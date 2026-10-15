import { describe, expect, test } from '@jest/globals';
import { SESSION_COOKIE_NAME, sessionKeyCheck } from '../app/session/session-cookie';
import {
  CLOUDFRONT_FUNCTION_MAX_BYTES,
  renderViewerRequestCode,
} from '../infrastructure/stage/viewer-request';
import {
  CfRequest,
  CfResponse,
  isResponse,
  loadViewerRequestHandler,
  sessionCookie,
  TEST_HOST,
  TEST_KEY,
  TEST_KID,
  viewerRequest,
  ViewerRequestHandler,
} from './viewer-request-harness';

/**
 * Behavioural tests for the generated viewer-request CloudFront Function. It decides whether a reader is signed in
 * and which object serves a URL, so these tests execute it rather than inspecting its source.
 */

const NOT_FOUND_KEY = '/_platform/public/not-found';

const run = (handler: ViewerRequestHandler, request: CfRequest): CfRequest | CfResponse =>
  handler({ request });

const expectRewrite = (result: CfRequest | CfResponse, uri: string) => {
  expect(isResponse(result)).toBe(false);
  expect((result as CfRequest).uri).toBe(uri);
};

const expectRedirect = (result: CfRequest | CfResponse, statusCode: number, location: string) => {
  expect(isResponse(result)).toBe(true);
  const response = result as CfResponse;
  expect(response.statusCode).toBe(statusCode);
  expect(response.headers?.location?.value).toBe(location);
  expect(response.headers?.['cache-control']?.value).toBe('no-store');
};

const expectSessionCleared = (result: CfRequest | CfResponse) => {
  const cookie = (result as CfResponse).cookies?.[SESSION_COOKIE_NAME];
  expect(cookie?.value).toBe('');
  expect(cookie?.attributes).toContain('Max-Age=0');
};

const signInFor = (path: string) => `/_auth/?rd=${encodeURIComponent(path)}`;

describe('without a session', () => {
  const handler = loadViewerRequestHandler();

  test.each([
    ['/_auth/', '/_auth/index.html'],
    ['/_auth/app.js', '/_auth/app.js'],
    ['/_auth/env.js', '/_auth/env.js'],
    ['/_auth/styles.css', '/_auth/styles.css'],
    ['/robots.txt', '/_platform/public/robots.txt'],
    ['/favicon.ico', '/_platform/public/favicon.ico'],
    ['/_platform/public/404.html', '/_platform/public/404.html'],
  ])('serves public %s from %s', (uri, expected) => {
    expectRewrite(run(handler, viewerRequest(uri)), expected);
  });

  test('redirects /_auth to the sign-in page, keeping the query string', () => {
    expectRedirect(
      run(handler, viewerRequest('/_auth', { query: { rd: '/platform/' } })),
      301,
      '/_auth/?rd=/platform/'
    );
  });

  test('passes the viewer host to the session endpoint, overwriting any client value', () => {
    const result = run(
      handler,
      viewerRequest('/_auth/session', { headers: { 'x-docs-host': 'evil.example.com' } })
    );
    expectRewrite(result, '/_auth/session');
    expect((result as CfRequest).headers['x-docs-host'].value).toBe(TEST_HOST);
  });

  test('tells the session Lambda which key it holds without revealing it, overwriting any client value', () => {
    const result = run(
      handler,
      viewerRequest('/_auth/session', { headers: { 'x-docs-key-check': 'forged' } })
    );
    const check = (result as CfRequest).headers['x-docs-key-check'].value;
    expect(check).toBe(sessionKeyCheck(TEST_KID, TEST_KEY));
    expect(check).not.toContain(TEST_KEY.slice(0, 8));
  });

  test('signs out by clearing the cookie and handing over to Amplify', () => {
    const result = run(handler, viewerRequest('/_auth/signout', { cookie: sessionCookie() }));
    expectRedirect(result, 302, '/_auth/?signout=1');
    expectSessionCleared(result);
  });

  test.each([
    ['/', '/'],
    ['/platform/', '/platform/'],
    [
      '/management-knowledgebase/Projects/portal-hub/',
      '/management-knowledgebase/Projects/portal-hub/',
    ],
    // Unknown paths redirect too, so an unauthenticated reader cannot tell which pages exist.
    ['/no-such-site/page/', '/no-such-site/page/'],
    ['/_platform/data/catalog.json', '/_platform/data/catalog.json'],
    ['/sites/platform/index.html', '/sites/platform/index.html'],
  ])('sends a page navigation for %s to sign in, returning to it afterwards', (uri, returnPath) => {
    const result = run(handler, viewerRequest(uri, { headers: { 'sec-fetch-mode': 'navigate' } }));
    expectRedirect(result, 302, signInFor(returnPath));
  });

  test('keeps the query string in the return path', () => {
    const result = run(
      handler,
      viewerRequest('/platform/search/', { query: { q: 'cognito', tag: ['a', 'b'] } })
    );
    expectRedirect(result, 302, signInFor('/platform/search/?q=cognito&tag=a&tag=b'));
  });

  test('treats a request without Sec-Fetch-Mode as a navigation', () => {
    expectRedirect(run(handler, viewerRequest('/platform/')), 302, signInFor('/platform/'));
  });

  test.each(['cors', 'no-cors', 'same-origin'])(
    'answers a %s request with 401 rather than the sign-in page',
    (mode) => {
      const result = run(
        handler,
        viewerRequest('/platform/search/search_index.json', { headers: { 'sec-fetch-mode': mode } })
      );
      expect((result as CfResponse).statusCode).toBe(401);
      expect((result as CfResponse).headers?.location).toBeUndefined();
    }
  );
});

