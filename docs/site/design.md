# docs.umccr.org design

How docs.umccr.org fits together, and the decisions behind it: the stages, the site registry, publishing, sign-in,
the chat, paths and caching. What the platform is for and where it stands is in [Project](project.md); what it is
built with, and the conventions for changing it, in [Tech stack](tech.md). The source is this repository: the CDK app
in [`infrastructure/`](https://github.com/umccr/docs-platform/tree/main/infrastructure) and the code it deploys in [`app/`](https://github.com/umccr/docs-platform/tree/main/app).

## Decisions

| | Decision | Record |
| --- | --- | --- |
| D1 | Readers: anyone who can sign in to the `data-portal-<stage>` Cognito pool. Its Google identity provider only admits UMCCR Workspace accounts. One site-wide policy. | [ADR-0005](../design/adr/0005-reader-policy.md) |
| D2 | All docs infrastructure lives in this repository, in the OrcaBus service layout; Terraform for the shared Cognito pool and the certificate stays in `umccr/infrastructure`. | [ADR-0008](../design/adr/0008-infrastructure-in-docs-platform.md) |
| D3 | Sign-in works like orcahouse-ui and orca-ui-v2 (Amplify v6, Google, public client). One small Lambda exchanges the ID token for an HttpOnly session cookie that a CloudFront Function checks. | [ADR-0002](../design/adr/0002-sign-in-and-sessions.md) |
| D4 | The session key is a Secrets Manager secret whose value CloudFormation generates; the function receives it at deploy time. CloudFront KeyValueStore is not permitted in UMCCR's AWS accounts. | [ADR-0002](../design/adr/0002-sign-in-and-sessions.md) |
| D5 | Publishing is dispatched: one organisation webhook, one dispatcher, one shared site pipeline. Two docs pipelines in total, however many sites join. | [ADR-0006](../design/adr/0006-dispatched-publishing.md) |
| D6 | No approval before prod for site releases: documentation changes no data and no running system. A failure in dev stops the release. | [ADR-0006](../design/adr/0006-dispatched-publishing.md) |
| D7 | docs.umccr.org runs in dev and prod only; the stg account has no docs stage (since 2026-10-21). | [ADR-0008](../design/adr/0008-infrastructure-in-docs-platform.md) |
| D8 | One `docs-publisher` role per stage, narrowed per run to one site by a session policy. | [ADR-0006](../design/adr/0006-dispatched-publishing.md) |
| D9 | Chat is OrcaSonar's: docs hosts the panel, calls OrcaSonar's API with the reader's Cognito ID token, and exports documents to its ingest bucket. | [ADR-0007](../design/adr/0007-chat-through-orcasonar.md) |
| D10 | The pilot publishes the vault's `PlatformServices/` folder in full, with wikilinks resolved and Bases views rendered as tables. When a note name exists in several folders, links resolve by `prefer_folders`. | |
| D11 | Repository names in the public site registry are acceptable. | |

Open: the build engine. Material for MkDocs 9.7 on MkDocs 1.6 builds everything today; Zensical 0.0.66 also builds
both examples and the pilot vault. See [ADR-0003](../design/adr/0003-build-engine.md).

The [design records](../design/adr/README.md) give each decision's reasons, and the decisions they replaced.

## At a glance

Each participating repository keeps its own Markdown and nothing else: no workflow, environment or secret. An
organisation-wide GitHub webhook sends every push to a dispatcher, which starts one run of a shared site pipeline
for pushes to a registered site. The pipeline builds the site with this repository's toolkit and publishes it to dev,
then prod. Readers sign in with their UMCCR Google Workspace account, the same way as in the UMCCR portal, and
CloudFront checks the sign-in on every request before it serves anything:

```text
Reader ──HTTPS──▶ CloudFront (docs distribution)
                    ├─ viewer-request CloudFront Function, on every request, before the cache:
                    │    host and reserved-path checks; the session cookie (no session: 302 /_auth/, or 401);
                    │    clean URLs: /<slug>/a/b/ ──▶ /sites/<slug>/a/b/index.html
                    ├─ /_auth/session  ──▶ session Lambda (function URL + origin access control)
                    └─ everything else ──▶ S3 content bucket (origin access control)
```

The chat panel on every page asks OrcaSonar, a separate service, which indexes the documents each publish exports.

## Hostnames

| Stage | Hostnames                               | Cognito pool       | Sites                 |
| ----- | --------------------------------------- | ------------------ | --------------------- |
| beta  | `docs.dev.umccr.org`                    | `data-portal-dev`  | every registered site |
| prod  | `docs.umccr.org`, `docs.prod.umccr.org` | `data-portal-prod` | every registered site |

There is no docs stage in the stg account.

`DOCS_DOMAIN_NAMES` in [`infrastructure/config.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/config.ts) is the source of truth. The
Cognito callback URLs in `umccr/infrastructure` `cognito_aai/app_docs.tf` and the certificate in
`umccr_docs_domain` must cover the same hosts.

A host in a stage's own zone, such as `docs.dev.umccr.org`, gets its records from Terraform (the certificate's
validation) and the hosting stack (the alias). A host directly under `umccr.org`, such as `docs.umccr.org`, needs both
of its records added by hand: the `umccr.org` zone is in the toolchain account, and nothing manages it as code. See
[deploying](deploy.md#prod-the-umccrorg-records).

## Sites

Sites are registered in [`infrastructure/sites.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/sites.ts) and served at `/<slug>/` from
`sites/<slug>/` in the stage's content bucket. `/` redirects to `/platform/`, this repository's own site and
catalogue, built from `docs/site/`.

| Slug                       | Repository                       | Builds with                       |
| -------------------------- | -------------------------------- | --------------------------------- |
| `platform`                 | `umccr/docs-platform`            | the pushed commit                 |
| `management-knowledgebase` | `umccr/management-knowledgebase` | `DOCS_TOOLKIT_REF`, a release tag |

## Publishing

```text
push ─▶ organisation webhook ─▶ dispatcher (Lambda) ─▶ fetch build (CodeBuild) ─▶ source bucket
                                                                                  │
    UMCCR-DocsSitesPipeline: Source ─▶ Build (read-only) ─▶ Publish beta ─▶ Publish prod
                                                                  │                │
                                         docs-publisher (dev)  ◀──┘                └──▶ docs-publisher (prod)
                                         sites/<slug>/ and OrcaSonar's docs/<slug>/
```

- **Dispatcher** ([`app/dispatcher/`](https://github.com/umccr/docs-platform/blob/main/app/dispatcher/dispatch.ts)): a Lambda behind a function URL that
  GitHub's organisation webhook posts every push to. It checks `X-Hub-Signature-256` against the webhook secret,
  ignores pushes from unregistered repositories and branches and pushes outside a site's `docsPaths`, records the
  delivery ID so a redelivery starts nothing, takes the site's next release number, and starts the fetch build.
- **Fetch build**: clones the repository at the pushed commit through the AWS Connector for GitHub (the
  `codestar_github_arn` connection), zips it without `.git` to `sources/<slug>/<commit>.zip` (kept 30 days), and
  starts the site pipeline with that object and the release's variables.
- **UMCCR-DocsSitesPipeline**: CodePipeline V2 in queued mode: one release at a time, in the order they start, since a
  publish is not atomic and two releases of one site must not overlap. Build runs the toolkit at the site's
  `toolkitRef` (a release tag or commit, never a branch) with no write access. Each publish step runs as
  `docs-sites-publish`, whose only permission is to assume the stage's `docs-publisher` role; the toolkit narrows
  that role to the release's site with a session policy. No approval: a failure in beta stops the release before
  prod, and failed runs post to the alerts Slack channel.
- **`docs-publisher`**: one role per stage account (path `/docs/`). It trusts only `docs-sites-publish` in the
  toolchain account, may list, read, put and delete under `sites/*`, and may read the SSM parameters
  `/docs/content-bucket-name` and `/orcasonar/ingest-bucket-name`. For the documents it exports, it may do the same
  under `docs/*` in OrcaSonar's ingest bucket, matched by the bucket's generated name
  (`umccr-orcasonarstatefulstack-ingestbucket…`), and use OrcaSonar's key through S3 for that bucket only.
  OrcaSonar's bucket and key policies name the role only by condition on the account, which defers to these grants.
- **Newer release wins**: each publish compares its release number with the live `sites/<slug>/_publish.json` and
  skips if a newer release is already live.

What a site owner sees of this, and what the build checks, is in the [publishing contract](publishing.md).

## Sign-in

Readers sign in exactly as they do in the portal apps: Amplify in the browser, the Cognito hosted UI, then Google
(UMCCR Workspace accounts only). The pages themselves are the data, so CloudFront checks the sign-in before it
serves anything.

```text
Reader ─ GET /<slug>/page/ ─▶ viewer-request CloudFront Function: no valid __Host-docs_session
  ◀─ 302 /_auth/?rd=/<slug>/page/        (401 for non-navigation requests)
/_auth/  static sign-in page, Amplify v6
  ├─ Amplify session present ─▶ getIdToken({ forceRefresh: true })
  └─ none ─▶ "Sign in with UMCCR account" ─▶ signInWithRedirect({ provider: 'Google' })
               ─▶ Cognito hosted UI ─▶ Google ─▶ /_auth/?code=…&state=…
  ─▶ GET /_auth/session   header x-docs-id-token: <ID token>
       session Lambda: aws-jwt-verify ─▶ Set-Cookie __Host-docs_session (8 hours)
  ─▶ back to /<slug>/page/
```

- **Sign-in page** ([`app/auth-web/`](https://github.com/umccr/docs-platform/blob/main/app/auth-web/src/auth.ts)): adapted from orcahouse-ui's
  `src/lib/auth.ts`. Its `env.js` is written at deploy time with the portal's `VITE_*` keys plus
  `VITE_SONAR_API_URL`. The same build produces `token.js`, which the chat panel loads (below).
- **Session Lambda** ([`app/session/`](https://github.com/umccr/docs-platform/blob/main/app/session/session.ts)): checks the ID token the way the OrcaBus API
  authorizers do and sets an HttpOnly cookie signed with the session key. It exists because CloudFront Functions can
  compute HMAC but cannot verify Cognito's RSA signatures. CloudFront reaches it through origin access control.
- **Viewer-request function** ([`app/edge/viewer-request.js`](https://github.com/umccr/docs-platform/blob/main/app/edge/viewer-request.js)): runs on every
  behaviour before the cache. It verifies the cookie and rewrites clean URLs (`/<slug>/a/b/` →
  `sites/<slug>/a/b/index.html`). Its slug table and settings are generated at synth from the registry.
- **Session key**: one Secrets Manager secret per stage, `DocsSessionKeyV<generation>`, whose value CloudFormation
  generates. The Lambda reads it at run time; the function gets it at deploy time through a
  `{{resolve:secretsmanager:...}}` dynamic reference, so the template and this repository only hold the reference.
- **Key check**: the function adds `x-docs-key-check` on `/_auth/session`, and the Lambda signs only if it matches
  its own key, so a reader is never handed a cookie the edge would reject.
- **Renewal and sign-out**: an expired cookie bounces through `/_auth/`, where Amplify refreshes silently for as
  long as the Cognito refresh token lasts (30 days). `/_auth/signout` clears the cookie, then Amplify signs out of
  Cognito and revokes the refresh token.

The `docs-app` client ID must never be added to the OrcaBus API authorizers' client list. OrcaSonar accepts it,
for the chat panel only.

Why not CloudFront KeyValueStore for the key: its data API (`cloudfront-keyvaluestore:*`) is not permitted in
UMCCR's AWS accounts. The trade-off is that anyone in the stage account who can read the function's code can read
the key; such principals can generally read the content bucket directly too.

## Chat

The theme's chat panel calls OrcaSonar's API (`sonar.<stage>.umccr.org/api/v1`, from `SONAR_API_URLS` in
`config.ts`) directly from the browser. On first open it loads `/_auth/env.js` and `/_auth/token.js`, and sends the
reader's Cognito ID token; the docs session cookie never leaves docs.umccr.org. The content pages' Content Security
Policy allows `connect-src` to OrcaSonar and the Cognito API only. Everything behind the API (the knowledge base,
the model, the budget, the 30-day records) is OrcaSonar's.

## Paths

| Request                              | Served                                              |
| ------------------------------------ | --------------------------------------------------- |
| `/`                                  | 302 to `/platform/`                                 |
| `/<slug>` or `/<slug>/a/b`           | 301 to the same path with a trailing slash          |
| `/<slug>/a/b/`                       | `sites/<slug>/a/b/index.html`                       |
| `/<slug>/assets/x.css`               | `sites/<slug>/assets/x.css`                         |
| unregistered slug, `/sites/...`      | the 404 page                                        |
| `/_auth/`, `/_auth/*`                | the sign-in page, `env.js`, `token.js` (public)     |
| `/_auth/session`                     | the session Lambda                                  |
| `/_platform/public/*`, `/robots.txt` | public files                                        |
| `/_platform/data/catalog.json`       | the catalogue the platform site renders (signed in) |

Without a session, everything but the public paths redirects to sign-in, including paths that do not exist.

## Caching

The cache key holds no cookies, headers or query strings: the function has already rejected unauthenticated
requests, and every signed-in reader sees the same content. The publisher sets `Cache-Control` per object: pages
and indexes `no-cache`, fingerprinted theme assets `immutable`. A publish is live on the next request, so no
invalidation is needed and the publisher has no CloudFront permissions.

## Deploying

The toolchain stack `DocsInfrastructurePipeline` (`bin/deploy.ts`) holds pipeline 1, `UMCCR-DocsInfrastructure`,
and dispatched publishing. Pipeline 1 is self-mutating: it deploys `UMCCR-DocsHostingStack` to beta and, after
approval, prod, and its self-update deploys the rest of the toolchain stack. It is built by
[`deployment-pipeline.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/toolchain/deployment-pipeline.ts), the same construct OrcaSonar
uses. It is started by changes under `bin/`, `infrastructure/` and `app/`, never by the platform site, docs, toolkit
or example changes. [Deploying](deploy.md) has the commands for every step.

Before a stage's first deploy:

1. `umccr/infrastructure` `cognito_aai`: apply `app_docs.tf` to the workspace (callback URLs, SSM
   `/cognito/docs-app/app-client-id`).
2. `umccr/infrastructure` `umccr_docs_domain`: apply to the workspace (certificate, SSM `/docs/certificate_arn`). In
   prod, add the records it outputs to the `umccr.org` zone, by hand with toolchain credentials
   ([deploying](deploy.md#prod-the-umccrorg-records)), and wait for the certificate to be issued.

Before the first release, an organisation owner creates the GitHub webhook (see the
[runbook](runbook.md#set-up-the-organisation-webhook)).

In prod, set `DOCS_CANONICAL_HOST` to `docs.umccr.org` in `config.ts` once the `docs.umccr.org` record resolves.

## Logs, alarms and cost

- **Logs:** CloudFront standard logs and session Lambda logs, 90 days; dispatcher logs, 90 days. No cookies, tokens
  or keys are logged; the Lambdas log the Cognito `sub` or the site, not emails or content.
- **Alarms:** session Lambda errors and throttles, sign-ins refused as unavailable, and failed site pipeline runs
  (Slack). The [runbook](runbook.md) says what to do about each.
- **Cost:** CloudFront requests and transfer, one function run per request, the session Lambda at sign-in, a few
  CodeBuild minutes and CodePipeline action minutes per release, and one secret per stage plus the webhook secret.

## Risks

| Risk | Mitigation |
| --- | --- |
| Material for MkDocs gets only critical fixes; MkDocs 2.0 breaks plugins and theming | MkDocs 1.6 pinned; the preprocessing and theme are engine-neutral; Zensical bake-off (ADR-0003) |
| The session code at the edge is custom | small, and covered by tests that execute the generated function and check a Lambda-minted cookie end to end |
| The session key is part of the edge function's code | readable only inside the stage account, by principals that can generally read the bucket anyway; one config change rotates it (ADR-0002) |
| Amplify tokens are readable by any script on the origin | no project scripts; one platform script; strict CSP |
| The function URL for the webhook is public | signature checked before anything is parsed; unregistered pushes stop at a lookup; the slug comes from the registry. Kept for now (2026-10-15); [ADR-0009](../design/adr/0009-dispatch-from-github-actions.md) proposes removing it |
| A push event lists too few files (capped or force pushes) | the dispatcher publishes when it cannot tell, rather than miss a release |
| Releases finish out of order | each publish compares its release number with the live marker |
| A vault uses Obsidian features beyond the subset | the build names the note and line and stops |
| A site needs a narrower audience | not onboarded until per-site groups exist (ADR-0005); the chat would quote it too |

## History

docs.umccr.org was proposed in the [proposal](../plans/proposal.md) and built to the
[implementation plan](../plans/implementation-plan.md), which tracks the rollout. The design pages in
[`docs/design/`](https://github.com/umccr/docs-platform/tree/main/docs/design) were exported from the design documents, each as of its date. Where one of them differs
from this page, the design records, [Deploying](deploy.md) or the [Runbook](runbook.md), the latter are current.
