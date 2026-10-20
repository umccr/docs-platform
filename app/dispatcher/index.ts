import { CodeBuildClient, StartBuildCommand } from '@aws-sdk/client-codebuild';
import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { cachedSecret, createDispatcher, DispatchRoute, FetchRequest } from './dispatch';

/**
 * Wiring for the dispatcher Lambda. The routing table and the fetch build's buildspec are compiled into the bundle at
 * synth (esbuild `define`), so the registry can grow past Lambda's 4 KB environment limit.
 */

const required = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
};

const routes = JSON.parse(
  required('DOCS_DISPATCH_ROUTES', process.env.DOCS_DISPATCH_ROUTES)
) as DispatchRoute[];
const fetchBuildspec = required('DOCS_FETCH_BUILDSPEC', process.env.DOCS_FETCH_BUILDSPEC);
const tableName = required('TABLE_NAME', process.env.TABLE_NAME);
const secretArn = required('WEBHOOK_SECRET_ARN', process.env.WEBHOOK_SECRET_ARN);
const projectName = required('FETCH_PROJECT_NAME', process.env.FETCH_PROJECT_NAME);
const connectionArn = required('CONNECTION_ARN', process.env.CONNECTION_ARN);

/** Delivery IDs are kept this long: GitHub's own redelivery window is three days. */
const DELIVERY_TTL_SECONDS = 7 * 24 * 60 * 60;

const dynamodb = new DynamoDBClient({});
const codebuild = new CodeBuildClient({});
const secrets = new SecretsManagerClient({});

/** A rotated webhook secret takes effect within this time, or at the first delivery signed with it. */
const SECRET_MAX_AGE_MS = 5 * 60 * 1000;

/** A signature mismatch reads the secret again at most this often per execution environment. */
const SECRET_MIN_REFRESH_MS = 60 * 1000;

const getWebhookSecret = cachedSecret(
  () =>
    secrets
      .send(new GetSecretValueCommand({ SecretId: secretArn }))
      .then((result) => result.SecretString ?? ''),
  { maxAgeMs: SECRET_MAX_AGE_MS, minRefreshMs: SECRET_MIN_REFRESH_MS }
);

const recordDelivery = async (deliveryId: string): Promise<boolean> => {
  try {
    await dynamodb.send(
      new PutItemCommand({
        TableName: tableName,
        Item: {
          pk: { S: `delivery#${deliveryId}` },
          expiresAt: { N: String(Math.floor(Date.now() / 1000) + DELIVERY_TTL_SECONDS) },
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      })
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
};

const forgetDelivery = async (deliveryId: string): Promise<void> => {
  await dynamodb.send(
    new DeleteItemCommand({ TableName: tableName, Key: { pk: { S: `delivery#${deliveryId}` } } })
  );
};

const nextRelease = async (slug: string): Promise<number> => {
  const result = await dynamodb.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: { pk: { S: `release#${slug}` } },
      UpdateExpression: 'ADD #release :one',
      ExpressionAttributeNames: { '#release': 'release' },
      ExpressionAttributeValues: { ':one': { N: '1' } },
      ReturnValues: 'UPDATED_NEW',
    })
  );
  const release = Number(result.Attributes?.release?.N);
  // Fail here rather than start a run whose publish would reject a release of NaN.
  if (!Number.isSafeInteger(release) || release < 1) {
    throw new Error(`No release number for ${slug}`);
  }
  return release;
};

const startFetch = async (request: FetchRequest): Promise<string> => {
  const variables: Record<string, string> = {
    SLUG: request.slug,
    REPO: request.repo,
    COMMIT: request.commit,
    RELEASE: String(request.release),
    CONFIG_PATH: request.configPath,
    TOOLKIT_REF: request.toolkitRef,
    STAGES: request.stages.join(','),
  };
  const result = await codebuild.send(
    new StartBuildCommand({
      projectName,
      sourceTypeOverride: 'GITHUB',
      sourceLocationOverride: `https://github.com/${request.repo}.git`,
      sourceVersion: request.commit,
      sourceAuthOverride: { type: 'CODECONNECTIONS', resource: connectionArn },
      buildspecOverride: fetchBuildspec,
      environmentVariablesOverride: Object.entries(variables).map(([name, value]) => ({
        name,
        value,
        type: 'PLAINTEXT',
      })),
      idempotencyToken: request.deliveryId.slice(0, 64),
    })
  );
  return result.build?.id ?? 'unknown';
};

export const handler = createDispatcher({
  routes,
  getWebhookSecret,
  recordDelivery,
  forgetDelivery,
  nextRelease,
  startFetch,
  log: (entry) => console.log(JSON.stringify(entry)),
});
