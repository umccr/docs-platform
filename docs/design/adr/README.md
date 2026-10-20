# Design records

Decisions that shape docs.umccr.org, with their reasons. Each record is short, public, and free of environment
identifiers and security findings; the threat model and review findings are kept privately.

| Record | Decision | Status |
| --- | --- | --- |
| [0001](0001-repository-split.md) | Infrastructure lives with UMCCR's existing Terraform and CDK; this repository owns publishing | Superseded in part by 0008 |
| [0002](0002-sign-in-and-sessions.md) | Portal-style Amplify sign-in, exchanged once for an edge-checked session cookie | Accepted |
| [0003](0003-build-engine.md) | Build with Material for MkDocs 9.7 on MkDocs 1.6 for now; decide on Zensical after a bake-off | Proposed |
| [0004](0004-publishing-contract.md) | Per-site prefixes, OIDC publisher roles, cache classes instead of invalidation | Superseded in part by 0006 |
| [0005](0005-reader-policy.md) | Every signed-in UMCCR reader can read every site | Accepted |
| [0006](0006-dispatched-publishing.md) | One webhook, one dispatcher and one shared site pipeline publish every site, one release at a time | Accepted; amended 2026-10-20 |
| [0007](0007-chat-through-orcasonar.md) | Chat on docs pages is a client of OrcaSonar's API; docs exports documents to it | Accepted |
| [0008](0008-infrastructure-in-docs-platform.md) | docs.umccr.org's infrastructure and pipelines live in this repository | Accepted |
| [0009](0009-dispatch-from-github-actions.md) | Sites' workflows would ask the dispatcher through GitHub OIDC, replacing the webhook and the function URL | Proposed; deferred |
