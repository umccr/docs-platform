import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, jest, test } from '@jest/globals';
import type { Construct } from 'constructs';
import { minimatch } from 'minimatch';
import {
  DOCS_INFRASTRUCTURE_EXCLUDED_FILE_PATHS,
  DOCS_INFRASTRUCTURE_FILE_PATHS,
  DocsInfrastructureDeploymentStack,
} from '../infrastructure/toolchain/infrastructure-pipeline';
import { MAX_TRIGGER_FILE_PATHS } from '../infrastructure/toolchain/deployment-pipeline';
import { DocsHostingStack } from '../infrastructure/stage/hosting-stack';
import { AppStage, STAGE_ENVIRONMENT, TOOLCHAIN_ENVIRONMENT } from '../infrastructure/stages';
import { fetchBuildSpec, REFUSE_ESCAPING_SYMLINKS } from '../infrastructure/toolchain/fetch-build';
import {
  DOCS_SITES_NOTIFICATION_RULE_NAME,
  DOCS_SITES_PIPELINE_NAME,
} from '../infrastructure/toolchain/sites-pipeline';
import {
  acknowledgeFindings,
  addAwsSolutionsChecks,
  expectNoUnacknowledgedFindings,
} from './cdk-nag-helpers';

// AwsSolutions findings accepted for the CDK Pipelines resources, as for the other UMCCR pipelines.
const ACCEPTED_PIPELINE_RULES = [
  'AwsSolutions-IAM4',
  'AwsSolutions-IAM5',
  'AwsSolutions-S1',
  'AwsSolutions-CB4',
  // The webhook secret is shared with GitHub's organisation webhook settings, which nothing can update
  // automatically; it rotates by hand (docs/operating/runbooks.md).
  'AwsSolutions-SMG4',
];

// The hosting stack has its own cdk-nag test; mocking it keeps this test to the pipeline.
jest.mock('../infrastructure/stage/hosting-stack', () => ({
  DocsHostingStack: jest.fn((scope: Construct) => {
    const stack = new Stack(scope, 'mockDocsHostingStack', {});
    new (jest.requireActual<typeof import('aws-cdk-lib')>('aws-cdk-lib').CfnWaitConditionHandle)(
      stack,
      'Placeholder'
    );
    return stack;
  }),
}));

type PipelineProperties = {
  Name: string;
  PipelineType?: string;
  Stages: Array<{ Name: string; Actions: Array<{ Configuration?: Record<string, unknown> }> }>;
  Triggers?: unknown[];
};

