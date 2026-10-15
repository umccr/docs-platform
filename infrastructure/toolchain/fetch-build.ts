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
 * Stops the fetch build when the checkout has a symlink leading out of it or into its `.git`, before anything reads
 * through one. Such a link would otherwise put a file of this host, or of the clone's own git state, in front of the
 * site pipeline as if it were the repository's. A link `realpath` cannot resolve counts as leading out.
 */
export const REFUSE_ESCAPING_SYMLINKS = [
  'root="$(pwd -P)"',
  'escaping=0',
  'while IFS= read -r -d "" link; do',
  '  target="$(realpath -q -- "$link")" || target=""',
  '  case "$target" in',
  '    "$root/.git" | "$root/.git/"*) ;;',
  '    "$root" | "$root/"*) continue ;;',
  '  esac',
  '  echo "$link is a symlink leading outside the repository or into .git"',
  '  escaping=1',
  'done < <(find . -path ./.git -prune -o -type l -print0)',
  'if [ "$escaping" != 0 ]; then echo "Remove or fix the symlinks above: they are never published"; exit 1; fi',
];

/**
 * The fetch build's buildspec. The dispatcher passes it with every start (as a buildspec override), together with the
 * repository, the commit and the release's variables, so the project itself has no source of its own.
 *
 * It zips the checkout without `.git` to `sources/<slug>/<commit>.zip`, which keeps every release's files for 30
 * days, and starts the site pipeline on exactly that object. Symlinks are stored as links (`zip -y`), never as the
 * files they point at, so the toolkit's own symlink checks see them. The start request is written as JSON rather
 * than CLI shorthand, because variable values such as `beta,prod` contain commas, by Python in isolated mode (`-I`):
 * the working directory is the site's checkout, and a module there such as `json.py` must not run with this role.
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
          ...REFUSE_ESCAPING_SYMLINKS,
          "zip -q -r -X -y /tmp/source.zip . -x '.git/*'",
          'aws s3 cp --only-show-errors /tmp/source.zip "s3://$SOURCE_BUCKET/$KEY"',
          "python3 -I - > /tmp/start.json <<'PY'",
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
