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

  /** The branch whose pushes publish the site. */
  readonly branch: string;

  /** Path of the site's `mkdocs.yml`, relative to the repository root. */
  readonly configPath: string;

  /**
   * Repository paths, as globs, whose changes publish the site. A push that changes none of them is ignored, so
   * unrelated changes in a code repository with a docs folder start nothing.
   */
  readonly docsPaths: string[];

  /**
   * Git ref of `umccr/docs-platform` whose toolkit and theme build the site: a release tag such as `v1.2.0`, or a full
   * commit SHA. Never a branch, whose next merge would change how the site builds without a registry change. `self`
   * builds with the toolkit at the pushed commit, for this repository's own site only.
   */
  readonly toolkitRef: string;

  /** Stages the site is published to, in order. Sites publish to dev and prod; stg carries no site content. */
  readonly stages: AppStage[];

  /** Catalogue title. */
  readonly title: string;

  /** One-line catalogue description. */
  readonly description: string;
}

/** Stages the site pipeline publishes to. Stg receives infrastructure from the infrastructure pipeline, not sites. */
export const SITE_PUBLISH_STAGES: readonly AppStage[] = [AppStage.BETA, AppStage.PROD];

/** Keeps URLs and S3 keys short, and the edge function's route table well within CloudFront's 10 KB limit. */
export const MAX_SLUG_LENGTH = 49;

/** Toolkit ref that means "the pushed commit": only `umccr/docs-platform` itself may use it. */
export const SELF_TOOLKIT_REF = 'self';

/**
 * The toolkit every other site builds with: a docs-platform release tag. Push the tag before, or straight after, the
 * merge that moves this to it: until the tag exists, those sites' releases stop at Build (docs/operating/releasing.md).
 */
export const DOCS_TOOLKIT_REF = 'v1.0.0';

const PLATFORM_REPO = 'umccr/docs-platform';

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
 * The docs platform's own site, in `app/site/`: catalogue, onboarding and conventions. `/` redirects here. It builds
 * with the toolkit at the same commit, so a theme or toolkit change shows on this site first. The repository's
 * `docs/` folder (design records, plans, runbooks) is not part of it.
 */
export const PLATFORM_SITE: DocsSite = {
  slug: 'platform',
  repo: PLATFORM_REPO,
  branch: 'main',
  configPath: 'app/site/mkdocs.yml',
  docsPaths: ['app/site/**', 'toolkit/**', 'requirements/build.txt'],
  toolkitRef: SELF_TOOLKIT_REF,
  stages: [AppStage.BETA, AppStage.PROD],
  title: 'UMCCR docs platform',
  description: 'Catalogue of UMCCR documentation, onboarding and authoring conventions.',
};

/** Platform Services management knowledge base, an Obsidian vault (`PlatformServices/`). */
export const MANAGEMENT_KNOWLEDGEBASE_SITE: DocsSite = {
  slug: 'management-knowledgebase',
  repo: 'umccr/management-knowledgebase',
  branch: 'main',
  configPath: 'mkdocs.yml',
  docsPaths: ['PlatformServices/**', 'mkdocs.yml'],
  toolkitRef: DOCS_TOOLKIT_REF,
  stages: [AppStage.BETA, AppStage.PROD],
  title: 'Management knowledgebase',
  description: 'Platform Services projects, decisions, priorities and working conventions.',
};

/**
 * Every registered site. **Append new sites at the end**: the order drives the route table and the catalogue, and
 * reordering produces a meaningless template diff.
 */
export const DOCS_SITES: DocsSite[] = [PLATFORM_SITE, MANAGEMENT_KNOWLEDGEBASE_SITE];

/**
 * Throw if the registry is unusable: an invalid, reserved or duplicate slug, a malformed repository, branch or path, a
 * toolkit ref that is not a release tag or commit, two sites on one repository and branch, or a site with no stage to
 * publish to.
 */
export const validateDocsSites = (sites: DocsSite[]): void => {
  const seen = new Set<string>();
  const sources = new Set<string>();

  for (const site of sites) {
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
    if (site.toolkitRef === SELF_TOOLKIT_REF) {
      if (site.repo !== PLATFORM_REPO) {
        throw new Error(
          `Docs site '${site.slug}' cannot use toolkit ref '${SELF_TOOLKIT_REF}': only ${PLATFORM_REPO} can`
        );
      }
    } else if (!TOOLKIT_REF_PATTERN.test(site.toolkitRef)) {
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

/** Sites published to `appStage`, in registry order. Validates the whole registry first. */
export const getDocsSites = (appStage: AppStage, sites: DocsSite[] = DOCS_SITES): DocsSite[] => {
  validateDocsSites(sites);
  return sites.filter((site) => site.stages.includes(appStage));
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
  return sites.map(({ slug, repo, branch, configPath, docsPaths, toolkitRef, stages }) => ({
    slug,
    repo,
    branch,
    configPath,
    docsPaths,
    toolkitRef,
    stages,
  }));
};
