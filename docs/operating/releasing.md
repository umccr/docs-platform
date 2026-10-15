# Releasing the platform

The site registry pins the toolkit, theme and engine version each site builds with: `toolkitRef` in
[`infrastructure/sites.ts`](../../infrastructure/sites.ts). A release of
this repository therefore changes no site until its registry entry moves to it, so sites move deliberately, one at a
time or together. The platform's own site, `/platform/`, builds with the toolkit at the pushed commit, so a theme or
toolkit change shows there first.

Infrastructure changes are separate: a merge to `main` under `bin/`, `infrastructure/` or `app/` (except
`app/site/`, the platform site) starts the infrastructure pipeline, which deploys to beta and gamma and then waits
for approval before prod.

## Versioning

- Releases are semantic versions, `vMAJOR.MINOR.PATCH`.
- A change that could break an existing site, such as a contract rule, a removed extension or an engine change,
  needs a new major version and a migration note.
- Tag protection rules restrict who can create `v*` tags.

## Releasing the toolkit and theme

1. Make sure `main` is green, and that the platform site on docs.dev.umccr.org and the example builds look right.
2. Update `CHANGELOG.md` and merge.
3. Tag the merge commit and push the tag:

   ```sh
   git tag -s v1.2.0 -m "v1.2.0"
   git push origin v1.2.0
   ```

4. Move sites to the new tag: change their `toolkitRef` in the registry (`DOCS_TOOLKIT_REF` for every site that uses
   the default) and merge. The infrastructure pipeline updates the dispatcher; each site builds with the new version
   on its next push.

## Rolling back a release

Point the affected sites' `toolkitRef` back at the previous tag and merge. To rebuild a site straight away, re-run
its last release from the site pipeline's history (see [Runbooks](runbooks.md#re-run-or-force-a-release)).

## Updating pinned dependencies

- Engine and toolkit runtime: edit `requirements/build.in` and regenerate `requirements/build.txt` with the
  command at the top of the file. The hashes change with it.
- CDK app: `pnpm update`, then `pnpm test` and a template diff before merging.
- Actions: every third-party action is pinned to a full commit SHA with its version in a comment. Update both.
- The build engine decision and the MkDocs 1.x pin are recorded in
  [ADR-0003](../design/adr/0003-build-engine.md).
