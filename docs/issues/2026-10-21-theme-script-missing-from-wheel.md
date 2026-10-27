# Sites published by the pipeline have no theme script: no catalogue, account menu or chat panel

**Status:** open; fixed in `v0.1.1`, resolved once both sites are released with it
**Found:** 2026-10-21, in prod and dev, while checking the first sites the site pipeline published

## What happened

The first pipeline releases reached dev and prod on 2026-10-21: `/platform/` release 2, started by hand, and the
knowledgebase's release 28. Every page loaded, but the platform's script did not run:

- `/platform/`'s catalogue showed nothing between the introduction and the next heading: not the site cards, not
  "Loading…", not the error message. The script writes one of those three whatever happens.
- There was no account menu in the header, and no chat panel.

The catalogue data, `/_platform/data/catalog.json`, listed both sites. Each page linked `assets/umccr/umccr.js`, but
neither site's published files held it: `assets/umccr/` had only `umccr.css` and `logo.svg`. Dev's earlier copy of
`/platform/`, published by hand on 2026-10-16, had 51 files; release 2 had 50.

## Why

The toolkit package (the wheel) left the script out:

1. The repository's `.gitignore` ignores `*.js`, for the CDK app's compiled output, with an exception for the theme
   written from the repository root: `!toolkit/src/umccr_docs/theme/**/*.js`. Git applies it, so the script is
   tracked.
2. Hatch, which builds the wheel, leaves out what the nearest `.gitignore` ignores. `toolkit/` has none, so it reads
   the repository's, but matches its patterns against paths from `toolkit/`, where the script is
   `src/umccr_docs/theme/assets/umccr/umccr.js`. The exception never matches, and `*.js` does.
3. CI and the site pipeline install the toolkit from that wheel (`pip install ./toolkit`). The build still linked the
   script on every page, since it comes from the configuration, and nothing checked that the file was there.

Local builds were not affected: `make install` installs the toolkit editable, which reads the theme from the source
tree. The hand publishes before 2026-10-21 were built that way.

## Impact

Every site the pipeline built with `v0.1.0`, or with a docs-platform commit before the fix, in dev and prod, from
the first pipeline releases on 2026-10-21 until each site's first release with the fix. Readers could read and
search every page, but saw no catalogue, no account menu and no chat panel. Sign-in, access control and content were
unaffected.

## Resolution

- `toolkit/pyproject.toml` lists the theme's scripts as Hatch `artifacts`, which it includes whatever the ignore
  files say. Built from the branch, the wheel holds `umccr.js`, and nothing else in it changes.
- `verify-site` refuses a site without the theme's script, stylesheet or logo, which every page links. A wheel built
  without the fix gives a site that `verify-site` now refuses with "`assets/umccr/umccr.js` is missing: the toolkit
  was installed without part of its theme". CI's site builds, which install the toolkit from its wheel, and the
  pipeline's Build run that check before anything is published.
- Released as `v0.1.1`; the registry moves every site but `/platform/` to it (`DOCS_TOOLKIT_REF`). The merge starts
  a `/platform/` release built with that commit. The knowledgebase picks `v0.1.1` up on its next push, or straight
  away with a release started by hand ([runbook](../site/runbook.md#start-a-release-by-hand)).

Checked: with the wheel installed as CI installs it, the two examples and `/platform/` build, pass `verify-site`
and hold `assets/umccr/umccr.js`.

## Follow-ups

- [Releasing](../site/runbook.md#release-the-toolkit-and-theme): local builds cannot show a file the package
  leaves out; CI's site builds can.
- [Deploying](../site/deploy.md#troubleshooting): a troubleshooting entry for pages without the theme's script.
