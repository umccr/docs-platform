import { createHmac, timingSafeEqual } from 'node:crypto';
import { minimatch } from 'minimatch';
import type { APIGatewayProxyStructuredResultV2, LambdaFunctionURLEvent } from 'aws-lambda';

/**
 * The dispatcher: an organisation-wide GitHub webhook posts every push here, and pushes to registered docs sites
 * become one run of the shared site pipeline each.
 *
 * Order matters. The signature is checked before anything is parsed; the registry decides the slug, never the event;
 * the delivery ID is recorded before the release number is taken, so a redelivered event starts nothing; and GitHub
 * gets an answer within a second or two, because the fetch build does the slow part.
 */

/** One registry entry, as `infrastructure/sites.ts` `dispatchRegistry()` builds it. */
export interface DispatchRoute {
  readonly slug: string;
  readonly repo: string;
  readonly branch: string;
  readonly configPath: string;
  readonly docsPaths: string[];
  readonly toolkitRef: string;
  readonly stages: string[];
}

/** The parts of a GitHub push event the dispatcher reads. */
export interface PushEvent {
  readonly ref: string;
  readonly after: string;
  readonly deleted?: boolean;
  readonly repository?: { readonly full_name?: string };
  readonly commits?: Array<{
    readonly added?: string[];
    readonly removed?: string[];
    readonly modified?: string[];
  }>;
}

/** What the fetch build needs for one release. */
export interface FetchRequest {
  readonly slug: string;
  readonly repo: string;
  readonly commit: string;
  readonly release: number;
  readonly configPath: string;
  /** A docs-platform git ref. `self` is already resolved to the pushed commit. */
  readonly toolkitRef: string;
  readonly stages: string[];
  readonly deliveryId: string;
}

export interface DispatcherDeps {
  readonly routes: DispatchRoute[];
  /**
   * The webhook secret, the same value configured on the GitHub organisation webhook. `fresh` asks for the value as
   * it is now rather than a cached one, after a signature mismatch; see {@link cachedSecret}.
   */
  getWebhookSecret(fresh?: boolean): Promise<string>;
  /** Record a delivery. Resolves false when it was already recorded. */
  recordDelivery(deliveryId: string): Promise<boolean>;
  /** Forget a delivery, so a manual redelivery can retry after a failed start. */
  forgetDelivery(deliveryId: string): Promise<void>;
  /** The site's next release number: 1, 2, 3, ... */
  nextRelease(slug: string): Promise<number>;
  /** Start the fetch build. Resolves to the build ID. */
  startFetch(request: FetchRequest): Promise<string>;
  log(entry: Record<string, unknown>): void;
}

/** Toolkit ref meaning "the pushed commit". Must match `SELF_TOOLKIT_REF` in `infrastructure/sites.ts`. */
export const SELF_TOOLKIT_REF = 'self';

/** GitHub caps a push event's commit list here; a capped list may not name every changed file. */
export const MAX_LISTED_COMMITS = 2048;

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const ZERO_COMMIT = /^0{40}$/;

