# Security

## Reporting

If you find a vulnerability in docs.umccr.org or in this repository, or sensitive material committed here by
mistake (a key, a token, an account identifier, private documentation), report it to **services at umccr dot org**
as soon as possible. Please do not open a public issue.

For material committed by mistake, the platform team rotates the affected credential first and then removes it
from history. Deleting it in a later commit does not remove it from history.

## What this repository must never contain

This repository is public. It holds only generic platform code and documentation. It must never contain:

- private documentation, generated sites, search indexes or build output from any participating repository;
- AWS account IDs, ARNs, bucket names, distribution IDs or other environment-specific identifiers;
- credentials, tokens, signing keys, Cognito client secrets or identity-provider metadata with secrets;
- user data, access lists, logs, security findings or threat models.

CI enforces part of this with `scripts/check-boundary.sh` and detect-secrets; reviewers enforce the rest.
The CDK app takes AWS account IDs only from `@orcabus/platform-cdk-constructs`; the site pipeline reads bucket names
from SSM in each stage account at run time, so neither is written here.

## Scope of the platform's controls

Readers sign in through the UMCCR Cognito user pool, and every request is checked at the edge before content is
served. Sites are published only by the shared site pipeline: the organisation webhook's deliveries are signed,
the dispatcher takes the site from the registry rather than the event, the build step has no write access, and
each publish runs as `docs-publisher` narrowed to its own site's prefixes by a session policy. See
[ADR-0002](docs/design/adr/0002-sign-in-and-sessions.md), [ADR-0004](docs/design/adr/0004-publishing-contract.md) and
[ADR-0006](docs/design/adr/0006-dispatched-publishing.md).
