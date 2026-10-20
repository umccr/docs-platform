import { AppStage } from './stages';
import { DocsSite, getDocsSites } from './sites';

/**
 * Per-stage configuration for the docs hosting stack (`docs.<stage>.umccr.org`).
 *
 * Cognito and the certificate are provisioned by Terraform in `umccr/infrastructure` and read here from SSM at
 * deploy time, the same way the portal reads its certificate:
 *
 *  - `cognito_aai/app_docs.tf` writes {@link DOCS_APP_CLIENT_ID_PARAMETER}. Its callback URLs are
 *    `https://<host>/_auth/` for each host in {@link DOCS_DOMAIN_NAMES}; keep the two lists in step.
 *  - `umccr_docs_domain` writes {@link DOCS_CERTIFICATE_ARN_PARAMETER}.
 *
 * Apply both to a workspace before this stack deploys to that stage.
 */

/**
 * Hostnames the docs distribution answers on, per stage. The Cognito app client registers `https://<host>/_auth/`
 * for each, and the certificate covers each.
 */
export const DOCS_DOMAIN_NAMES: Record<AppStage, string[]> = {
  [AppStage.BETA]: ['docs.dev.umccr.org'],
  [AppStage.PROD]: ['docs.umccr.org', 'docs.prod.umccr.org'],
};

/**
 * Host every other host redirects to, per stage. Readers hold one session cookie per host, so prod converges on one.
 *
 * Unset in prod until the `docs.umccr.org` record exists in the umccr.org zone: until then the stage is only
 * reachable as `docs.prod.umccr.org`, and redirecting away from it would break sign-in.
 */
const DOCS_CANONICAL_HOST: Partial<Record<AppStage, string>> = {};

export const DOCS_CERTIFICATE_ARN_PARAMETER = '/docs/certificate_arn';
export const DOCS_APP_CLIENT_ID_PARAMETER = '/cognito/docs-app/app-client-id';
export const COGNITO_USER_POOL_ID_PARAMETER = '/data_portal/client/cog_user_pool_id';
/** The hosted UI domain prefix, e.g. `data-portal-app-dev`. */
export const COGNITO_OAUTH_DOMAIN_PARAMETER = '/data_portal/client/oauth_domain';

/**
 * The stage role every site publish assumes, from the site pipeline in the toolchain account. One role for all sites:
 * each run narrows it to its own site with a session policy (see the toolkit's `publish --role-arn`).
 */
export const DOCS_PUBLISHER_ROLE_NAME = 'docs-publisher';
export const DOCS_PUBLISHER_ROLE_PATH = '/docs/';

/** The toolchain role the site pipeline's publish steps run as. The only principal `docs-publisher` trusts. */
export const DOCS_SITES_PUBLISH_ROLE_NAME = 'docs-sites-publish';

/** Written by the hosting stack, read by the publish steps after they assume `docs-publisher`. */
export const DOCS_CONTENT_BUCKET_PARAMETER = '/docs/content-bucket-name';

/**
 * Written by OrcaSonar's stateful stack. The publish steps read it to export documents; when it is missing (OrcaSonar
 * not deployed to the stage yet), they skip the export with a warning.
 */
export const ORCASONAR_INGEST_BUCKET_PARAMETER = '/orcasonar/ingest-bucket-name';

/**
 * How the name CloudFormation gives OrcaSonar's ingest bucket starts: its stateful stack's name
 * (`UMCCR-OrcaSonarStatefulStack`) and the bucket's construct ID (`IngestBucket`), in lower case. The publisher
 * role's document grants match it, so renaming either in umccr/orcasonar needs a change here too.
 */
export const ORCASONAR_INGEST_BUCKET_NAME_PREFIX = 'umccr-orcasonarstatefulstack-ingestbucket';

/**
 * OrcaSonar's API, per stage. The chat panel calls it with the reader's Cognito ID token; the content pages'
 * Content Security Policy allows it. Fixed here rather than read from SSM, so docs deploys never depend on OrcaSonar.
 */
export const SONAR_API_URLS: Record<AppStage, string> = {
  [AppStage.BETA]: 'https://sonar.dev.umccr.org/api/v1',
  [AppStage.PROD]: 'https://sonar.prod.umccr.org/api/v1',
};

/** How long a docs session cookie lasts before the sign-in page renews it through Amplify. */
export const DOCS_SESSION_LIFETIME_SECONDS = 8 * 60 * 60;

/**
 * Generation of the session signing key, per stage. The hosting stack keeps the key in a Secrets Manager secret
 * whose value CloudFormation generates, so nobody ever handles it.
 *
 * Increase a stage's number to rotate its key: the deploy creates a new secret, builds it into the edge function
 * and deletes the old one. Every cookie signed with the old key stops working, and readers renew silently on their
 * next page load (see `docs/operating/runbooks.md`). Never change the secret's value by hand: the edge function keeps
 * the key it was deployed with, so the session Lambda would sign cookies the edge rejects.
 */
const DOCS_SESSION_KEY_GENERATION: Record<AppStage, number> = {
  [AppStage.BETA]: 1,
  [AppStage.PROD]: 1,
};

/** Retention for CloudFront standard logs and the session Lambda's logs, which hold paths and IP addresses. */
export const DOCS_LOG_RETENTION_DAYS = 90;

export interface DocsHostingStackConfig {
  readonly appStage: AppStage;
  readonly domainNames: string[];
  readonly canonicalHost?: string;
  readonly sites: DocsSite[];
  /** OrcaSonar's API base URL, for the chat panel. */
  readonly sonarApiUrl: string;
  readonly sessionLifetimeSeconds: number;
  /** See {@link DOCS_SESSION_KEY_GENERATION}. A positive integer. */
  readonly sessionKeyGeneration: number;
  readonly logRetentionDays: number;
}

export const getDocsHostingStackConfig = (appStage: AppStage): DocsHostingStackConfig => ({
  appStage,
  domainNames: DOCS_DOMAIN_NAMES[appStage],
  canonicalHost: DOCS_CANONICAL_HOST[appStage],
  sites: getDocsSites(appStage),
  sonarApiUrl: SONAR_API_URLS[appStage],
  sessionLifetimeSeconds: DOCS_SESSION_LIFETIME_SECONDS,
  sessionKeyGeneration: DOCS_SESSION_KEY_GENERATION[appStage],
  logRetentionDays: DOCS_LOG_RETENTION_DAYS,
});
