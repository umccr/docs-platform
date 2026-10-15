# Implementation plan: docs.umccr.org

> **Status:** 2026-10-15. Dev runs `UMCCR-DocsHostingStack`, with both sites published by hand, and OrcaSonar's chat
> answers there. The toolchain stack is deployed from branch `feat/docs-umccr-org`: the organisation webhook, the
> dispatcher and the fetch build work, and releases wait only for this repository's merge, which puts the toolkit on
> `main`. This repository holds all of the infrastructure, moved here from `umccr/frontend-infrastructure-pipelines`
> ([ADR-0008](../design/adr/0008-infrastructure-in-docs-platform.md)). Section 6 lists what remains. Builds on
> [proposal.md](proposal.md).
>
> This repository is public. Keep AWS account IDs, ARNs, bucket names, distribution IDs and any content from
> private repositories out of this file and everything else committed here.

## 1. Summary

`https://docs.umccr.org/<slug>/` serves documentation that stays in its owning repository. An organisation-wide
GitHub webhook sends every push to a dispatcher, which starts one run of a shared site pipeline for pushes to a
registered site; the pipeline builds the site and publishes it to a private S3 prefix in dev, then prod. Readers
sign in the same way as in the UMCCR portal apps: Amplify, the Cognito hosted UI and their UMCCR Google Workspace
account. CloudFront checks the sign-in on every request before serving anything. A chat panel on every page asks
OrcaSonar, a separate service, which indexes the documents each publish exports.

| Repository | Path | Owns |
| --- | --- | --- |
| `umccr/docs-platform` (this one) | `bin/`, `infrastructure/`, `app/` | hosting, sign-in, the site registry, the dispatcher and both pipelines |
| | `toolkit/`, `templates/`, `app/site/` | the `umccr-docs` toolkit and theme, conventions, and the `/platform/` site |
| | `docs/` | the platform team's design records, plans, issues, runbooks and deploy guide (not published) |
| `umccr/infrastructure` | `terraform/stacks/cognito_aai/app_docs.tf` | the public `docs-app` Cognito client |
| | `terraform/stacks/umccr_docs_domain/` | the docs certificate (us-east-1), `/docs/certificate_arn` |
| `umccr/orcasonar` | its own | the chat API, knowledge base and ingest bucket |
| participating repositories, starting with `umccr/management-knowledgebase` | `mkdocs.yml` and their Markdown | their content |

## 2. Decisions

| | Decision | Record |
| --- | --- | --- |
| D1 | Readers: anyone who can sign in to the `data-portal-<stage>` Cognito pool. Its Google identity provider only admits UMCCR Workspace accounts. One site-wide policy. | [ADR-0005](../design/adr/0005-reader-policy.md) |
| D2 | All docs infrastructure lives in this repository, in the OrcaBus service layout; Terraform for the shared Cognito pool and the certificate stays in `umccr/infrastructure`. | [ADR-0008](../design/adr/0008-infrastructure-in-docs-platform.md) |
| D3 | Sign-in works like orcahouse-ui and orca-ui-v2 (Amplify v6, Google, public client). One small Lambda exchanges the ID token for an HttpOnly session cookie that a CloudFront Function checks. | [ADR-0002](../design/adr/0002-sign-in-and-sessions.md) |
| D4 | The session key is a Secrets Manager secret whose value CloudFormation generates; the function receives it at deploy time. CloudFront KeyValueStore is not permitted in UMCCR's AWS accounts. | [ADR-0002](../design/adr/0002-sign-in-and-sessions.md) |
| D5 | Publishing is dispatched: one organisation webhook, one dispatcher, one shared site pipeline. Two docs pipelines in total, however many sites join. | [ADR-0006](../design/adr/0006-dispatched-publishing.md) |
| D6 | No approval before prod for site releases: documentation changes no data and no running system. A failure in dev stops the release. | [ADR-0006](../design/adr/0006-dispatched-publishing.md) |
| D7 | Sites publish to dev and prod; stg carries no site content. | |
| D8 | One `docs-publisher` role per stage, narrowed per run to one site by a session policy. | [ADR-0006](../design/adr/0006-dispatched-publishing.md) |
| D9 | Chat is OrcaSonar's: docs hosts the panel, calls OrcaSonar's API with the reader's Cognito ID token, and exports documents to its ingest bucket. | [ADR-0007](../design/adr/0007-chat-through-orcasonar.md) |
| D10 | The pilot publishes the vault's `PlatformServices/` folder in full, with wikilinks resolved and Bases views rendered as tables. When a note name exists in several folders, links resolve by `prefer_folders`. | |
| D11 | Repository names in the public site registry are acceptable. | |

