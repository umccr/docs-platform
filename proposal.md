# Proposal: UMCCR Docs Platform

## Summary

Create a shared, authenticated documentation platform at `docs.umccr.org`. Documentation remains in its owning GitHub repository. Each participating repository builds its Markdown with MkDocs Material in GitHub Actions and publishes only generated static files to an assigned prefix in a private Amazon S3 bucket. Amazon CloudFront serves all projects from one domain, Amazon Cognito authenticates readers, and GitHub OIDC provides short-lived deployment access to AWS.

The `umccr/docs-platform` repository owns the shared infrastructure and publishing contract. It must not contain private repository documentation, generated private content, secrets, or sensitive environment configuration.

## Problem and context

UMCCR documentation is distributed across many repositories, including private repositories. Readers need a discoverable, consistent website, while repository owners need to retain source ownership and normal pull-request review. The platform must not make source repositories public or rely on repository visibility alone to protect the rendered website.

The proposed platform separates two security boundaries:

1. **Source access:** GitHub permissions control access to Markdown, configuration, and history in each source repository.
2. **Published access:** CloudFront and Cognito control access to the rendered documentation.

## Objectives

- Serve documentation from `https://docs.umccr.org/<project>/`.
- Support private GitHub repositories without copying their source into a central repository.
- Require organisational authentication before serving protected content.
- Provide consistent styling, conventions, and deployment behaviour.
- Minimize credentials and blast radius through OIDC and least-privilege IAM.
- Allow teams to update documentation alongside the code it describes.
- Make platform configuration auditable and reproducible.

## Non-goals

- Replacing GitHub as the authoring and review system.
- Centralizing all private Markdown in `docs-platform`.
- Providing arbitrary server-side applications through the documentation distribution.
- Deriving reader authorization directly from access to a GitHub source repository in the first release.
- Publishing the S3 bucket as a public static website.

## Proposed architecture

### Build and publish flow

1. A participating repository stores Markdown under `docs/` and its project configuration in `mkdocs.yml`.
2. A pull request runs validation, link checking, and a site build without deploying.
3. A merge to the approved branch invokes a versioned reusable workflow owned by `docs-platform`.
4. The workflow installs pinned MkDocs Material dependencies and builds static HTML.
5. GitHub Actions requests an OIDC token and assumes an AWS IAM deployment role.
6. The role permits synchronization only to the repository's allocated `sites/<project>/` S3 prefix.
7. The workflow uploads the generated site and requests a narrowly scoped CloudFront invalidation when needed.

No private Markdown needs to be checked out by `docs-platform`, and no source-repository content is committed to it.

### Delivery flow

1. A reader requests `https://docs.umccr.org/<project>/...`.
2. The authentication layer verifies an existing session or redirects the reader to Cognito.
3. Cognito authenticates directly or federates to an approved organisational identity provider, such as Google or AAF.
4. After a valid callback, the platform establishes a secure session and returns the reader to the requested path.
5. CloudFront applies clean-URL rewriting, for example `/project/guide/` to `/sites/project/guide/index.html` at the origin.
6. CloudFront reads the object from the private bucket through OAC and returns it to the authenticated reader.

The precise edge-authentication implementation should be selected through a short proof of concept. It must cover cookies, token validation, refresh, logout, callback paths, cache-key behaviour, and failure handling. Authentication must execute before protected content can be returned from cache.

### AWS components

- **Route 53 or existing DNS provider:** DNS record for `docs.umccr.org`.
- **AWS Certificate Manager:** TLS certificate compatible with CloudFront requirements.
- **CloudFront:** one distribution, custom domain, HTTPS enforcement, caching, request routing, and security headers.
- **CloudFront OAC:** signed origin requests to S3.
- **Private S3 bucket:** generated sites stored under unique project prefixes, with Block Public Access enabled.
- **Cognito:** user pool or identity-broker configuration and federation to approved organisation IdPs.
- **Edge/request components:** authentication enforcement and clean-URL rewriting, implemented with the CloudFront-compatible mechanism selected during the proof of concept.
- **IAM:** separate infrastructure and publishing roles with constrained trust and permission policies.
- **Logging and monitoring:** CloudTrail, CloudFront/access logs where appropriate, alarms, and authentication monitoring with privacy-aware retention.

## URL and storage conventions

Each project receives an immutable, DNS-safe slug:

```text
Public URL:  https://docs.umccr.org/<project>/
S3 prefix:  s3://<private-bucket>/sites/<project>/
```

Slugs must be centrally registered to prevent collisions. A slug should not expose a confidential internal project or repository name. Renames require redirects and a deprecation period.

The platform should define handling for:

