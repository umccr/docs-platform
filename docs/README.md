# Platform team documents

Design, plans and operations for docs.umccr.org, for the platform team. They are read here on GitHub and never
published. The `/platform/` site that readers and site owners see is built from [app/site/](../app/site/).

| Path | Holds |
| --- | --- |
| [deploy.md](deploy.md) | deploying everything, step by step: the Terraform, the hosting stack, the pipelines, the webhook, the first releases |
| [design/](design/) | design pages exported from the design documents, each as of its date, and the design records in [design/adr/](design/adr/README.md). Where a page and the records, the deploy guide or `operating/` differ, the latter are current |
| [plans/](plans/) | the original proposal, the [implementation plan](plans/implementation-plan.md) and planning notes |
| [issues/](issues/README.md) | write-ups of problems found, and how they were resolved |
| [operating/](operating/README.md) | how the platform runs: runbooks, onboarding a site, releasing the platform |

This repository is public. Keep AWS account IDs, ARNs, bucket names, distribution IDs, security findings and
content from private repositories out of every file here; see [SECURITY.md](../SECURITY.md).
