import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AppStage, STAGE_ENVIRONMENT } from '../stages';
import { getDocsHostingStackConfig } from '../config';
import { DocsHostingStack, DocsHostingStackProps } from '../stage/hosting-stack';
import { DeploymentPipeline } from './deployment-pipeline';
import { DocsSitePublishing } from './site-publishing';

/**
 * Repository paths that start the docs infrastructure pipeline when changed on `main`: the CDK app, the stacks and
 * the code they deploy (Lambdas, the edge function, the sign-in page). The toolkit, the theme and the platform site
 * (`app/site/`) live in this repository too, but they reach readers through the site pipeline, not this one.
 */
export const DOCS_INFRASTRUCTURE_FILE_PATHS = [
  'bin/**',
  'infrastructure/**',
  'app/**',
  'cdk.json',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
];

/**
 * Paths that must not start the pipeline although an include matches them: the platform site (inside `app/`, but
 * published by the site pipeline) and Markdown. An exclude wins over an include. Paths no include matches, such as
 * `docs/`, `toolkit/`, `examples/` and `templates/`, never start the pipeline, so listing them would only use up the
 * eight patterns a list may hold.
 */
export const DOCS_INFRASTRUCTURE_EXCLUDED_FILE_PATHS = ['app/site/**', '**/*.md'];

/** Pipeline 1's name. docs.umccr.org belongs to UMCCR, so nothing here is named for OrcaBus. */
export const DOCS_INFRASTRUCTURE_PIPELINE_NAME = 'UMCCR-DocsInfrastructure';

/** The hosting stack's CloudFormation name, the same in every stage: each stage is its own account. */
export const DOCS_HOSTING_STACK_NAME = 'UMCCR-DocsHostingStack';

/**
 * The docs toolchain stack.
 *
 * Pipeline 1, `UMCCR-DocsInfrastructure`, is self-mutating: it deploys {@link DocsHostingStack} to beta, gamma and,
 * after a manual approval, prod, and its self-update deploys this stack, including dispatched publishing
 * ({@link DocsSitePublishing}): the dispatcher, the fetch build and pipeline 2, `UMCCR-DocsSitesPipeline`, which publishes
 * site contents. Site contents never go through this pipeline.
 */
export class DocsInfrastructureDeploymentStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Same pinned pnpm as the portal infrastructure pipeline; see its comment on corepack.
    const PNPM_VERSION = '10.34.5';
    const installCommands = [
      'node -v',
      'corepack enable',
      `corepack prepare pnpm@${PNPM_VERSION} --activate`,
      'pnpm --version',
      'pnpm install --frozen-lockfile',
    ];

    new DeploymentPipeline<DocsHostingStackProps>(this, 'DeploymentPipeline', {
      pipelineName: DOCS_INFRASTRUCTURE_PIPELINE_NAME,
      repository: 'umccr/docs-platform',
      includedFilePaths: DOCS_INFRASTRUCTURE_FILE_PATHS,
      excludedFilePaths: DOCS_INFRASTRUCTURE_EXCLUDED_FILE_PATHS,
      stack: DocsHostingStack,
      stackId: 'DocsHostingStack',
      stackName: DOCS_HOSTING_STACK_NAME,
      stackProps: {
        beta: getDocsHostingStackConfig(AppStage.BETA),
        gamma: getDocsHostingStackConfig(AppStage.GAMMA),
        prod: getDocsHostingStackConfig(AppStage.PROD),
      },
      environments: {
        beta: STAGE_ENVIRONMENT[AppStage.BETA],
        gamma: STAGE_ENVIRONMENT[AppStage.GAMMA],
        prod: STAGE_ENVIRONMENT[AppStage.PROD],
      },
      tags: { 'umccr-org:Product': 'Docs' },
      // jest with cdk-nag covers the CDK app and the code it deploys; the toolkit's tests run in CI.
      tests: { UnitTest: { installCommands, commands: ['pnpm run test'] } },
      synth: { installCommands, commands: ['pnpm cdk synth'] },
    });

    new DocsSitePublishing(this, 'SitePublishing');
  }
}