- trailing slashes and `index.html`;
- root navigation and a project catalogue;
- not-found and authentication-error pages;
- assets referenced with relative or absolute paths;
- project moves and redirects;
- cache-control policy for HTML versus versioned assets.

## Repository ownership model

### `umccr/docs-platform` owns

- domain, certificate, CloudFront, S3, OAC, Cognito integration, and edge components;
- infrastructure-as-code definitions and environment promotion;
- versioned reusable GitHub Actions workflows;
- the shared MkDocs Material theme, approved plugins, and dependency versions;
- project slug registration and publishing conventions;
- contributor, onboarding, operational, incident, and rollback guidance;
- non-sensitive example documentation and tests.

### Participating repositories own

- their Markdown, images, diagrams, and navigation;
- documentation correctness, classification, and review;
- their workflow caller and publishing trigger;
- adherence to the assigned project slug and platform contract;
- local preview and pre-deployment validation.

## Authentication and authorization

Cognito is the authentication broker for the documentation site and may federate to existing organisational IdPs such as Google or AAF. The first release should use a clearly documented site-wide reader policy. If different projects later need different audiences, introduce explicit group- or claim-based authorization before onboarding those projects; authentication alone is not sufficient for per-project access control.

Required controls include:

- exact callback and logout URL allowlists;
- secure, HTTP-only, same-site cookies with bounded lifetimes;
- state, nonce, and PKCE where applicable;
- issuer, audience, signature, expiry, and token-use validation;
- session renewal and forced logout behaviour;
- protection of authentication endpoints from open redirects;
- cache policies that cannot mix authenticated and unauthenticated responses;
- generic error responses that do not disclose protected paths or identity details;
- an emergency access-revocation and key-rotation procedure.

AAF federation feasibility and required metadata, claims, assurance levels, and operational ownership must be confirmed with the organisation's identity team during the proof of concept.

## Deployment security

GitHub Actions must use OIDC to assume short-lived AWS roles. Trust policies should bind tokens to the expected GitHub organisation, specific repository, protected branch or GitHub environment, and token audience.

Each source repository should have a dedicated role or an equivalently strict session policy. Its permissions should be limited to:

- listing only the required bucket/prefix context;
- creating, replacing, and deleting objects only under `sites/<project>/`;
- applying approved object metadata such as content type and cache control; and
- invalidating only permitted CloudFront paths, or invoking a controlled platform mechanism that does so.

A compromised source repository must not be able to overwrite another project's content, alter infrastructure, change authentication, or read private S3 objects. The infrastructure deployment role must be separate from content-publishing roles.

Synchronization with deletion is useful for removing stale pages but must validate a non-empty, registered prefix before running. Bucket versioning or a release-based prefix strategy should support rollback.

## Repository visibility and information boundary

### Recommendation

`umccr/docs-platform` **can be public**, and public visibility can improve transparency and reuse, provided it contains only generic platform code and documentation and passes a security review before publication.

Public infrastructure code is not inherently a secret. Security must rely on private data, strong identity controls, least-privilege policies, and correct configuration—not on hiding the architecture. However, a public repository increases the importance of a disciplined information boundary.

### Safe to keep public

- generic architecture diagrams and proposals;
- reusable MkDocs theme code and non-sensitive assets;
- reusable workflows that contain no organisation secrets or sensitive identifiers;
- infrastructure modules with parameters or obviously fictitious example values;
- publishing conventions and contributor documentation;
- synthetic example sites and test fixtures;
- security principles and responsible-disclosure instructions.

### Keep private or outside Git

- private repository names or inventories when their existence is sensitive;
- copied Markdown, generated HTML, search indexes, assets, logs, or metadata from private repositories;
- AWS account IDs, sensitive role ARNs, bucket names, distribution IDs, origin identifiers, internal hostnames, and unpublished environment topology;
- Cognito client secrets, IdP metadata containing secrets, signing material, tokens, session keys, or recovery codes;
- real user attributes, group mappings, access lists, authentication logs, and support exports;
- security findings, incident notes, internal threat models, or unpatched vulnerability details;
- production state files, deployment outputs, `.env` files, credentials, and local caches.

Some identifiers are not credentials by themselves, but keeping environment-specific identifiers out of a public repository reduces unnecessary reconnaissance and prevents accidental coupling. Store secrets in an approved secrets manager and non-secret environment values in protected deployment configuration.

### Publication safeguards

- enable GitHub secret scanning, push protection, dependency alerts, and code scanning where supported;
- require pull-request review and CODEOWNERS approval for infrastructure, workflows, and authentication code;
- pin third-party Actions and dependencies to reviewed immutable versions;
- add automated checks for secrets, private repository URLs/names, generated-site files, state files, and sensitive deployment output;
- use synthetic values in examples and redact logs in CI;
- keep GitHub environments, variables, and secrets access-controlled;
- perform a history scan before making an existing repository public, since deleting a secret in a later commit does not remove it from history;
- document how to report accidental disclosure and rotate affected credentials.

