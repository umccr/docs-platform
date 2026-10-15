import { createHmac } from 'node:crypto';
import { describe, expect, test } from '@jest/globals';
import type { LambdaFunctionURLEvent } from 'aws-lambda';
import {
  cachedSecret,
  changedFiles,
  createDispatcher,
  DispatcherDeps,
  DispatchRoute,
  FetchRequest,
  MAX_LISTED_COMMITS,
  PushEvent,
  routeFor,
  touchesDocs,
  verifySignature,
} from '../app/dispatcher/dispatch';
import { dispatchRegistry } from '../infrastructure/sites';

const SECRET = 'webhook-secret-for-tests'; // pragma: allowlist secret
const COMMIT = 'a'.repeat(40);

const ROUTES: DispatchRoute[] = [
  {
    slug: 'management-knowledgebase',
    repo: 'umccr/management-knowledgebase',
    branch: 'main',
    configPath: 'mkdocs.yml',
    docsPaths: ['PlatformServices/**', 'mkdocs.yml'],
    toolkitRef: 'v1.0.0',
    stages: ['beta', 'prod'],
  },
  {
    slug: 'platform',
    repo: 'umccr/docs-platform',
    branch: 'main',
    configPath: 'app/site/mkdocs.yml',
    docsPaths: ['app/site/**', 'toolkit/**'],
    toolkitRef: 'self',
    stages: ['beta', 'prod'],
  },
];

const push = (overrides: Partial<PushEvent> = {}): PushEvent => ({
  ref: 'refs/heads/main',
  after: COMMIT,
  repository: { full_name: 'umccr/management-knowledgebase' },
  commits: [{ added: [], removed: [], modified: ['PlatformServices/Home.md'] }],
  ...overrides,
});

const sign = (body: string, secret = SECRET): string =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const request = (
  payload: unknown,
  headers: Record<string, string> = {},
  options: { method?: string; base64?: boolean } = {}
): LambdaFunctionURLEvent => {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    headers: {
      'x-github-event': 'push',
      'x-github-delivery': 'delivery-1',
      'x-hub-signature-256': sign(body),
      ...headers,
    },
    body: options.base64 ? Buffer.from(body).toString('base64') : body,
    isBase64Encoded: options.base64 ?? false,
    requestContext: { http: { method: options.method ?? 'POST' } },
  } as unknown as LambdaFunctionURLEvent;
};

const deps = (overrides: Partial<DispatcherDeps> = {}) => {
  const delivered = new Set<string>();
  const releases = new Map<string, number>();
  const started: FetchRequest[] = [];
  const forgotten: string[] = [];
  const base: DispatcherDeps = {
    routes: ROUTES,
    getWebhookSecret: () => Promise.resolve(SECRET),
    recordDelivery: (id) => {
      if (delivered.has(id)) return Promise.resolve(false);
      delivered.add(id);
      return Promise.resolve(true);
    },
    forgetDelivery: (id) => {
      delivered.delete(id);
      forgotten.push(id);
      return Promise.resolve();
    },
    nextRelease: (slug) => {
      const next = (releases.get(slug) ?? 0) + 1;
      releases.set(slug, next);
      return Promise.resolve(next);
    },
    startFetch: (fetch) => {
      started.push(fetch);
      return Promise.resolve(`build-${started.length}`);
    },
    log: () => undefined,
  };
  return { deps: { ...base, ...overrides }, started, forgotten };
};

const bodyOf = (result: { body?: string }) =>
  JSON.parse(result.body ?? '{}') as Record<string, unknown>;

describe('verifySignature', () => {
  const body = Buffer.from('{"zen":"Keep it logically awesome."}');

  test('accepts the HMAC-SHA256 of the body', () => {
    expect(verifySignature(body, sign(body.toString()), SECRET)).toBe(true);
  });

  test.each([
    ['a missing header', undefined],
    ['a SHA-1 signature', 'sha1=0000'],
    ['another secret', sign(body.toString(), 'other')],
    ['a truncated signature', sign(body.toString()).slice(0, -2)],
  ])('rejects %s', (_label, signature) => {
    expect(verifySignature(body, signature, SECRET)).toBe(false);
  });

  test('rejects everything when the secret is empty', () => {
    expect(verifySignature(body, sign(body.toString(), ''), '')).toBe(false);
  });
});

