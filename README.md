# UMCCR Docs Platform

Everything behind [docs.umccr.org](https://docs.umccr.org), authenticated documentation for UMCCR staff: the
infrastructure and its pipelines, sign-in, the `umccr-docs` build toolkit, the shared theme with its chat panel,
the conventions participating repositories follow, and the platform's own `/platform/` site.

> **Status:** 2026-10-15. Hosting, sign-in, the dispatcher and the chat panel run in dev, and both sites are published
> there by hand. Releases through the site pipeline start once this repository is merged to `main`; stg and prod
> follow. See the [implementation plan](docs/plans/implementation-plan.md), and [docs/deploy.md](docs/deploy.md) to
> deploy.

## How it fits together

Each participating repository keeps its own Markdown and nothing else: no workflow, environment or secret. An
organisation-wide GitHub webhook sends every push to a dispatcher, which starts one run of a shared site pipeline
for pushes to a registered site. The pipeline builds the site with this repository's toolkit and publishes it to
dev, then prod. Readers sign in with their UMCCR Google Workspace account, the same way as in the UMCCR portal.
The chat panel on every page asks [OrcaSonar](https://github.com/umccr/orcasonar), a separate service, which
indexes the documents each publish exports.

| Repository | Owns |
| --- | --- |
| `umccr/docs-platform` (this one) | hosting, sign-in, the site registry, the dispatcher and both pipelines; the toolkit, theme and conventions; the `/platform/` site |
| `umccr/infrastructure` | the `docs-app` Cognito client and the docs certificate (Terraform) |
| `umccr/orcasonar` | the chat API, its knowledge base and the bucket documents are exported to |
| participating repositories | their Markdown and `mkdocs.yml` |

See [ADR-0008](docs/design/adr/0008-infrastructure-in-docs-platform.md) for why the infrastructure lives here. The
`/platform/` site that readers and site owners see is built from [app/site/](app/site/); the platform team's
design records, plans, runbooks and deploy guide are in [docs/](docs/), read here and never published.

## Pipelines

| Pipeline | Starts on | Does |
| --- | --- | --- |
| `UMCCR-DocsInfrastructure` | a push to `main` under `bin/`, `infrastructure/` or `app/`, except `app/site/` | deploys `UMCCR-DocsHostingStack` to beta, gamma and, after approval, prod; its self-update deploys the dispatcher and the site pipeline |
| `UMCCR-DocsSitesPipeline` | the dispatcher, once per release of a site; for `/platform/`, a push under `app/site/`, `toolkit/` or `requirements/build.txt` | builds the site, then publishes it to dev and prod with no approval |

## Layout

```text
bin/deploy.ts       CDK app: the DocsInfrastructurePipeline toolchain stack
infrastructure/     stacks and constructs
  sites.ts          the site registry
  config.ts         per-stage settings
  stage/            DocsHostingStack: bucket, CloudFront, edge function, session Lambda, publisher role
  toolchain/        pipeline 1, the dispatcher, the fetch build and pipeline 2 (UMCCR-DocsSitesPipeline)
app/                code those stacks deploy, and the platform site
  auth-web/         the /_auth/ sign-in page (Amplify) and token.js for the chat panel
  session/          the session Lambda
  edge/             the viewer-request CloudFront Function
  dispatcher/       the webhook dispatcher Lambda
  static/           public files: 404 page, robots.txt, favicon
  site/             the /platform/ site, published by the site pipeline: mkdocs.yml, and docs/ with the catalogue,
                    reading, onboarding, authoring and publishing pages
test/               jest tests for all of the above, with cdk-nag
toolkit/            the umccr-docs Python package (CLI, Obsidian adapter, export, publisher) and the theme
requirements/       hash-pinned engine and tool versions
templates/          mkdocs.yml templates for participating repositories
examples/           synthetic sites CI builds on every change (plain Markdown and an Obsidian vault)
docs/               the platform team's documents, read on GitHub and never published
  deploy.md         deploying everything, step by step
  design/           design pages and the design records (adr/)
  plans/            the proposal and the implementation plan
  issues/           write-ups of problems found and how they were resolved
  operating/        how the platform runs, runbooks, onboarding a site, releasing
scripts/            check-boundary.sh, the public-repository information-boundary check
```

## Development

Node.js 22 or later with pnpm through Corepack, Python 3.12, and [pre-commit](https://pre-commit.com). The
Makefile runs everything; the toolkit lives in a virtualenv, `.venv`.

```sh
corepack enable
make install     # pnpm packages, and .venv with the hash-pinned engine, the dev tools and the toolkit
make check       # dependency audit, formatting, lint (CDK app and toolkit), workflows, pre-commit hooks
make test        # jest with cdk-nag, and pytest
make sites       # strict builds of the examples and the /platform/ site, as CI runs them
make serve       # preview the /platform/ site on http://127.0.0.1:8000
make synth       # the CDK app
make fix         # formatting and lint fixes
make audit-fix   # overrides forcing patched dependency versions
```

`make check` runs the pre-commit hooks, including the information-boundary check, on every tracked file. To run a
toolkit command yourself, use `.venv/bin/umccr-docs`, or `source .venv/bin/activate` first.

## Repository visibility

This repository is public. It must hold only generic platform code and documentation: no private documentation,
generated sites, credentials, account identifiers or security findings. AWS account IDs reach the CDK app only
through `@orcabus/platform-cdk-constructs`, never as literals here. See [SECURITY.md](SECURITY.md).
