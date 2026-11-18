# UMCCR Docs Platform

Everything behind [docs.umccr.org](https://docs.umccr.org), authenticated documentation for UMCCR staff: the
infrastructure and its pipelines, sign-in, the site registry, the conventions participating repositories follow,
and the platform's own `/platform/` site. The `umccr-docs` build toolkit and the theme every site shares, with its
chat panel, are in [umccr/docs-toolkit](https://github.com/umccr/docs-toolkit).

> **Status:** 2026-11-18. Hosting, sign-in and the dispatcher run in dev and prod, which pipeline 1 deploys, and
> `/platform/`, the knowledgebase and `/orcasonar/` publish to both through the site pipeline. Every site builds with
> the latest release of umccr/docs-toolkit, where the toolkit moved from this repository
> ([ADR-0010](docs/design/adr/0010-toolkit-repository.md), [ADR-0011](docs/design/adr/0011-latest-toolkit-release.md)).
> The chat panel answers in dev, where OrcaSonar runs. [Project](docs/site/project.md) has where the platform stands and
> what is still open, and [Deploying](docs/site/deploy.md) how to deploy it.

## How it fits together

Each participating repository keeps its own Markdown and nothing else: no workflow, environment or secret. An
organisation-wide GitHub webhook sends every push to a dispatcher, which starts one run of a shared site pipeline
for pushes to a registered site. The pipeline builds the site with the release of the toolkit the registry pins and
publishes it to dev, then prod. Readers sign in with their UMCCR Google Workspace account, the same way as in the
UMCCR portal. The chat panel on every page asks [OrcaSonar](https://github.com/umccr/orcasonar), a separate service,
which indexes the documents each publish exports.

| Repository | Owns |
| --- | --- |
| `umccr/docs-platform` (this one) | hosting, sign-in, the site registry, the dispatcher and both pipelines; the conventions; the `/platform/` site |
| `umccr/docs-toolkit` | the `umccr-docs` toolkit and the theme, released as git tags that the registry pins |
| `umccr/infrastructure` | the `docs-app` Cognito client and the docs certificate (Terraform) |
| `umccr/orcasonar` | the chat API, its knowledge base and the bucket documents are exported to |
| participating repositories | their Markdown and `mkdocs.yml` |

See [ADR-0008](docs/design/adr/0008-infrastructure-in-docs-platform.md) for why the infrastructure lives here. The
`/platform/` site is built from [docs/site/](docs/site/index.md) with the root `mkdocs.yml`: the catalogue, the pages
for readers and site owners, and the platform's own project pages: the [project](docs/site/project.md), the
[tech stack](docs/site/tech.md), the [design](docs/site/design.md), [deploying](docs/site/deploy.md), the
[runbook](docs/site/runbook.md) and the [changelog](docs/site/changelog.md). The design records, plans and issue
write-ups elsewhere in [docs/](docs/README.md) are read here and never published.

## Pipelines

| Pipeline | Starts on | Does |
| --- | --- | --- |
| `UMCCR-DocsInfrastructure` | a push to `main` that changes the CDK app: `bin/`, `infrastructure/`, `app/`, `cdk.json`, `package.json`, `pnpm-lock.yaml` or `tsconfig.json`, except Markdown | deploys `UMCCR-DocsHostingStack` to beta and, after approval, prod; its self-update deploys the dispatcher and the site pipeline |
| `UMCCR-DocsSitesPipeline` | the dispatcher, once per release of a site; for `/platform/`, a push that changes `mkdocs.yml` or `docs/site/` | builds the site with its `toolkitRef`, then publishes it to dev and prod with no approval, one release at a time |

## Layout

```text
bin/deploy.ts       CDK app: the DocsInfrastructurePipeline toolchain stack
infrastructure/     stacks and constructs
  sites.ts          the site registry
  config.ts         per-stage settings
  stage/            DocsHostingStack: bucket, CloudFront, edge function, session Lambda, publisher role
  toolchain/        pipeline 1, the dispatcher, the fetch build and pipeline 2 (UMCCR-DocsSitesPipeline)
app/                code those stacks deploy
  auth-web/         the /_auth/ sign-in page (Amplify) and token.js for the chat panel
  session/          the session Lambda
  edge/             the viewer-request CloudFront Function
  dispatcher/       the webhook dispatcher Lambda
  static/           public files: 404 page, robots.txt, favicon
test/               jest tests for all of the above, with cdk-nag
docs/
  site/             the /platform/ site, published by the site pipeline: the catalogue, the pages for readers and
                    site owners, and the platform's project pages (project, tech, design, deploy, runbook, changelog)
  design/           design pages and the design records (adr/), read on GitHub
  plans/            the proposal and the implementation plan
  issues/           write-ups of problems found and how they were resolved
mkdocs.yml          the /platform/ site's configuration
```

## Development

Node.js 22 or later with pnpm through Corepack, and [pre-commit](https://pre-commit.com). The Makefile runs the CDK
app through pnpm, and the checks through pre-commit.

```sh
corepack enable
make install     # pnpm packages; the git hook
make check       # dependency audit, then the pre-commit hooks: secrets, workflows, lint and formatting
make test        # jest with cdk-nag
make synth       # the CDK app
make fix         # formatting and lint fixes
make audit-fix   # overrides forcing patched dependency versions
```

`make install` installs the pre-commit hooks as a git hook: each commit runs them on the files it changes, and
`make check` runs them on every tracked file, as CI does.

The `/platform/` site builds with the toolkit's latest release from
[umccr/docs-toolkit](https://github.com/umccr/docs-toolkit) (`DOCS_TOOLKIT_REF` in `infrastructure/sites.ts` is
`latest`), and CI builds it strictly with that release on every pull request. To preview it, install the toolkit as any
site owner does ([Onboarding](docs/site/onboarding.md#2-add-the-configuration)) and run `umccr-docs serve` here. A
docs-toolkit checkout with `make install` done there previews it with that checkout's toolkit:
`../docs-toolkit/.venv/bin/umccr-docs serve`.

## Repository visibility

This repository is public. It must hold no credentials, private documentation, generated sites or security findings.
AWS account IDs, ARNs and resource names are not secrets and may appear where they are needed, though the CDK app
takes account IDs from `@orcabus/platform-cdk-constructs`. See [SECURITY.md](SECURITY.md).
