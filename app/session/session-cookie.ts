import { createHmac } from 'node:crypto';

/**
 * The docs session cookie, issued by the session Lambda and checked on every request by the viewer-request
 * CloudFront Function (`../viewer-request.js`). The two must agree on this format exactly.
 *
 * ```text
 * __Host-docs_session = v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, "v1." + base64url(payload)))>
 * ```
 *
 * The HMAC key is the session key: a Secrets Manager secret the hosting stack generates, which the Lambda reads at
 * run time and the edge function receives at deploy time. CloudFront Functions can compute HMAC but cannot verify
 * Cognito's RSA signatures, which is why the Cognito token is checked once by the Lambda and exchanged for this
 * cookie.
 */
export const SESSION_COOKIE_NAME = '__Host-docs_session';

const SESSION_COOKIE_VERSION = 'v1';

/**
 * Shortest session key either side accepts. The stack generates 64 characters; anything shorter means a broken
 * deployment, and an empty key would let anyone compute a valid signature. Matches `MIN_KEY_LENGTH` in
 * `../viewer-request.js`.
 */
export const MIN_SESSION_KEY_LENGTH = 32;

export interface SessionPayload {
  /** ID of the session key that signed this cookie: its generation in `infrastructure/config.ts`. */
  readonly kid: string;
  /** Cognito `sub` of the reader. No email or name: the edge does not need them. */
  readonly sub: string;
  /** Hostname the cookie was issued for. */
  readonly aud: string;
  /** Issued at, seconds since the epoch. */
  readonly iat: number;
  /** Expiry, seconds since the epoch. */
  readonly exp: number;
}

export const signSessionCookieValue = (payload: SessionPayload, key: string): string => {
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signedPart = `${SESSION_COOKIE_VERSION}.${encodedPayload}`;
  const signature = createHmac('sha256', key).update(signedPart).digest('base64url');
  return `${signedPart}.${signature}`;
};

/**
 * Identifies a session key without revealing it. The edge function sends this value for the key it holds, in the
 * `x-docs-key-check` header, and the Lambda signs only if it matches its own key. Matches `keyCheck()` in
 * `../viewer-request.js`.
 */
export const sessionKeyCheck = (kid: string, key: string): string =>
  createHmac('sha256', key).update(`docs-key-check.${kid}`).digest('base64url');

/**
 * `Set-Cookie` value for a new session. `__Host-` requires `Secure`, `Path=/` and no `Domain`, which pins the cookie
 * to the exact host that set it.
 */
export const sessionSetCookie = (value: string, maxAgeSeconds: number): string =>
  `${SESSION_COOKIE_NAME}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