describe('cachedSecret', () => {
  const cache = (values: Array<string | Error>) => {
    let clock = 0;
    let reads = 0;
    const get = cachedSecret(
      () => {
        const value = values[Math.min(reads++, values.length - 1)];
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
      },
      { maxAgeMs: 300_000, minRefreshMs: 60_000, now: () => clock }
    );
    return {
      get,
      advance: (ms: number) => (clock += ms),
      reads: () => reads,
    };
  };

  test('reads once while the value is younger than the maximum age', async () => {
    const secret = cache(['first', 'second']);
    expect(await secret.get()).toBe('first');
    secret.advance(299_999);
    expect(await secret.get()).toBe('first');
    expect(secret.reads()).toBe(1);
  });

  test('reads again once the value reaches the maximum age', async () => {
    const secret = cache(['first', 'second']);
    await secret.get();
    secret.advance(300_000);
    expect(await secret.get()).toBe('second');
  });

  test('a fresh request reads again, but at most once per minimum interval', async () => {
    const secret = cache(['first', 'second', 'third']);
    await secret.get();
    expect(await secret.get(true)).toBe('first');
    secret.advance(60_000);
    expect(await secret.get(true)).toBe('second');
    expect(await secret.get(true)).toBe('second');
    expect(secret.reads()).toBe(2);
  });

  test('does not keep a failed read', async () => {
    const secret = cache([new Error('throttled'), 'recovered']);
    await expect(secret.get()).rejects.toThrow('throttled');
    expect(await secret.get()).toBe('recovered');
  });
});

describe('routing', () => {
  test('matches repository case-insensitively, and the branch exactly', () => {
    expect(
      routeFor(ROUTES, push({ repository: { full_name: 'UMCCR/Management-Knowledgebase' } }))?.slug
    ).toBe('management-knowledgebase');
    expect(routeFor(ROUTES, push({ ref: 'refs/heads/feature' }))).toBeUndefined();
    expect(routeFor(ROUTES, push({ ref: 'refs/tags/v1.0.0' }))).toBeUndefined();
    expect(routeFor(ROUTES, push({ repository: { full_name: 'umccr/other' } }))).toBeUndefined();
  });

  test('works with the real registry', () => {
    expect(routeFor(dispatchRegistry(), push())?.slug).toBe('management-knowledgebase');
  });
});

describe('changed files', () => {
  test('collects added, removed and modified files across commits', () => {
    expect(
      changedFiles(
        push({
          commits: [
            { added: ['a.md'], modified: ['b.md'] },
            { removed: ['c.md'], modified: ['b.md'] },
          ],
        })
      )!.sort()
    ).toEqual(['a.md', 'b.md', 'c.md']);
  });

  test('cannot be trusted when GitHub lists no commits or caps the list', () => {
    expect(changedFiles(push({ commits: [] }))).toBeNull();
    expect(
      changedFiles(push({ commits: Array.from({ length: MAX_LISTED_COMMITS }, () => ({})) }))
    ).toBeNull();
  });

  test('matches docs paths with globs, including dotfiles under them', () => {
    expect(touchesDocs(['PlatformServices/Projects/x.md'], ['PlatformServices/**'])).toBe(true);
    expect(touchesDocs(['PlatformServices/.attachments/a.png'], ['PlatformServices/**'])).toBe(
      true
    );
    expect(touchesDocs(['src/main.ts', 'README.md'], ['PlatformServices/**', 'mkdocs.yml'])).toBe(
      false
    );
    expect(touchesDocs(null, ['PlatformServices/**'])).toBe(true);
  });
});

