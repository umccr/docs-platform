import { Aws, Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  BuildSpec,
  ComputeType,
  LinuxBuildImage,
  PipelineProject,
} from 'aws-cdk-lib/aws-codebuild';
import {
  Artifact,
  ExecutionMode,
  Pipeline,
  PipelineNotificationEvents,
  PipelineType,
  Variable,
} from 'aws-cdk-lib/aws-codepipeline';
import { CodeBuildAction, S3SourceAction, S3Trigger } from 'aws-cdk-lib/aws-codepipeline-actions';
import { SlackChannelConfiguration } from 'aws-cdk-lib/aws-chatbot';
import { DetailType } from 'aws-cdk-lib/aws-codestarnotifications';
import { AccountRootPrincipal, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  DOCS_PUBLISHER_ROLE_NAME,
  DOCS_PUBLISHER_ROLE_PATH,
  DOCS_SITES_PUBLISH_ROLE_NAME,
} from '../config';
import { SITE_PUBLISH_STAGES } from '../sites';
import { AppStage, STAGE_ENVIRONMENT } from '../stages';

/** The pipeline's name, with UMCCR's prefix like the organisation's other pipelines; the fetch build starts it by name. */
export const DOCS_SITES_PIPELINE_NAME = 'UMCCR-DocsSitesPipeline';

/**
 * The failure notification rule's name. It differs from the pipeline's: renaming the pipeline replaces it, which
 * replaces the rule, and CloudFormation creates the new rule before deleting the old one, under a name that must be
 * unique in the account.
 */
export const DOCS_SITES_NOTIFICATION_RULE_NAME = `${DOCS_SITES_PIPELINE_NAME}-Failures`;

/** Name of the S3 source action, which the fetch build's source revision override refers to. */
export const DOCS_SITES_SOURCE_ACTION_NAME = 'Source';

/**
 * Variables every run carries, set by the fetch build from the dispatcher's request. None has a default, so a run
 * started without them fails at once instead of publishing the wrong site.
 */
export const DOCS_SITES_PIPELINE_VARIABLES = {
  SLUG: 'the site, from the registry',
  REPO: 'GitHub owner/repo the commit came from',
  COMMIT: 'the pushed commit',
  RELEASE: "the site's release number; a publish skips if a newer release is live",
  CONFIG_PATH: "path of the site's mkdocs.yml",
  TOOLKIT_REF: 'docs-platform git ref whose toolkit builds and publishes the site',
  STAGES: 'comma-separated stages the site publishes to (beta, prod)',
} as const;

const TOOLKIT_REPOSITORY = 'https://github.com/umccr/docs-platform.git';

/**
 * Install the toolkit at `TOOLKIT_REF`, with the engine pinned by hash from the same ref. docs-platform is public, so
 * the clone needs no credentials.
 */
const INSTALL_TOOLKIT = [
  `git clone --quiet ${TOOLKIT_REPOSITORY} "$TOOLKIT_DIR"`,
  // A ref that does not exist, such as a release tag the registry names before the tag is pushed.
  'git -C "$TOOLKIT_DIR" checkout --quiet "$TOOLKIT_REF" || { echo "docs-platform has no ref $TOOLKIT_REF: push the tag, or point the site toolkitRef at a ref that exists"; exit 1; }',
  // A ref without the toolkit, such as main before this repository was first merged, otherwise fails in pip with a
  // missing file. Say what to do instead.
  'test -f "$TOOLKIT_DIR/requirements/build.txt" || { echo "docs-platform at $TOOLKIT_REF has no toolkit: merge it to main, or point the site toolkitRef at a ref that has one"; exit 1; }',
  'python -m pip install --quiet --require-hashes --no-deps -r "$TOOLKIT_DIR/requirements/build.txt"',
  'python -m pip install --quiet --no-deps "$TOOLKIT_DIR/toolkit"',
];

const PYTHON_VERSION = '3.12';

const stageTitle = (stage: AppStage): string => stage.charAt(0).toUpperCase() + stage.slice(1);

