import * as path from 'path';
import { CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { IProject } from 'aws-cdk-lib/aws-codebuild';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, FunctionUrl, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { DispatchRoute } from '../sites';

export interface DocsDispatcherProps {
  /** The routing table, from `dispatchRegistry()`. */
  readonly routes: DispatchRoute[];
  /** The fetch build the dispatcher starts, and the buildspec it passes with each start. */
  readonly fetchProject: IProject;
  readonly fetchBuildSpec: Record<string, unknown>;
  /** The CodeConnections connection the fetch build clones through. */
  readonly connectionArn: string;
}

/**
 * The organisation webhook's endpoint. GitHub posts every push in the umccr organisation here; the Lambda checks the
 * signature, drops what is not a registered docs push, records the delivery, numbers the release and starts the fetch
 * build. See `app/dispatcher/dispatch.ts`.
 *
 * The function URL is public by necessity: GitHub cannot sign AWS requests. The webhook secret is what keeps it
 * closed, and an unsigned or wrongly signed request costs one HMAC and a 401.
 */
export class DocsDispatcher extends Construct {
  readonly url: FunctionUrl;

  constructor(scope: Construct, id: string, props: DocsDispatcherProps) {
    super(scope, id);

    // CloudFormation generates the value. An organisation owner copies it into the webhook's settings once.
    const webhookSecret = new Secret(this, 'WebhookSecret', {
      secretName: 'docs/github-webhook-secret', // pragma: allowlist secret
      description:
        'docs.umccr.org: the GitHub organisation webhook secret. Copy this value into the webhook settings.',
      generateSecretString: { passwordLength: 48, excludePunctuation: true, includeSpace: false },
    });

    const table = new Table(this, 'DispatchTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expiresAt',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Release counters only ever grow, so losing them would restart numbering; keep the table, except when the
      // stack's first create fails and there is nothing to keep.
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    const logGroup = new LogGroup(this, 'LogGroup', {
      retention: RetentionDays.THREE_MONTHS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const handler = new NodejsFunction(this, 'Function', {
      description: 'docs.umccr.org: GitHub organisation webhook to the site pipeline',
      entry: path.join(__dirname, '..', '..', 'app', 'dispatcher', 'index.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logGroup,
      environment: {
        TABLE_NAME: table.tableName,
        WEBHOOK_SECRET_ARN: webhookSecret.secretArn,
        FETCH_PROJECT_NAME: props.fetchProject.projectName,
        CONNECTION_ARN: props.connectionArn,
      },
      bundling: {
        externalModules: [],
        format: OutputFormat.CJS,
        minify: true,
        sourceMap: false,
        // Compiled in rather than set as environment variables: the registry would outgrow Lambda's 4 KB limit.
        define: {
          'process.env.DOCS_DISPATCH_ROUTES': JSON.stringify(JSON.stringify(props.routes)),
          'process.env.DOCS_FETCH_BUILDSPEC': JSON.stringify(JSON.stringify(props.fetchBuildSpec)),
        },
      },
    });

    webhookSecret.grantRead(handler);
    table.grant(handler, 'dynamodb:PutItem', 'dynamodb:DeleteItem', 'dynamodb:UpdateItem');
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['codebuild:StartBuild'],
        resources: [props.fetchProject.projectArn],
      })
    );
    // Starting a build with the connection as its source credentials passes the connection to CodeBuild.
    handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['codeconnections:PassConnection', 'codestar-connections:PassConnection'],
        resources: [props.connectionArn],
      })
    );

    this.url = handler.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
    new CfnOutput(this, 'WebhookUrl', {
      value: this.url.url,
      description:
        'Payload URL for the GitHub organisation webhook (content type application/json, push events)',
    });
    new CfnOutput(this, 'WebhookSecretName', { value: webhookSecret.secretName });
  }
}
