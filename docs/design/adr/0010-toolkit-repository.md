# 0010: The toolkit in its own repository

**Status:** accepted, 2026-11-11. Supersedes the toolkit part of [0001](0001-repository-split.md) and
[0008](0008-infrastructure-in-docs-platform.md), which kept the toolkit and theme in this repository.

## Context

The toolkit and theme, `umccr-docs`, lived in `toolkit/`. A toolkit release was a tag of this repository, and the
site pipeline cloned this repository to install the toolkit at a site's `toolkitRef`. The two halves already shipped
separately: infrastructure deploys from merges through pipeline 1, and the toolkit reaches a site only when the
registry moves the site to a new tag. Sharing a repository mixed them anyway. `v0.3.1` changed only the toolkit but
tagged the whole platform, and anyone who wanted the build tool got the hosting with it.

The toolkit was a package of its own already. Since `v0.2.0` everything it needs had been inside `toolkit/`: the
package and its theme, the hash-pinned engine, the `mkdocs.yml` templates, the example sites and the tests.
`pyproject.toml` declared the MIT licence, though the repository had no licence file. The only test outside
`toolkit/` was jest's, for the theme's script. The parts that only make sense for docs.umccr.org are few, and known:

| Where | What |
| --- | --- |
| `slug.py` | the `docs.umccr.org` origin, and slug rules copied from the registry |
| `build.py`, `contract.py` | the theme's asset folder `assets/umccr/`, the `UMCCR_DOCS_*` variables, `extra.umccr`, the logo linking to `/platform/` |
| `publish.py`, `aws.py` | the S3 layout, the `docs-publisher` role and OrcaSonar's SSM parameter; `boto3` is always installed |
| `export_kb.py` | links in exported documents point at `docs.umccr.org` |
| `theme/assets/umccr/umccr.js` | the account menu (Cognito tokens), the catalogue, the chat panel (`/_auth/`, OrcaSonar) and the branding |

The team wants the toolkit usable on its own: by UMCCR repositories outside the platform first, and later by other
organisations, as an open-source tool that builds Markdown and Obsidian vaults into sites with an organisation's
theme and rules, from configuration. It does not need a package index: the pipeline and authors can install it from
git.

## Decision

