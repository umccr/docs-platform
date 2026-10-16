# Changelog

All notable changes to the docs platform: the infrastructure, the `umccr-docs` toolkit and the theme. Sites pick
toolkit and theme changes up when their registry entry's `toolkitRef` moves to a release; see
[docs/operating/releasing.md](docs/operating/releasing.md).

## Unreleased

- Theme: the chat panel renders answers as Markdown: paragraphs, lists, emphasis, code, tables, quotes and links. It
  builds every element itself from a parsed tree, so nothing in an answer is ever read as HTML, and links keep to
  http(s), mailto and paths on the docs site. Citation markers such as `[2]` link to the cited page, and sources are
  numbered to match them, from OrcaSonar's `ref`; snippets arrive from OrcaSonar as plain text.
- Theme: the chat panel shows an answer at a steady pace as it arrives, with "Searching the documentation…" until the
  first words. OrcaSonar's guardrail releases an answer about 1,000 characters at a time, so it used to appear all at
  once. The panel follows the answer down only while the reader is at the end of the conversation, shows sources and
  feedback once the answer is complete, and respects reduced motion.
- The fetch build stores symlinks as links (`zip -y`) and stops on one that leads out of the checkout or into its
  `.git`. `zip` used to package the file a link pointed at, so `docs/x -> /etc/hosts` or `-> ../.git/config`
  reached the site pipeline as an ordinary file, and a link loop multiplied the archive.
- The fetch build writes its start request with Python in isolated mode (`python3 -I`). It ran in the site's
  checkout, where a `json.py` would have run with the fetch role, which can start the shared pipeline for any site.
- Contract: pages are checked as rendered, after preprocessing, so attribute lists (`![x](x.png){ onerror=... }`),
  entities (`javascript&#58;`), reference links, forms and front matter values that would run code are rejected.
  The checks also cover `mkdocs.yml` values, which the theme prints unescaped, and the HTML, SVG and XML files a
  site ships. `<base>` elements, files under `assets/javascripts/` or `assets/umccr/` (which replaced the theme's
  scripts) and `extra.polyfills`, `extra.analytics` and `extra.consent` are rejected. `verify-site` checks every
  built page and document for event handlers, `javascript:` URLs and frames. Theme: the classification banner and
  the footer escape the values they print.
- `umccr-docs export-kb` exports only the pages the site publishes: none matched by `exclude_docs` or `draft_docs`,
  and no `README.md` beside an `index.md`. Unpublished pages used to reach OrcaSonar, and its answers.
- Obsidian links are percent-encoded (`[[Alpha Beta]]` -> `Alpha%20Beta.md`), so exported documents point at the
  published page, and links leaving `docs_dir` for a file with a space in its name stay one link.
- The dispatcher reads the webhook secret again at least every five minutes, and at once (at most once a minute)
  when a signature does not match. It used to keep the first value for the life of an execution environment, so
  after a rotation warm environments refused valid deliveries for as long as pushes kept them warm.
- Docs: rolling back a site or the toolkit starts a new release with a higher release number (runbook "Start a
  release by hand"); re-running the old release is skipped while a newer one is live, and keeps its `TOOLKIT_REF`.

- The fetch build's role may read the GitHub connection (`codeconnections:GetConnection`), which CodeBuild checks
  before a build that clones through it can start. Without it, every dispatch failed with `OAuthProviderException`.
- `UMCCR-DocsSitesPipeline`'s source action has its own role, which may read every object under `sources/`. CDK's role
  could read only the placeholder key, so every release failed at Source with "Forbidden".
- The site pipeline is `UMCCR-DocsSitesPipeline`, named like the organisation's other pipelines, and its Slack
  failure rule is `UMCCR-DocsSitesPipeline-Failures`. Deploying the rename replaces the pipeline, and the old
  `DocsSitesPipeline` and its run history go.
- A release whose `toolkitRef` has no toolkit, such as `main` before this repository is merged, stops at Build with
  that reason, instead of pip's missing-file error.
- Theme: the chat panel stops reading an answer at its `error` or `done` event, so nothing is appended after an
  error message.
- Pipelines: `infrastructure/toolchain/deployment-pipeline.ts`, adapted from the OrcaBus `DeploymentStackPipeline`,
  replaces it, so nothing is named for OrcaBus: pipeline 1 is `UMCCR-DocsInfrastructure`, with stages `Beta`,
  `Gamma` and `Prod` and its own artifact bucket and key; the hosting stack is `UMCCR-DocsHostingStack` in every
  stage account, tagged `umccr-org:Product: Docs`.
- Layout: the `/platform/` site, with its `mkdocs.yml`, moved to `app/site/`. `docs/` now holds the platform team's
  design pages and records, plans, issues, runbooks and the deploy guide (`docs/deploy.md`, replacing
  `deploy-dev.md`), and is not published: the design records, runbooks and "Releasing the platform" left the site.
- The infrastructure moved here from `umccr/frontend-infrastructure-pipelines` `lib/docs/`
  ([ADR-0008](docs/design/adr/0008-infrastructure-in-docs-platform.md)): the CDK app in `bin/` and `infrastructure/`, the
  code it deploys in `app/`. Stack names and hosting templates are unchanged.
- Dispatched publishing ([ADR-0006](docs/design/adr/0006-dispatched-publishing.md)): an organisation webhook, a dispatcher
  Lambda, a fetch build and one shared site pipeline, `UMCCR-DocsSitesPipeline`, publishing to dev then prod. One
  `docs-publisher` role per stage replaces the per-site GitHub OIDC roles. The registry gains `branch`,
  `configPath`, `docsPaths`, `toolkitRef` and `stages`.
- Removed the reusable workflow (`.github/workflows/docs.yml`), `site.yml` and the caller-workflow template: site
  repositories need no workflow.
- `umccr-docs export-kb`: pages as plain Markdown with metadata, for OrcaSonar.
- `umccr-docs publish`: `--role-arn` (assume `docs-publisher` narrowed to the site, bucket names from SSM),
  `--release` (newer release wins) and `--documents` (mirror the export into OrcaSonar's ingest bucket).
- Theme: chat panel ([ADR-0007](docs/design/adr/0007-chat-through-orcasonar.md)), calling OrcaSonar with the reader's
  Cognito ID token through `/_auth/token.js`. The content pages' Content Security Policy allows OrcaSonar and the
  Cognito API.

### Earlier on this branch

- Reusable workflow `.github/workflows/docs.yml`: contract check, strict build, pre-publish checks, and OIDC
  publishing from the caller's GitHub environment.
- `umccr-docs` toolkit: `check`, `preprocess`, `build`, `serve`, `verify-site`, `publish`.
- Obsidian support: wikilinks with `prefer_folders`, Bases table views, callouts, comments, properties table.
- Theme: UMCCR colours, account menu with sign-out, catalogue, classification banner, provenance footer.
- Engine: Material for MkDocs 9.7.7 on MkDocs 1.6.1, hash-pinned; Zensical available for evaluation.
