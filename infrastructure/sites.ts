import { AppStage } from './stages';

/**
 * Registry of the documentation sites served at `docs.<stage>.umccr.org/<slug>/`.
 *
 * Sites keep their Markdown in their own repositories and have no workflow, environment or secret of their own. An
 * organisation-wide GitHub webhook sends every push to the dispatcher, which looks the repository up here, ignores
 * pushes that change nothing under {@link DocsSite.docsPaths}, and starts one run of the shared site pipeline for the
 * rest. This registry is the only place a slug is allocated. Everything else derives from it:
 *
 *  1. the dispatcher's routing table (repository and branch to slug, docs paths, toolkit ref, stages);
 *  2. the slug table baked into the viewer-request CloudFront Function, so an unregistered slug is a 404;
 *  3. the catalogue data (`/_platform/data/catalog.json`) that the platform site renders.
 *
 * Adding a site here does not publish anything. It becomes reachable at its next push to {@link DocsSite.branch}.
 *
 * Only `slug`, `repo` and `title` are required. Every other field has a default ({@link resolveDocsSite}) that suits
 * a repository laid out like the templates in umccr/docs-toolkit, with `mkdocs.yml` at the root and the pages in
 * `docs/`; an entry sets only what differs.
 */
export interface DocsSite {
  /**
   * URL path segment and S3 prefix, in the docs bucket and in OrcaSonar's ingest bucket. Treat it as immutable:
   * renaming it moves the site's URL. Lowercase letters, digits and hyphens; at most {@link MAX_SLUG_LENGTH}
   * characters.
   */
  readonly slug: string;

  /** GitHub `owner/repo` holding the site's Markdown. The fetch build clones it through the AWS Connector app. */
  readonly repo: string;

  /** Catalogue title. */
  readonly title: string;

  /** One-line catalogue description. Default: none. */
  readonly description?: string;

  /** The branch whose pushes publish the site. Default: `main`. */
  readonly branch?: string;

  /** Path of the site's `mkdocs.yml`, relative to the repository root. Default: `mkdocs.yml`. */
  readonly configPath?: string;

  /**
   * Repository paths, as globs, whose changes publish the site. A push that changes none of them is ignored, so
   * unrelated changes in a code repository with a docs folder start nothing. Default: `docs/**` and the
   * configuration file, in the configuration's folder: MkDocs's own `docs_dir`, `docs`, beside `mkdocs.yml`.
   */
  readonly docsPaths?: string[];

  /**
   * Git ref of `umccr/docs-toolkit` whose toolkit and theme build the site: a release tag such as `v1.2.0`, or a full
   * commit SHA. Never a branch, whose next merge would change how the site builds without a registry change.
   * Default: {@link DOCS_TOOLKIT_REF}, the release every site builds with.
   */
  readonly toolkitRef?: string;

  /** Stages the site is published to, in order. Default: {@link SITE_PUBLISH_STAGES}, beta (dev) then prod. */
  readonly stages?: AppStage[];
}

/** A registry entry with every default filled in: what the dispatcher, the hosting stack and the catalogue read. */
export type ResolvedDocsSite = Required<DocsSite>;

/** Stages the site pipeline publishes to, in order. A stage added to `AppStage` gets no site content until it is here. */
export const SITE_PUBLISH_STAGES: readonly AppStage[] = [AppStage.BETA, AppStage.PROD];

/** Keeps URLs and S3 keys short, and the edge function's route table well within CloudFront's 10 KB limit. */
export const MAX_SLUG_LENGTH = 49;

/**
 * The toolkit every site builds with: a release tag of `umccr/docs-toolkit`. Release it there before the merge that
 * moves this to it: until the tag exists, the sites' releases stop at Build (docs/site/runbook.md). Keep it on one
 * line, as it is: CI reads it from there to build `/platform/`.
 */
export const DOCS_TOOLKIT_REF = 'v0.3.1';

const DEFAULT_BRANCH = 'main';

const DEFAULT_CONFIG_PATH = 'mkdocs.yml';

