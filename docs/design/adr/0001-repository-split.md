# 0001: Repository split

**Status:** superseded in part by [0008](0008-infrastructure-in-docs-platform.md), 2026-10-12. The Terraform split
stands; the hosting moved from `umccr/frontend-infrastructure-pipelines` to this repository.

## Context

The original proposal put all docs.umccr.org infrastructure in this repository. UMCCR already manages Cognito and
certificates with Terraform in `umccr/infrastructure`, and frontend hosting with a registry-driven CDK app and
self-mutating pipelines in `umccr/frontend-infrastructure-pipelines`.

## Decision

| Repository | Owns |
| --- | --- |
| `umccr/infrastructure` | the `docs-app` Cognito app client (`cognito_aai/app_docs.tf`) and the docs certificate (`umccr_docs_domain`) |
| `umccr/frontend-infrastructure-pipelines` | hosting (`lib/docs/`): bucket, CloudFront, the edge function, the session Lambda, the site registry, publisher roles, and the pipeline that deploys them |
| `umccr/docs-platform` (this repository) | the reusable workflow, the toolkit and theme, conventions, onboarding, and the `/platform/` site |
| participating repositories | their Markdown, `mkdocs.yml`, caller workflow and GitHub environments |

## Consequences

- Infrastructure changes follow the review and deployment routes those repositories already have.
- A site is registered in frontend-infrastructure-pipelines, which is public, so registered repository names are
  public. Sites with sensitive repository names need a neutral slug and a decision on their registry entry.
- This repository holds nothing account-specific: callers pass their role ARN and bucket as GitHub environment
  variables.
