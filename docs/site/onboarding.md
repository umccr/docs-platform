# Onboarding a repository

Publishing a repository's documentation at `https://docs.umccr.org/<slug>/`. Your repository gets a configuration
file and nothing else: no workflow, GitHub environment or secret.

## 1. Choose a slug

The slug is the site's path. It is permanent, so choose it with care:

- lowercase letters, digits and inner hyphens, at most 49 characters;
- not a confidential project or repository name: the registry is public;
- `platform` and `sites` are taken.

## 2. Add the configuration

Copy a template from the toolkit's
[`templates/`](https://github.com/umccr/docs-toolkit/tree/main/templates) into your repository:
`mkdocs.yml` at the repository root, from `mkdocs.yml`, or `mkdocs-obsidian.yml` for an Obsidian vault. Set
`site_name`, `site_url` (`https://docs.umccr.org/<slug>/`), `repo_url` and `docs_dir`.

Preview locally the way the site pipeline builds, with the release your site will build with: the toolkit's
[latest release](https://github.com/umccr/docs-toolkit/releases/latest), unless your registry entry pins another.

```sh
git clone --branch <release> https://github.com/umccr/docs-toolkit.git <docs-toolkit>
python3.12 -m venv <docs-toolkit>/.venv && source <docs-toolkit>/.venv/bin/activate
pip install --require-hashes --no-deps -r <docs-toolkit>/requirements/build.txt
pip install --no-deps <docs-toolkit>
umccr-docs serve
```

Fix anything `umccr-docs check` and the strict build report; see [Authoring](authoring.md).

## 3. Register the site

Ask the platform team, or open a pull request against
[`infrastructure/sites.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/sites.ts) in this
repository. The entry needs three fields; the rest have defaults that suit a repository laid out like the templates:

| Field | Default | Meaning |
| --- | --- | --- |
| `slug` | required, such as `my-service` | the site's path |
| `repo` | required, such as `umccr/my-service` | the repository that holds the site |
| `title` | required | the site's name in the catalogue |
| `description` | none | one line for the catalogue |
| `branch` | `main` | pushes to this branch publish the site |
| `configPath` | `mkdocs.yml` | where your configuration is |
| `docsPaths` | `docs/**` and `mkdocs.yml`, beside your configuration | a push that changes none of these publishes nothing |
| `toolkitRef` | `latest` | the release of the toolkit and theme your site builds with: umccr/docs-toolkit's latest when each release of your site starts, or a release tag that pins it |
| `stages` | dev, then prod | where it is published |

When the pull request merges, the infrastructure pipeline adds your site to the routing table, the catalogue and
the dispatcher. If the organisation's AWS Connector for GitHub app is limited to selected repositories, an
organisation owner also adds yours to it.

## 4. Push

The next push to your branch that changes your docs paths publishes the site: first to docs.dev.umccr.org, then to
docs.umccr.org, usually within minutes. It appears in the [catalogue](index.md) and becomes searchable in the chat
panel shortly after.

If the build fails, the platform team is notified with the pipeline's report; the site stays as it was.
