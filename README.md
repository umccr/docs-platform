# UMCCR Docs Platform

Shared infrastructure and publishing conventions for authenticated UMCCR documentation at [docs.umccr.org](https://docs.umccr.org).

> **Status:** Proposal and initial planning.

## Context and goal

UMCCR documentation lives across many GitHub repositories, including private repositories. This project will provide one consistent website while keeping documentation source in its owning repository and preserving private-repository access controls.

Each participating project will be published at:

```text
https://docs.umccr.org/<project>/
```

## Proposed architecture

```text
Private GitHub repository
  -> GitHub Actions builds Markdown with MkDocs Material
  -> GitHub OIDC assumes a scoped AWS IAM role
  -> generated site is uploaded to a project prefix in private S3
  -> CloudFront serves docs.umccr.org/<project>/ through OAC
  -> Cognito authenticates users through an approved organisation IdP
```

CloudFront will also handle clean URLs such as `/project/guide/` by resolving the appropriate `index.html` file.

## This repository owns

- domain, TLS, CloudFront, private S3, OAC, and authentication infrastructure;
- Cognito integration with approved identity providers such as Google or AAF;
- reusable GitHub Actions workflows and deployment conventions;
- the shared MkDocs Material theme and supported configuration;
- onboarding and operational guidance.

Each participating repository continues to own its Markdown, navigation, review process, and documentation quality.

This repository must not contain private repository documentation, generated private sites, credentials, secrets, or sensitive deployment data.

## Rollout

1. Agree on URL, MkDocs, workflow, and security conventions.
2. Provision the AWS foundation and Cognito authentication.
3. Create the reusable build and publishing workflow.
4. Pilot with one low-risk private repository.
5. Complete security and operational reviews.
6. Onboard additional repositories gradually.

## Local development

Local setup will be documented when the shared theme and pinned dependencies are added. Source repositories will preview their documentation with the same MkDocs versions used in CI.

## Deployment and security

Deployments will run through protected GitHub Actions environments. GitHub OIDC will provide short-lived AWS credentials, and each publisher will be restricted to its allocated S3 prefix. S3 Block Public Access will remain enabled, with CloudFront OAC as the only reader-facing origin path. Authentication must run before protected content can be returned from cache.

## Repository visibility

This repository can be public if it contains only generic platform code and documentation. Private content, repository inventories, secrets, account-specific configuration, access data, generated sites, and security findings must remain in approved private systems.

See [proposal.md](proposal.md) for the complete architecture, security boundary, risks, rollout plan, and acceptance criteria.
