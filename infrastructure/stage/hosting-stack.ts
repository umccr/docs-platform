import * as path from 'path';
import { Aws, CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  BehaviorOptions,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  HttpVersion,
  IOrigin,
  OriginRequestPolicy,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  SSLMethod,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Alarm, ComparisonOperator, Stats, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { AccountPrincipal, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Architecture, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { FilterPattern, LogGroup, MetricFilter, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { BlockPublicAccess, Bucket, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { buildAuthWeb } from '../../app/auth-web/build';
import {
  COGNITO_OAUTH_DOMAIN_PARAMETER,
  COGNITO_USER_POOL_ID_PARAMETER,
  DOCS_APP_CLIENT_ID_PARAMETER,
  DOCS_CERTIFICATE_ARN_PARAMETER,
  DOCS_CONTENT_BUCKET_PARAMETER,
  DOCS_PUBLISHER_ROLE_NAME,
  DOCS_PUBLISHER_ROLE_PATH,
  DOCS_SITES_PUBLISH_ROLE_NAME,
  DocsHostingStackConfig,
  ORCASONAR_INGEST_BUCKET_NAME_PREFIX,
  ORCASONAR_INGEST_BUCKET_PARAMETER,
} from '../config';
import { DocsSite } from '../sites';
import { TOOLCHAIN_ENVIRONMENT } from '../stages';
import { renderViewerRequestCode } from './viewer-request';

export type DocsHostingStackProps = DocsHostingStackConfig & StackProps;

const retentionFor = (days: number): RetentionDays => {
  const periods = Object.values(RetentionDays).filter(
    (value): value is number => typeof value === 'number'
  );
  if (!periods.includes(days)) {
    throw new Error(`${days} days is not a CloudWatch Logs retention period`);
  }
  return days;
};

/**
 * Hosting for the authenticated documentation site, `docs.<stage>.umccr.org`.
 *
 * Sites are built by the shared site pipeline in the toolchain account and published into `sites/<slug>/` of one
 * private bucket, through the single `docs-publisher` role this stack creates. Readers sign in on `/_auth/` with Amplify, exactly as in the portal apps; the session Lambda swaps the
 * Cognito ID token for an HttpOnly cookie; a CloudFront Function checks that cookie on every request before the
 * cache. That Lambda is the only one: CloudFront Functions can compute HMAC but cannot verify Cognito's RSA
 * signatures, so the token has to be checked once somewhere that can.
 *
 * Both sides share one HMAC key, the session key: a Secrets Manager secret whose value CloudFormation generates. The
 * Lambda reads it at run time; the function gets it at deploy time, since CloudFront Functions cannot call AWS APIs.
 *
 * S3 layout:
 *
 *  - `sites/<slug>/`       each site, written only by `docs-publisher`, narrowed to that site for each publish
 *  - `_auth/`              the sign-in page and its env.js (public)
 *  - `_platform/public/`   404 page, robots.txt, favicon (public)
 *  - `_platform/data/`     catalogue data for the platform site (signed-in readers only)
 */
export class DocsHostingStack extends Stack {
  constructor(scope: Construct, id: string, props: DocsHostingStackProps) {
    super(scope, id, props);

    const userPoolId = StringParameter.valueForStringParameter(
      this,
      COGNITO_USER_POOL_ID_PARAMETER
    );
    const appClientId = StringParameter.valueForStringParameter(this, DOCS_APP_CLIENT_ID_PARAMETER);
    const oauthDomain = StringParameter.valueForStringParameter(
      this,
      COGNITO_OAUTH_DOMAIN_PARAMETER
    );

    // Content. Versioned so an overwrite or deletion by a publish can be rolled back.
    const contentBucket = new Bucket(this, 'DocsContentBucket', {
      bucketName: `docs-cloudfront-${this.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [
        { noncurrentVersionExpiration: Duration.days(30) },
        { abortIncompleteMultipartUploadAfter: Duration.days(7) },
      ],
      // Unlike the portal buckets: object versions are part of the rollback path, so keep them. Not after a failed
      // first create, though: a kept bucket would hold the fixed name and block the retry.
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    // CloudFront standard logs hold paths and IP addresses, so they expire.
    const logBucket = new Bucket(this, 'DocsLogBucket', {
      bucketName: `docs-cloudfront-logs-${this.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // CloudFront standard logging writes with an ACL.
      objectOwnership: ObjectOwnership.OBJECT_WRITER,
      lifecycleRules: [{ expiration: Duration.days(props.logRetentionDays) }],
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    // The session key. CloudFormation generates the value inside Secrets Manager, so it never appears in this
    // repository, a template or the pipeline, and nobody has to create it. One secret per generation: increasing
    // DOCS_SESSION_KEY_GENERATION in config.ts creates a new secret and deletes this one, which rotates the key.
    if (!Number.isInteger(props.sessionKeyGeneration) || props.sessionKeyGeneration < 1) {
      throw new Error(
        `sessionKeyGeneration must be a positive integer, not ${props.sessionKeyGeneration}`
      );
    }
    const sessionKeyId = String(props.sessionKeyGeneration);
    const sessionKey = new Secret(this, `DocsSessionKeyV${sessionKeyId}`, {
      description:
        `docs.umccr.org session key, generation ${sessionKeyId}. Generated by CloudFormation and built into the ` +
        'viewer-request function: rotate by increasing DOCS_SESSION_KEY_GENERATION, never by editing this value.',
      generateSecretString: {
        passwordLength: 64,
        // Letters and digits only: CloudFormation pastes the value into the function's JavaScript source.
        excludePunctuation: true,
        includeSpace: false,
      },
      // A rotated-out key has no further use.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const sessionFunction = this.sessionFunction(props, {
      userPoolId,
      appClientId,
      sessionKey,
      sessionKeyId,
    });
    const sessionFunctionUrl = sessionFunction.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
    });

    const viewerRequestFunction = new CloudFrontFunction(this, 'DocsViewerRequestFunction', {
      runtime: FunctionRuntime.JS_2_0,
      comment: 'docs.umccr.org: session check and clean URLs',
      code: FunctionCode.fromInline(
        renderViewerRequestCode({
          sites: props.sites.map((site) => site.slug),
          canonicalHost: props.canonicalHost,
          sessionKeyId,
          // A `{{resolve:secretsmanager:...}}` dynamic reference: CloudFormation substitutes the value while it
          // deploys the function, and the synthesized template holds only the reference. Anyone allowed to read the
          // function's code in this account can read the key; such principals can generally read the bucket too.
          sessionKey: sessionKey.secretValue.unsafeUnwrap(),
        })
      ),
    });

    const distribution = this.distribution(props, {
      contentBucket,
      logBucket,
      viewerRequestFunction,
      sessionOrigin: FunctionUrlOrigin.withOriginAccessControl(sessionFunctionUrl),
    });

    // With list access, S3 answers 404 for a missing key instead of 403, so readers get the 404 page.
    contentBucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        principals: [new ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [contentBucket.bucketArn],
        conditions: { StringEquals: { 'AWS:SourceArn': distribution.distributionArn } },
      })
    );

    this.deployPlatformFiles(props, contentBucket, { userPoolId, appClientId, oauthDomain });
    this.aliasRecord(distribution);
    this.publisherRole(contentBucket);

    // The publish steps find the bucket here after assuming docs-publisher, so no bucket name is configured anywhere
    // else.
    new StringParameter(this, 'DocsContentBucketNameParameter', {
      parameterName: DOCS_CONTENT_BUCKET_PARAMETER,
      stringValue: contentBucket.bucketName,
      description: 'docs.umccr.org content bucket, for the site pipeline publish steps',
    });

    new Alarm(this, 'DocsSessionErrorsAlarm', {
      alarmDescription: 'docs.umccr.org session Lambda errors: readers may be unable to sign in',
      metric: sessionFunction.metricErrors({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    new Alarm(this, 'DocsSessionThrottlesAlarm', {
      alarmDescription: 'docs.umccr.org session Lambda throttled: readers may be unable to sign in',
      metric: sessionFunction.metricThrottles({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    // The Lambda answers 503 itself when it cannot read the session key or holds a different key from the edge, so
    // those failures never count as Lambda errors. Its log lines do.
    const unavailableSignIns = new MetricFilter(this, 'DocsSessionUnavailableMetric', {
      logGroup: sessionFunction.logGroup,
      filterPattern: FilterPattern.any(
        FilterPattern.stringValue('$.outcome', '=', 'unavailable'),
        FilterPattern.stringValue('$.outcome', '=', 'key-mismatch')
      ),
      metricNamespace: 'Docs',
      metricName: 'SessionUnavailable',
      metricValue: '1',
    });
    new Alarm(this, 'DocsSessionUnavailableAlarm', {
      alarmDescription:
        'docs.umccr.org sign-ins refused as unavailable: the session key is unreadable, or differs from the ' +
        'one the edge holds. Expected for a few minutes after a key rotation; see docs/site/runbook.md.',
      metric: unavailableSignIns.metric({ statistic: Stats.SUM, period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    new CfnOutput(this, 'DocsBucketName', { value: contentBucket.bucketName });
    new CfnOutput(this, 'DocsDistributionId', { value: distribution.distributionId });
  }

  /**
   * The only Lambda: `GET /_auth/session` exchanges a Cognito ID token for the docs session cookie. See
   * `lambda/session/session.ts`.
   */
  private sessionFunction(
    props: DocsHostingStackProps,
    settings: { userPoolId: string; appClientId: string; sessionKey: Secret; sessionKeyId: string }
  ): NodejsFunction {
    const logGroup = new LogGroup(this, 'DocsSessionLogGroup', {
      retention: retentionFor(props.logRetentionDays),
      // Sign-in logs outlive the stack until they expire, but not a failed first create.
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    const sessionFunction = new NodejsFunction(this, 'DocsSessionFunction', {
      entry: path.join(__dirname, '..', '..', 'app', 'session', 'index.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup,
      environment: {
        USER_POOL_ID: settings.userPoolId,
        APP_CLIENT_ID: settings.appClientId,
        // Where the key is, not the key: the Lambda reads it from Secrets Manager at run time.
        SESSION_KEY_SECRET_ARN: settings.sessionKey.secretArn,
        SESSION_KEY_ID: settings.sessionKeyId,
        ALLOWED_HOSTS: JSON.stringify(props.domainNames),
        SESSION_LIFETIME_SECONDS: String(props.sessionLifetimeSeconds),
      },
      bundling: {
        // Bundle every dependency, AWS SDK included, so the function runs the versions this repository tests
        // rather than whichever the runtime ships.
        externalModules: [],
        format: OutputFormat.CJS,
        minify: true,
        sourceMap: false,
      },
    });

    settings.sessionKey.grantRead(sessionFunction);

    return sessionFunction;
  }

  private distribution(
    props: DocsHostingStackProps,
    resources: {
      contentBucket: Bucket;
      logBucket: Bucket;
      viewerRequestFunction: CloudFrontFunction;
      sessionOrigin: IOrigin;
    }
  ): Distribution {
    const certificate = Certificate.fromCertificateArn(
      this,
      'DocsCertificate',
      StringParameter.valueForStringParameter(this, DOCS_CERTIFICATE_ARN_PARAMETER)
    );

    // Nothing viewer-specific in the key: the function has already rejected unauthenticated requests, and every
    // signed-in reader sees the same content, so one cache serves them all. Objects set their own Cache-Control.
    const contentCachePolicy = new CachePolicy(this, 'DocsContentCachePolicy', {
      comment: 'docs.umccr.org content: shared cache for signed-in readers',
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.days(365),
      cookieBehavior: CacheCookieBehavior.none(),
      headerBehavior: CacheHeaderBehavior.none(),
      queryStringBehavior: CacheQueryStringBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const viewerRequest = [
      { function: resources.viewerRequestFunction, eventType: FunctionEventType.VIEWER_REQUEST },
    ];
    const s3Origin = S3BucketOrigin.withOriginAccessControl(resources.contentBucket);

    const contentBehavior: BehaviorOptions = {
      origin: s3Origin,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: contentCachePolicy,
      responseHeadersPolicy: this.headersPolicy('DocsContentHeaders', {
        // The documentation theme ships inline scripts and styles. Everything else must come from this origin, so a
        // page can neither load third-party code nor send data elsewhere with fetch or image beacons. The two
        // exceptions are for the chat panel: OrcaSonar's API, and the Cognito API that Amplify refreshes tokens with.
        contentSecurityPolicy:
          "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data:; font-src 'self' data:; " +
          `connect-src 'self' ${new URL(props.sonarApiUrl).origin} https://cognito-idp.${this.region}.amazonaws.com; ` +
          "object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      }),
      functionAssociations: viewerRequest,
      compress: true,
    };

    return new Distribution(this, 'DocsDistribution', {
      comment: `docs.umccr.org (${props.appStage})`,
      defaultBehavior: contentBehavior,
      additionalBehaviors: {
        // Must precede /_auth/*: CloudFront matches behaviours in order.
        '/_auth/session': {
          origin: resources.sessionOrigin,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          // Forwards x-docs-id-token, x-docs-host and Sec-Fetch-Site. The Host header must stay the function URL's.
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: this.headersPolicy('DocsSessionHeaders', {
            contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'",
          }),
          functionAssociations: viewerRequest,
        },
        '/_auth/*': {
          ...contentBehavior,
          responseHeadersPolicy: this.headersPolicy('DocsSignInHeaders', {
            // Amplify talks to the Cognito hosted UI (token exchange) and the Cognito API (refresh).
            contentSecurityPolicy:
              "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
              `connect-src 'self' https://cognito-idp.${this.region}.amazonaws.com ` +
              `https://*.auth.${this.region}.amazoncognito.com; object-src 'none'; ` +
              "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          }),
        },
      },
      domainNames: props.domainNames,
      certificate,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      sslSupportMethod: SSLMethod.SNI,
      httpVersion: HttpVersion.HTTP2_AND_3,
      // Price class All is the only one that includes Australian edge locations.
      priceClass: PriceClass.PRICE_CLASS_ALL,
      enableIpv6: false,
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 404,
          responsePagePath: '/_platform/public/404.html',
          ttl: Duration.minutes(1),
        },
      ],
      enableLogging: true,
      logBucket: resources.logBucket,
      logFilePrefix: 'cloudfront/',
      logIncludesCookies: false,
    });
  }

  private headersPolicy(
    id: string,
    options: { contentSecurityPolicy: string }
  ): ResponseHeadersPolicy {
    return new ResponseHeadersPolicy(this, id, {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: false,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: HeadersFrameOption.DENY, override: true },
        // Private paths must not leak to external sites through the Referer header.
        referrerPolicy: { referrerPolicy: HeadersReferrerPolicy.SAME_ORIGIN, override: true },
        contentSecurityPolicy: {
          contentSecurityPolicy: options.contentSecurityPolicy,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'X-Robots-Tag', value: 'noindex, nofollow', override: true }],
      },
    });
  }

  /** The sign-in page, its runtime config, the public error pages and the catalogue data. */
  private deployPlatformFiles(
    props: DocsHostingStackProps,
    contentBucket: Bucket,
    cognito: { userPoolId: string; appClientId: string; oauthDomain: string }
  ): void {
    // Same keys as the portal's env.js, so the sign-in page's auth code matches orcahouse-ui's, plus OrcaSonar's URL
    // for the chat panel. Values are resolved at deploy time, so one build of the page serves every stage.
    const envJs = `window.config = ${this.toJsonString({
      VITE_REGION: this.region,
      VITE_COG_USER_POOL_ID: cognito.userPoolId,
      VITE_COG_APP_CLIENT_ID: cognito.appClientId,
      VITE_OAUTH_DOMAIN: cognito.oauthDomain,
      VITE_SONAR_API_URL: props.sonarApiUrl,
    })};\n`;

    new BucketDeployment(this, 'DocsSignInPageDeployment', {
      destinationBucket: contentBucket,
      destinationKeyPrefix: '_auth/',
      sources: [Source.asset(buildAuthWeb()), Source.data('env.js', envJs)],
      cacheControl: [CacheControl.noCache()],
    });

    new BucketDeployment(this, 'DocsPublicFilesDeployment', {
      destinationBucket: contentBucket,
      destinationKeyPrefix: '_platform/public/',
      sources: [Source.asset(path.join(__dirname, '..', '..', 'app', 'static', 'public'))],
      cacheControl: [CacheControl.noCache()],
    });

    new BucketDeployment(this, 'DocsCatalogueDeployment', {
      destinationBucket: contentBucket,
      destinationKeyPrefix: '_platform/data/',
      sources: [Source.jsonData('catalog.json', catalogueFor(props.sites))],
      cacheControl: [CacheControl.noCache()],
    });
  }

  /** `docs.<stage>.umccr.org`, in this account's stage zone, as the portal does for `portal.<stage>`. */
  private aliasRecord(distribution: Distribution): void {
    const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: StringParameter.valueForStringParameter(this, '/hosted_zone/umccr/id'),
      zoneName: StringParameter.valueForStringParameter(this, '/hosted_zone/umccr/name'),
    });

    new ARecord(this, 'DocsDomainAlias', {
      zone: hostedZone,
      recordName: 'docs',
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });
  }

  /**
   * The one role every site publish assumes. Only the site pipeline's publish steps in the toolchain account can
   * assume it, and each run narrows it with a session policy to its own `sites/<slug>/` here and `docs/<slug>/` in
   * OrcaSonar's ingest bucket. No CloudFront rights: pages are served `no-cache`, so a publish needs no invalidation.
   */
  private publisherRole(contentBucket: Bucket): Role {
    const role = new Role(this, 'DocsPublisherRole', {
      roleName: DOCS_PUBLISHER_ROLE_NAME,
      path: DOCS_PUBLISHER_ROLE_PATH,
      description:
        'Publishes docs.umccr.org sites from the site pipeline; each run is narrowed to one site',
      maxSessionDuration: Duration.hours(1),
      // The toolchain account, limited to the publish role by a condition rather than by naming the role as the
      // principal: IAM rejects a trust policy that names a role that does not exist yet, and this stack can deploy
      // before the toolchain stack creates it.
      assumedBy: new AccountPrincipal(TOOLCHAIN_ENVIRONMENT.account).withConditions({
        ArnEquals: {
          'aws:PrincipalArn': `arn:${Aws.PARTITION}:iam::${TOOLCHAIN_ENVIRONMENT.account}:role/${DOCS_SITES_PUBLISH_ROLE_NAME}`,
        },
      }),
    });

    role.addToPolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [contentBucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': ['sites/*'] } },
      })
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [contentBucket.arnForObjects('sites/*')],
      })
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [DOCS_CONTENT_BUCKET_PARAMETER, ORCASONAR_INGEST_BUCKET_PARAMETER].map(
          (name) => `arn:${Aws.PARTITION}:ssm:${this.region}:${this.account}:parameter${name}`
        ),
      })
    );

    // Documents go to docs/* in OrcaSonar's ingest bucket. Its bucket and key policies name this role only by
    // condition on the account principal, which leaves the decision to IAM, so the grant must be here. The bucket is
    // matched by its generated name, so this stack deploys whether or not OrcaSonar is in the account.
    const ingestBuckets = `arn:${Aws.PARTITION}:s3:::${ORCASONAR_INGEST_BUCKET_NAME_PREFIX}*`;
    role.addToPolicy(
      new PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [ingestBuckets],
        conditions: { StringLike: { 's3:prefix': ['docs/*'] } },
      })
    );
    role.addToPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
        resources: [`${ingestBuckets}/docs/*`],
      })
    );
    // The bucket encrypts with OrcaSonar's key: S3 calls KMS for the role, for that bucket only.
    role.addToPolicy(
      new PolicyStatement({
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [`arn:${Aws.PARTITION}:kms:${this.region}:${this.account}:key/*`],
        conditions: {
          StringEquals: { 'kms:ViaService': `s3.${this.region}.amazonaws.com` },
          StringLike: { 'kms:EncryptionContext:aws:s3:arn': [ingestBuckets] },
        },
      })
    );

    new CfnOutput(this, 'DocsPublisherRoleArn', { value: role.roleArn });
    return role;
  }
}

/** Catalogue rendered by the platform site. Titles and paths only; repositories stay out of it. */
export const catalogueFor = (sites: DocsSite[]) => ({
  sites: sites.map((site) => ({
    slug: site.slug,
    title: site.title,
    description: site.description,
    url: `/${site.slug}/`,
  })),
});
