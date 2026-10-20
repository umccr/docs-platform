import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from '@jest/globals';
import { AppStage, STAGE_ENVIRONMENT, TOOLCHAIN_ENVIRONMENT } from '../infrastructure/stages';
import {
  DOCS_CONTENT_BUCKET_PARAMETER,
  DOCS_DOMAIN_NAMES,
  DocsHostingStackConfig,
  getDocsHostingStackConfig,
  ORCASONAR_INGEST_BUCKET_PARAMETER,
  SONAR_API_URLS,
} from '../infrastructure/config';
import { DocsHostingStack } from '../infrastructure/stage/hosting-stack';
import {
  acknowledgeFindings,
  addAwsSolutionsChecks,
  expectNoUnacknowledgedFindings,
} from './cdk-nag-helpers';

// AwsSolutions findings accepted for the docs hosting stack.
const ACCEPTED_DOCS_HOSTING_RULES = [
  'AwsSolutions-S1', // CloudFront standard logs record content access; the log bucket needs no log of its own
  'AwsSolutions-IAM4', // AWSLambdaBasicExecutionRole for the session Lambda and CDK's BucketDeployment
  'AwsSolutions-IAM5', // the publisher's sites/* (each run narrows it to one site) and BucketDeployment's copy
  'AwsSolutions-L1', // CDK-managed BucketDeployment runtime
  'AwsSolutions-CFR1', // no geo restriction: readers work from anywhere, and every page requires a session
  'AwsSolutions-CFR2', // no WAF in the first release; every request is checked for a session at the edge
  // The session key is also built into the edge function, which Secrets Manager rotation cannot update; it rotates
  // by a new generation in config.ts instead (see docs/operating/runbooks.md).
  'AwsSolutions-SMG4',
];

type Resource = {
  Properties: Record<string, unknown>;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
};
type Statement = {
  Effect: string;
  Action: string | string[];
  Resource?: unknown;
  Principal?: unknown;
  Condition?: Record<string, Record<string, unknown>>;
};

const synthStack = (appStage: AppStage, overrides: Partial<DocsHostingStackConfig> = {}) => {
  const app = new App({});
  const stack = new DocsHostingStack(app, `${appStage}DocsHostingStack`, {
    env: STAGE_ENVIRONMENT[appStage],
    tags: { 'umccr-org:Product': 'Docs', 'umccr-org:Creator': 'CDK' },
    ...getDocsHostingStackConfig(appStage),
    ...overrides,
  });
  // The template is built on first use: synthesizing before the cdk-nag test attaches its checks would let that
  // test's synth reuse the cached assembly and run no validation.
  return {
    app,
    stack,
    get template() {
      return Template.fromStack(stack);
    },
  };
};

const templates = Object.fromEntries(
  Object.values(AppStage).map((appStage) => [appStage, synthStack(appStage).template])
) as Record<AppStage, Template>;

const resources = (template: Template, type: string): Resource[] =>
  Object.values(template.findResources(type)) as Resource[];

const onlyResource = (template: Template, type: string): Resource => {
  const found = resources(template, type);
  expect(found).toHaveLength(1);
  return found[0];
};

const distributionConfig = (template: Template) =>
  onlyResource(template, 'AWS::CloudFront::Distribution').Properties.DistributionConfig as {
    Aliases: string[];
    DefaultCacheBehavior: Record<string, unknown>;
    CacheBehaviors: Array<Record<string, unknown>>;
    CustomErrorResponses: Array<Record<string, unknown>>;
    Logging?: Record<string, unknown>;
  };

const publisherRoles = (template: Template) =>
  Object.entries(template.findResources('AWS::IAM::Role')).filter(
    ([, role]) => (role as Resource).Properties.RoleName === 'docs-publisher'
  );

const policyStatementsFor = (template: Template, roleLogicalId: string): Statement[] =>
  resources(template, 'AWS::IAM::Policy')
    .filter((policy) =>
      JSON.stringify(policy.Properties.Roles ?? []).includes(`"${roleLogicalId}"`)
    )
    .flatMap(
      (policy) => (policy.Properties.PolicyDocument as { Statement: Statement[] }).Statement
    );

