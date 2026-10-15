# 0004: Publishing contract

**Status:** accepted, 2026-09-29; access and build superseded by [0006](0006-dispatched-publishing.md), 2026-10-12.
Slugs, storage, the publish order and caching stand.

## Decision

- **Slugs** are permanent, DNS-label-style names registered centrally; the registry drives publisher roles, edge
  routing and the catalogue together.
- **Storage:** one private bucket; each site under `sites/<slug>/`. Versioning keeps previous versions for 30 days.
- **Access:** each site has a publisher role per stage, assumed through GitHub OIDC only from its repository's
  GitHub environment. It may list, put and delete under its own prefix, and nothing else.
- **Build** in the calling repository, with the toolkit and engine pinned by the workflow release; no central
  system checks out private repositories.
- **Publish** uploads, then prunes, then writes a provenance marker, and refuses to delete most of a site without
  explicit confirmation. `aws s3 sync --delete` is not used, because it never deletes files excluded by filters.
- **Caching:** only fingerprinted theme assets are cached long-term; everything else is revalidated on every
  request, so no invalidation is needed.

## Consequences

A compromised repository can overwrite only its own site. Rollback is a revert or a re-run; object versions cover
emergencies.
