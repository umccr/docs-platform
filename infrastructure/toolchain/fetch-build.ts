import { Duration } from 'aws-cdk-lib';
import {
  BuildEnvironmentVariableType,
  BuildSpec,
  ComputeType,
  LinuxBuildImage,
  Project,
} from 'aws-cdk-lib/aws-codebuild';
import { IPipeline } from 'aws-cdk-lib/aws-codepipeline';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { DOCS_SITES_PIPELINE_VARIABLES, DOCS_SITES_SOURCE_ACTION_NAME } from './sites-pipeline';

/**
 * The fetch build's buildspec. The dispatcher passes it with every start (as a buildspec override), together with the
 * repository, the commit and the release's variables, so the project itself has no source of its own.
 *
 * It zips the checkout without `.git` to `sources/<slug>/<commit>.zip`, which keeps every release's files for 30
 * days, and starts the site pipeline on exactly that object. The start request is written as JSON rather than CLI
 * shorthand, because variable values such as `beta,prod` contain commas.
 */
export const fetchBuildSpec = (): Record<string, unknown> => ({
  version: '0.2',
  env: { shell: 'bash' },
  phases: {
    build: {
      commands: [
        [
          'set -euo pipefail',
          'export KEY="sources/$SLUG/$COMMIT.zip"',
          "zip -q -r -X /tmp/source.zip . -x '.git/*'",
          'aws s3 cp --only-show-errors /tmp/source.zip "s3://$SOURCE_BUCKET/$KEY"',
          "python3 - > /tmp/start.json <<'PY'",
          'import json, os',
          `names = ${JSON.stringify(Object.keys(DOCS_SITES_PIPELINE_VARIABLES))}`,
          'print(json.dumps({',
          '    "name": os.environ["PIPELINE_NAME"],',
          '    "variables": [{"name": n, "value": os.environ[n]} for n in names],',
          '    "sourceRevisions": [{',
          '        "actionName": os.environ["SOURCE_ACTION"],',
          '        "revisionType": "S3_OBJECT_KEY",',
          '        "revisionValue": os.environ["KEY"],',
          '    }],',
          '}))',
          'PY',
          'aws codepipeline start-pipeline-execution --cli-input-json file:///tmp/start.json',
        ].join('\n'),
      ],
    },
  },
});

export interface DocsFetchBuildProps {
  readonly sourceBucket: IBucket;
  readonly pipeline: IPipeline;
  /** The CodeConnections connection the organisation's pipelines already use (SSM `codestar_github_arn`). */
  readonly connectionArn: string;
}

/**
 * CodeBuild project the dispatcher starts once per release. It clones the site's repository at the pushed commit
 * through the AWS Connector for GitHub, so no personal access token or GitHub App key exists anywhere.
 */
export class DocsFetchBuild extends Construct {
  readonly project: Project;

  constructor(scope: Construct, id: string, props: DocsFetchBuildProps) {
    super(scope, id);

    this.project = new Project(this, 'Project', {
      description: 'docs.umccr.org: clone one release of one site and start the site pipeline',
      buildSpec: BuildSpec.fromObject(fetchBuildSpec()),
      environment: { buildImage: LinuxBuildImage.STANDARD_7_0, computeType: ComputeType.SMALL },
      environmentVariables: {
        SOURCE_BUCKET: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: props.sourceBucket.bucketName,
        },
        PIPELINE_NAME: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: props.pipeline.pipelineName,
        },
        SOURCE_ACTION: {
          type: BuildEnvironmentVariableType.PLAINTEXT,
          value: DOCS_SITES_SOURCE_ACTION_NAME,
        },
      },
      timeout: Duration.minutes(15),
    });

    props.sourceBucket.grantPut(this.project, 'sources/*');
    this.project.addToRolePolicy(
      new PolicyStatement({
        actions: ['codepipeline:StartPipelineExecution'],
        resources: [props.pipeline.pipelineArn],
      })
    );
    // Cloning through the connection. Connections created before the rename carry the codestar-connections prefix.
    // StartBuild checks GetConnection as this role: without it the dispatcher's start fails with OAuthProviderException.
    this.project.addToRolePolicy(
      new PolicyStatement({
        actions: [
          'codeconnections:UseConnection',
          'codeconnections:GetConnection',
          'codeconnections:GetConnectionToken',
          'codestar-connections:UseConnection',
          'codestar-connections:GetConnection',
          'codestar-connections:GetConnectionToken',
        ],
        resources: [props.connectionArn],
      })
    );
  }
}
