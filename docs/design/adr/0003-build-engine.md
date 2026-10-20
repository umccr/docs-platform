# 0003: Build engine

**Status:** proposed, 2026-09-29

## Context

Material for MkDocs has been in maintenance mode since November 2025, with critical fixes promised for about a
year. Its team now builds Zensical, which reads `mkdocs.yml` and supports template overrides but runs only its own
built-in plugins. Separately, the Material team warns that MkDocs 2.0 will remove plugins and rewrite theming, with
no migration path.

## Decision

- Projects keep `mkdocs.yml` plus Markdown as their contract.
- The platform builds with Material for MkDocs 9.7 on MkDocs 1.6, pinned with hashes; MkDocs 2.0 is not used.
- Obsidian support and every other preprocessing step run before the engine, not as MkDocs plugins, so they work
  with either engine.
- The theme is template overrides and CSS, which Zensical also supports.
- `extra.platform.engine: zensical` and `requirements/zensical.txt` exist for a bake-off against the example sites
  and a pilot vault. The outcome updates this record.

## Bake-off so far (2026-09-29)

With Zensical 0.0.66, the toolkit builds both examples and the pilot vault with `--engine zensical`. The output
includes the platform's template overrides (provenance footer), script and stylesheet, the Obsidian adapter's
properties tables and admonitions, and GitHub-style heading anchors, and it passes `verify-site`. That needed one
change: the generated configuration now uses paths relative to the work directory, which Zensical requires.

Still to compare before deciding: the rendered pages side by side in beta (navigation, search, dark mode,
instant navigation behaviour when a session expires), and Zensical's release cadence and stability.

## Consequences

Switching engines is a toolkit release: sites do not change. Until the bake-off, the platform depends on a theme
that receives only critical fixes.
