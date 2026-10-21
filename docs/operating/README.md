# Operating docs.umccr.org

How the platform is built and run, for the platform team. The source is this repository: the CDK app in
[`infrastructure/`](../../infrastructure/) and the code it deploys in [`app/`](../../app/). These pages are read
here on GitHub; the published `/platform/` site, for readers and site owners, is [`app/site/`](../../app/site/).

- [Deploying](../deploy.md): every deploy step for the infrastructure, the pipelines and the webhook.
- [Onboarding a site](onboarding-a-site.md): registering a documentation site.
- [Runbooks](runbooks.md): the webhook, re-running a release, rotating the session key, revoking readers, taking a
  site offline.
- [Releasing the platform](releasing.md): versioning the toolkit and theme, and moving sites to a release.

## Hostnames

| Stage | Hostnames                               | Cognito pool       | Sites                 |
| ----- | --------------------------------------- | ------------------ | --------------------- |
| beta  | `docs.dev.umccr.org`                    | `data-portal-dev`  | every registered site |
| prod  | `docs.umccr.org`, `docs.prod.umccr.org` | `data-portal-prod` | every registered site |

There is no docs stage in the stg account.

`DOCS_DOMAIN_NAMES` in [`infrastructure/config.ts`](../../infrastructure/config.ts) is the source of truth. The
Cognito callback URLs in `umccr/infrastructure` `cognito_aai/app_docs.tf` and the certificate in
`umccr_docs_domain` must cover the same hosts.

A host in a stage's own zone, such as `docs.dev.umccr.org`, gets its records from Terraform (the certificate's
validation) and the hosting stack (the alias). A host directly under `umccr.org`, such as `docs.umccr.org`, needs both
of its records added by hand: the `umccr.org` zone is in the toolchain account, and nothing manages it as code. See
[deploying](../deploy.md#prod-the-umccrorg-records).

## Sites

Sites are registered in [`infrastructure/sites.ts`](../../infrastructure/sites.ts) and served at `/<slug>/` from
`sites/<slug>/` in the stage's content bucket. `/` redirects to `/platform/`, this repository's own site and
catalogue, built from `app/site/`.

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

- **Dispatcher** ([`app/dispatcher/`](../../app/dispatcher/dispatch.ts)): a Lambda behind a function URL that
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

- **Sign-in page** ([`app/auth-web/`](../../app/auth-web/src/auth.ts)): adapted from orcahouse-ui's
  `src/lib/auth.ts`. Its `env.js` is written at deploy time with the portal's `VITE_*` keys plus
  `VITE_SONAR_API_URL`. The same build produces `token.js`, which the chat panel loads (below).
- **Session Lambda** ([`app/session/`](../../app/session/session.ts)): checks the ID token the way the OrcaBus API
  authorizers do and sets an HttpOnly cookie signed with the session key. It exists because CloudFront Functions can
  compute HMAC but cannot verify Cognito's RSA signatures. CloudFront reaches it through origin access control.
- **Viewer-request function** ([`app/edge/viewer-request.js`](../../app/edge/viewer-request.js)): runs on every
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
[`deployment-pipeline.ts`](../../infrastructure/toolchain/deployment-pipeline.ts), the same construct OrcaSonar
uses. It is started by changes under
`bin/`, `infrastructure/` and `app/`, never by the platform site (`app/site/`), docs, toolkit or example changes.
[Deploying](../deploy.md) has the commands for every step.

Before a stage's first deploy:

1. `umccr/infrastructure` `cognito_aai`: apply `app_docs.tf` to the workspace (callback URLs, SSM
   `/cognito/docs-app/app-client-id`).
2. `umccr/infrastructure` `umccr_docs_domain`: apply to the workspace (certificate, SSM `/docs/certificate_arn`). In
   prod, add the records it outputs to the `umccr.org` zone, by hand with toolchain credentials
   ([deploying](../deploy.md#prod-the-umccrorg-records)), and wait for the certificate to be issued.

Before the first release, an organisation owner creates the GitHub webhook (see [Runbooks](runbooks.md)).

In prod, set `DOCS_CANONICAL_HOST` to `docs.umccr.org` in `config.ts` once the `docs.umccr.org` record resolves.