/** The ARN of `role/docs/docs-publisher` in the stage's account. */
export const publisherRoleArn = (stage: AppStage): string =>
  `arn:${Aws.PARTITION}:iam::${STAGE_ENVIRONMENT[stage].account}:role${DOCS_PUBLISHER_ROLE_PATH}${DOCS_PUBLISHER_ROLE_NAME}`;

export interface DocsSitesPipelineProps {
  /** Where the fetch build puts each release's files, as `sources/<slug>/<commit>.zip`. */
  readonly sourceBucket: IBucket;
}

/**
 * Pipeline 2: one shared pipeline that builds and publishes every site, one run per release.
 *
 *   Source (S3, object key set per run) → Build (read-only) → Publish beta → Publish prod
 *
 * Runs are started only by the fetch build, never by a trigger, and run one at a time, in the order they start. A
 * publish uploads, then deletes, then writes the release marker, so two releases of one site publishing at once could
 * leave a mix of both. Releases of different sites queue too, which costs minutes. There is no approval:
 * documentation changes no data and no running system, and a failure in beta stops the release before prod.
 *
 * Build has no write access to anything but the pipeline's artifacts, so repository content never runs with
 * publishing rights. The publish steps run as `docs-sites-publish`, whose only permission is to assume each stage's
 * `docs-publisher` role; the toolkit narrows that role to the release's site with a session policy.
 */
export class DocsSitesPipeline extends Construct {
  readonly pipeline: Pipeline;

  constructor(scope: Construct, id: string, props: DocsSitesPipelineProps) {
    super(scope, id);

    const runVariables = Object.fromEntries(
      Object.keys(DOCS_SITES_PIPELINE_VARIABLES).map((name) => [
        name,
        { value: `#{variables.${name}}` },
      ])
    );

    this.pipeline = new Pipeline(this, 'Pipeline', {
      pipelineName: DOCS_SITES_PIPELINE_NAME,
      pipelineType: PipelineType.V2,
      // One release at a time: see above.
      executionMode: ExecutionMode.QUEUED,
      // Every action runs in this account; the publish steps reach the stage accounts by assuming a role.
      crossAccountKeys: false,
      restartExecutionOnUpdate: false,
      variables: Object.entries(DOCS_SITES_PIPELINE_VARIABLES).map(
        ([variableName, description]) => new Variable({ variableName, description })
      ),
    });
    // CDK retains the artifact bucket it creates, even when the stack's first create rolls back.
    this.pipeline.artifactBucket.applyRemovalPolicy(RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE);

    const source = new Artifact('Source');
    const built = new Artifact('Built');

    // CDK grants an S3 source action's role read access to its configured key only, but every run here names its own
    // object, `sources/<slug>/<commit>.zip`. With CDK's role, every run failed at Source with "Forbidden".
    const sourceRole = new Role(this, 'SourceActionRole', {
      assumedBy: new AccountRootPrincipal(),
    });
    props.sourceBucket.grantRead(sourceRole, 'sources/*');

    this.pipeline.addStage({
      stageName: 'Source',
      actions: [
        new S3SourceAction({
          actionName: DOCS_SITES_SOURCE_ACTION_NAME,
          bucket: props.sourceBucket,
          // Never used: every run overrides the object key. A run started without one fails on this missing key.
          bucketKey: 'sources/unset.zip',
          trigger: S3Trigger.NONE,
          output: source,
          role: sourceRole,
        }),
      ],
    });

    this.pipeline.addStage({
      stageName: 'Build',
      actions: [
        new CodeBuildAction({
          actionName: 'Build',
          project: this.buildProject(),
          input: source,
          outputs: [built],
          environmentVariables: runVariables,
        }),
      ],
    });

    const publishProject = this.publishProject();
    for (const stage of SITE_PUBLISH_STAGES) {
      this.pipeline.addStage({
        stageName: `Publish${stageTitle(stage)}`,
        actions: [
          new CodeBuildAction({
            actionName: `Publish${stageTitle(stage)}`,
            project: publishProject,
            input: built,
            environmentVariables: {
              ...runVariables,
              STAGE: { value: stage },
              PUBLISHER_ROLE_ARN: { value: publisherRoleArn(stage) },
            },
          }),
        ],
      });
    }

    // The S3 source action takes its object key from the start request only when the action allows it. CDK does not
    // model the setting, so it is set on the template.
    const cfnPipeline = this.pipeline.node.defaultChild as unknown as {
      addPropertyOverride(path: string, value: unknown): void;
    };
    cfnPipeline.addPropertyOverride(
      'Stages.0.Actions.0.Configuration.AllowOverrideForS3ObjectKey',
      'true'
    );

    // Failed releases are reported where the other OrcaBus pipelines report theirs.
    const slack = SlackChannelConfiguration.fromSlackChannelConfigurationArn(
      this,
      'SlackChannelConfiguration',
      StringParameter.valueForStringParameter(this, '/chatbot_arn/slack/alerts-build')
    );
    this.pipeline.notifyOn('PipelineSlackNotification', slack, {
      events: [PipelineNotificationEvents.PIPELINE_EXECUTION_FAILED],
      detailType: DetailType.FULL,
      notificationRuleName: DOCS_SITES_NOTIFICATION_RULE_NAME,
    });
  }

