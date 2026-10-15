# Publishing contract

What happens between a push and a live page, and what the platform guarantees.

## From push to release

Your repository holds only its Markdown and `mkdocs.yml`: no workflow, environment or secret.

1. You push to your site's branch, usually `main`.
2. An organisation-wide GitHub webhook sends the push to the platform's dispatcher. The dispatcher ignores pushes
   from repositories and branches that aren't registered, and pushes that change nothing under your site's docs
   paths (for a code repository with a `docs/` folder, a code-only change publishes nothing).
3. The dispatcher gives the release a number and starts a fetch build, which clones your repository at the pushed
   commit through the AWS Connector for GitHub app. No personal access token is involved.
4. The fetch build starts the shared site pipeline with exactly those files.

A release is usually live in dev and prod a few minutes after the push. There is no approval step: documentation
changes no data and no running system.

## Build

Every release, in the site pipeline's build step:

1. installs the platform toolkit and the documentation engine at the version the site registry pins for your site,
   with hash-verified dependencies;
2. `umccr-docs check`: the contract in [Authoring](authoring.md);
3. `umccr-docs build`: preprocessing (Obsidian syntax, links leaving `docs_dir`) and a strict build, which fails on
   broken links and other warnings;
4. `umccr-docs verify-site`: the built site has `index.html` and `404.html`, and contains no source maps, dotfiles,
   credential files, oversized files or text that looks like a credential;
5. `umccr-docs export-kb`: the same pages as plain Markdown with metadata, for the chat (below).

The build step has no write access to anything: your repository's content never runs with publishing rights.

## Publish

Dev first, then prod as soon as dev succeeds. A failure anywhere stops the release before prod, and the platform
team is notified.

1. The publish step assumes the stage's `docs-publisher` role, narrowed for this run to your site's prefixes only.
2. If a newer release of your site is already live (two pushes close together can finish out of order), it stops:
   an older release never overwrites a newer one.
3. It uploads the exported documents to OrcaSonar under `docs/<slug>/`, and deletes documents for pages you
   removed.
4. `umccr-docs publish` uploads every file under `sites/<slug>/`, then deletes the files your new build no longer
   has, then writes `sites/<slug>/_publish.json` recording the release number, repository, commit and build.

**Deletion safety.** Publishing refuses to delete more than half of a site's published files, or of its documents,
which catches a build that lost most of its pages by mistake; the platform team can override it for a deliberate
restructure. It also refuses a site without `index.html`, a malformed slug, or a build containing its own
`_publish.json`.

## Chat

Every page has a chat panel that answers from UMCCR documentation, provided by OrcaSonar, a separate service. Your
published pages are what it knows: each publish exports them, and OrcaSonar re-indexes the changes within about 20
minutes. Pages you remove leave its index the same way. Everything a signed-in reader can read, the chat can quote.

## Caching

| Files | `Cache-Control` |
| --- | --- |
| Theme assets with a content hash in the name (`*.<hash>.min.js`, `*.<hash>.min.css`) | `public, max-age=31536000, immutable` |
| Everything else: pages, search index, images, stylesheets | `no-cache` |

Because everything except fingerprinted theme assets is revalidated on every request, a publish is visible on the
next page load, and nothing needs to clear the cache.

## Rolling back

- **Usual path:** revert the change and push; the next release republishes.
- **Faster:** the platform team can re-run the last good release from the site pipeline's history; its files are
  kept for 30 days.
- **Emergency:** the platform team can take a site offline immediately and restore previous file versions (kept 30
  days).

## What your repository owns

Its Markdown and navigation, what is fit to publish (every signed-in UMCCR reader can read every site, and the chat
can quote it), and fixing problems the build reports. The platform team owns the registry entry, the pipelines and
the toolkit version your site builds with.
