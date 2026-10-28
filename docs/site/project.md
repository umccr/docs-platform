# Project

What docs.umccr.org is for, who uses it, where it stands and what is still open: the place to start for anyone
joining the platform team, a person or a coding agent. [Tech stack](tech.md) covers what it is built with and the
conventions for changing it, and [Design](design.md) how it fits together and the decisions behind it.

## What docs.umccr.org is

docs.umccr.org is authenticated documentation for UMCCR staff. Each site is written and reviewed in its own
repository, and published at `https://docs.umccr.org/<slug>/` when it changes. Everything in between belongs to this
repository, `umccr/docs-platform`: the build toolkit and theme, sign-in, hosting, the site registry and both
pipelines. `/` redirects to `/platform/`, this site, whose front page is the [catalogue](index.md) of every site.

Readers sign in with their UMCCR Google Workspace account, as in the UMCCR portal apps, and every request is checked
before anything is served. A chat panel on every page answers questions from the published documentation, with links
to its sources, through [OrcaSonar](https://github.com/umccr/orcasonar), a separate service.

## Who uses it

| Who | How |
| --- | --- |
| Readers | UMCCR staff, signed in through the `data-portal-<stage>` Cognito pool. Every signed-in reader can read every site and ask the chat panel; see [Reading](reading.md). |
| Site owners | Teams that publish a site from their own repository: a `mkdocs.yml` and their Markdown, with no workflow, environment or secret. See [Onboarding a repository](onboarding.md) and [Authoring](authoring.md). |
| The platform team | Owns this repository and the site registry, deploys the platform, releases the toolkit and theme, and hears about failed releases in the alerts Slack channel. See [Deploying](deploy.md) and the [Runbook](runbook.md). |
| OrcaSonar | Indexes the documents each publish exports into its ingest bucket, and answers the chat panel. It is deployed from its own repository. |

## Where it fits

| Repository | Owns |
| --- | --- |
| `umccr/docs-platform` (this one) | hosting, sign-in, the site registry, the dispatcher and both pipelines; the toolkit, theme and conventions; the `/platform/` site |
| `umccr/infrastructure` | the `docs-app` Cognito client and the docs certificate (Terraform) |
| `umccr/orcasonar` | the chat API, its knowledge base and the bucket documents are exported to |
| participating repositories | their Markdown and `mkdocs.yml` |

[ADR-0008](../design/adr/0008-infrastructure-in-docs-platform.md) records why the infrastructure lives here rather than
with UMCCR's other Terraform and CDK.

## Principles

Every change keeps to these. [Design](design.md) has the reasons.

1. **Documentation stays where it is written.** A site's Markdown lives and is reviewed in its own repository, and
   reaches the platform only as the commit that was pushed. Nothing private is copied into this repository.
2. **Nothing is served without sign-in.** CloudFront checks the session before it serves a page; only the sign-in
   page and a few public files are open. Every signed-in UMCCR reader can read every site, and the chat can quote it.
3. **Sites cannot run code.** Every site shares one browser origin, where the sign-in keeps its tokens. The theme and
   its one script are the platform's, and the contract rejects scripts, event handlers, frames and `javascript:` links
   in Markdown, configuration and files alike.
4. **Building never holds publishing rights.** The build step can write nothing but its artifacts. Each publish runs
   as `docs-publisher`, narrowed to the release's own site.
5. **The live site only moves forward.** A release that fails leaves the site as it was, and an older release never
   replaces a newer one.
6. **A merge here changes no other site.** Every site but `/platform/` builds with a toolkit release tag that the
   registry pins, and moves to a new one deliberately.
7. **One pipeline for every site.** Adding a site adds a registry entry, never a pipeline, role or secret.
8. **This repository is public.** It holds generic platform code and documentation only: no account IDs, ARNs, bucket
   names, credentials or private content ([SECURITY.md](../../SECURITY.md)).

## Stages

| Stage | Account | Hostnames | Deployed |
| --- | --- | --- | --- |
| beta | dev | `docs.dev.umccr.org` | by pipeline 1's Beta stage; every site release publishes here first |
| prod | prod | `docs.umccr.org`, `docs.prod.umccr.org` | by pipeline 1's Prod stage, after the `PromoteToProd` approval; site releases follow dev with no approval |

Both pipelines run in the toolchain account: `UMCCR-DocsInfrastructure` deploys the hosting stack, and
`UMCCR-DocsSitesPipeline` publishes the sites. The stg account has run no docs stage since 2026-10-21.
[Design](design.md#hostnames) has how the hosts are wired.

## Where it stands, on 2026-10-28

| Date | Milestone |
| --- | --- |
| 2026-10-13 | The beta hosting stack and the toolchain stack deployed by hand from the branch, and the organisation webhook created. |
| 2026-10-15 | The chat panel answers in dev, through OrcaSonar. |
| 2026-10-20 | `main` protected by a ruleset; the site pipeline runs one release at a time. |
| 2026-10-21 | Merged to `main` and tagged `v0.1.0`; the stg stage removed; prod's hosting stack deployed once its `umccr.org` records and certificate were in place; `/platform/` and the knowledgebase published to dev and prod through the site pipeline. `v0.1.1` put the theme's script back in the toolkit's package. |
| 2026-10-27 | `v0.1.2`: a wikilink to a missing note warns instead of stopping a site from publishing. |
| 2026-10-28 | The repository's new layout, and `/platform/` publishes the platform's own pages. `v0.2.0`: a new look for every site, from the classification banner and the catalogue to the chat panel docked beside the page. |

Today `UMCCR-DocsHostingStack` runs in dev and prod, deployed by pipeline 1, and both sites publish to both through
the site pipeline; the knowledgebase builds with `v0.2.0`. The chat panel answers in dev, where OrcaSonar runs.
OrcaSonar's own prod deploy is tracked in its repository.

## Open items

| Open item | Where it is decided |
| --- | --- |
| The build engine: Material for MkDocs on MkDocs 1.6, or Zensical, after a side-by-side comparison in beta. | [ADR-0003](../design/adr/0003-build-engine.md) |
| Prod's canonical host: `DOCS_CANONICAL_HOST` set to `docs.umccr.org`, so the other prod host redirects to it. | `infrastructure/config.ts`; [Deploying](deploy.md#step-8-prod), step 3 |
| Whether sites ask the dispatcher through GitHub OIDC instead of the public function URL; proposed and deferred on 2026-10-15. | [ADR-0009](../design/adr/0009-dispatch-from-github-actions.md) |
| The `ci` checks required on `main`, and the `v*` tags protected. | [Repository settings](runbook.md#repository-settings) |
| The owners' team named in `.github/CODEOWNERS`, and their review required on `main`. | `.github/CODEOWNERS` |
| `umccr/infrastructure`'s docs branch merged; it is already applied to dev and prod. | `umccr/infrastructure` |
| A private security review, an accessibility check and an operational readiness review, and a check that a personal Google account cannot sign in to prod. | the [implementation plan](../plans/implementation-plan.md#production) |
| Secret scanning, push protection and Dependabot for this repository. | the repository's settings |
| `v1.0.0`, once the engine is decided, the first users' feedback is in, and a team outside the platform team depends on the contract. | [Versioning](runbook.md#versioning) |

The [implementation plan](../plans/implementation-plan.md#6-rollout) tracks the rollout item by item.

## Vocabulary

| Term | Meaning |
| --- | --- |
| site, slug | one documentation site, served at `/<slug>/`. The slug is also its prefix in the docs bucket and in OrcaSonar's ingest bucket, and never changes once published |
| registry | `DOCS_SITES` in `infrastructure/sites.ts`: each site's repository, branch, `mkdocs.yml`, docs paths, toolkit ref and stages. The dispatcher's routes, the edge function's slug table and the catalogue all come from it |
| docs paths | the globs whose changes publish a site; a push that changes none of them starts nothing |
| toolkit, theme | `umccr-docs`, the Python package in `toolkit/` that checks, builds, verifies, exports and publishes a site, and the theme it ships |
| toolkit ref | the docs-platform release tag or commit a site builds with; `self` for `/platform/`, which builds with its own commit |
| contract | what a site's `mkdocs.yml` and Markdown may contain; see [Authoring](authoring.md) |
| release | one build and publish of one site, numbered per site; an older release never replaces a newer one |
| dispatcher | the Lambda the organisation webhook sends every push to; it starts a release for a push that changes a registered site |
| fetch build | the CodeBuild project that clones a release's commit and starts the site pipeline with it |
| pipeline 1 | `UMCCR-DocsInfrastructure`: deploys the hosting stack to beta and prod, and updates the toolchain stack |
| site pipeline | `UMCCR-DocsSitesPipeline`, pipeline 2: builds each release, then publishes it to dev and prod |
| `docs-publisher` | the role in each stage account that the publish steps assume, narrowed to one site per run |
| session cookie | `__Host-docs_session`: set by the session Lambda after sign-in, and checked by the edge function on every request, for 8 hours |
| documents | each published page as plain Markdown with metadata, exported to OrcaSonar for the chat |
| beta, prod | the stages; beta runs in the dev account |
| toolchain account | the bastion account, where both pipelines, the dispatcher and the fetch build run |

## Where to read more

| Page | For |
| --- | --- |
| [Tech stack](tech.md) | what the platform is built with, the repository's layout and commands, and the conventions for changing it |
| [Design](design.md) | how publishing, sign-in and the chat fit together, the decisions and the risks |
| [Deploying](deploy.md) | every deploy step, the verification checklist and troubleshooting |
| [Runbook](runbook.md) | releases, keys, readers, registering and removing sites, and releasing the toolkit |
| [Changelog](changelog.md) | what changed in each release |
| [Publishing contract](publishing.md) | what the platform guarantees site owners |
| [README](../../README.md) | the repository on GitHub |
| [Design records](../design/adr/README.md) | each decision, with its reasons |
| [Issues](../issues/README.md) | write-ups of problems found, and how they were resolved |
