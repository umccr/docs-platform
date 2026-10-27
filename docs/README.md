# Documentation

docs.umccr.org's own documentation. [site/](site/index.md) is the `/platform/` site, which the site pipeline builds
with the root `mkdocs.yml` and publishes at <https://docs.umccr.org/platform/>. The rest is the platform team's
working record, read here on GitHub and never published.

| Path | Holds |
| --- | --- |
| [site/](site/index.md) | the `/platform/` site. For readers and site owners: the catalogue, [reading](site/reading.md), [onboarding a repository](site/onboarding.md), [authoring](site/authoring.md) and the [publishing contract](site/publishing.md). For the platform team: the [project](site/project.md), the [tech stack](site/tech.md), the [design](site/design.md), [deploying](site/deploy.md), the [runbook](site/runbook.md) and the [changelog](site/changelog.md) |
| [design/](design/) | design pages exported from the design documents, each as of its date, and the design records in [design/adr/](design/adr/README.md). Where a page differs from the records, the [design](site/design.md), [deploying](site/deploy.md) or the [runbook](site/runbook.md), the latter are current |
| [plans/](plans/) | the original proposal, the [implementation plan](plans/implementation-plan.md) and planning notes |
| [issues/](issues/README.md) | write-ups of problems found, and how they were resolved |

This repository is public. Keep AWS account IDs, ARNs, bucket names, distribution IDs, security findings and
content from private repositories out of every file here, published or not; see [SECURITY.md](../SECURITY.md).