/** The session Lambda: the only function on the Node 24 runtime (BucketDeployment's is CDK-managed). */
const sessionLambda = (template: Template): Resource => {
  const own = resources(template, 'AWS::Lambda::Function').filter(
    (fn) => (fn.Properties.Runtime as string) === 'nodejs24.x'
  );
  expect(own).toHaveLength(1);
  return own[0];
};

const lambdaVariables = (template: Template): Record<string, unknown> =>
  (sessionLambda(template).Properties.Environment as { Variables: Record<string, unknown> })
    .Variables;

const sessionKeyLogicalId = (template: Template): string => {
  const ids = Object.keys(template.findResources('AWS::SecretsManager::Secret'));
  expect(ids).toHaveLength(1);
  return ids[0];
};

const viewerRequestCode = (template: Template): string =>
  JSON.stringify(onlyResource(template, 'AWS::CloudFront::Function').Properties.FunctionCode);

/** How a JavaScript fragment of the function appears inside the template's JSON. */
const asTemplateText = (fragment: string): string => JSON.stringify(fragment).slice(1, -1);

describe('cdk-nag', () => {
  test.each(Object.values(AppStage))('%s reports no unacknowledged findings', (appStage) => {
    const { app, stack } = synthStack(appStage);
    addAwsSolutionsChecks(stack);
    acknowledgeFindings(
      stack,
      ACCEPTED_DOCS_HOSTING_RULES,
      'Accepted for docs hosting; see test comments'
    );
    expect(() => expectNoUnacknowledgedFindings(app)).not.toThrow();
  });
});

