import { createSign, generateKeyPairSync } from 'node:crypto';
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { describe, expect, test } from '@jest/globals';
import { createSessionHandler, SigningKey } from '../app/session/session';
import { SESSION_COOKIE_NAME, sessionKeyCheck } from '../app/session/session-cookie';
import {
  CfRequest,
  loadViewerRequestHandler,
  TEST_HOST,
  viewerRequest,
} from './viewer-request-harness';

/**
 * The session Lambda checks a Cognito ID token and sets the docs session cookie. These tests sign real RS256
 * tokens and verify them with aws-jwt-verify against a cached JWKS, so they run offline and exercise the same
 * checks as production.
 */

const REGION = 'ap-southeast-2';
const USER_POOL_ID = `${REGION}_TestPool1`;
const DOCS_CLIENT_ID = 'docsclientid0000000000000';
const OTHER_CLIENT_ID = 'orcauiclientid00000000000';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
const SIGNING_KEY: SigningKey = { kid: '3', secret: 's'.repeat(64) };
const OTHER_KEY: SigningKey = { kid: '4', secret: 'o'.repeat(64) };
const LIFETIME = 8 * 60 * 60;

const poolKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const strangerKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK_KID = 'pool-key-1';

const verifier = CognitoJwtVerifier.create({
  userPoolId: USER_POOL_ID,
  tokenUse: 'id',
  clientId: DOCS_CLIENT_ID,
});
const poolJwk = poolKeys.publicKey.export({ format: 'jwk' });
verifier.cacheJwks({
  keys: [{ kty: 'RSA', n: poolJwk.n!, e: poolJwk.e!, kid: JWK_KID, alg: 'RS256', use: 'sig' }],
});

const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

const signJwt = (claims: Record<string, unknown>, privateKey = poolKeys.privateKey): string => {
  const signingInput = `${base64url({ alg: 'RS256', kid: JWK_KID, typ: 'JWT' })}.${base64url(claims)}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(privateKey)
    .toString('base64url');
  return `${signingInput}.${signature}`;
};

const idToken = (overrides: Record<string, unknown> = {}): string => {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    sub: 'reader-sub',
    iss: ISSUER,
    aud: DOCS_CLIENT_ID,
    token_use: 'id',
    auth_time: now,
    iat: now,
    exp: now + 3600,
    email: 'reader@umccr.org',
    ...overrides,
  });
};

const event = (headers: Record<string, string>, method = 'GET'): LambdaFunctionURLEvent =>
  ({
    version: '2.0',
    rawPath: '/_auth/session',
    rawQueryString: '',
    headers,
    isBase64Encoded: false,
    requestContext: { http: { method } },
  }) as unknown as LambdaFunctionURLEvent;

/** What the Lambda receives from the edge function for a same-origin fetch by the sign-in page. */
const browserHeaders = (
  token?: string,
  edgeKey: SigningKey = SIGNING_KEY
): Record<string, string> => ({
  'x-docs-host': TEST_HOST,
  'x-docs-key-check': sessionKeyCheck(edgeKey.kid, edgeKey.secret),
  'sec-fetch-site': 'same-origin',
  ...(token ? { 'x-docs-id-token': token } : {}),
});

/** A handler whose signing key is {@link SIGNING_KEY}, or which fails to read its key. */
const setup = (options: { keyError?: Error } = {}) => {
  const logs: string[] = [];
  const handler = createSessionHandler({
    verifier,
    signingKey: () =>
      options.keyError ? Promise.reject(options.keyError) : Promise.resolve(SIGNING_KEY),
    allowedHosts: [TEST_HOST, 'docs.umccr.org'],
    sessionLifetimeSeconds: LIFETIME,
    log: (entry) => logs.push(JSON.stringify(entry)),
  });
  return { handler, logs };
};

type Result = { statusCode: number; cookies?: string[]; headers?: Record<string, string> };

const errorOf = (result: LambdaFunctionURLResult): string | undefined =>
  (JSON.parse((result as { body?: string }).body ?? '{}') as { error?: string }).error;

describe('a valid ID token', () => {
  test('gets a session cookie that the edge function forwarding the request accepts', async () => {
    const { handler } = setup();
    const edge = loadViewerRequestHandler({ keyId: SIGNING_KEY.kid, key: SIGNING_KEY.secret });

    // End to end: the headers the edge function adds are the ones this Lambda checks...
    const forwarded = edge({ request: viewerRequest('/_auth/session') }) as CfRequest;
    const edgeHeaders = Object.fromEntries(
      Object.entries(forwarded.headers).map(([name, header]) => [name, header.value])
    );
    const result = (await handler(
      event({ ...edgeHeaders, 'sec-fetch-site': 'same-origin', 'x-docs-id-token': idToken() })
    )) as Result;

    expect(result.statusCode).toBe(204);
    expect(result.headers?.['cache-control']).toBe('no-store');
    expect(result.cookies).toHaveLength(1);

    const [cookie] = result.cookies!;
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=v1\\.`));
    expect(cookie).toContain('; Path=/; Secure; HttpOnly; SameSite=Lax; ');
    expect(cookie).toContain(`Max-Age=${LIFETIME}`);

    const value = cookie.split(';')[0].slice(`${SESSION_COOKIE_NAME}=`.length);
    const payload = JSON.parse(
      Buffer.from(value.split('.')[1], 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    expect(payload).toMatchObject({ kid: SIGNING_KEY.kid, sub: 'reader-sub', aud: TEST_HOST });
    expect((payload.exp as number) - (payload.iat as number)).toBe(LIFETIME);
    expect(payload).not.toHaveProperty('email');

    // ...and the cookie it mints opens a page there.
    const routed = edge({ request: viewerRequest('/platform/', { cookie: value }) }) as CfRequest;
    expect(routed.uri).toBe('/sites/platform/index.html');
  });

  test('never logs the token, the key or the email address', async () => {
    const { handler, logs } = setup();
    const token = idToken();
    await handler(event(browserHeaders(token)));
    const logged = logs.join('\n');
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(SIGNING_KEY.secret);
    expect(logged).not.toContain('reader@umccr.org');
    expect(logged).toContain('session-issued');
  });
});

