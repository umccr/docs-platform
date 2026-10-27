# umccr-docs

The build and publish toolkit behind docs.umccr.org. Participating repositories do not install it directly: the
site pipeline installs it at the git ref the site registry pins for each site (`toolkitRef` in
`infrastructure/sites.ts`). Authors can use it locally to preview a site the way the pipeline builds it.

```sh
pip install --require-hashes --no-deps -r toolkit/requirements/build.txt   # pinned engine
pip install --no-deps ./toolkit

umccr-docs check --slug <slug>     # the project contract
umccr-docs build --slug <slug>     # preprocess + strict build into site/
umccr-docs serve --slug <slug>     # the same, with live reload on http://127.0.0.1:8000
umccr-docs export-kb --slug <slug> # the pages as documents for OrcaSonar, into kb/
```

See `docs/site/authoring.md` and `docs/site/publishing.md` for what each command enforces.

| Path | Holds |
| --- | --- |
| `src/`, `tests/` | the `umccr_docs` package, with the theme in `src/umccr_docs/theme/`, and its tests |
| `requirements/` | the hash-pinned engine (`build.txt`), the repository's test and lint tools (`dev.txt`), and Zensical for the engine bake-off |
| `templates/` | `mkdocs.yml` templates that participating repositories copy |
| `examples/` | synthetic sites CI builds strictly on every change: plain Markdown and an Obsidian vault |
