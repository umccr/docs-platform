# umccr-docs

The build and publish toolkit behind docs.umccr.org. Participating repositories do not install it directly: the
site pipeline installs it at the git ref the site registry pins for each site (`toolkitRef` in
`infrastructure/sites.ts`). Authors can use it locally to preview a site the way the pipeline builds it.

```sh
pip install --require-hashes --no-deps -r requirements/build.txt   # pinned engine
pip install --no-deps ./toolkit

umccr-docs check --slug <slug>     # the project contract
umccr-docs build --slug <slug>     # preprocess + strict build into site/
umccr-docs serve --slug <slug>     # the same, with live reload on http://127.0.0.1:8000
umccr-docs export-kb --slug <slug> # the pages as documents for OrcaSonar, into kb/
```

See `app/site/docs/authoring.md` and `app/site/docs/publishing.md` for what each command enforces.
