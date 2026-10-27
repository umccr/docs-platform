"""
Obsidian support: turns a vault's Obsidian-only syntax into Markdown any engine can build.

Supported: wikilinks (including in frontmatter lists), Bases table views rendered at build time, callouts, `%%`
comments, and a properties list. Anything outside that subset is reported as a problem rather than rendered
wrongly. See docs/site/authoring.md.
"""
