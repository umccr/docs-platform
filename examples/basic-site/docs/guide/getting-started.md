# Getting started

Build the site locally the same way CI does:

```sh
umccr-docs build --slug example-basic
```

The repository's own README is outside `docs_dir`, so this link is rewritten to point at the file in the source
repository: [example README](../../README.md).

## Checklist

- [x] Write Markdown under `docs/`
- [ ] Open a pull request

HTML in a code sample is fine, because it is never rendered: `<script>alert(1)</script>`.
