# 0006: Dispatched publishing

**Status:** accepted, 2026-10-12; amended 2026-10-20 (releases run one at a time). Supersedes the access and build
parts of [0004](0004-publishing-contract.md). [0009](0009-dispatch-from-github-actions.md) proposes replacing the
organisation webhook and the function URL; it is deferred.

## Context

Sites first published themselves: each repository called a reusable GitHub Actions workflow, which assumed a
per-site publisher role through GitHub OIDC from a GitHub environment. Every new site therefore needed a workflow,
environments, variables and a role per stage. UMCCR wants as many repositories' docs on the platform as possible,
and its toolchain account already runs about 100 pipelines, so a pipeline per site was ruled out too.

## Decision

- An **organisation-wide GitHub webhook** sends every push to a **dispatcher** Lambda in the toolchain account. It
  verifies the signature, ignores pushes that are not to a registered site's branch and docs paths, records the
  delivery ID so redeliveries start nothing, and numbers the release.
- A **fetch build** clones the commit through the organisation's existing AWS Connector for GitHub app (no personal
  access token or GitHub App key), zips it, and starts **one shared site pipeline**, `UMCCR-DocsSitesPipeline`, with the
  site and commit as pipeline variables. The pipeline runs releases one at a time, in the order they start
  (amended 2026-10-20: it ran them in parallel, and two releases of one site publishing together could leave a mix
  of both).
- **Build** has no write access. **Publish** runs to dev, then prod, with **no approval**: documentation changes no
  data and no running system, and a failure in dev stops the release.
- **One `docs-publisher` role per stage** replaces the per-site roles. Only the pipeline's publish role can assume
  it, and each run narrows it to its own site's prefixes with a session policy.
- **Newer release wins:** a publish skips when the live marker records a newer release, as when an older release is
  retried after a newer one has published.
- The registry entry pins the **toolkit version** each site builds with: a release tag or a commit, never a branch.

## Consequences

- Adding a site is one registry entry: no workflow, environment, secret, pipeline, project or role.
- The number of pipelines is fixed: the infrastructure pipeline and the site pipeline.
- Releases of different sites queue behind each other, a few minutes each. If that grows slow, a per-site lock in
  the publisher (an object created with an S3 conditional write) would let releases of different sites run in
  parallel again.
- The webhook secret is the only secret, and it rotates by hand (it lives in GitHub's settings too).
- Pull requests are no longer checked by the platform. Repositories that want checks can run `umccr-docs check` and
  `build` themselves; check runs from the dispatcher can follow.
- A compromised site repository can still only change its own site: the slug comes from the registry, never from
  the event, and the publish session cannot reach another prefix.