describe('DocsInfrastructurePipeline', () => {
  const app = new App({});
  const stack = new DocsInfrastructureDeploymentStack(app, 'TestDocsInfrastructurePipeline', {
    env: TOOLCHAIN_ENVIRONMENT,
  });

  addAwsSolutionsChecks(stack);
  acknowledgeFindings(stack, ACCEPTED_PIPELINE_RULES, 'Allow CDK Pipeline');

  test('cdk-nag AwsSolutions Pack reports no unacknowledged findings', () => {
    expect(() => expectNoUnacknowledgedFindings(app)).not.toThrow();
  });

  // CodePipeline rejects a trigger filter list with more than 8 patterns, and only when the pipeline is created.
  test('every trigger filter list fits CodePipeline limits', () => {
    const pipelines = Object.values(
      Template.fromStack(stack).findResources('AWS::CodePipeline::Pipeline')
    ) as Array<{ Properties: PipelineProperties }>;
    const lists = pipelines.flatMap(({ Properties }) =>
      (
        (Properties.Triggers ?? []) as Array<{ GitConfiguration?: Record<string, unknown> }>
      ).flatMap(({ GitConfiguration }) =>
        [
          ...((GitConfiguration?.Push ?? []) as Array<Record<string, unknown>>),
          ...((GitConfiguration?.PullRequest ?? []) as Array<Record<string, unknown>>),
        ].flatMap((filter) =>
          ['FilePaths', 'Branches', 'Tags'].flatMap((kind) =>
            Object.values((filter[kind] ?? {}) as Record<string, string[]>)
          )
        )
      )
    );
    expect(lists.length).toBeGreaterThan(0);
    for (const list of lists) {
      expect(list.length).toBeGreaterThanOrEqual(1);
      expect(list.length).toBeLessThanOrEqual(MAX_TRIGGER_FILE_PATHS);
    }
  });

  // A failed first create must not leave retained resources behind: they would be orphans, and a fixed name would
  // block the retry. Resources worth keeping use RETAIN_ON_UPDATE_OR_DELETE (RetainExceptOnCreate).
  test('retains nothing when its first create rolls back', () => {
    const retained = Object.entries(Template.fromStack(stack).toJSON().Resources as object)
      .filter(
        ([, resource]) => (resource as { DeletionPolicy?: string }).DeletionPolicy === 'Retain'
      )
      .map(([logicalId]) => logicalId);
    expect(retained).toEqual([]);
  });

  // docs.umccr.org is UMCCR's: its stacks, pipelines and notification rules are named and tagged for UMCCR.
  test('deploys UMCCR-DocsHostingStack to every stage account, tagged as Docs', () => {
    const calls = jest.mocked(DocsHostingStack).mock.calls;
    expect(new Set(calls.map(([, , props]) => props.env?.account))).toEqual(
      new Set(Object.values(STAGE_ENVIRONMENT).map((environment) => environment.account))
    );
    for (const [, , props] of calls) {
      expect(props.stackName).toBe('UMCCR-DocsHostingStack');
      expect(props.tags).toMatchObject({
        'umccr-org:Product': 'Docs',
        'umccr-org:Source': 'https://github.com/umccr/docs-platform',
      });
    }
  });

  test('names its pipelines and notification rules for UMCCR', () => {
    const template = Template.fromStack(stack);
    const names = (type: string) =>
      Object.values(template.findResources(type)).map(
        (resource) => (resource as { Properties: { Name: string } }).Properties.Name
      );
    expect(names('AWS::CodePipeline::Pipeline').sort()).toEqual([
      'UMCCR-DocsInfrastructure',
      'UMCCR-DocsSitesPipeline',
    ]);
    // Not the pipeline's own name: see DOCS_SITES_NOTIFICATION_RULE_NAME.
    expect(names('AWS::CodeStarNotifications::NotificationRule').sort()).toEqual([
      'UMCCR-DocsInfrastructure',
      'UMCCR-DocsSitesPipeline-Failures',
    ]);
    expect([DOCS_SITES_PIPELINE_NAME, DOCS_SITES_NOTIFICATION_RULE_NAME]).toEqual([
      'UMCCR-DocsSitesPipeline',
      'UMCCR-DocsSitesPipeline-Failures',
    ]);
  });

  test('deploys beta, gamma and prod from this repository', () => {
    const pipelines = Object.values(
      Template.fromStack(stack).findResources('AWS::CodePipeline::Pipeline')
    ).map((resource) => (resource as { Properties: PipelineProperties }).Properties);
    const pipeline = pipelines.find((candidate) => candidate.Name === 'UMCCR-DocsInfrastructure');
    expect(pipeline).toBeDefined();

    expect(pipeline!.PipelineType).toBe('V2');
    expect(pipeline!.Stages[0].Actions[0].Configuration).toMatchObject({
      FullRepositoryId: 'umccr/docs-platform',
      BranchName: 'main',
    });
    expect(pipeline!.Stages.map((stage) => stage.Name)).toEqual([
      'Source',
      'Build',
      'UpdatePipeline',
      'Beta',
      'Gamma',
      'Prod',
    ]);

    // Listed literally so that changing the trigger paths is a deliberate, reviewed edit.
    expect(pipeline!.Triggers).toEqual([
      {
        GitConfiguration: {
          Push: [
            {
              Branches: { Includes: ['main'] },
              FilePaths: {
                Includes: [
                  'bin/**',
                  'infrastructure/**',
                  'app/**',
                  'cdk.json',
                  'package.json',
                  'pnpm-lock.yaml',
                  'tsconfig.json',
                ],
                Excludes: ['app/site/**', '**/*.md'],
              },
            },
          ],
          SourceActionName: 'umccr_docs-platform',
        },
        ProviderType: 'CodeStarSourceConnection',
      },
    ]);
  });
});

