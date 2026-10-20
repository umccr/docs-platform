# Onboarding a documentation site

Registering a repository's documentation at `docs.umccr.org/<slug>/`, for the platform team. The site's own side is
one `mkdocs.yml`; see [Onboarding a repository](../../app/site/docs/onboarding.md).

## 1. Register the site

Append a `DocsSite` to `DOCS_SITES` in [`infrastructure/sites.ts`](../../infrastructure/sites.ts):

```ts
export const EXAMPLE_SITE: DocsSite = {
  slug: 'example', // URL path and S3 prefix; immutable once published
  repo: 'umccr/example', // the repository the dispatcher clones
  branch: 'main', // pushes to this branch publish the site
  configPath: 'mkdocs.yml',
  docsPaths: ['docs/**', 'mkdocs.yml'], // a push that changes none of these publishes nothing
  toolkitRef: DOCS_TOOLKIT_REF, // or a docs-platform release tag or full commit SHA, never a branch
  stages: [AppStage.BETA, AppStage.PROD],
  title: 'Example',
  description: 'One line for the catalogue.',
};
```

- **Slug**: lowercase letters, digits and inner hyphens, at most 49 characters. It must not reveal a confidential
  project or repository name. `sites` is reserved.
- **Docs paths**: globs relative to the repository root. Keep them tight in code repositories, so code-only pushes
  don't rebuild the site.
- **Stages**: sites publish to beta (dev) and prod, the platform's two stages.
- **Registry visibility**: this repository is public, so the repository name becomes public too.

Merging starts `DocsInfrastructurePipeline`. Its self-update gives the dispatcher the new routing entry, and each
stage deploy adds the slug to the edge function and the catalogue. Registering a site before its first push is
harmless: the path is a 404 until content arrives.

## 2. Check GitHub access

The fetch build clones through the AWS Connector for GitHub app. If the app is installed for selected repositories
only, an organisation owner adds the site's repository in the organisation's settings (**GitHub Apps → AWS
Connector for GitHub → Configure**). Nothing else is needed: the organisation webhook already covers every
repository.

## 3. First release

The next push to the site's branch that changes its docs paths publishes it. Watch the release in the
`UMCCR-DocsSitesPipeline` execution history, where each run's variables name the site, commit and release. To publish
without waiting for a new push, redeliver the latest push that changed the site's docs paths from the webhook's
settings: the dispatcher ignored it while the site was unregistered, so it is not a duplicate (see
[runbooks](./runbooks.md#re-run-or-force-a-release)).

## Removing a site

1. Take it offline immediately by deleting its objects under `sites/<slug>/`; pages are served `no-cache`, so it
   is a 404 on the next request (see [runbooks](./runbooks.md#take-a-site-offline)).
2. Remove its registry entry. The pipeline unregisters the slug, and the dispatcher ignores its pushes from then on.
3. Ask the OrcaSonar team to remove its documents under `docs/<slug>/`, or delete them with admin credentials.
4. If the content must not be recoverable, also delete the previous object versions
   ([runbooks](./runbooks.md#remove-content-permanently)).