describe('dispatcher', () => {
  test('starts one fetch build for a registered docs push, and answers 202', async () => {
    const { deps: d, started } = deps();
    const result = await createDispatcher(d)(request(push()));

    expect(result.statusCode).toBe(202);
    expect(bodyOf(result)).toEqual({
      slug: 'management-knowledgebase',
      release: 1,
      buildId: 'build-1',
    });
    expect(started).toEqual([
      {
        slug: 'management-knowledgebase',
        repo: 'umccr/management-knowledgebase',
        commit: COMMIT,
        release: 1,
        configPath: 'mkdocs.yml',
        toolkitRef: 'v1.0.0',
        stages: ['beta', 'prod'],
        deliveryId: 'delivery-1',
      },
    ]);
  });

  test('accepts a base64-encoded body', async () => {
    const { deps: d, started } = deps();
    const result = await createDispatcher(d)(request(push(), {}, { base64: true }));
    expect(result.statusCode).toBe(202);
    expect(started).toHaveLength(1);
  });

  test("builds docs-platform's own site with the toolkit at the pushed commit", async () => {
    const { deps: d, started } = deps();
    await createDispatcher(d)(
      request(
        push({
          repository: { full_name: 'umccr/docs-platform' },
          commits: [{ modified: ['toolkit/src/umccr_docs/theme/assets/umccr/umccr.js'] }],
        })
      )
    );
    expect(started[0]).toMatchObject({ slug: 'platform', toolkitRef: COMMIT });
  });

  test('rejects a request without a valid signature', async () => {
    const { deps: d, started } = deps();
    const result = await createDispatcher(d)(
      request(push(), { 'x-hub-signature-256': sign('{}', 'wrong') })
    );
    expect(result.statusCode).toBe(401);
    expect(started).toHaveLength(0);
  });

  test('accepts a delivery signed with a rotated secret once a fresh read returns it', async () => {
    const reads: boolean[] = [];
    const { deps: d, started } = deps({
      getWebhookSecret: (fresh = false) => {
        reads.push(fresh);
        return Promise.resolve(fresh ? 'rotated-secret' : SECRET);
      },
    });
    const event = request(push());
    event.headers['x-hub-signature-256'] = sign(event.body ?? '', 'rotated-secret');

    expect((await createDispatcher(d)(event)).statusCode).toBe(202);
    expect(reads).toEqual([false, true]);
    expect(started).toHaveLength(1);
  });

  test('does not read the secret again for a request without a signature', async () => {
    const reads: boolean[] = [];
    const { deps: d } = deps({
      getWebhookSecret: (fresh = false) => {
        reads.push(fresh);
        return Promise.resolve(SECRET);
      },
    });
    const event = request(push());
    delete event.headers['x-hub-signature-256'];

    expect((await createDispatcher(d)(event)).statusCode).toBe(401);
    expect(reads).toEqual([false]);
  });

  test('does not parse a body that fails the signature check', async () => {
    const { deps: d } = deps();
    const event = request('not json at all');
    event.headers['x-hub-signature-256'] = sign('something else');
    expect((await createDispatcher(d)(event)).statusCode).toBe(401);
  });

  test('answers GitHub ping events', async () => {
    const { deps: d } = deps();
    const result = await createDispatcher(d)(request({ zen: 'hi' }, { 'x-github-event': 'ping' }));
    expect(result.statusCode).toBe(200);
  });

  test.each([
    ['another event type', push(), { 'x-github-event': 'pull_request' }, 'not-a-push'],
    [
      'an unregistered repository',
      push({ repository: { full_name: 'umccr/orcabus' } }),
      {},
      'not-registered',
    ],
    ['another branch', push({ ref: 'refs/heads/feature' }), {}, 'not-registered'],
    ['a deleted branch', push({ deleted: true, after: '0'.repeat(40) }), {}, 'no-commit'],
    [
      'a push outside the docs paths',
      push({ commits: [{ modified: ['README.md'] }] }),
      {},
      'no-docs-change',
    ],
  ])('ignores %s', async (_label, payload, headers, reason) => {
    const { deps: d, started } = deps();
    const result = await createDispatcher(d)(request(payload, headers));
    expect(result.statusCode).toBe(202);
    expect(bodyOf(result).ignored).toBe(reason);
    expect(started).toHaveLength(0);
  });

  test('starts nothing for a repeated delivery', async () => {
    const { deps: d, started } = deps();
    const dispatch = createDispatcher(d);
    await dispatch(request(push()));
    const repeat = await dispatch(request(push()));
    expect(repeat.statusCode).toBe(200);
    expect(bodyOf(repeat).duplicate).toBe(true);
    expect(started).toHaveLength(1);
  });

  test('numbers each release of a site', async () => {
    const { deps: d, started } = deps();
    const dispatch = createDispatcher(d);
    await dispatch(request(push()));
    await dispatch(request(push(), { 'x-github-delivery': 'delivery-2' }));
    expect(started.map((fetch) => fetch.release)).toEqual([1, 2]);
  });

  test('forgets the delivery when the build cannot start, so a redelivery can retry', async () => {
    const { deps: d, forgotten } = deps({
      startFetch: () => Promise.reject(new Error('throttled')),
    });
    const result = await createDispatcher(d)(request(push()));
    expect(result.statusCode).toBe(500);
    expect(forgotten).toEqual(['delivery-1']);
  });

  test('refuses anything but POST', async () => {
    const { deps: d } = deps();
    const result = await createDispatcher(d)(request(push(), {}, { method: 'GET' }));
    expect(result.statusCode).toBe(405);
  });
});