Open: the build engine. Material for MkDocs 9.7 on MkDocs 1.6 builds everything today; Zensical 0.0.66 also builds
both examples and the pilot vault. See [ADR-0003](../design/adr/0003-build-engine.md).

## 3. Architecture

Request path:

```text
Reader ──HTTPS──▶ CloudFront (docs distribution)
                    ├─ viewer-request CloudFront Function, on every request, before the cache:
                    │    host and reserved-path checks; the session cookie (no session: 302 /_auth/, or 401);
                    │    clean URLs: /<slug>/a/b/ ──▶ /sites/<slug>/a/b/index.html
                    ├─ /_auth/session  ──▶ session Lambda (function URL + origin access control)
                    └─ everything else ──▶ S3 content bucket (origin access control)
```

Publishing:

```text
push ─▶ organisation webhook ─▶ dispatcher Lambda (toolchain) ─▶ fetch build ─▶ sources/<slug>/<commit>.zip
     ─▶ UMCCR-DocsSitesPipeline: Source ─▶ Build (read-only: check, build, verify-site, export-kb)
                                 ─▶ Publish dev ─▶ Publish prod   (as docs-publisher, narrowed to the site)
                                       sites/<slug>/ in the docs bucket, docs/<slug>/ in OrcaSonar's ingest bucket
```

Chat: the theme's panel loads `/_auth/env.js` and `/_auth/token.js` when opened, and calls
`https://sonar.<stage>.umccr.org/api/v1` (`/chat` streamed, `/search`, `/feedback`) with the reader's ID token.

Details: [docs/operating/](../operating/README.md) for the platform team, the
[publishing contract](../../app/site/docs/publishing.md) for site owners.

## 4. Pipelines

| Pipeline | Source | Starts on | Deploys or publishes |
| --- | --- | --- | --- |
| `UMCCR-DocsInfrastructure` (toolchain stack `DocsInfrastructurePipeline`) | this repository | a push to `main` under `bin/`, `infrastructure/`, `app/` (not `app/site/`) | `DocsHostingStack` to beta, gamma and, after approval, prod; its self-update deploys the dispatcher, the fetch build and `UMCCR-DocsSitesPipeline` |
| `UMCCR-DocsSitesPipeline` | any registered repository, through the dispatcher | a push under a site's docs paths | the site to dev, then prod; documents to OrcaSonar |

## 5. Work by repository

### 5.1 umccr/docs-platform (branch `feat/docs-umccr-org`)

- [x] The CDK app moved from `frontend-infrastructure-pipelines/lib/docs/`; the beta, gamma and prod hosting
      templates synthesize identically to the deployed code.
- [x] Registry: `branch`, `configPath`, `docsPaths`, `toolkitRef`, `stages`; `dispatchRegistry()`.
- [x] Hosting: one `docs-publisher` role trusted by the toolchain's `docs-sites-publish`; SSM
      `/docs/content-bucket-name`; CSP for OrcaSonar and Cognito; `VITE_SONAR_API_URL` in `env.js`; `token.js`.
- [x] Toolchain: dispatcher (function URL, webhook secret, dispatch table), fetch build, source bucket,
      `UMCCR-DocsSitesPipeline` (V2, parallel, no approval, Slack on failure).
- [x] Toolkit: `export-kb`; `publish --role-arn --release --documents`.
- [x] Theme: chat panel (Ask, Search, sources, feedback, the 30-day notice).
- [x] Retired the reusable workflow, `site.yml` and the caller template; CI gains the CDK job.
- [x] Docs and ADRs 0006–0008.
- [x] Pipelines: this repository's own `DeploymentPipeline` construct replaces the OrcaBus `DeploymentStackPipeline`:
      pipeline `UMCCR-DocsInfrastructure`, stages `Beta`, `Gamma` and `Prod`, stack `UMCCR-DocsHostingStack`, its own
      artifact bucket and key. The same construct deploys OrcaSonar.
- [x] Layout: the `/platform/` site and its `mkdocs.yml` moved to `app/site/`; `docs/` holds the team's design
      records, plans, issues, runbooks and the deploy guide, none of them published.

### 5.2 umccr/management-knowledgebase (branch `feat/docs-umccr-org`)

- [x] `mkdocs.yml`; the caller workflow removed; README describes dispatched publishing.

### 5.3 umccr/infrastructure (branch `feat/docs-umccr-org`)

- [x] `cognito_aai/app_docs.tf` and `umccr_docs_domain/`, unchanged by this design.

