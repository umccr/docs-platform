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

- Releases are semantic versions, `vMAJOR.MINOR.PATCH`. The toolkit's package version (`toolkit/pyproject.toml` and
  `umccr_docs.__version__`) is the same as the tag.
- Until `v1.0.0` the platform is in initial development, `0.y.z`: the authoring contract and the engine
  ([ADR-0003](../design/adr/0003-build-engine.md)) can still change. A change that could break an existing site,
  such as a contract rule, a removed extension or an engine change, takes the next minor version (`v0.2.0`) and a
  migration note; fixes and compatible additions take the next patch (`v0.1.1`).
- `v1.0.0` comes once the engine is decided, the first users' feedback is in, and a team outside the platform team
  depends on the contract with a site of its own. From then on, a breaking change needs a new major version.
- A registry `toolkitRef` is a release tag or a full commit SHA, never a branch; the registry refuses anything else.

## Repository settings

Review on `main` is the only gate before prod for the toolkit, the theme and `/platform/`: the site pipeline
publishes `/platform/` from each merge with no approval, and the other sites build with tags cut from `main`. An
organisation owner sets these under **Settings → Rules → Rulesets**:

- **`main`**: require a pull request with one approval, and the `ci` checks to pass ("Toolkit tests and lint",
  "Strict builds of the examples and the platform site", "CDK app tests, lint and synth", "Workflows, secrets and
  information boundary"); block force pushes and deletion.
- **`v*` tags**: only the platform owners may create them, and nobody may update or delete one: a moved tag would
  change how sites build without a registry change.
- **Code owners**, later: once the owners' team is named in [`.github/CODEOWNERS`](../../.github/CODEOWNERS), which
  holds a placeholder for now, require their review on `main` too.

## Releasing the toolkit and theme

1. Make sure `main` is green, and that the platform site on docs.dev.umccr.org and the example builds look right.
2. Update `CHANGELOG.md` and the toolkit's version (`toolkit/pyproject.toml`, `toolkit/src/umccr_docs/__init__.py`),
   and merge.
3. Tag the merge commit and push the tag:

   ```sh
   git tag -s v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

   `-s` signs the tag; without a signing key, `-a` makes an annotated tag instead.

4. Move sites to the new tag: change their `toolkitRef` in the registry (`DOCS_TOOLKIT_REF` for every site that uses
   the default) and merge. The infrastructure pipeline updates the dispatcher; each site builds with the new version
   on its next push.

Steps 2 and 4 can be one merge, as for `v0.1.0`: then tag that merge straight away, since the sites' releases stop
at Build ("has no ref") until the tag exists. Re-run any that stopped once it does.

## Rolling back a release

Point the affected sites' `toolkitRef` back at the previous tag and merge. Once the infrastructure pipeline has
updated the dispatcher, each site builds with that tag on its next push under its docs paths.

To rebuild a site straight away, [start a release by hand](runbooks.md#start-a-release-by-hand) from its live
release's source object, with `TOOLKIT_REF` set to the previous tag. Re-running an existing release does not do
this: it keeps the `TOOLKIT_REF` it started with, and is skipped when a newer release is live.

## Updating pinned dependencies

- Engine and toolkit runtime: edit `requirements/build.in` and regenerate `requirements/build.txt` with the
  command at the top of the file. The hashes change with it.
- CDK app: `pnpm update`, then `pnpm test` and a template diff before merging.
- Actions: every third-party action is pinned to a full commit SHA with its version in a comment. Update both.
- The build engine decision and the MkDocs 1.x pin are recorded in
  [ADR-0003](../design/adr/0003-build-engine.md).