describe('with an invalid session cookie', () => {
  const handler = loadViewerRequestHandler();
  const now = Math.floor(Date.now() / 1000);
  const valid = sessionCookie();
  const [version, payload, signature] = valid.split('.');

  test.each([
    ['expired', sessionCookie({ iat: now - 7200, exp: now - 1 })],
    ['issued in the future', sessionCookie({ iat: now + 600, exp: now + 3600 })],
    ['for another host', sessionCookie({ aud: 'docs.prod.umccr.org' })],
    ['signed with another key', sessionCookie({}, 'o'.repeat(64))],
    ['from another key generation', sessionCookie({ kid: '6' })],
    [
      'with a tampered payload',
      `${version}.${Buffer.from('{"kid":"7","sub":"x"}').toString('base64url')}.${signature}`,
    ],
    ['with a truncated signature', `${version}.${payload}.${signature.slice(0, 10)}`],
    ['of another version', `v2.${payload}.${signature}`],
    ['that is not a session', 'not-a-session'],
  ])('rejects a cookie %s', (_label, cookie) => {
    const result = run(handler, viewerRequest('/platform/', { cookie }));
    expectRedirect(result, 302, signInFor('/platform/'));
  });

  test.each([
    ['empty', ''],
    ['shorter than 32 characters', 'k'.repeat(31)],
  ])('rejects every cookie when the deployed key is %s', (_label, key) => {
    const broken = loadViewerRequestHandler({ key });
    // Even a cookie signed with that very key: anyone can compute an HMAC with an empty key.
    const result = run(broken, viewerRequest('/platform/', { cookie: sessionCookie({}, key) }));
    expectRedirect(result, 302, signInFor('/platform/'));

    // Nor does the session Lambda get a key check (even a client's), so it refuses to sign.
    const forwarded = run(
      broken,
      viewerRequest('/_auth/session', { headers: { 'x-docs-key-check': 'forged' } })
    ) as CfRequest;
    expect(forwarded.headers['x-docs-key-check']).toBeUndefined();
  });
});

describe('after a key rotation', () => {
  const rotated = loadViewerRequestHandler({ keyId: '8', key: 'n'.repeat(64) });

  test('sends a reader with a cookie from the previous key back through sign-in', () => {
    const result = run(rotated, viewerRequest('/platform/', { cookie: sessionCookie() }));
    expectRedirect(result, 302, signInFor('/platform/'));
  });

  test('accepts cookies signed with the new key', () => {
    const cookie = sessionCookie({ kid: '8' }, 'n'.repeat(64));
    expectRewrite(
      run(rotated, viewerRequest('/platform/', { cookie })),
      '/sites/platform/index.html'
    );
  });
});