  /** Check, strict build, verify and export, with the toolkit at the release's ref. No AWS access beyond artifacts. */
  private buildProject(): PipelineProject {
    return new PipelineProject(this, 'BuildProject', {
      description: 'docs.umccr.org: build one release of one site (read-only)',
      environment: { buildImage: LinuxBuildImage.STANDARD_7_0, computeType: ComputeType.SMALL },
      timeout: Duration.minutes(30),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        env: { shell: 'bash', variables: { TOOLKIT_DIR: '/tmp/docs-platform' } },
        phases: {
          install: {
            'runtime-versions': { python: PYTHON_VERSION },
            commands: INSTALL_TOOLKIT,
          },
          build: {
            commands: [
              'umccr-docs check --slug "$SLUG" --config "$CONFIG_PATH"',
              // The footer names the release's repository and commit. The source has no .git for the toolkit to ask.
              'UMCCR_DOCS_SOURCE_REPO="$REPO" UMCCR_DOCS_COMMIT="$COMMIT" umccr-docs build --slug "$SLUG" --config "$CONFIG_PATH" --site-dir out/site',
              'umccr-docs verify-site out/site',
              'umccr-docs export-kb --slug "$SLUG" --config "$CONFIG_PATH" --commit "$COMMIT" --out out/kb',
            ],
          },
        },
        artifacts: { 'base-directory': 'out', files: ['**/*'] },
      }),
    });
  }

  /**
   * Publish one stage: documents to OrcaSonar, pages to the docs bucket, then the release marker. The input is the
   * build's artifact, so `site/` and `kb/` sit at the top of the working directory.
   */
  private publishProject(): PipelineProject {
    const role = new Role(this, 'PublishRole', {
      roleName: DOCS_SITES_PUBLISH_ROLE_NAME,
      assumedBy: new ServicePrincipal('codebuild.amazonaws.com'),
      description:
        'docs.umccr.org site pipeline publish steps: may only assume each stage docs-publisher role',
    });
    role.addToPolicy(
      new PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: SITE_PUBLISH_STAGES.map(publisherRoleArn),
      })
    );

    return new PipelineProject(this, 'PublishProject', {
      description: 'docs.umccr.org: publish one release of one site to one stage',
      role,
      environment: { buildImage: LinuxBuildImage.STANDARD_7_0, computeType: ComputeType.SMALL },
      timeout: Duration.minutes(30),
      buildSpec: BuildSpec.fromObject({
        version: '0.2',
        env: { shell: 'bash', variables: { TOOLKIT_DIR: '/tmp/docs-platform' } },
        phases: {
          install: {
            'runtime-versions': { python: PYTHON_VERSION },
            commands: INSTALL_TOOLKIT,
          },
          build: {
            commands: [
              [
                'if [[ ",$STAGES," != *",$STAGE,"* ]]; then',
                '  echo "$SLUG does not publish to $STAGE"',
                'else',
                '  umccr-docs publish site --slug "$SLUG" --role-arn "$PUBLISHER_ROLE_ARN" \\',
                '    --release "$RELEASE" --documents kb',
                'fi',
              ].join('\n'),
            ],
          },
        },
      }),
    });
  }
}