/** `docs/**` and the configuration file, in the configuration's folder. */
const defaultDocsPaths = (configPath: string): string[] => {
  const folder = configPath.slice(0, configPath.lastIndexOf('/') + 1);
  return [`${folder}docs/**`, configPath];
};

/** The entry with a default for each field it leaves out. */
export const resolveDocsSite = (site: DocsSite): ResolvedDocsSite => {
  const configPath = site.configPath ?? DEFAULT_CONFIG_PATH;
  return {
    slug: site.slug,
    repo: site.repo,
    title: site.title,
    description: site.description ?? '',
    branch: site.branch ?? DEFAULT_BRANCH,
    configPath,
    docsPaths: site.docsPaths ?? defaultDocsPaths(configPath),
    toolkitRef: site.toolkitRef ?? DOCS_TOOLKIT_REF,
    stages: site.stages ?? [...SITE_PUBLISH_STAGES],
  };
};

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Branch names: no spaces, no `..`, no leading or trailing slash. */
const REF_PATTERN = /^(?!\/)(?!.*\.\.)(?!.*\/$)[A-Za-z0-9._/-]+$/;

/** Toolkit refs that only move with the registry: a release tag (`v1.2.0`, `v2.0.0-rc.1`) or a full commit SHA. */
const TOOLKIT_REF_PATTERN = /^(?:v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?|[0-9a-f]{40})$/;

/** Relative paths and globs: no leading slash, no `..` segment. */
const PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\s]+$/;

/**
 * Slugs that would collide with platform paths. `sites` is the internal S3 prefix the edge function rewrites into,
 * so a site called `sites` could not be told apart from a direct request for an internal key. Names starting with
 * `_` are already rejected by {@link SLUG_PATTERN}.
 */
export const RESERVED_SLUGS = ['sites'];

/**
 * The docs platform's own site, in `docs/site/` with its `mkdocs.yml` at the repository root: the catalogue, onboarding
 * and conventions, and the platform's project pages (design, deploying, the runbook). `/` redirects here. The rest of
 * `docs/` (design records, plans, issue write-ups) is not part of it, so its docs paths name `docs/site/` only.
 */
export const PLATFORM_SITE: DocsSite = {
  slug: 'platform',
  repo: 'umccr/docs-platform',
  title: 'UMCCR docs platform',
  description:
    'Catalogue of UMCCR documentation, how to publish yours, and how the platform is built and run.',
  docsPaths: ['mkdocs.yml', 'docs/site/**'],
};

/** Platform Services management knowledge base, an Obsidian vault in `PlatformServices/` rather than `docs/`. */
export const MANAGEMENT_KNOWLEDGEBASE_SITE: DocsSite = {
  slug: 'management-knowledgebase',
  repo: 'umccr/management-knowledgebase',
  title: 'Management knowledgebase',
  description: 'Platform Services projects, decisions, priorities and working conventions.',
  docsPaths: ['PlatformServices/**', 'mkdocs.yml'],
};

/** OrcaSonar's own pages, its `docs/` folder beside the code: a code-only push publishes nothing. */
export const ORCASONAR_SITE: DocsSite = {
  slug: 'orcasonar',
  repo: 'umccr/orcasonar',
  title: 'OrcaSonar',
  description: 'The service behind the chat panel: its design, API, deployment and operation.',
};

/**
 * Every registered site. **Append new sites at the end**: the order drives the route table and the catalogue, and
 * reordering produces a meaningless template diff.
 */
export const DOCS_SITES: DocsSite[] = [
  PLATFORM_SITE,
  MANAGEMENT_KNOWLEDGEBASE_SITE,
  ORCASONAR_SITE,
];

/**
 * Throw if the registry is unusable, once each entry's defaults are filled in: an invalid, reserved or duplicate slug,
 * a missing title, a malformed repository, branch or path, a toolkit ref that is not a release tag or commit, two sites
 * on one repository and branch, or a site with no stage to publish to.
 */