/** True when `signature` (the `X-Hub-Signature-256` header) is the HMAC-SHA256 of `body` with `secret`. */
export const verifySignature = (
  body: Buffer,
  signature: string | undefined,
  secret: string
): boolean => {
  if (!signature?.startsWith('sha256=') || secret.length === 0) {
    return false;
  }
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    'utf8'
  );
  const received = Buffer.from(signature, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export interface SecretCacheOptions {
  /** A cached value is read again once it is this old, so a rotated secret takes effect without a mismatch. */
  readonly maxAgeMs: number;
  /** A `fresh` request reads again only when the cached value is at least this old, so forged requests stay cheap. */
  readonly minRefreshMs: number;
  readonly now?: () => number;
}

/**
 * A secret cached per execution environment. Organisation-wide pushes keep environments warm for hours, so the cache
 * expires, and a caller that sees a signature mismatch asks for a fresh value: after a rotation that recovers on the
 * first delivery signed with the new secret. A failed read is not kept, so the next call tries again.
 */
export const cachedSecret = (
  read: () => Promise<string>,
  { maxAgeMs, minRefreshMs, now = Date.now }: SecretCacheOptions
): ((fresh?: boolean) => Promise<string>) => {
  let cached: { value: Promise<string>; readAt: number } | undefined;
  return (fresh = false) => {
    const age = cached ? now() - cached.readAt : Infinity;
    if (cached && age < maxAgeMs && !(fresh && age >= minRefreshMs)) {
      return cached.value;
    }
    const entry = { value: read(), readAt: now() };
    cached = entry;
    entry.value.catch(() => {
      if (cached === entry) {
        cached = undefined;
      }
    });
    return entry.value;
  };
};

/**
 * Files the push changed, or null when the event cannot be trusted to list them all: GitHub caps the commit list,
 * and some pushes (a new branch from an existing commit, a force push) list no commits at all. Null means "assume the
 * docs changed", because missing a release is worse than one extra build.
 */
export const changedFiles = (event: PushEvent): string[] | null => {
  const commits = event.commits ?? [];
  if (commits.length === 0 || commits.length >= MAX_LISTED_COMMITS) {
    return null;
  }
  const files = new Set<string>();
  for (const commit of commits) {
    for (const file of [
      ...(commit.added ?? []),
      ...(commit.removed ?? []),
      ...(commit.modified ?? []),
    ]) {
      files.add(file);
    }
  }
  return [...files];
};

/** True when any changed file matches the site's docs paths. */
export const touchesDocs = (files: string[] | null, docsPaths: string[]): boolean => {
  if (files === null) {
    return true;
  }
  return files.some((file) => docsPaths.some((glob) => minimatch(file, glob, { dot: true })));
};

/** The registered site a push belongs to, matched on repository (case-insensitive, like GitHub) and branch. */
export const routeFor = (routes: DispatchRoute[], event: PushEvent): DispatchRoute | undefined => {
  const repo = event.repository?.full_name?.toLowerCase();
  const branch = event.ref.startsWith('refs/heads/') ? event.ref.slice('refs/heads/'.length) : null;
  if (!repo || branch === null) {
    return undefined;
  }
  return routes.find((route) => route.repo.toLowerCase() === repo && route.branch === branch);
};

const header = (event: LambdaFunctionURLEvent, name: string): string | undefined =>
  event.headers?.[name] ?? event.headers?.[name.toLowerCase()];

const reply = (
  statusCode: number,
  body: Record<string, unknown>
): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

export const createDispatcher =
  (deps: DispatcherDeps) =>
  async (event: LambdaFunctionURLEvent): Promise<APIGatewayProxyStructuredResultV2> => {
    if (event.requestContext?.http?.method !== 'POST') {
      return reply(405, { error: 'method-not-allowed' });
    }

    const body = Buffer.from(event.body ?? '', event.isBase64Encoded ? 'base64' : 'utf8');
    const signature = header(event, 'X-Hub-Signature-256');
    const signed =
      verifySignature(body, signature, await deps.getWebhookSecret()) ||
      // The secret may have been rotated since this environment read it: check once more against the current one.
      (signature !== undefined &&
        verifySignature(body, signature, await deps.getWebhookSecret(true)));
    if (!signed) {
      deps.log({ outcome: 'bad-signature' });
      return reply(401, { error: 'bad-signature' });
    }

    const kind = header(event, 'X-GitHub-Event');
    const deliveryId = header(event, 'X-GitHub-Delivery') ?? '';
    if (kind === 'ping') {
      return reply(200, { ok: true });
    }
    if (kind !== 'push') {
      return reply(202, { ignored: 'not-a-push' });
    }

    let push: PushEvent;
    try {
      push = JSON.parse(body.toString('utf8')) as PushEvent;
    } catch {
      return reply(400, { error: 'invalid-json' });
    }

    const route = routeFor(deps.routes, push);
    if (!route) {
      // Every push in the organisation arrives here; nearly all of them stop at this line.
      return reply(202, { ignored: 'not-registered' });
    }
    if (push.deleted || ZERO_COMMIT.test(push.after) || !COMMIT_PATTERN.test(push.after)) {
      return reply(202, { ignored: 'no-commit', slug: route.slug });
    }
    if (!touchesDocs(changedFiles(push), route.docsPaths)) {
      deps.log({
        outcome: 'ignored',
        reason: 'no-docs-change',
        slug: route.slug,
        commit: push.after,
      });
      return reply(202, { ignored: 'no-docs-change', slug: route.slug });
    }

    if (!deliveryId || !(await deps.recordDelivery(deliveryId))) {
      deps.log({ outcome: 'duplicate', slug: route.slug, deliveryId });
      return reply(200, { duplicate: true, slug: route.slug });
    }

    const release = await deps.nextRelease(route.slug);
    const request: FetchRequest = {
      slug: route.slug,
      repo: route.repo,
      commit: push.after,
      release,
      configPath: route.configPath,
      toolkitRef: route.toolkitRef === SELF_TOOLKIT_REF ? push.after : route.toolkitRef,
      stages: route.stages,
      deliveryId,
    };
    try {
      const buildId = await deps.startFetch(request);
      deps.log({ outcome: 'dispatched', slug: route.slug, commit: push.after, release, buildId });
      return reply(202, { slug: route.slug, release, buildId });
    } catch (error) {
      await deps.forgetDelivery(deliveryId);
      deps.log({
        outcome: 'start-failed',
        slug: route.slug,
        commit: push.after,
        error: String(error),
      });
      return reply(500, { error: 'start-failed' });
    }
  };