describe.each(Object.values(AppStage))('%s', (appStage) => {
  const template = templates[appStage];

  test('retains nothing when its first create rolls back', () => {
    const retained = Object.entries(template.toJSON().Resources as Record<string, Resource>)
      .filter(([, resource]) => resource.DeletionPolicy === 'Retain')
      .map(([logicalId]) => logicalId);
    expect(retained).toEqual([]);
  });

  test('keeps content in a private, versioned, retained bucket', () => {
    const bucket = resources(template, 'AWS::S3::Bucket').find(
      (candidate) =>
        candidate.Properties.BucketName === `docs-cloudfront-${STAGE_ENVIRONMENT[appStage].account}`
    );
    expect(bucket).toBeDefined();
    // Kept on update and delete, but not after a failed first create, where it would block the retry by name.
    expect(bucket!.DeletionPolicy).toBe('RetainExceptOnCreate');
    expect(bucket!.UpdateReplacePolicy).toBe('Retain');
    expect(bucket!.Properties.VersioningConfiguration).toEqual({ Status: 'Enabled' });
    expect(bucket!.Properties.PublicAccessBlockConfiguration).toEqual({
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    });
  });

  test('lets only CloudFront read the content bucket', () => {
    const policy = resources(template, 'AWS::S3::BucketPolicy').find((candidate) =>
      JSON.stringify(candidate.Properties.Bucket).includes('DocsContentBucket')
    );
    expect(policy).toBeDefined();
    const statements = (policy!.Properties.PolicyDocument as { Statement: Statement[] }).Statement;

    for (const statement of statements.filter((candidate) => candidate.Effect === 'Allow')) {
      expect(statement.Principal).toEqual({ Service: 'cloudfront.amazonaws.com' });
      expect(JSON.stringify(statement.Condition)).toContain('AWS:SourceArn');
    }
    const actions = statements.flatMap((statement) => [statement.Action].flat());
    expect(actions).toEqual(expect.arrayContaining(['s3:GetObject', 's3:ListBucket']));
  });

  test('answers on the stage hostnames with the Terraform-issued certificate', () => {
    const config = distributionConfig(template);
    expect(config.Aliases).toEqual(DOCS_DOMAIN_NAMES[appStage]);
    expect(JSON.stringify(template.toJSON().Parameters)).toContain('/docs/certificate_arn');
  });

  test('routes /_auth/session to the Lambda before the other /_auth/ paths', () => {
    const config = distributionConfig(template);
    expect(config.CacheBehaviors.map((behavior) => behavior.PathPattern)).toEqual([
      '/_auth/session',
      '/_auth/*',
    ]);
  });

  test('runs the viewer-request function on every behaviour, before the cache', () => {
    const config = distributionConfig(template);
    for (const behavior of [config.DefaultCacheBehavior, ...config.CacheBehaviors]) {
      expect(behavior.FunctionAssociations).toEqual([
        expect.objectContaining({ EventType: 'viewer-request' }),
      ]);
      expect(behavior.AllowedMethods).toEqual(['GET', 'HEAD']);
      expect(behavior.ViewerProtocolPolicy).toBe('redirect-to-https');
    }
  });

  test('keeps cookies, headers and query strings out of the cache key', () => {
    const policy = onlyResource(template, 'AWS::CloudFront::CachePolicy').Properties
      .CachePolicyConfig as { ParametersInCacheKeyAndForwardedToOrigin: Record<string, unknown> };
    expect(policy.ParametersInCacheKeyAndForwardedToOrigin).toMatchObject({
      CookiesConfig: { CookieBehavior: 'none' },
      HeadersConfig: { HeaderBehavior: 'none' },
      QueryStringsConfig: { QueryStringBehavior: 'none' },
    });
  });

  test('serves the platform 404 page and logs without cookies', () => {
    const config = distributionConfig(template);
    expect(config.CustomErrorResponses).toEqual([
      expect.objectContaining({
        ErrorCode: 404,
        ResponseCode: 404,
        ResponsePagePath: '/_platform/public/404.html',
      }),
    ]);
    expect(config.Logging).toMatchObject({ IncludeCookies: false });
  });

  test('bakes the stage sites and the session key reference into the viewer-request function', () => {
    const fn = onlyResource(template, 'AWS::CloudFront::Function');
    const code = viewerRequestCode(template);
    const config = getDocsHostingStackConfig(appStage);
    const expectedSites = config.sites.map((site) => site.slug);

    expect(code).toContain(asTemplateText(`"sites":${JSON.stringify(expectedSites)}`));
    expect(code).toContain(asTemplateText(`"keyId":"${config.sessionKeyGeneration}"`));
    // A dynamic reference to the stack's secret, which CloudFormation resolves while deploying: never the key.
    expect(code).toContain('{{resolve:secretsmanager:');
    expect(code).toContain(`"Ref":"${sessionKeyLogicalId(template)}"`);
    expect((fn.Properties.FunctionConfig as { Runtime: string }).Runtime).toBe('cloudfront-js-2.0');
  });

  test('generates the session key in Secrets Manager, from letters and digits only', () => {
    const secret = onlyResource(template, 'AWS::SecretsManager::Secret');
    // Letters and digits because CloudFormation pastes the value into the function's JavaScript source.
    expect(secret.Properties.GenerateSecretString).toEqual({
      PasswordLength: 64,
      ExcludePunctuation: true,
      IncludeSpace: false,
    });
    expect(secret.Properties.SecretString).toBeUndefined();
    expect(secret.DeletionPolicy).toBe('Delete');
    expect(sessionKeyLogicalId(template)).toMatch(
      new RegExp(`^DocsSessionKeyV${getDocsHostingStackConfig(appStage).sessionKeyGeneration}`)
    );
  });

  test('uses no CloudFront KeyValueStore', () => {
    expect(resources(template, 'AWS::CloudFront::KeyValueStore')).toHaveLength(0);
    expect(JSON.stringify(template.toJSON())).not.toMatch(/KeyValueStore|cloudfront-keyvaluestore/);
  });

  test('has exactly one Lambda of its own, the session Lambda, reachable only through CloudFront', () => {
    const variables = lambdaVariables(template);
    expect(Object.keys(variables).sort()).toEqual(
      [
        'ALLOWED_HOSTS',
        'APP_CLIENT_ID',
        'SESSION_KEY_ID',
        'SESSION_KEY_SECRET_ARN',
        'SESSION_LIFETIME_SECONDS',
        'USER_POOL_ID',
      ].sort()
    );
    expect(variables.ALLOWED_HOSTS).toBe(JSON.stringify(DOCS_DOMAIN_NAMES[appStage]));
    expect(variables.SESSION_KEY_ID).toBe(
      String(getDocsHostingStackConfig(appStage).sessionKeyGeneration)
    );
    // The secret's ARN, not its value.
    expect(variables.SESSION_KEY_SECRET_ARN).toEqual({ Ref: sessionKeyLogicalId(template) });

    expect(onlyResource(template, 'AWS::Lambda::Url').Properties.AuthType).toBe('AWS_IAM');
  });

  test('lets only the session Lambda read the session key', () => {
    const secretRef = `"Ref":"${sessionKeyLogicalId(template)}"`;
    const readers = resources(template, 'AWS::IAM::Policy').filter((policy) =>
      JSON.stringify(policy.Properties.PolicyDocument).includes(secretRef)
    );
    expect(readers).toHaveLength(1);

    const role = sessionLambda(template).Properties.Role as { 'Fn::GetAtt': [string, string] };
    expect(readers[0].Properties.Roles).toEqual([{ Ref: role['Fn::GetAtt'][0] }]);

    const actions = (
      readers[0].Properties.PolicyDocument as { Statement: Statement[] }
    ).Statement.filter((statement) =>
      JSON.stringify(statement.Resource).includes(secretRef)
    ).flatMap((statement) => [statement.Action].flat());
    expect(actions.sort()).toEqual([
      'secretsmanager:DescribeSecret',
      'secretsmanager:GetSecretValue',
    ]);
  });

  test('alarms when sign-ins are refused as unavailable', () => {
    const filter = onlyResource(template, 'AWS::Logs::MetricFilter');
    expect(filter.Properties.FilterPattern).toContain('$.outcome = "unavailable"');
    expect(filter.Properties.FilterPattern).toContain('$.outcome = "key-mismatch"');

    const alarm = resources(template, 'AWS::CloudWatch::Alarm').find(
      (candidate) => candidate.Properties.MetricName === 'SessionUnavailable'
    );
    expect(alarm).toBeDefined();
    expect(alarm!.Properties).toMatchObject({ Namespace: 'Docs', Statistic: 'Sum', Threshold: 5 });
  });

  test('has one publisher role, assumable only by the site pipeline in the toolchain account', () => {
    const roles = publisherRoles(template);
    expect(roles).toHaveLength(1);
    const [logicalId, role] = roles[0];
    expect((role as Resource).Properties.Path).toBe('/docs/');

    const trust = (role as Resource).Properties.AssumeRolePolicyDocument as {
      Statement: Statement[];
    };
    expect(trust.Statement).toHaveLength(1);
    expect(trust.Statement[0].Action).toBe('sts:AssumeRole');
    // The toolchain account, narrowed to the site pipeline's publish role by condition.
    expect(JSON.stringify(trust.Statement[0].Principal)).toContain(
      `:iam::${TOOLCHAIN_ENVIRONMENT.account}:root`
    );
    expect(JSON.stringify(trust.Statement[0].Condition)).toContain(
      `:iam::${TOOLCHAIN_ENVIRONMENT.account}:role/docs-sites-publish`
    );
    expect(Object.keys(trust.Statement[0].Condition as object)).toEqual(['ArnEquals']);
    expect(JSON.stringify(template.toJSON())).not.toContain('token.actions.githubusercontent.com');
    expect(resources(template, 'AWS::IAM::OIDCProvider')).toHaveLength(0);

    const statements = policyStatementsFor(template, logicalId);
    const actions = statements.flatMap((statement) => [statement.Action].flat()).sort();
    expect(actions).toEqual([
      's3:DeleteObject',
      's3:GetObject',
      's3:ListBucket',
      's3:PutObject',
      'ssm:GetParameter',
    ]);

    const list = statements.find((statement) => statement.Action === 's3:ListBucket')!;
    expect(list.Condition).toEqual({ StringLike: { 's3:prefix': ['sites/*'] } });
    const write = statements.find((statement) =>
      [statement.Action].flat().includes('s3:PutObject')
    )!;
    expect(JSON.stringify(write.Resource)).toContain('/sites/*');

    const parameters = JSON.stringify(
      statements.find((statement) => statement.Action === 'ssm:GetParameter')!.Resource
    );
    expect(parameters).toContain(`parameter${DOCS_CONTENT_BUCKET_PARAMETER}`);
    expect(parameters).toContain(`parameter${ORCASONAR_INGEST_BUCKET_PARAMETER}`);
  });

  test('names the content bucket in SSM for the publish steps', () => {
    const parameter = resources(template, 'AWS::SSM::Parameter').find(
      (candidate) => candidate.Properties.Name === DOCS_CONTENT_BUCKET_PARAMETER
    );
    expect(parameter).toBeDefined();
    expect(JSON.stringify(parameter!.Properties.Value)).toContain('DocsContentBucket');
  });

  test('lets content pages call OrcaSonar and Cognito, and nothing else off-origin', () => {
    const policies = resources(template, 'AWS::CloudFront::ResponseHeadersPolicy').map(
      (policy) =>
        (
          policy.Properties.ResponseHeadersPolicyConfig as {
            Name?: string;
            SecurityHeadersConfig: { ContentSecurityPolicy: { ContentSecurityPolicy: string } };
          }
        ).SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy
    );
    const content = policies.find((csp) => csp.includes("'unsafe-inline'"));
    expect(content).toBeDefined();
    const connect = JSON.stringify(content).match(/connect-src ([^;]*);/)![1];
    expect(connect).toContain("'self'");
    expect(connect).toContain(new URL(SONAR_API_URLS[appStage]).origin);
    expect(connect).toContain('https://cognito-idp.');
    expect(connect.split(' ')).toHaveLength(3);
  });

  test('never lets a publisher touch CloudFront or the session key', () => {
    for (const [logicalId] of publisherRoles(template)) {
      const actions = policyStatementsFor(template, logicalId).flatMap((statement) =>
        [statement.Action].flat()
      );
      expect(actions.some((action) => action.startsWith('cloudfront'))).toBe(false);
      expect(actions.some((action) => action.startsWith('secretsmanager'))).toBe(false);
    }
  });

  test('points docs.<stage> at the distribution', () => {
    const record = onlyResource(template, 'AWS::Route53::RecordSet');
    expect(record.Properties.Type).toBe('A');
    expect(JSON.stringify(record.Properties.Name)).toContain('docs.');
  });
});