describe('trigger paths', () => {
  // As CodePipeline reads the lists: a changed file starts the pipeline if an include matches it and no exclude does.
  const startsPipeline = (file: string) =>
    DOCS_INFRASTRUCTURE_FILE_PATHS.some((glob) => minimatch(file, glob, { dot: true })) &&
    !DOCS_INFRASTRUCTURE_EXCLUDED_FILE_PATHS.some((glob) => minimatch(file, glob, { dot: true }));

  test.each([
    'bin/deploy.ts',
    'infrastructure/stage/hosting-stack.ts',
    'app/session/index.ts',
    'app/edge/viewer-request.js',
    'package.json',
    'pnpm-lock.yaml',
  ])('%s deploys the infrastructure', (file) => {
    expect(startsPipeline(file)).toBe(true);
  });

  test.each([
    'app/site/mkdocs.yml',
    'app/site/docs/index.md',
    'docs/deploy.md',
    'docs/design/adr/0008-infrastructure-in-docs-platform.md',
    'toolkit/src/umccr_docs/theme/assets/umccr/umccr.js',
    'requirements/build.txt',
    'examples/basic-site/mkdocs.yml',
    'templates/mkdocs.yml',
    'infrastructure/README.md',
    'README.md',
  ])('%s does not', (file) => {
    expect(startsPipeline(file)).toBe(false);
  });

  test("fit CodePipeline's limit, which CDK checks as the pipeline is built", () => {
    for (const paths of [DOCS_INFRASTRUCTURE_FILE_PATHS, DOCS_INFRASTRUCTURE_EXCLUDED_FILE_PATHS]) {
      expect(paths.length).toBeGreaterThanOrEqual(1);
      expect(paths.length).toBeLessThanOrEqual(MAX_TRIGGER_FILE_PATHS);
    }
  });
});