describe('rejected tokens', () => {
  const now = Math.floor(Date.now() / 1000);

  test.each([
    ['for another app client', idToken({ aud: OTHER_CLIENT_ID })],
    ['that is an access token', idToken({ token_use: 'access' })],
    [
      'from another issuer',
      idToken({ iss: `https://cognito-idp.${REGION}.amazonaws.com/${REGION}_Other` }),
    ],
    ['that has expired', idToken({ iat: now - 7200, exp: now - 3600 })],
    [
      'signed by another key',
      signJwt(
        { sub: 'x', iss: ISSUER, aud: DOCS_CLIENT_ID, token_use: 'id', iat: now, exp: now + 3600 },
        strangerKeys.privateKey
      ),
    ],
    ['that is not a JWT', 'not-a-jwt'],
  ])('rejects a token %s', async (_label, token) => {
    const { handler } = setup();
    const result = (await handler(event(browserHeaders(token)))) as Result;
    expect(result.statusCode).toBe(401);
    expect(errorOf(result)).toBe('invalid-token');
    expect(result.cookies).toBeUndefined();
  });

  test('requires the token', async () => {
    const { handler } = setup();
    const result = await handler(event(browserHeaders()));
    expect((result as Result).statusCode).toBe(401);
    expect(errorOf(result)).toBe('missing-token');
  });
});

describe('request checks', () => {
  test('refuses a host the distribution does not serve', async () => {
    const { handler } = setup();
    const result = await handler(
      event({ ...browserHeaders(idToken()), 'x-docs-host': 'evil.example.com' })
    );
    expect((result as Result).statusCode).toBe(400);
    expect(errorOf(result)).toBe('unknown-host');
  });

  test.each([['cross-site'], ['same-site'], ['none']])('refuses a %s request', async (site) => {
    const { handler } = setup();
    const result = await handler(event({ ...browserHeaders(idToken()), 'sec-fetch-site': site }));
    expect((result as Result).statusCode).toBe(403);
    expect(errorOf(result)).toBe('cross-site');
  });

  test('refuses a request without Sec-Fetch-Site', async () => {
    const { handler } = setup();
    const headers = browserHeaders(idToken());
    delete headers['sec-fetch-site'];
    const result = await handler(event(headers));
    expect((result as Result).statusCode).toBe(403);
  });

  test('accepts header names in any case', async () => {
    const { handler } = setup();
    const result = await handler(
      event({
        'X-Docs-Host': TEST_HOST,
        'X-Docs-Key-Check': sessionKeyCheck(SIGNING_KEY.kid, SIGNING_KEY.secret),
        'Sec-Fetch-Site': 'same-origin',
        'X-Docs-Id-Token': idToken(),
      })
    );
    expect((result as Result).statusCode).toBe(204);
  });

  test('only answers GET', async () => {
    const { handler } = setup();
    const result = await handler(event(browserHeaders(idToken()), 'POST'));
    expect((result as Result).statusCode).toBe(405);
  });
});

describe('the session key', () => {
  test('is not used when the edge holds a different one, so the reader is not sent round in a loop', async () => {
    const { handler, logs } = setup();
    const result = (await handler(event(browserHeaders(idToken(), OTHER_KEY)))) as Result;
    expect(result.statusCode).toBe(503);
    expect(errorOf(result)).toBe('unavailable');
    expect(result.cookies).toBeUndefined();
    expect(logs.join('\n')).toContain('key-mismatch');
  });

  test('is not used without the edge function’s key check', async () => {
    const { handler } = setup();
    const headers = browserHeaders(idToken());
    delete headers['x-docs-key-check'];
    const result = (await handler(event(headers))) as Result;
    expect(result.statusCode).toBe(503);
    expect(result.cookies).toBeUndefined();
  });

  test('being unreadable is reported as unavailable, without a cookie', async () => {
    const { handler, logs } = setup({ keyError: new Error('AccessDeniedException') });
    const result = (await handler(event(browserHeaders(idToken())))) as Result;
    expect(result.statusCode).toBe(503);
    expect(errorOf(result)).toBe('unavailable');
    expect(result.cookies).toBeUndefined();
    expect(logs.join('\n')).toContain('"outcome":"unavailable"');
  });

  test('is only fetched for a verified token', async () => {
    let reads = 0;
    const handler = createSessionHandler({
      verifier,
      signingKey: () => {
        reads += 1;
        return Promise.resolve(SIGNING_KEY);
      },
      allowedHosts: [TEST_HOST],
      sessionLifetimeSeconds: LIFETIME,
      log: () => undefined,
    });
    await handler(event(browserHeaders('not-a-jwt')));
    expect(reads).toBe(0);
  });
});
