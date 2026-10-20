import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import type { SigningKey } from './session';
import { MIN_SESSION_KEY_LENGTH } from './session-cookie';

/**
 * The session key, from the Secrets Manager secret the hosting stack generates (`DocsSessionKeyV<generation>`).
 *
 * The viewer-request function received the same value when it was deployed. A key never changes in place: rotating
 * it creates a new secret and changes this Lambda's configuration, which starts fresh execution environments. So
 * each environment fetches the key once and keeps it.
 */
export const cachedSigningKey = (
  kid: string,
  readSecret: () => Promise<string | undefined>
): (() => Promise<SigningKey>) => {
  let pending: Promise<SigningKey> | undefined;

  const load = async (): Promise<SigningKey> => {
    const secret = await readSecret();
    if (!secret || secret.length < MIN_SESSION_KEY_LENGTH) {
      throw new Error(
        `Session key ${kid} is missing or shorter than ${MIN_SESSION_KEY_LENGTH} characters`
      );
    }
    return { kid, secret };
  };

  return () => {
    pending ??= load().catch((error: unknown) => {
      // Try again on the next request instead of failing every sign-in until the environment is recycled.
      pending = undefined;
      throw error;
    });
    return pending;
  };
};

/** Reads the current value of a Secrets Manager secret. */
export const secretsManagerValue = (secretArn: string): (() => Promise<string | undefined>) => {
  const client = new SecretsManagerClient({});
  return async () =>
    (await client.send(new GetSecretValueCommand({ SecretId: secretArn }))).SecretString;
};
