# 0007: Chat through OrcaSonar

**Status:** accepted, 2026-10-12

## Context

The plan for chat over the documentation put a knowledge base, a chat Lambda, a budget and 30-day records inside the
docs hosting stack, behind `/_api/chat`. UMCCR then decided to answer questions about more than documentation in
future (databases and APIs as sources), so the question-answering service became its own project, OrcaSonar
(`umccr/orcasonar`), with its own API at `sonar.<stage>.umccr.org`. Its design, with diagrams, lives there:
[docs/design.md](https://github.com/umccr/orcasonar/blob/main/docs/design.md).

## Decision

- docs.umccr.org hosts only the **chat panel**, in the theme. It calls OrcaSonar's API directly from the browser,
  like any other client: Ask (`/chat`, streamed) and Search (`/search`), plus feedback.
- The panel authenticates with the reader's **Cognito ID token** from the `docs-app` client, the way the portal apps
  call OrcaBus. The docs session cookie never leaves docs.umccr.org. The panel loads Amplify (`/_auth/token.js`)
  only when it opens.
- Each publish **exports** the site's pages as plain Markdown with metadata (`doc_id`, `site`, `title`, `url`,
  `commit`, `updated`) to OrcaSonar's ingest bucket under `docs/<slug>/`, and deletes documents for removed pages.
  OrcaSonar names the bucket in SSM; the docs side needs nothing else of it.
- The knowledge base, the model, the guardrail, the budget and the records belong to OrcaSonar.

## Consequences

- The content pages' Content Security Policy allows `connect-src` to OrcaSonar and the Cognito API.
- docs deploys never depend on OrcaSonar: without its SSM parameter the export is skipped with a warning, and the
  panel reports that chat is unavailable.
- Everything a signed-in reader can read, the chat can quote; [0005](0005-reader-policy.md) covers both.
- Citations carry `docs.umccr.org` URLs; the panel rewrites them to the current host, so dev links stay in dev.
