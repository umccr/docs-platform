# 0008: Infrastructure in docs-platform

**Status:** accepted, 2026-10-12. Supersedes the hosting part of [0001](0001-repository-split.md).

## Context

[0001](0001-repository-split.md) put docs hosting in `umccr/frontend-infrastructure-pipelines` (`lib/docs/`), next
to the portal's frontend hosting. In practice docs has its own domain, distribution, sign-in and, with dispatched
publishing, its own pipelines; it shares nothing with the portal but the CDK conventions. The team wants
`frontend-infrastructure-pipelines` to serve the customer-facing portal UI only, and one place for docs.umccr.org.

## Decision

- This repository holds all of docs.umccr.org: the CDK app (`bin/`, `infrastructure/`), the code it deploys
  (`app/`), the site registry, both pipelines, the toolkit, the theme, the conventions and the `/platform/` site.
- It follows the OrcaBus service layout and uses `@orcabus/platform-cdk-constructs` for the deployment pipeline,
  stage accounts and the toolchain account.
- The Cognito client and the certificate stay in Terraform in `umccr/infrastructure`, because the user pool is
  shared with the portal; the hosting stack keeps reading them from SSM.
- The repository stays public. Account IDs come only from `@orcabus/platform-cdk-constructs`, never as literals,
  and bucket names are read from SSM at run time.

## Consequences

- The deployed stack names do not change (`DocsInfrastructurePipeline`, `OrcaBus<Stage>-DocsHostingStack`), and
  the move synthesizes identical hosting templates, so the dev deployment carries over untouched.
  **Update, 2026-10-13:** docs.umccr.org is named for UMCCR rather than OrcaBus: pipeline 1 is
  `UMCCR-DocsInfrastructure`, and the hosting stack is `UMCCR-DocsHostingStack` in every stage account, tagged
  `umccr-org:Product: Docs`. The renamed stack is a new stack; dev's was replaced while still in testing. The
  OrcaBus `DeploymentStackPipeline` construct fixes OrcaBus stage IDs, names and tags, so pipeline 1 is built by this
  repository's own construct, `infrastructure/toolchain/deployment-pipeline.ts`, adapted from it (MIT): stages
  `Beta`, `Gamma` and `Prod`, its own artifact bucket and key, and UMCCR names throughout.
  **Update, 2026-10-21:** the `Gamma` stage is gone. The stg account runs no docs stage, so pipeline 1 deploys `Beta`,
  then `Prod`, which opens with the `PromoteToProd` approval.
- The infrastructure pipeline is started only by changes under `bin/`, `infrastructure/` and `app/`; docs, toolkit
  and example changes reach readers through the site pipeline instead.
- CI runs the TypeScript tests, lint and synth alongside the toolkit tests.
- Registry changes are reviewed here, in public, so registered repository names are public, as before.