describe('site publishing', () => {
  const app = new App({});
  const stack = new DocsInfrastructureDeploymentStack(app, 'SitePublishingTest', {
    env: TOOLCHAIN_ENVIRONMENT,
  });
  const template = Template.fromStack(stack);

  type Action = {
    Name: string;
    ActionTypeId: { Category: string; Provider: string };
    Configuration?: Record<string, unknown>;
    RoleArn?: { 'Fn::GetAtt': [string, string] };
  };
  type SitesPipeline = {
    Name: string;
    PipelineType?: string;
    ExecutionMode?: string;
    Triggers?: unknown[];
    Variables?: Array<{ Name: string; DefaultValue?: string }>;
    Stages: Array<{ Name: string; Actions: Action[] }>;
  };

  const sitesPipeline = (): SitesPipeline =>
    Object.values(template.findResources('AWS::CodePipeline::Pipeline'))
      .map((resource) => (resource as { Properties: SitesPipeline }).Properties)
      .find((candidate) => candidate.Name === DOCS_SITES_PIPELINE_NAME)!;

  const policyFor = (roleName: string) => {
    const [logicalId] = Object.entries(template.findResources('AWS::IAM::Role')).find(
      ([, role]) => (role as { Properties: { RoleName?: string } }).Properties.RoleName === roleName
    )!;
    return JSON.stringify(
      Object.values(template.findResources('AWS::IAM::Policy')).filter((policy) =>
        JSON.stringify((policy as { Properties: { Roles: unknown } }).Properties.Roles).includes(
          `"${logicalId}"`
        )
      )
    );
  };

  test('is one V2 pipeline with parallel runs and required variables', () => {
    const pipeline = sitesPipeline();
    expect(pipeline.PipelineType).toBe('V2');
    expect(pipeline.ExecutionMode).toBe('PARALLEL');
    expect(pipeline.Variables!.map((variable) => variable.Name)).toEqual([
      'SLUG',
      'REPO',
      'COMMIT',
      'RELEASE',
      'CONFIG_PATH',
      'TOOLKIT_REF',
      'STAGES',
    ]);
    expect(pipeline.Variables!.every((variable) => variable.DefaultValue === undefined)).toBe(true);
  });

  test("builds with the release's repository and commit, which the page footer shows", () => {
    type Project = { Description?: string; Source: { BuildSpec: string } };
    const build = Object.values(template.findResources('AWS::CodeBuild::Project'))
      .map((resource) => (resource as { Properties: Project }).Properties)
      .find((project) => project.Description?.includes('build one release of one site'))!;
    const spec = JSON.parse(build.Source.BuildSpec) as {
      phases: { build: { commands: string[] } };
    };
    // The source object holds no .git, so the toolkit cannot ask git for the commit.
    expect(spec.phases.build.commands).toContainEqual(
      expect.stringMatching(
        /^UMCCR_DOCS_SOURCE_REPO="\$REPO" UMCCR_DOCS_COMMIT="\$COMMIT" umccr-docs build /
      )
    );
  });

  test('builds, then publishes to beta and straight on to prod, with no approval', () => {
    const pipeline = sitesPipeline();
    expect(pipeline.Stages.map((stage) => stage.Name)).toEqual([
      'Source',
      'Build',
      'PublishBeta',
      'PublishProd',
    ]);
    const categories = pipeline.Stages.flatMap((stage) =>
      stage.Actions.map((action) => action.ActionTypeId.Category)
    );
    expect(categories).not.toContain('Approval');
    expect(pipeline.Triggers ?? []).toEqual([]);
  });

  test('takes each run’s source object from the start request', () => {
    const source = sitesPipeline().Stages[0].Actions[0];
    expect(source.ActionTypeId.Provider).toBe('S3');
    expect(source.Configuration).toMatchObject({
      AllowOverrideForS3ObjectKey: 'true',
      PollForSourceChanges: false,
    });
  });

  test('stops with a reason, before pip, when the toolkit ref has no toolkit', () => {
    const specs = Object.values(template.findResources('AWS::CodeBuild::Project'))
      .map(
        (project) =>
          (project as { Properties: { Source: { BuildSpec?: string } } }).Properties.Source
            .BuildSpec ?? ''
      )
      .filter((spec) => spec.includes('TOOLKIT_DIR'));
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const check = spec.indexOf('has no toolkit');
      expect(check).toBeGreaterThan(-1);
      expect(check).toBeLessThan(spec.indexOf('pip install --quiet --require-hashes'));
    }
  });

  test('lets the source action read any object a run names, not only the configured key', () => {
    const [roleId] = sitesPipeline().Stages[0].Actions[0].RoleArn!['Fn::GetAtt'];
    const reads = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) =>
        JSON.stringify((policy as { Properties: { Roles: unknown } }).Properties.Roles).includes(
          `"${roleId}"`
        )
      )
      .flatMap(
        (policy) =>
          (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action: unknown }> } } })
            .Properties.PolicyDocument.Statement
      )
      .filter((statement) => JSON.stringify(statement.Action).includes('s3:GetObject*'));
    expect(JSON.stringify(reads)).toContain('/sources/*');
  });

  test('lets the publish steps do nothing but assume each stage’s docs-publisher role', () => {
    const policy = policyFor('docs-sites-publish');
    expect(policy).toContain('sts:AssumeRole');
    for (const environment of [
      STAGE_ENVIRONMENT[AppStage.BETA],
      STAGE_ENVIRONMENT[AppStage.PROD],
    ]) {
      expect(policy).toContain(`:iam::${environment.account}:role/docs/docs-publisher`);
    }
    expect(policy).not.toContain(`:iam::${STAGE_ENVIRONMENT[AppStage.GAMMA].account}:`);
    // Reading the pipeline's own artifacts is all it may do in S3 here; writes happen as docs-publisher.
    expect(policy).not.toMatch(/"s3:(Put|Delete)|"cloudfront:/);
  });

  test('exposes the dispatcher at a public function URL, guarded by the webhook secret', () => {
    const url = Object.values(template.findResources('AWS::Lambda::Url'))[0] as {
      Properties: Record<string, unknown>;
    };
    expect(url.Properties.AuthType).toBe('NONE');

    const dispatcher = Object.values(template.findResources('AWS::Lambda::Function')).find((fn) =>
      JSON.stringify(fn).includes('WEBHOOK_SECRET_ARN')
    ) as { Properties: { Environment: { Variables: Record<string, unknown> } } };
    expect(Object.keys(dispatcher.Properties.Environment.Variables).sort()).toEqual([
      'CONNECTION_ARN',
      'FETCH_PROJECT_NAME',
      'TABLE_NAME',
      'WEBHOOK_SECRET_ARN',
    ]);
  });

  test('lets the fetch build read the connection, which StartBuild checks before cloning', () => {
    const statements = Object.values(template.findResources('AWS::IAM::Policy')).flatMap(
      (policy) =>
        (policy as { Properties: { PolicyDocument: { Statement: Array<{ Action: unknown }> } } })
          .Properties.PolicyDocument.Statement
    );
    const clone = statements.find((statement) =>
      JSON.stringify(statement.Action).includes('codeconnections:GetConnectionToken')
    );
    expect(clone?.Action).toEqual(
      expect.arrayContaining([
        'codeconnections:GetConnection',
        'codeconnections:GetConnectionToken',
        'codestar-connections:GetConnection',
        'codestar-connections:GetConnectionToken',
      ])
    );
  });

  test('fetches the commit without .git and starts the site pipeline on that object', () => {
    const spec = fetchBuildSpec();
    const script = JSON.stringify(spec);
    expect(script).toContain('.git/*');
    expect(script).toContain('sources/$SLUG/$COMMIT.zip');
    expect(script).toContain('start-pipeline-execution --cli-input-json');
    expect(script).toContain('S3_OBJECT_KEY');
  });

  test('stores symlinks as links, and runs Python isolated from the checkout', () => {
    const script = JSON.stringify(fetchBuildSpec());
    expect(script).toContain('zip -q -r -X -y ');
    expect(script).toContain('python3 -I - ');
    expect(script).not.toMatch(/python3 -(?!I )/);
  });

  describe('symlink check', () => {
    /** Runs the check in a checkout with `links` (name -> target), returning its exit status and output. */
    const check = (links: Record<string, string>): { status: number; output: string } => {
      const checkout = mkdtempSync(join(tmpdir(), 'fetch-build-'));
      try {
        mkdirSync(join(checkout, '.git'));
        mkdirSync(join(checkout, 'docs'));
        writeFileSync(join(checkout, '.git', 'config'), '[core]\n');
        writeFileSync(join(checkout, 'README.md'), '# Readme\n');
        for (const [name, target] of Object.entries(links)) {
          symlinkSync(target, join(checkout, name));
        }
        const result = spawnSync(
          'bash',
          ['-c', ['set -euo pipefail', ...REFUSE_ESCAPING_SYMLINKS].join('\n')],
          { cwd: checkout, encoding: 'utf8' }
        );
        return { status: result.status ?? -1, output: result.stdout + result.stderr };
      } finally {
        rmSync(checkout, { recursive: true, force: true });
      }
    };

    test('passes links that stay inside the repository', () => {
      expect(check({ 'docs/index.md': '../README.md', 'docs/up': '..' }).status).toBe(0);
    });

    test.each([
      ['an absolute path on the host', '/etc/hosts'],
      ['a path above the checkout', '../../outside'],
      ["the clone's git state", '../.git/config'],
      ['a target that does not exist', '/nonexistent/deeper/path'],
    ])('refuses a link to %s', (_label, target) => {
      const { status, output } = check({ 'docs/escape': target });
      expect(status).toBe(1);
      expect(output).toContain('./docs/escape is a symlink leading outside the repository');
    });

    test('refuses a link whose name hides a second line', () => {
      // Read line by line, the name would look like `./docs/a` and `b`, two harmless paths.
      const { status, output } = check({ 'docs/a\nb': '/etc/hosts' });
      expect(status).toBe(1);
      expect(output).toContain('symlink leading outside the repository');
    });
  });
});