If the team cannot reliably maintain this boundary, keep the repository private until those controls are in place. Changing the platform repository to public does not make source repositories or the protected documentation site public.

## Operational considerations

- Define platform owners, source-repository owners, and escalation paths.
- Monitor authentication failures, origin errors, elevated 4xx/5xx rates, deployment failures, and unusual publishing activity.
- Set retention and access policies for logs that may contain user or path information.
- Test rollback of both infrastructure and individual project content.
- Document disaster recovery, certificate and IdP metadata renewal, and dependency updates.
- Apply lifecycle policies to old generated releases and incomplete uploads.
- Establish availability, recovery, and support expectations before broad rollout.
- Review cost drivers including CloudFront requests and transfer, edge execution, logging, S3 storage, Cognito usage, and cache invalidations.

## Rollout plan

### Phase 1: Design and proof of concept

- Confirm repository and path conventions.
- Select infrastructure as code and edge-authentication implementation.
- Validate Cognito federation with the chosen organisational IdP.
- Test authenticated cache behaviour and clean URL rewriting.
- Record architecture and security decisions.

### Phase 2: Platform foundation

- Provision DNS, certificate, private S3, CloudFront, OAC, Cognito, IAM, logging, and monitoring.
- Implement the shared theme and reusable workflow.
- Add CI tests, security scanning, protected environments, and rollback capability.

### Phase 3: Private-repository pilot

- Choose one low-risk private repository and assign a non-sensitive slug.
- Validate pull-request previews or builds, production deployment, authentication, routing, search, cache invalidation, deletion safety, and rollback.
- Perform IAM review, threat modelling, accessibility checks, and an operational readiness review.

### Phase 4: Incremental onboarding

- Publish onboarding documentation and an ownership register.
- Add repositories in small batches.
- Track failures, support load, performance, and cost.
- Refine conventions before wider adoption.

## Alternatives considered

### Central checkout and build

A central workflow could clone every private repository and build all sites. This simplifies orchestration but gives one system broad read access, increases blast radius, and makes incremental ownership harder. The proposed distributed build avoids that concentration.

### Public S3 website or GitHub Pages

These options are simpler for public content but do not meet the requirement for authenticated private documentation and a private origin.

### Separate stack or domain per project

This provides stronger isolation but creates more certificates, distributions, authentication integrations, and operational overhead. One distribution with strict publishing prefixes is the preferred starting point; projects with materially different compliance needs can use separate stacks later.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Authentication bypass or cache misconfiguration | Authenticate before content delivery; test cache keys and behaviours; conduct security review. |
| Cross-project overwrite | Allocate unique prefixes and enforce them in IAM and workflow validation. |
| Compromised GitHub workflow or dependency | Pin immutable versions, restrict OIDC trust, protect environments, scan dependencies, and minimize role permissions. |
| Sensitive content is published accidentally | Require repository-level review and classification; add content checks; provide rapid unpublish and rollback procedures. |
| Clean URLs break assets or deep links | Define canonical path rules and test nested pages, redirects, errors, and relative links. |
| Public platform repository leaks operational detail | Enforce the information boundary, scan history and changes, and keep environment configuration outside public Git. |
| AAF or IdP integration assumptions are incorrect | Run an early proof of concept with identity owners and document claims and assurance requirements. |
| Project-level audience requirements emerge | Introduce explicit authorization policies before onboarding those projects or isolate them in a separate distribution. |

## Decisions required

Before implementation, approve:

1. the infrastructure-as-code tool and deployment environments;
2. the edge-authentication/session design;
3. the organisational IdP and Cognito federation model;
4. the initial site-wide authorization policy;
5. project slug ownership and registration process;
6. reusable workflow distribution and versioning;
7. rollback, logging, retention, and support expectations; and
8. whether the repository will be public at launch or after the pilot security review.

## Acceptance criteria

The first production release is complete when:

- an approved private repository publishes through OIDC without stored AWS access keys;
- its role cannot modify another project's prefix or platform infrastructure;
- the S3 bucket has Block Public Access enabled and is readable only through CloudFront OAC and approved administrative paths;
- unauthenticated requests cannot retrieve protected HTML, assets, error bodies, or cached responses;
- Cognito federation, callback, renewal, and logout flows pass testing;
- clean and nested URLs resolve correctly;
- deployment, invalidation, deletion safety, monitoring, and rollback are demonstrated;
- no private source content or secrets exist in `docs-platform`; and
- the repository's visibility has passed an information-boundary and history review.