### 5.4 umccr/frontend-infrastructure-pipelines

- [x] Docs changes removed; it serves the portal only.

## 6. Rollout

### Before deploying anything

- [ ] Review and merge `umccr/infrastructure`, then this repository, then `management-knowledgebase`.
- [ ] Find how `portal.umccr.org` is wired in the `umccr.org` zone and mirror it for `docs.umccr.org`.
- [ ] Turn on secret scanning, push protection and Dependabot here, and name the owners in `CODEOWNERS`.

### Dev

Step-by-step commands, checks and troubleshooting: [docs/deploy.md](../deploy.md).

- [x] Apply `cognito_aai` and `umccr_docs_domain` to `dev`; deploy the beta hosting stack.
- [x] Read-only pre-flight in the toolchain and dev accounts (2026-10-12): every prerequisite exists, no name is
      taken, and `cdk diff --method template` is clean for the beta hosting stack and all three toolchain stacks.
- [x] Redeploy the beta hosting stack from this repository, as `UMCCR-DocsHostingStack` (2026-10-13); `cdk diff` is
      clean against the branch.
- [x] Deploy `DocsInfrastructurePipeline` to the toolchain account, and create the organisation webhook
      (2026-10-13). Fixed while testing, 2026-10-14 and 15: the fetch build may read the GitHub connection, the site
      pipeline's source action may read every release's object, and the site pipeline is `UMCCR-DocsSitesPipeline`.
- [ ] Push to `/platform/` and to the knowledgebase; both publish to dev through the pipeline. Dispatch and fetch
      work (2026-10-15); releases fail at Build until this repository's merge puts the toolkit on `main`, and the
      knowledgebase's until two broken links in its notes are fixed (its strict build names both).
- [x] Once OrcaSonar's stacks are in dev: documents appear under `docs/<slug>/` (`/platform/`'s, published by
      hand), and the chat panel answers (2026-10-15).
- [ ] Engine bake-off, second pass: compare both engines side by side in beta, then settle ADR-0003.

### Production

- [ ] Apply `cognito_aai` and `umccr_docs_domain` to `stg` and `prod`, add the `umccr.org` records the prod output
      lists, and wait for the certificate.
- [ ] Approve the infrastructure pipeline's prod stage.
- [ ] OrcaSonar in stg and prod, from its repository: in each account, Anthropic's model agreements (manual), the
      data-retention decision, and the docs Cognito client; then its pipelines' PromoteToProd.
- [ ] Release docs-platform `v1.0.0` and pin `DOCS_TOOLKIT_REF` to it.
- [ ] Set the prod canonical host to `docs.umccr.org` in `infrastructure/config.ts`.
- [ ] Private security review, accessibility check and operational readiness review.
- [ ] Decide whether to replace the dispatcher's function URL with dispatch from GitHub Actions before prod
      ([ADR-0009](../design/adr/0009-dispatch-from-github-actions.md), proposed and deferred 2026-10-15; the
      [plan](publishing-from-github.md) and the [issue](../issues/2026-10-14-dispatcher-function-url.md)).

### Order of dependencies

| Step | Needs |
| --- | --- |
| Hosting stack in a stage | `app_docs.tf` and `umccr_docs_domain` applied to that workspace |
| A release of any site | the toolchain stack deployed, the webhook created, the repository visible to the AWS Connector app |
| A release reaching a stage | that stage's hosting stack (its `docs-publisher` role and `/docs/content-bucket-name`) |
| Documents reaching OrcaSonar | OrcaSonar's stateful stack in the stage (`/orcasonar/ingest-bucket-name`) |
| Chat answering in a stage | OrcaSonar's stateless stack in the stage, and a theme release pinned by the site |
| Canonical-host redirect in prod | the `docs.umccr.org` record |

## 7. Operations

- **Runbooks:** [docs/operating/runbooks.md](../operating/runbooks.md): the webhook, failed and re-run releases,
  key rotation, revocation, takedown, rollback, permanent removal, sign-in failures.
- **Logs:** CloudFront standard logs and session Lambda logs, 90 days; dispatcher logs, 90 days. No cookies, tokens
  or keys are logged; the Lambdas log the Cognito `sub` or the site, not emails or content.
- **Alarms:** session Lambda errors and throttles, sign-ins refused as unavailable, and failed site pipeline runs
  (Slack).
- **Cost:** CloudFront requests and transfer, one function run per request, the session Lambda at sign-in, a few
  CodeBuild minutes and CodePipeline action minutes per release, and one secret per stage plus the webhook secret.

## 8. Risks

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
