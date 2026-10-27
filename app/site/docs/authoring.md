# Authoring

Sites are written in Markdown, configured by `mkdocs.yml`, and built by `umccr-docs` with the platform theme. Every
site gets the same theme, Markdown extensions and scripts; a site configures its content, not its presentation.

## What your `mkdocs.yml` may set

`site_name`, `site_description`, `site_author`, `site_url`, `copyright`, `repo_url`, `repo_name`, `edit_uri`,
`edit_uri_template`, `docs_dir`, `nav`, `not_in_nav`, `exclude_docs`, `draft_docs`, `validation`, `extra`,
`extra_css` (stylesheets inside `docs_dir`), and `plugins` limited to `search` and `tags`.

Everything else is the platform's: `theme`, `markdown_extensions`, `extra_javascript`, `hooks`, `site_dir` and the
rest, and the `extra` settings that add scripts (`polyfills`, `analytics` and `consent`). `umccr-docs check` names
any key it rejects. `site_url` must be `https://docs.umccr.org/<slug>/`, and `use_directory_urls` stays on.

Optional settings under `extra`:

```yaml
extra:
  classification: 'Internal: UMCCR staff only'   # a banner on every page
  platform:
    source_format: markdown   # or obsidian
```

## Markdown

Available on every site: admonitions (`!!! note`), collapsible blocks (`??? note`), content tabs, task lists,
`==highlight==`, footnotes, definition lists, abbreviations, attribute lists, Markdown inside HTML blocks, code
highlighting and heading permalinks.

Links between pages are relative paths to `.md` files, as in any MkDocs site. A link that leaves `docs_dir`, such
as `../README.md`, is rewritten to the file in your repository on GitHub, so it keeps working. Images must be inside
`docs_dir`.

Only files git would commit are built: anything your `.gitignore` excludes never reaches the site, and neither do
dotfiles or dot-directories.

## Not allowed

Every site shares one browser origin, where the sign-in page keeps your session tokens, as the portal apps do. So a
site cannot bring its own code:

- no `<script>` elements, and no `extra_javascript`;
- no HTML event handlers (`onclick=`, `onerror=`, and so on), in HTML or in attribute lists (`{ onclick=... }`);
- no `<iframe>`, `<object>`, `<embed>` or `<base>`;
- no `javascript:` links;
- no files under `assets/javascripts/` or `assets/umccr/` in `docs_dir`: the theme's scripts are served from there.

The same goes for front matter and `mkdocs.yml` values, which the theme shows as they are, and for HTML, SVG and
XML files in `docs_dir`, which readers can open directly. Those files must be saved as UTF-8, the encoding they are
served and checked in. Pages are checked as they are built, after attribute lists, entities and front matter take
effect, and `umccr-docs verify-site` checks the built site again before it is published.

HTML in code is fine: it is shown, not run. That includes fenced and indented code blocks, inside lists and
admonitions too, and inline code.

## Obsidian vaults

Set `extra.platform.source_format: obsidian` and point `docs_dir` at the vault folder. The build turns Obsidian's
syntax into Markdown the engine understands.

```yaml
docs_dir: PlatformServices
extra:
  platform:
    source_format: obsidian
    home: Home.md                       # published as the site's front page
    properties: [status, priority, lead, updated]   # shown in a table at the top of each note
    obsidian:
      prefer_folders: [Projects]        # which note a name means when several folders have one
      sort_orders:
        priority: [Low, Medium, High]   # lowest first; a DESC sort then lists High first
```

| Obsidian | On the site |
| --- | --- |
| `[[note]]`, `[[note\|label]]`, `[[folder/note]]` | links, resolved by filename as Obsidian does |
| `[[note#Heading]]`, `[[#Heading]]` | links to the heading |
| wikilinks in frontmatter, such as `domains: ["[[area]]"]` | links in the properties table and in tables |
| ```` ```base ```` blocks | tables, computed from frontmatter when the site is built |
| `> [!note] Title` callouts, including `-` and `+` folding | admonitions |
| `%% comments %%` | removed |
| `==highlight==`, `- [ ]` tasks | rendered |

When a name matches notes in several folders, `prefer_folders` decides; otherwise a note in the linking note's own
folder wins; otherwise the build reports the link as ambiguous. Write `[[folder/note]]` to be explicit.

A link to a note that is not in the vault, such as one nobody has written yet, shows as its plain `[[note]]` text,
as Obsidian shows an unresolved link. The build warns with the note and line, and publishes the rest of the site.

**Bases.** The build supports `filters` with nested `and`, `or` and `not`; `==` and `!=`; `.contains(...)`;
`.contains(link("note"))`; `file.inFolder("Folder")`; and `table` views with `name`, `order`, `sort` and `limit`,
using frontmatter properties and `file.name`, `file.folder` and `file.path`. `properties.<name>.displayName`
renames a column. Without a sort order, text sorts alphabetically. Tables reflect the vault when the site was
built, so they update on the next publish.

**Not supported:** embeds (`![[...]]`), block references (`[[note#^block]]`), Dataview, `this` in Bases filters,
formulas, and view types other than `table`. The build stops and names the note and line rather than publish
something wrong.

## Checking your work

```sh
umccr-docs check   # the contract
umccr-docs build   # a strict build: broken Markdown links fail it; wikilinks to missing notes warn
umccr-docs serve   # a live preview on http://127.0.0.1:8000
```