- The toolkit moves to a public repository of its own, **[umccr/docs-toolkit](https://github.com/umccr/docs-toolkit)**,
  with what `toolkit/` held at its root, and a `LICENSE` file for the MIT licence, held by the University of
  Melbourne Centre for Cancer Research as OrcaSonar's is. Its history comes with it (`git filter-repo
  --subdirectory-filter toolkit`, which keeps 28 commits), with references to this repository's pull requests
  rewritten from `#14` to `umccr/docs-platform#14` so they still link to the right place. Tags `v0.2.0` to `v0.3.1`
  come too, each holding exactly the tree `toolkit/` had at that tag. `v0.1.x` kept the engine pins at this
  repository's root, outside `toolkit/`, so those tags stay here only.
- **Names stay as they are:** the package and command `umccr-docs`, the module `umccr_docs`, the `.umccr-docs` work
  folder and the `extra.platform` settings. Site owners change nothing. A neutral name can wait until another
  organisation uses the toolkit; GitHub redirects a renamed repository.
- **Versions are git tags,** `vX.Y.Z` equal to the package version, each with an immutable GitHub release, which
  docs-toolkit's release workflow makes from the tag's section of its changelog. While the release exists, its tag
  cannot be moved or deleted. The toolkit is not published to PyPI.
- The site pipeline clones `umccr/docs-toolkit` instead of this repository, checks out the site's `toolkitRef`,
  installs the engine with hashes from that ref's `requirements/build.txt`, then the package with `--no-deps`. These
  are the steps it took before, from another URL and without the `toolkit/` folder. pip cannot check a hash for a
  git checkout, so the toolkit's own integrity rests on the immutable tag or a full commit, as it did here, and the
  engine stays hash-pinned. `make toolkit` does the same for `make install` and CI, at `DOCS_TOOLKIT_REF`, with pip
  reading the pins and the package from GitHub instead of a clone. Authors install a release the same way:

  ```sh
  git clone --branch v0.3.1 https://github.com/umccr/docs-toolkit.git
  pip install --require-hashes --no-deps -r docs-toolkit/requirements/build.txt
  pip install --no-deps ./docs-toolkit
  ```

- This repository keeps the hosting, sign-in, the registry, the dispatcher, both pipelines, the conventions and
  `/platform/`. `toolkitRef` keeps its rules, a release tag or a full commit, but names a ref of `umccr/docs-toolkit`.
  `self` goes: `/platform/` builds with `DOCS_TOOLKIT_REF` like every other site, and publishes on changes to
  `mkdocs.yml` and `docs/site/` only.
- The theme script's test moves with the script, from jest here to Node's own test runner there, so the toolkit's
  repository needs no npm packages.
- After the move, the docs.umccr.org values in the table above gather into one UMCCR profile, which another
  organisation could replace with its own: the origin and slug rules, the branding and asset folder, the publish
  target, export links, and the theme script's account menu, catalogue and chat panel. `boto3` becomes an optional
  extra for publishing. The profile stays in the toolkit's repository rather than here. The theme and `/_auth/`
  already ship separately, through a toolkit tag and pipeline 1, so keeping it there adds no coordination, and a
  site's build still needs one ref.

## Considered

- **Keep the toolkit here and only generalise it.** No second repository, but toolkit versions stay tags of the
  platform, and nobody can use the tool or contribute to it without the infrastructure around it.
- **`umccr/umccr-docs`.** The name people install and run, but in the organisation, repositories named `*-doc` hold
  documentation, so it reads as UMCCR's documentation rather than a tool. `docs-toolkit` says what it is, and pairs
  with `docs-platform`.
- **PyPI.** A wheel could be pinned by hash like the engine, but PyPI adds an account, a publishing workflow and a
  name to hold, for users who can install from git.

## Consequences

- Toolkit releases no longer tag this repository. Its tags `v0.1.0` to `v0.3.1` stay here. `v0.2.0` onwards also exist
  in `umccr/docs-toolkit`, so a site can roll back to any of them; the pipeline's fallback for `v0.1.x`'s pins goes.
- A theme or toolkit change no longer shows on `/platform/` first. The toolkit's CI builds its example sites strictly
  on every pull request, and a release candidate (`v0.4.0-rc.1`, which the registry already accepts) can go to
  `/platform/` before the other sites move. Moving sites to a release stays a pull request here that changes
  `DOCS_TOOLKIT_REF`, and `/platform/` moves with it.
- CI splits. `umccr/docs-toolkit` runs the toolkit's tests and lint, the theme script's tests, the strict example
  builds, and the information boundary check, since it is public too. This repository's CI installs the toolkit at
  `DOCS_TOOLKIT_REF` to build `/platform/` strictly, so a release must be on GitHub before the registry names it.
- Write access to `umccr/docs-toolkit` reaches every site: its code builds each site, and its `publish` narrows the
  `docs-publisher` role to one site. It needs the rules this repository has: a reviewed pull request and passing
  checks on `main`, `v*` tags created only by the platform owners, code owners, secret scanning and Dependabot, plus
  release immutability.
- The release steps split between the repositories. The version, the toolkit's changelog and the tag are in
  `umccr/docs-toolkit`; moving the sites stays here, and this repository's changelog records which release the sites
  build with.
- Authoring and publishing conventions stay on `/platform/`, where readers and site owners already find them. The
  toolkit's README covers installing it and its commands.
- The merge that makes this change publishes `/platform/` with the registry it replaces: its own release builds with
  `self`, which no longer finds a toolkit here, and stops at Build. It is started again by hand with `v0.3.1` once
  pipeline 1's self-update is done ([runbook](../../site/runbook.md#a-merge-that-changes-platforms-own-registry-entry)).