describe('with a valid session cookie', () => {
  const handler = loadViewerRequestHandler();
  const cookie = sessionCookie();
  const signedIn = (uri: string, query?: Record<string, string>) =>
    viewerRequest(uri, { cookie, query });

  test.each([
    ['/platform/', '/sites/platform/index.html'],
    ['/platform/onboarding/', '/sites/platform/onboarding/index.html'],
    [
      '/management-knowledgebase/Projects/portal-hub/',
      '/sites/management-knowledgebase/Projects/portal-hub/index.html',
    ],
    [
      '/management-knowledgebase/assets/stylesheets/main.abc123.min.css',
      '/sites/management-knowledgebase/assets/stylesheets/main.abc123.min.css',
    ],
    [
      '/management-knowledgebase/search/search_index.json',
      '/sites/management-knowledgebase/search/search_index.json',
    ],
    ['/management-knowledgebase/sitemap.xml.gz', '/sites/management-knowledgebase/sitemap.xml.gz'],
    ['/_platform/data/catalog.json', '/_platform/data/catalog.json'],
  ])('rewrites %s to %s', (uri, expected) => {
    expectRewrite(run(handler, signedIn(uri)), expected);
  });

  test.each([
    ['/platform', '/platform/'],
    [
      '/management-knowledgebase/Projects/portal-hub',
      '/management-knowledgebase/Projects/portal-hub/',
    ],
  ])('redirects directory %s to %s, because relative links need the slash', (uri, expected) => {
    expectRedirect(run(handler, signedIn(uri)), 301, expected);
  });

  test('keeps the query string when adding the slash', () => {
    expectRedirect(
      run(handler, signedIn('/platform/onboarding', { from: 'catalogue' })),
      301,
      '/platform/onboarding/?from=catalogue'
    );
  });

  test('sends the site root to the platform home', () => {
    expectRedirect(run(handler, signedIn('/')), 302, '/platform/');
  });

  test.each([
    '/no-such-site/',
    '/no-such-site/page/',
    // Internal keys are only reachable through the function's own rewrite.
    '/sites/platform/index.html',
    '/platform/../management-knowledgebase/',
    '/platform/./index.html',
  ])('serves the 404 page for %s', (uri) => {
    expectRewrite(run(handler, signedIn(uri)), NOT_FOUND_KEY);
  });
});

describe('only registered sites are routed', () => {
  test('a site not published to the stage is a 404 even for a signed-in reader', () => {
    const gammaLike = loadViewerRequestHandler({ sites: ['platform'] });
    expectRewrite(
      run(gammaLike, viewerRequest('/management-knowledgebase/', { cookie: sessionCookie() })),
      NOT_FOUND_KEY
    );
  });
});

describe('with a canonical host', () => {
  const handler = loadViewerRequestHandler({ canonicalHost: 'docs.umccr.org' });

  test('redirects any other host to it, keeping path and query', () => {
    expectRedirect(
      run(handler, viewerRequest('/platform/', { host: 'docs.prod.umccr.org', query: { a: '1' } })),
      301,
      'https://docs.umccr.org/platform/?a=1'
    );
  });

  test('serves the canonical host normally', () => {
    const result = run(handler, viewerRequest('/_auth/', { host: 'docs.umccr.org' }));
    expectRewrite(result, '/_auth/index.html');
  });
});

describe('deployed code size', () => {
  // CloudFront rejects function code over 10 KB, and every registered site adds to the slug table. The key is
  // measured at its deployed length: CloudFormation substitutes 64 characters for the dynamic reference.
  const sizeFor = (siteCount: number) =>
    Buffer.byteLength(
      renderViewerRequestCode({
        sites: Array.from(
          { length: siteCount },
          (_, index) => `example-documentation-site-${index}`
        ),
        canonicalHost: 'docs.umccr.org',
        sessionKeyId: '999',
        sessionKey: TEST_KEY,
      })
    );

  test('fits comfortably for today’s registry', () => {
    expect(sizeFor(2)).toBeLessThan(CLOUDFRONT_FUNCTION_MAX_BYTES * 0.6);
  });

  test('still fits with 50 sites', () => {
    expect(sizeFor(50)).toBeLessThan(CLOUDFRONT_FUNCTION_MAX_BYTES);
  });

  test('ships no template comments', () => {
    const code = renderViewerRequestCode({
      sites: ['platform'],
      sessionKeyId: '1',
      sessionKey: TEST_KEY,
    });
    expect(code).not.toMatch(/^\s*\/\//m);
    expect(code).not.toContain('/**');
  });
});
