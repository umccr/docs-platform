import { timingSafeEqual } from 'node:crypto';
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from 'aws-lambda';
import { sessionKeyCheck, sessionSetCookie, signSessionCookieValue } from './session-cookie';

/**
 * `GET /_auth/session`: exchange a Cognito ID token for the docs session cookie.
 *
 * Readers sign in on the `/_auth/` page with Amplify, exactly as in the portal apps. That leaves the Cognito tokens
 * in the browser, where CloudFront cannot see them. The page then calls this endpoint once with the ID token, and
 * this handler checks it the way the OrcaBus API authorizers do (signature, issuer, audience, token use, expiry)
 * before setting an HttpOnly cookie that the viewer-request CloudFront Function can verify on every request.
 *
 * CloudFront reaches this Lambda's function URL through origin access control, so it cannot be called directly.
 * Origin access control signs the request with SigV4 and owns the `Authorization` header, which is why the token
 * travels in `x-docs-id-token`. A custom header also means a cross-site caller needs a CORS preflight, which this
 * endpoint never grants.
 */

/** The subset of aws-jwt-verify's `CognitoJwtVerifier` this handler uses. */
export interface IdTokenVerifier {
  verify(token: string): Promise<{ sub: string }>;
}

/** The session key new cookies are signed with. See `signing-key.ts`. */
export interface SigningKey {
  readonly kid: string;
  readonly secret: string;
}

export interface SessionHandlerOptions {
  readonly verifier: IdTokenVerifier;
  readonly signingKey: () => Promise<SigningKey>;
  /** Hostnames the distribution serves. The viewer's host arrives in `x-docs-host`, set by the edge function. */
  readonly allowedHosts: string[];
  readonly sessionLifetimeSeconds: number;
  readonly now?: () => number;
  readonly log?: (entry: Record<string, unknown>) => void;
}

/** Error codes returned to the sign-in page, which maps them to messages. */
export type SessionErrorCode =
  | 'method-not-allowed'
  | 'unknown-host'
  | 'cross-site'
  | 'missing-token'
  | 'invalid-token'
  | 'unavailable';

const errorResponse = (statusCode: number, error: SessionErrorCode): LambdaFunctionURLResult => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify({ error }),
});

const lowerCaseHeaders = (headers: LambdaFunctionURLEvent['headers']): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([name, value]) => [name.toLowerCase(), value])
  );

const sameValue = (received: string | undefined, expected: string): boolean => {
  if (received === undefined) {
    return false;
  }
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const createSessionHandler = (options: SessionHandlerOptions) => {
  const now = options.now ?? Date.now;
  // Never log the token, the cookie, the key or the email address. `sub` is enough to trace a sign-in in Cognito.
  const log = options.log ?? ((entry) => console.log(JSON.stringify(entry)));

  return async (event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> => {
    if (event.requestContext.http.method !== 'GET') {
      return errorResponse(405, 'method-not-allowed');
    }

    const headers = lowerCaseHeaders(event.headers);

    const host = headers['x-docs-host'];
    if (!host || !options.allowedHosts.includes(host)) {
      log({ outcome: 'unknown-host' });
      return errorResponse(400, 'unknown-host');
    }

    // Browsers send Sec-Fetch-Site on every fetch; only the sign-in page on the same host may mint a session.
    if (headers['sec-fetch-site'] !== 'same-origin') {
      log({ outcome: 'cross-site' });
      return errorResponse(403, 'cross-site');
    }

    const token = headers['x-docs-id-token'];
    if (!token) {
      return errorResponse(401, 'missing-token');
    }

    let sub: string;
    try {
      ({ sub } = await options.verifier.verify(token));
    } catch {
      log({ outcome: 'invalid-token' });
      return errorResponse(401, 'invalid-token');
    }

    let key: SigningKey;
    try {
      key = await options.signingKey();
    } catch (error) {
      log({
        outcome: 'unavailable',
        sub,
        error: error instanceof Error ? error.message : String(error),
      });
      return errorResponse(503, 'unavailable');
    }

    // The edge function that forwarded this request says which key it holds. A cookie signed with any other key
    // would be rejected there, sending the reader straight back to sign in. That happens for a few minutes after a
    // key rotation, while the new function reaches every edge location, or for good if someone changed the secret's
    // value by hand. Refusing here shows the reader "try again shortly" instead of a redirect loop.
    if (!sameValue(headers['x-docs-key-check'], sessionKeyCheck(key.kid, key.secret))) {
      log({ outcome: 'key-mismatch', sub, kid: key.kid });
      return errorResponse(503, 'unavailable');
    }

    const iat = Math.floor(now() / 1000);
    const cookie = signSessionCookieValue(
      { kid: key.kid, sub, aud: host, iat, exp: iat + options.sessionLifetimeSeconds },
      key.secret
    );

    log({ outcome: 'session-issued', sub, kid: key.kid });
    return {
      statusCode: 204,
      headers: { 'cache-control': 'no-store' },
      cookies: [sessionSetCookie(cookie, options.sessionLifetimeSeconds)],
    };
  };
};