export const validateDocsSites = (sites: DocsSite[]): void => {
  const seen = new Set<string>();
  const sources = new Set<string>();

  for (const site of sites.map(resolveDocsSite)) {
    if (!SLUG_PATTERN.test(site.slug) || site.slug.length > MAX_SLUG_LENGTH) {
      throw new Error(
        `Docs site slug '${site.slug}' must be lowercase letters, digits and inner hyphens, ` +
          `at most ${MAX_SLUG_LENGTH} characters`
      );
    }
    if (RESERVED_SLUGS.includes(site.slug)) {
      throw new Error(`Docs site slug '${site.slug}' is reserved`);
    }
    if (seen.has(site.slug)) {
      throw new Error(`Docs site slug '${site.slug}' is registered more than once`);
    }
    seen.add(site.slug);

    if (site.title.trim() === '') {
      throw new Error(`Docs site '${site.slug}' needs a title for the catalogue`);
    }

    if (!REPO_PATTERN.test(site.repo)) {
      throw new Error(
        `Docs site '${site.slug}' has an invalid repo '${site.repo}'; expected owner/repo`
      );
    }
    if (!REF_PATTERN.test(site.branch)) {
      throw new Error(`Docs site '${site.slug}' has an invalid branch '${site.branch}'`);
    }
    // The dispatcher maps a push to exactly one site.
    const source = `${site.repo.toLowerCase()}#${site.branch}`;
    if (sources.has(source)) {
      throw new Error(
        `Docs site '${site.slug}' shares ${site.repo} branch ${site.branch} with another site`
      );
    }
    sources.add(source);

    if (!PATH_PATTERN.test(site.configPath)) {
      throw new Error(`Docs site '${site.slug}' has an invalid config path '${site.configPath}'`);
    }
    if (site.docsPaths.length === 0 || !site.docsPaths.every((glob) => PATH_PATTERN.test(glob))) {
      throw new Error(
        `Docs site '${site.slug}' needs docs paths: relative globs, without '..' segments`
      );
    }
    if (!TOOLKIT_REF_PATTERN.test(site.toolkitRef)) {
      throw new Error(
        `Docs site '${site.slug}' has toolkit ref '${site.toolkitRef}'; use a release tag such as v1.2.0 ` +
          'or a full commit SHA, never a branch'
      );
    }

    if (site.stages.length === 0) {
      throw new Error(`Docs site '${site.slug}' does not publish to any stage`);
    }
    const unsupported = site.stages.filter((stage) => !SITE_PUBLISH_STAGES.includes(stage));
    if (unsupported.length > 0) {
      throw new Error(
        `Docs site '${site.slug}' cannot publish to ${unsupported.join(', ')}; sites publish to ` +
          SITE_PUBLISH_STAGES.join(' and ')
      );
    }
  }
};

/** Sites published to `appStage`, in registry order, with their defaults. Validates the whole registry first. */
export const getDocsSites = (
  appStage: AppStage,
  sites: DocsSite[] = DOCS_SITES
): ResolvedDocsSite[] => {
  validateDocsSites(sites);
  return sites.map(resolveDocsSite).filter((site) => site.stages.includes(appStage));
};

/** One routing entry for the dispatcher. Catalogue fields stay out: the dispatcher has no use for them. */
export interface DispatchRoute {
  readonly slug: string;
  readonly repo: string;
  readonly branch: string;
  readonly configPath: string;
  readonly docsPaths: string[];
  readonly toolkitRef: string;
  readonly stages: AppStage[];
}

/** The dispatcher's routing table, built into its environment at synth. Validates the registry first. */
export const dispatchRegistry = (sites: DocsSite[] = DOCS_SITES): DispatchRoute[] => {
  validateDocsSites(sites);
  return sites
    .map(resolveDocsSite)
    .map(({ slug, repo, branch, configPath, docsPaths, toolkitRef, stages }) => ({
      slug,
      repo,
      branch,
      configPath,
      docsPaths,
      toolkitRef,
      stages,
    }));
};