describe('rotating the session key', () => {
  const current = templates[AppStage.BETA];
  const rotated = synthStack(AppStage.BETA, {
    sessionKeyGeneration: getDocsHostingStackConfig(AppStage.BETA).sessionKeyGeneration + 1,
  }).template;
  const nextGeneration = String(getDocsHostingStackConfig(AppStage.BETA).sessionKeyGeneration + 1);

  test('a new generation is a new secret, so CloudFormation generates a new key and deletes the old', () => {
    expect(sessionKeyLogicalId(rotated)).not.toBe(sessionKeyLogicalId(current));
    expect(sessionKeyLogicalId(rotated)).toMatch(new RegExp(`^DocsSessionKeyV${nextGeneration}`));
  });

  test('the edge function and the Lambda move to the new key together', () => {
    const code = viewerRequestCode(rotated);
    expect(code).toContain(`"Ref":"${sessionKeyLogicalId(rotated)}"`);
    expect(code).toContain(asTemplateText(`"keyId":"${nextGeneration}"`));
    expect(lambdaVariables(rotated)).toMatchObject({
      SESSION_KEY_ID: nextGeneration,
      SESSION_KEY_SECRET_ARN: { Ref: sessionKeyLogicalId(rotated) },
    });
  });

  test.each([0, -1, 1.5, Number.NaN])('refuses generation %p', (generation) => {
    expect(() => synthStack(AppStage.BETA, { sessionKeyGeneration: generation })).toThrow(
      'positive integer'
    );
  });
});
