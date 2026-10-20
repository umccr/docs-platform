import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { createSessionHandler } from './session';
import { cachedSigningKey, secretsManagerValue } from './signing-key';

/** Entry point of the docs session Lambda. See `session.ts` for what it does and why. */

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
};

export const handler = createSessionHandler({
  // Checks signature (against the pool's JWKS), issuer, audience (the docs client only), token_use and expiry.
  verifier: CognitoJwtVerifier.create({
    userPoolId: requireEnv('USER_POOL_ID'),
    tokenUse: 'id',
    clientId: requireEnv('APP_CLIENT_ID'),
  }),
  signingKey: cachedSigningKey(
    requireEnv('SESSION_KEY_ID'),
    secretsManagerValue(requireEnv('SESSION_KEY_SECRET_ARN'))
  ),
  allowedHosts: JSON.parse(requireEnv('ALLOWED_HOSTS')) as string[],
  sessionLifetimeSeconds: Number(requireEnv('SESSION_LIFETIME_SECONDS')),
});
