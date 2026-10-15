UMCCR Platform Services · platform design

# docs.umccr.org platform design

One place for UMCCR’s documentation. Each repository keeps its own Markdown; docs.umccr.org builds it, publishes it and serves it to staff signed in with their UMCCR Google account. One dispatcher and two pipelines publish every site, however many repositories join. The chat on every page comes from OrcaSonar, a separate project, through its API.

Design · 9 October 2026 · hosting and sign-in deployed in dev

This page covers the docs platform only. The knowledge base, the model, the budget and the 30-day records moved to OrcaSonar and are described on its design page. Hosting and sign-in are as deployed from branch `feat/docs-umccr-org`; the dispatcher, the export and the chat panel are not built yet.

Related: [OrcaSonar design](https://github.com/umccr/orcasonar/blob/main/docs/design.md) [Architecture as deployed in dev](https://claude.ai/artifact/TUtBrjcoBmfaLZApu11pAW) [Delivery plan (8 October)](https://claude.ai/artifact/HNeMSkzpVNCFdXCroNtsT6)

[Decisions](#decisions) [At a glance](#glance) [Repositories](#repos) [Signing in](#signin) [Edge function](#edge) [Publishing](#publishing) [One release](#release) [Chat](#chat) [Pipelines](#pipelines) [Plan](#plan)

## Decisions

| Topic | Decision | Status |
| --- | --- | --- |
| Sign-in | Amplify v6, the Cognito hosted UI and Google, as in the portal. One session Lambda turns the ID token into an 8-hour cookie that the edge function checks on every request. | built |
| Building and publishing | One shared site pipeline in the toolchain account, started per release by a dispatcher behind an organisation-wide GitHub webhook, with the repository and commit as variables. CodePipeline and CodeBuild, the way the portal builds its apps. | decided |
| Number of pipelines | Two for docs however many sites join: DocsInfrastructurePipeline and DocsSitesPipeline. OrcaSonar adds a third of its own. | decided |
| Approval before prod | None for site releases. Documentation changes no data and no running system; a release goes to dev, then straight to prod, and a failure in dev stops it. | decided |
| Chat | Provided by OrcaSonar, a separate project, through its API. docs.umccr.org hosts only the chat panel, which calls the API with the reader’s Cognito token. | decided |
| What docs gives OrcaSonar | Each publish step also writes the site’s documents, as processed Markdown with metadata, to OrcaSonar’s ingest bucket under `docs/<slug>/`. | decided |
| Knowledge base, model, budget, 30-day records | Moved to OrcaSonar, with the same decisions: managed knowledge base, records kept 30 days for evaluation. | decided |

### What moved to OrcaSonar

The delivery plan put the chat inside the docs hosting stack. With OrcaSonar as its own project, docs.umccr.org keeps the reading, signing in and publishing, and becomes one of OrcaSonar’s clients.

| Piece | In the delivery plan | Now |
| --- | --- | --- |
| Chat endpoint | `docs.umccr.org/_api/chat`, behind the docs cookie | `sonar.<stage>.umccr.org/api/v1/chat`, with the reader’s Cognito ID token |
| Chat Lambda, budget ledger, records bucket | in `DocsHostingStack` | OrcaSonar |
| Knowledge base and its bucket | one per stage, beside the docs bucket, fed from `kb/<slug>/` | OrcaSonar, fed from its own ingest bucket, `docs/<slug>/` |
| Edge function and behaviours | a new `/_api/*` behaviour | unchanged; the panel talks to OrcaSonar directly |
| Chat panel | calls its own origin | an OrcaSonar client, like any other app |

## At a glance

Readers only ever reach the stage account and OrcaSonar’s API. GitHub reaches the toolchain account through one webhook, and the site pipeline writes into each stage through one narrow role. Four flows run through the system; their steps are numbered in the order they happen.

### Reading a page

1. R1Every request, with its session cookie, meets the viewer-request function first, before the cache.
2. R2With a valid cookie, the request goes on to the shared cache, rewritten to the site’s object.
3. R3On a miss or revalidation, CloudFront reads the object from the private bucket through origin access control.

### Signing in

1. A1First visit only: Amplify sends the reader to the Cognito hosted UI and Google, and back to `/_auth/`.
2. A2The sign-in page sends the ID token to `/_auth/session`.
3. A3CloudFront forwards it to the session Lambda, signed with origin access control.
4. A4The Lambda verifies the token against the pool’s keys: signature, issuer, audience `docs-app`, expiry.
5. A5It signs the 8-hour cookie with the key from Secrets Manager.

### Publishing

1. P1A push to a registered repository reaches the dispatcher through the organisation webhook.
2. P2The dispatcher numbers the release and starts the fetch build.
3. P3The fetch build clones the commit through the AWS Connector app.
4. P4It starts the shared site pipeline with that commit’s files.
5. P5Each publish step assumes the stage’s `docs-publisher` role, narrowed to one site.
6. P6It writes the built pages under `sites/<slug>/`.
7. P7It writes the exported documents under OrcaSonar’s `docs/<slug>/`.
8. P8OrcaSonar indexes what changed.

### Chat

1. C1The chat panel calls OrcaSonar’s API with the reader’s Cognito ID token, refreshed by Amplify, and renders the answer as it streams in.
2. C2OrcaSonar checks the token and the budget, retrieves passages and answers. Sources come back as links to docs pages.

new or changed in this design OrcaSonar, a separate project

**TF** marks resources Terraform creates in `umccr/infrastructure`; **CDK** marks resources `DocsHostingStack` creates. Pipeline 1 deploys the hosting stack and everything in the toolchain account except OrcaSonar’s pipeline.

## What each repository does

Five repositories take part. Each owns one layer, and each layer hands the next one something small and stable: SSM parameters, a registry entry, a toolkit tag, an ingest format and an API.

Outlined in blue: new in this design. Dashed: OrcaSonar, which has its own repository, pipeline and design page.

| Repository | Key paths | Changes in this design |
| --- | --- | --- |
| `umccr/infrastructure` | `terraform/stacks/cognito_aai/app_docs.tf`, `terraform/stacks/umccr_docs_domain/` | none |
| `umccr/frontend-infrastructure-pipelines` | `lib/docs/sites.ts`, `hosting-stack.ts`, `pipeline-stack.ts`, `auth-web/`, `lambda/viewer-request.js`, `lambda/session/` | registry gains branch, docs paths and toolkit tag; new dispatcher, fetch build and DocsSitesPipeline; one `docs-publisher` role per stage instead of one per site; the content-page CSP allows the OrcaSonar API |
| `umccr/docs-platform` | `toolkit/`, `toolkit/src/umccr_docs/theme/`, `docs/`, `.github/workflows/` | `export-kb` command; chat panel in the theme; `docs.yml` and `site.yml` retire after the move |
| `umccr/management-knowledgebase` | `PlatformServices/`, `mkdocs.yml` | its caller workflow, `.github/workflows/docs.yml`, is removed after the move |
| `umccr/orcasonar` (new) | its own | the chat API, ingest bucket, knowledge base and pipeline; see the OrcaSonar design |

## Signing in

Readers sign in the way they do in the portal apps: Amplify in the browser, the Cognito hosted UI, then Google. Here the pages are the data, so CloudFront has to see a sign-in before it serves anything. CloudFront Functions can verify an HMAC but not Cognito’s RSA signatures, so one small Lambda checks the ID token once and exchanges it for a cookie the edge can check on every request. This is built and running in dev, and the chat changes none of it.

A reader opening a site, for example `/management-knowledgebase/`. Solid arrows are requests and dashed arrows are responses.

### Renewal

The cookie expires after 8 hours. The next page load passes through `/_auth/`, where Amplify refreshes its tokens without a prompt. Readers see the sign-in button again only when their Cognito session ends after 30 days, or if their account is disabled.

### Sign-out

`/_auth/signout` clears the cookie at the edge, then the sign-in page calls Amplify’s `signOut()`, which revokes the refresh token. The chat panel loses its token at the same moment.

### Tokens for chat

The chat panel uses the same Amplify session as the sign-in page, on the same origin. Its ID token, not the cookie, is what OrcaSonar checks, so the panel works on any page the reader can open.

## What the edge function does with each request

One CloudFront Function runs on every request, before the cache. Its checks run top to bottom and the first match wins. The site list and the session key are written into its code at deploy time, because CloudFront Functions have no environment variables and can’t call AWS APIs.

Only the sign-in page and a few public files are reachable without a session, so someone who isn’t signed in can’t tell which pages exist. Shown for dev; prod is the same with its own hostnames.

| Files | Cache-Control | Effect |
| --- | --- | --- |
| Theme assets with a content hash: `*.<hash>.min.js`, `*.<hash>.min.css` | `public, max-age=31536000, immutable` | cached for a year; a changed asset gets a new name |
| Everything else: pages, the search index, images, `_publish.json` | `no-cache` | CloudFront and browsers revalidate on every request, so a publish or a deletion shows on the next one |

## Publishing: one webhook, one dispatcher, one site pipeline

Every push in the organisation reaches one small Lambda. It drops everything that isn’t a push to a registered docs repository, and turns the rest into a run of the one shared site pipeline, with the site and commit as variables. Code is fetched through the AWS Connector app the organisation already uses, so no personal access token or GitHub App key is involved. Each publish now writes two things: the built site, and the same pages as documents for OrcaSonar.

new or changed OrcaSonar a release a registry change

The prod account mirrors the dev account; only the dev side carries the R10 badge.

### Each step

1. D1A registry change merges in `frontend-infrastructure-pipelines`. Pipeline 1 updates routing and the catalogue in each stage, and the dispatcher’s copy of the registry.
2. R1A writer pushes to `main`. GitHub posts the push event, signed with the webhook secret, to the dispatcher’s URL.
3. R2The dispatcher checks the signature and the registry, records the delivery so a repeat does nothing, and takes the site’s next release number.
4. R3It starts the fetch build for that repository and commit, and answers GitHub straight away.
5. R4The fetch build clones the repository at the commit through the AWS Connector app.
6. R5It zips the files to `sources/<slug>/<commit>.zip` in the source bucket.
7. R6It starts the site pipeline with that object key and the variables `SLUG`, `REPO`, `COMMIT`, `RELEASE` and `TOOLKIT_REF`.
8. R7Build runs the toolkit: check, strict build, verify-site and export-kb. It can’t write anywhere.
9. R8Publish dev assumes the dev publisher role, narrowed to this site, and writes the pages and the documents.
10. R9Publish prod does the same in prod, as soon as dev succeeds.
11. R10OrcaSonar re-indexes the changed documents in each stage.

### Each node

Docs repositories

Markdown and `mkdocs.yml`, nothing else: no workflow, no environments, no secrets. `umccr/docs-platform` is one of them and publishes `/platform/`.

Organisation webhook

Created once by an organisation owner. It sends push events for every repository in the umccr organisation, including ones created later, to the dispatcher’s URL. Each delivery is signed with a secret kept in Secrets Manager.

AWS Connector for GitHub

The CodeConnections GitHub App UMCCR’s pipelines already use. CodeBuild can clone any repository the app can see, at any commit, with no token.

Registry, `lib/docs/sites.ts`

One entry per site: repository, slug, branch, docs paths, stages, toolkit tag, title. It drives routing, the catalogue and the dispatcher.

Dispatcher Lambda

Answers GitHub within a second or two and rejects anything without a valid signature. Pushes from repositories, branches or paths not in the registry stop here. The slug always comes from the registry, never from the event.

Dispatch table

DynamoDB: delivery IDs, which expire after a few days so a repeated delivery does nothing, and a release counter per site.

Fetch build and source bucket

A CodeBuild project started once per release with its source, commit and CodeConnections authorisation set for that run. It zips the checkout without `.git` to `sources/<slug>/<commit>.zip`, kept 30 days, so any run can be repeated from the same files.

Pipeline 2 · DocsSitesPipeline

CodePipeline V2 in parallel mode: releases of different sites run side by side, up to 50 at once. Each run carries its site and commit in pipeline variables, so the execution history reads as a release log.

Build

CodeBuild with no write access, running the toolkit at the tag the registry pins. Repository content never runs with publishing rights.

Publish dev, publish prod

Each assumes its stage’s `docs-publisher` role with a session policy that allows only `sites/<slug>/` in the content bucket and `docs/<slug>/` in OrcaSonar’s ingest bucket. It records the release number in `_publish.json`, and skips if the live release is newer.

`docs-publisher`

One role per stage account, replacing the role per site. It trusts only the site pipeline’s publish role. OrcaSonar’s bucket policy lets it write under `docs/`.

OrcaSonar ingest bucket

Owned and deployed by OrcaSonar. The docs side only writes to it. OrcaSonar publishes the bucket’s name in SSM, where the publish step reads it.

## One release, end to end

The order of events for a single push, and the rules that keep shared, parallel runs safe.

Solid arrows are requests, dashed arrows are responses. A typical release is live in prod a few minutes after the push.

### Newer release wins

Runs of the same site can overlap and finish in any order. Each run carries the site’s release number, and the publish step compares it with the live `_publish.json`: an older release is skipped, not published over a newer one.

### Repeats do nothing

GitHub can deliver an event twice, and a person can redeliver one from the webhook’s settings. The dispatcher records each delivery ID, so the second copy starts nothing.

### No approval, still a gate

Prod publishing waits for dev to succeed. A broken build, a failed check or a failed publish in dev stops the release before prod, and the pipeline’s failure notification says why.

### Adding a site

Nothing in the AWS accounts grows with the number of sites except objects in the buckets.

| What it takes to add a site | Per new site |
| --- | --- |
| Registry entry in `lib/docs/sites.ts` | one, reviewed in a pull request |
| Pipelines, CodeBuild projects, IAM roles | none |
| Workflows, environments or secrets in the site repository | none |
| GitHub | add the repository to the AWS Connector app, only if the app is limited to selected repositories |
| OrcaSonar | nothing: the site’s documents arrive under their own `docs/<slug>/` prefix |
| Edge function | one slug in its route table; CloudFront’s 10 KB limit fits about 50 long slugs, after which the table should go |

## Chat: a client of OrcaSonar

docs.umccr.org doesn’t answer questions itself. The chat panel in the theme calls OrcaSonar’s API like any other app would, and OrcaSonar decides what it can afford to answer and how. The panel needs a Cognito token rather than the docs cookie, because the cookie belongs to docs.umccr.org and is never sent to `sonar.<stage>.umccr.org`. Content pages don’t keep tokens fresh, so the panel loads Amplify when it opens.

Solid arrows are requests, dashed arrows are responses. The OrcaSonar design describes what happens inside the API, and its error codes.

### What changes on docs.umccr.org

| Piece | Change |
| --- | --- |
| Theme: chat panel | A button on every page opens the panel. Ask (an answer with sources) and Search (passages only). It loads Amplify when opened, sends the reader’s ID token, renders the stream as it arrives, lists sources as docs links, and offers thumbs up or down. It tells readers that questions are kept for 30 days to improve answers. |
| Theme: limits | The current site is sent in `sites`, with an option to search every site. A `429` shows OrcaSonar’s message and when to try again; Search usually still works, because it costs a tenth of a cent. |
| Content Security Policy | `connect-src` on content pages adds `https://sonar.<stage>.umccr.org` and the Cognito endpoint Amplify uses to refresh tokens. |
| Configuration | `/_auth/env.js` gains the stage’s OrcaSonar URL, written at deploy like the rest of it. |
| Edge function, session Lambda, cookie | unchanged. The cookie belongs to docs.umccr.org and is never sent to OrcaSonar. |
| Publish steps | Write the `export-kb` output to OrcaSonar’s ingest bucket, then the pages, then `_publish.json`. |

### The export to OrcaSonar

`umccr-docs export-kb` runs in the build stage, after the strict build, so documents always match the published pages. The publish steps upload them with the pages.

| Object | What it holds |
| --- | --- |
| `docs/<slug>/<path>.md` | The page as processed Markdown: wikilinks resolved, Obsidian syntax converted, front matter removed. One object per published page. |
| `docs/<slug>/<path>.md.metadata.json` | The page’s metadata, which OrcaSonar keeps with every passage: `doc_id`, `site`, `title`, `url`, `commit`, `updated`. |
| Pages removed from the site | Their objects are deleted in the same publish, so OrcaSonar drops them at the next index update. |

```
{
  "metadataAttributes": {
    "doc_id": "platform:onboarding",
    "site": "platform",
    "title": "Onboarding a site",
    "url": "https://docs.umccr.org/platform/onboarding/",
    "commit": "3f2c9e1",
    "updated": "2026-10-09"
  }
}
```

`doc_id` is the site’s slug and the page’s path without its extension. It stays the same across releases, so OrcaSonar’s `/documents/{id}` links don’t break when a page is edited.

## Pipelines

Three pipelines in the toolchain account cover docs and chat, and the number doesn’t grow with the number of sites.

| Pipeline | Source | Starts on | Deploys or publishes | Approval |
| --- | --- | --- | --- | --- |
| 1 · DocsInfrastructurePipeline | `frontend-infrastructure-pipelines` | a push to `main` under `lib/docs/**` | `DocsHostingStack` to beta, gamma and prod; the dispatcher, fetch build and Pipeline 2 in the toolchain account | the existing one before prod |
| 2 · DocsSitesPipeline | any registered docs repository, through the dispatcher | a push under a site’s docs paths | pages to `sites/<slug>/` and documents to OrcaSonar’s `docs/<slug>/`, dev then prod | none |
| 3 · OrcaSonar pipeline | `umccr/orcasonar` | a push to `main` | OrcaSonar’s stacks to beta, gamma and prod | OrcaSonar’s choice |

How Pipeline 1 provisions a stage, as built. Terraform in `umccr/infrastructure` owns the Cognito client and the certificate; the hosting stack reads them from SSM when it deploys. With the dispatcher, the per-site publisher roles become one `docs-publisher` role per stage.

## Plan

1. **Dispatched publishing**

   The organisation webhook, the dispatcher, the fetch build, DocsSitesPipeline and one `docs-publisher` role per stage, all deployed by Pipeline 1. Move `/platform/` first, then the knowledgebase, and remove their publish workflows.

   Done when a push to either repository is live in dev and prod within minutes, with nothing in the repositories but docs.
2. **Export to OrcaSonar**

   `export-kb` in the toolkit, and the publish steps writing to OrcaSonar’s ingest bucket, in dev first, as soon as OrcaSonar’s data stack exists there.

   Done when every published page has a document and metadata in the ingest bucket, and removed pages disappear from it.
3. **Chat panel**

   A theme release with the panel, the CSP change and the OrcaSonar URL in `env.js`. On in dev against OrcaSonar dev, then in prod.

   Done when readers ask questions in prod and sources open the right pages.
4. **Later**

   Pull-request checks run by the dispatcher (a check-only build reporting back to GitHub), rebuilding every site when the toolkit tag moves, and more sites.

   Each when someone needs it.

### To confirm

1. An organisation owner to create the webhook, and its secret in Secrets Manager in the toolchain account.
2. Whether the AWS Connector app is installed for all repositories or for selected ones.
3. Whether sites publish to stg as well. The pipeline above publishes to dev and prod; stg keeps receiving infrastructure from Pipeline 1.
4. The SSM name under which OrcaSonar publishes its ingest bucket, agreed with the OrcaSonar stack.

## Sources

- Built code: `frontend-infrastructure-pipelines/lib/docs/` (`sites.ts`, `config.ts`, `hosting-stack.ts`, `pipeline-stack.ts`, `lambda/`, `auth-web/`); `infrastructure/terraform/stacks/cognito_aai/app_docs.tf` and `umccr_docs_domain/`; `docs-platform/toolkit/` and `.github/workflows/`; `management-knowledgebase/mkdocs.yml`
- Portal conventions: `orca-ui-v2/src/api/auth-middleware.ts` (Cognito ID token as the bearer token); `platform-cdk-constructs/packages/deployment-stack-pipeline`
- Pipelines: [starting a pipeline with a source override](https://docs.aws.amazon.com/codepipeline/latest/userguide/pipelines-trigger-source-overrides.html); [S3 object key overrides](https://docs.aws.amazon.com/codepipeline/latest/APIReference/API_SourceRevisionOverride.html); [execution modes](https://docs.aws.amazon.com/codepipeline/latest/userguide/execution-modes.html); [CodeBuild StartBuild overrides](https://docs.aws.amazon.com/codebuild/latest/APIReference/API_StartBuild.html)
- GitHub: [types of webhooks](https://docs.github.com/en/webhooks/types-of-webhooks); [push event payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- Document metadata: [metadata files for knowledge base documents](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-metadata.html)