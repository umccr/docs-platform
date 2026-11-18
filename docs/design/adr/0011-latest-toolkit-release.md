# 0011: Sites build with the latest toolkit release

**Status:** accepted, 2026-11-18. Amends [0010](0010-toolkit-repository.md), under which a toolkit release reached a
site only once the registry named it.

## Context

Since [0010](0010-toolkit-repository.md) the toolkit and theme are released in
[umccr/docs-toolkit](https://github.com/umccr/docs-toolkit), and the registry here names the release each site builds
with: `DOCS_TOOLKIT_REF`, or a site's own `toolkitRef`. Each release therefore takes a second pull request here, which
changes that one line, the changelog and the version in the status lines, then waits for pipeline 1's self-update and
a prod approval, though no infrastructure changes. Every release so far has moved every site that followed
`DOCS_TOOLKIT_REF`, and none was held back. The step is easy to miss: `v0.2.1` was tagged before the registry moved,
and the knowledgebase's next push put it back on `v0.2.0`.

What the second pull request guards is already guarded where the release is made. docs-toolkit's `main` takes reviewed
pull requests with passing checks, the strict builds of its example sites among them; only the platform owners create
`v*` tags; and each release is immutable, so its tag never changes.

## Decision

- **`latest` is a toolkit ref, and the default.** `DOCS_TOOLKIT_REF` is `latest`: umccr/docs-toolkit's latest release
  on GitHub, the newest published release that is neither a draft nor a pre-release. A site that names a release tag
  or a full commit keeps it, as before. A branch is still refused.
- **It is resolved once per release of a site, before the site pipeline starts.** The fetch build asks GitHub for
  `https://github.com/umccr/docs-toolkit/releases/latest`, which redirects to the release's tag, and starts the run
  with `TOOLKIT_REF` set to that tag. Build and both publish steps install the same release, a retry keeps it, and the
  run's variables record which release built the site. The site pipeline refuses a `TOOLKIT_REF` that is not a
  release tag or a full commit, so a run started by hand names the tag too.
- **Through GitHub's web link, not its REST API.** Without a token the API allows 60 requests an hour per address,
  and CodeBuild shares its addresses with other accounts. The platform holds no GitHub token, by design.
- **CI follows the same release.** Its build of `/platform/` resolves `latest` the same way, so CI builds what the
  site pipeline will.
- **Latest means the highest version.** docs-toolkit's release workflow marks a release latest only when no released
  version is higher, so a patch to an older line, such as `v0.3.3` after `v0.4.0`, never becomes every site's
  toolkit. Releases made by hand, such as those for the tags carried over from this repository, are made with
  `--latest=false`.

## Considered

- **Keep the pin, and have a workflow open the pull request that moves it.** Review stays here, but it needs a GitHub
  App, since pull requests opened with a workflow's own token start no CI; a scheduled run; and still a prod approval
  for each release. The team does not want a workflow running every day for it.
- **Resolve `latest` in Build and in each publish step.** Runs wait in a queue, so a toolkit release while one waits
  would publish files that another release built.
- **Resolve it in the dispatcher.** GitHub would sit on the webhook's path, which has to answer within ten seconds.
- **A moving `latest` tag in umccr/docs-toolkit.** Its tag ruleset forbids moving tags, and a moved tag leaves no
  record of what a run built with.
- **Renovate.** An organisation-wide app, for one line.

## Consequences

- A docs-toolkit release reaches every site that pins no release at the site's next push under its docs paths, with
  no change here. Reviewing what the sites build with happens in umccr/docs-toolkit, before the tag. To move a site
  sooner, [start a release by hand](../../site/runbook.md#start-a-release-by-hand) with the tag.
- Until each has pushed, sites build with different releases. A run's `TOOLKIT_REF` and its build log say which.
- A release that cannot build a site stops that site's release at Build: the live site stays as it was, and the alerts
  channel gets the failure. The fix is the next patch release; a site that cannot wait pins the last good release
  here. On GitHub, marking the previous release as latest moves every site back without a deploy.
- Breaking changes, which take a minor version until `v1.0.0`, reach the sites too. A release that needs sites to
  change goes out as a pre-release first, which is never latest; a site pinned to it tries it.
- CI here changes when the toolkit does: a release that cannot build `/platform/` turns the next pull request red,
  before any site's push.
- Releasing in umccr/docs-toolkit is now enough to update the sites. Its release steps say so, and its repository
  settings ([CONTRIBUTING](https://github.com/umccr/docs-toolkit/blob/main/CONTRIBUTING.md#repository-settings)) are
  what stand between a merge there and every site.
- The fetch build needs github.com to answer. It already clones the site from GitHub, so this adds no new dependency.
