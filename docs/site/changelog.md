# Changelog

All notable changes to the docs platform: the infrastructure, the `umccr-docs` toolkit and the theme. Sites pick
toolkit and theme changes up when their registry entry's `toolkitRef` moves to a release; see
[releasing the toolkit and theme](runbook.md#release-the-toolkit-and-theme).

## Unreleased

A new look for every site's pages, and diagrams: a minor release. A site that sets `extra.classification` can remove
it, as nothing shows it any more; no other site needs a change.

- Under each page's title, a GitHub icon opens the page's file in its repository, in place of the "Edit this page"
  link to GitHub's editor. A site's `edit_uri` (`edit/main/docs/`) stays as it is: the build points it at GitHub's
  file view. A front page published from a home note (`extra.platform.home`), such as the knowledgebase's `Home.md`,
  links to the note; it used to link to `index.md`, the name the page is built under, which is not in the repository.
- No classification banner. Every page used to open with "Internal: UMCCR staff only", but only signed-in UMCCR staff
  reach a page, so it told them nothing. `extra.classification` is ignored
  ([ADR-0005](../design/adr/0005-reader-policy.md), amended).
- "On this page" marks the section a reader's link went to. It used to mark the section before: the theme starts the
  page right under the header, and Material decides where the reader is from a gap above the page that the theme
  had taken away. Nothing on the page moves.
- Mermaid diagrams. A ```` ```mermaid ```` block is drawn as a diagram, by Material with the theme's own copy of
  Mermaid `11.17.2`: the pages' Content Security Policy blocks the copy Material would load from unpkg.com, and pages
  without a diagram never load it. Mermaid runs in its strict security mode, and the theme shows no diagram whose
  drawing holds script, an event handler or a script URL. A diagram fits the page, and a click on one that had to
  shrink shows it at full size. One that does not parse shows as its text. On `/orcasonar/`, the Design page's seven
  diagrams. The documents exported to OrcaSonar keep the block's text.

## v0.2.1

Links for bare URLs on every site, and a vault's Tasks queries as lists. The tag is on the merge of that change
(`99b6aad`), so the package there still reads `0.2.0`; the release that moves the registry to `v0.2.1` brings the
version up to match. The registry moves every site but `/platform/` to it.

The tag was pushed before the registry moved. A release of `/management-knowledgebase/` started by hand with
`v0.2.1` (release 42) published the lists, and the site's next push (release 43, 2026-10-29) built with the
registry's `v0.2.0` again and replaced it. A hand-started release with another toolkit lasts until the next push;
the [runbook](runbook.md#start-a-release-by-hand) now says so.

- Bare URLs and email addresses in Markdown are links, as GitHub and Obsidian show them. A vault note's
  `- GitHub: https://github.com/...` line used to publish as plain text.
- A vault's ```` ```tasks ```` blocks, queries for the Obsidian Tasks plugin, become lists of the matching tasks when
  the site is built: in the plugin's order and groups, each task with its dates and a link to the note and heading it
  is under. On `/management-knowledgebase/`, that is the front page's open, unassigned and stale actions and each
  person's own. A query outside the supported subset ([authoring](authoring.md#obsidian-vaults)) fails the build with
  its note and line, as an unsupported Bases block does. The documents exported to OrcaSonar carry the lists too.
- The theme styles the lists: group labels sized as headings that stay out of "On this page", and each task's dates
  and link quieter than the task.

## v0.2.0

A new look for every site, and the repository's new layout: tag the commit that merges it to `main`. The registry
moves every site but `/platform/` to it. It is a minor release because every site changes: the theme, the banner on
by default, and a vault note's properties, which change markup in the documents exported to OrcaSonar too.

The repository's layout, and the platform's own pages on `/platform/`, which has built this way since the layout
merged. That merge failed its own `/platform/` release at Build: until pipeline 1's self-update deployed the new
registry, the dispatcher still built the site from `app/site/mkdocs.yml`, and the live site stayed as it was. The
release was then [started by hand](runbook.md#start-a-release-by-hand) with `CONFIG_PATH` `mkdocs.yml`.

- Layout: the `/platform/` site moved from `app/site/` to `docs/site/`, with its `mkdocs.yml` at the repository root,
  and `examples/`, `templates/` and `requirements/` moved into `toolkit/`. Participating repositories copy their
  `mkdocs.yml` from `toolkit/templates/`.
- The site pipeline installs the engine's pins from `toolkit/requirements/build.txt`, or from `requirements/build.txt`
  at refs up to `v0.1.2`, so sites and rollbacks pinned to those still build.
- `/platform/` publishes the platform's own pages: the project, the tech stack and conventions, the design,
  deploying, the runbook and this changelog. They replace `docs/deploy.md`, `docs/operating/` and the `CHANGELOG.md`
  at the repository root, so the chat panel can answer from them too. The design records, plans and issue
  write-ups stay in `docs/`, read on GitHub.
- `/platform/` publishes on a push that changes `mkdocs.yml`, `docs/site/`, the toolkit's package or the engine's
  pins, and no longer on the toolkit's examples or templates. Its strict build also fails on a link to a heading that
  does not exist.
- Pipeline 1 no longer excludes `app/site/**` from its trigger: nothing under `app/` is published by the site pipeline
  any more.

A new look for the theme, which `/platform/` has shown since the layout merged.

- Header: the UMCCR Docs name, the site's name, search, the colour scheme, the repository and the account menu. The
  classification banner is on every site, "Internal: UMCCR staff only" unless `extra.classification` words it
  differently.
- Pages: breadcrumbs from all documentation to the page's section, a larger lead paragraph, a line with the page's
  `updated` date and an edit link, and the previous and next pages at the end. Callouts read "Note: …"; code blocks
  are dark, with a header naming the language and a Copy button; tables, task lists, the navigation and "On this
  page" are restyled. In the dark scheme, links had almost no contrast; now they do.
- Vault notes show their properties as a card: status and health as coloured pills, linked values as chips, dates
  as `28 Sep 2026`. A note's `status` no longer shows as an icon in the navigation.
- Chat panel: docked on the right below the header, with Ask and Search, This site only, a new conversation, and
  sources as cards naming their site. Answers can be rated and copied. ⌘K or Ctrl+K opens it, and the search box
  offers to ask the docs, or to search every site, from its results.
- The catalogue: a question box with suggested questions, the sites as cards, the guides and who can read.
- The basic example has a Components page with every element the theme styles.

## v0.1.2

Stops a wikilink to a missing note from blocking a site: tag the commit that merges it to `main`. The registry moves
every site but `/platform/` to it.

- A wikilink to a note that is not in the vault, in a note or in its frontmatter, is published as its plain
  `[[note]]` text, as Obsidian shows an unresolved link, and `umccr-docs build` prints a warning with the note and
  line. It used to fail the build, so one such link in `/management-knowledgebase/`
  (`[[hartwig-data-availability]]`, from 2026-10-23) stopped every later push publishing. Ambiguous links, embeds and
  block references still fail the build. `export-kb` lets the same links through without repeating the warnings.
- `umccr-docs build` and `serve` print what preprocessing warns about; a `--no-strict` build used to drop it.

## v0.1.1

Puts the theme's script back in every site: tag the commit that merges it to `main`. The registry moves every site
but `/platform/` to it.

- The toolkit's package holds the theme's script, `assets/umccr/umccr.js`. CI and the site pipeline install the
  toolkit from its wheel, which left the script out: the repository's `.gitignore` ignores `*.js`, and Hatch does not
  match its exception for the theme from `toolkit/`. Pages still linked the script, so the sites the pipeline
  published had no catalogue, account menu or chat panel. `make install`'s editable install reads the theme from the
  source tree, so local builds were unaffected
  ([write-up](../issues/2026-10-21-theme-script-missing-from-wheel.md)).
- `verify-site` refuses a site without the theme's script, stylesheet or logo, so CI's site builds and the
  pipeline's Build stop such a site before it is published.
- Pipeline 1 deploys beta, then prod; the gamma stage is gone, as the stg account runs no docs stage. Prod now
  opens with the `PromoteToProd` approval, so a timed-out approval fails prod rather than beta.
- The publish steps can export documents to OrcaSonar: `docs-publisher` may list, read, write and delete under
  `docs/*` in OrcaSonar's ingest bucket, matched by its generated name, and use its key through S3. OrcaSonar's
  bucket and key policies name the role only by condition on the account principal, which defers to the role's own
  policy, so every publish to a stage with OrcaSonar failed at `ListObjectsV2` with `AccessDenied`.

## v0.1.0

The first release, for the first users: tag the commit that merges it to `main`. The registry pins every site but
`/platform/` to it. Versions stay `0.y.z` while the authoring contract and the engine can still change; see
[versioning](runbook.md#versioning).

- `UMCCR-DocsSitesPipeline` runs one release at a time, in the order they start (queued, no longer parallel). A
  publish uploads, then deletes, then writes the release marker, so two releases of one site publishing together
  could leave a mix of both, with the older one's marker live. Releases of different sites wait for each other too;
  a run takes a few minutes.
- Sites other than `/platform/` build with the toolkit at `v0.1.0` (`DOCS_TOOLKIT_REF`), no longer at `main`, and the
  registry takes only a release tag or a full commit SHA as a `toolkitRef`: a merge to this repository no longer
  changes how other sites build. A release whose ref does not exist, such as a tag not yet pushed, stops at Build and
  says so.
- The dispatcher forgets a delivery when it cannot take the release number, as it already did when the fetch build
  would not start, so GitHub's redelivery starts the release instead of being refused as a duplicate. If forgetting
  fails too, it answers 500 and logs `forgetError` rather than throwing.
- Theme: the chat panel stops waiting for an answer that sends nothing for 90 seconds, or a search that takes 45, and
  says so. It used to keep **Send** disabled until the page was reloaded. It also stops reading at an answer's `done`
  or `error` event instead of waiting for the server to close the stream.
- The sign-in page shows its own message for an error the hosted UI sends back, never the URL's
  `error_description`, which anyone could set in a link to the real sign-in page; Amplify passed that text on too.
  The browser console keeps the details.
- The publisher serves files with Python's own media type table, not the publishing host's `mime.types`, so a file
  gets the same type from a laptop and from CodeBuild; `.xhtml`, `.xht` and `.shtml` are downloads. Documents (HTML,
  SVG and every XML type) are served as UTF-8, and the contract and `verify-site` check whichever files the
  publisher serves as documents, `.htm` and `.rdf` included, rather than a list of extensions. A document that is
  not UTF-8, such as a UTF-16 SVG, or that holds NUL characters, is rejected: read as UTF-8 it hid its tags from the
  checks while a browser decoded and ran them.
- Site builds show the release's repository and commit in the page footer: the site pipeline passes them to
  `umccr-docs build` (`UMCCR_DOCS_SOURCE_REPO`, `UMCCR_DOCS_COMMIT`), since the source object has no `.git`.
- Code-aware Markdown follows Python-Markdown: indented code blocks are code, and so are fences nested in lists and
  admonitions, while indented blocks after a list item, admonition, tab, footnote or definition stay content.
  Indented code samples are no longer rejected by the contract or rewritten (wikilinks, links, callouts), and a
  source finding the rendered page does not confirm is dropped. Obsidian properties go after the first heading
  outside code, not into a shell sample's `# comment`.
- Reference definitions (`[guide]: guide.md`) are rewritten like inline links: absolute docs URLs in exported
  documents, the home note as `index.md`, and links leaving `docs_dir` to the repository on GitHub. A reference to
  an image outside `docs_dir` is a problem, as an inline one is.
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
  ([ADR-0008](../design/adr/0008-infrastructure-in-docs-platform.md)): the CDK app in `bin/` and `infrastructure/`, the
  code it deploys in `app/`. Stack names and hosting templates are unchanged.
- Dispatched publishing ([ADR-0006](../design/adr/0006-dispatched-publishing.md)): an organisation webhook, a dispatcher
  Lambda, a fetch build and one shared site pipeline, `UMCCR-DocsSitesPipeline`, publishing to dev then prod. One
  `docs-publisher` role per stage replaces the per-site GitHub OIDC roles. The registry gains `branch`,
  `configPath`, `docsPaths`, `toolkitRef` and `stages`.
- Removed the reusable workflow (`.github/workflows/docs.yml`), `site.yml` and the caller-workflow template: site
  repositories need no workflow.
- `umccr-docs export-kb`: pages as plain Markdown with metadata, for OrcaSonar.
- `umccr-docs publish`: `--role-arn` (assume `docs-publisher` narrowed to the site, bucket names from SSM),
  `--release` (newer release wins) and `--documents` (mirror the export into OrcaSonar's ingest bucket).
- Theme: chat panel ([ADR-0007](../design/adr/0007-chat-through-orcasonar.md)), calling OrcaSonar with the reader's
  Cognito ID token through `/_auth/token.js`. The content pages' Content Security Policy allows OrcaSonar and the
  Cognito API.

### Earlier on this branch

- Reusable workflow `.github/workflows/docs.yml`: contract check, strict build, pre-publish checks, and OIDC
  publishing from the caller's GitHub environment.
- `umccr-docs` toolkit: `check`, `preprocess`, `build`, `serve`, `verify-site`, `publish`.
- Obsidian support: wikilinks with `prefer_folders`, Bases table views, callouts, comments, properties table.
- Theme: UMCCR colours, account menu with sign-out, catalogue, classification banner, provenance footer.
- Engine: Material for MkDocs 9.7.7 on MkDocs 1.6.1, hash-pinned; Zensical available for evaluation.
