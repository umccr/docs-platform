# Tech stack and conventions

How docs.umccr.org is built, how this repository is laid out, and the conventions for changing it, for anyone working
in it, a person or a coding agent. What the platform is for and where it stands is in [Project](project.md); how it
fits together, in [Design](design.md).

## The stack

| Part | What |
| --- | --- |
| Infrastructure | AWS CDK in TypeScript: `aws-cdk-lib` `^2.269.0`, the `aws-cdk` CLI `^2.1141.0` and `constructs` `^10.8.0` |
| Shared constructs | `@orcabus/platform-cdk-constructs` `^1.9.8`: UMCCR's accounts and the SSM names of shared resources, so no account ID is written here |
| Infrastructure checks | `cdk-nag` `^3.0.2`: the AwsSolutions pack, as a CDK validation plugin in the tests |
| Language | TypeScript `~5.9.3`, strict |
| Runtimes | Node.js 22 or later for the CDK app and CI (`.nvmrc`); Node.js 24 on arm64 for the Lambdas; `cloudfront-js-2.0` for the edge function |
| Package manager | pnpm `10.34.5` through Corepack |
| Sign-in page | Amplify `^6.22.1`, bundled by esbuild `^0.28.2` when the app is synthesized |
| Lambdas | the session Lambda checks tokens with `aws-jwt-verify` `^5.2.1`; the dispatcher matches docs paths with `minimatch` `^11.0.4`. AWS SDK v3: `client-secrets-manager` in both, `client-dynamodb` and `client-codebuild` in the dispatcher |
| Toolkit and theme | `umccr-docs` from [umccr/docs-toolkit](https://github.com/umccr/docs-toolkit), at the release `DOCS_TOOLKIT_REF` names: Python 3.12, Material for MkDocs on MkDocs 1.6, and the theme's copy of Mermaid. Its [CONTRIBUTING.md](https://github.com/umccr/docs-toolkit/blob/main/CONTRIBUTING.md) lists their versions |
| Tests | jest `^30.5.1` with ts-jest for the CDK app and the code it deploys |
| Lint and format | ESLint `^10.14.0` with typescript-eslint and Prettier `^3.9.6` for the CDK app |
| Repository checks | pre-commit; detect-secrets `1.5.0`; actionlint and zizmor `1.30.1` for the workflows; `scripts/check-boundary.sh` |

The CDK app's versions are the ranges in `package.json`, and `pnpm-lock.yaml` pins what is installed. The
repository's own Python tools are pinned with hashes in `requirements/dev.txt`, and the toolkit's dependencies in
its own repository. Everything runs in ap-southeast-2, except the docs certificate, which CloudFront needs in
us-east-1.

## Layout

```text
docs-platform/
├── bin/deploy.ts              # the CDK app: the DocsInfrastructurePipeline toolchain stack
├── infrastructure/            # stacks and constructs
│   ├── sites.ts               # the site registry
│   ├── config.ts              # per-stage settings: hosts, the session key's generation, OrcaSonar's API
│   ├── stage/                 # DocsHostingStack: bucket, CloudFront, edge function, session Lambda, publisher role
│   └── toolchain/             # pipeline 1, the dispatcher, the fetch build and the site pipeline
├── app/                       # the code those stacks deploy
│   ├── auth-web/              # the /_auth/ sign-in page (Amplify), and token.js for the chat panel
│   ├── session/               # the session Lambda
│   ├── edge/                  # the viewer-request CloudFront Function
│   ├── dispatcher/            # the webhook dispatcher Lambda
│   └── static/                # public files: the 404 page, robots.txt, favicon
├── test/                      # jest tests for all of the above, with cdk-nag
├── docs/
│   ├── site/                  # this site, /platform/, published by the site pipeline
│   ├── design/                # design pages exported from the design documents, and the design records (adr/)
│   ├── plans/                 # the proposal and the implementation plan
│   └── issues/                # write-ups of problems found and how they were resolved
├── mkdocs.yml                 # this site's configuration
├── requirements/dev.txt       # hash-pinned versions of the repository's own tools, from dev.in
├── scripts/check-boundary.sh  # the public-repository information-boundary check
└── Makefile                   # every command below
```

The toolkit and theme, `umccr-docs`, are in [umccr/docs-toolkit](https://github.com/umccr/docs-toolkit): the
package, its tests and examples, and the `mkdocs.yml` templates sites start from
([ADR-0010](../design/adr/0010-toolkit-repository.md)).

## Commands

Node.js 22 or later with pnpm through Corepack, Python 3.12, and [pre-commit](https://pre-commit.com). Run
`corepack enable` once.

| Command | Does |
| --- | --- |
| `make install` | pnpm packages; `.venv` with the dev tools and the toolkit at `DOCS_TOOLKIT_REF`; the pre-commit git hook |
| `make check` | dependency audit, formatting, lint, the workflows, and the pre-commit hooks on every tracked file |
| `make test` | jest with cdk-nag |
| `make sites` | the strict build and pre-publish checks of this site into `build/sites/platform`, as CI runs them |
| `make serve` | this site on `http://127.0.0.1:8000`, rebuilt as its pages change |
| `make toolkit` | the toolkit at `DOCS_TOOLKIT_REF`, from umccr/docs-toolkit as the site pipeline installs it, again after it moves; `TOOLKIT_REF=` another release tag or full commit |
| `make synth` | the CDK app |
| `make fix` | formatting and lint fixes |
| `make audit-fix` | overrides that force patched dependency versions |
| `make clean` | build output; the virtualenv and `node_modules` stay |

To run a toolkit command yourself, use `.venv/bin/umccr-docs`, or `source .venv/bin/activate` first.

## Tests and CI

- **jest** (`test/`): synthesizes the stacks with cdk-nag's AwsSolutions checks; runs the generated viewer-request
  function in a harness against cookies the session Lambda's code minted; and covers the session Lambda and its
  signing key, the dispatcher, the sign-in page, the site registry, and pipeline 1's trigger paths.
- **CI** (`.github/workflows/ci.yml`), on every pull request and every push to `main`: "Strict build of the platform
  site", with the toolkit at `DOCS_TOOLKIT_REF`; "CDK app tests, lint and synth"; and "Workflows, secrets and
  information boundary". `main`'s ruleset should require all three
  ([Repository settings](runbook.md#repository-settings)).
- **Pipeline 1** runs the jest tests again before it synthesizes.
- **The toolkit's tests**, its theme script's among them, and the strict builds of its examples run in
  umccr/docs-toolkit's CI.

## Conventions

- **This repository is public.** It holds generic platform code and documentation only. Account IDs reach the CDK app
  only through `@orcabus/platform-cdk-constructs`, and the site pipeline reads bucket names from SSM at run time, so
  neither is written here. `scripts/check-boundary.sh` and detect-secrets enforce part of this, in CI and in the
  pre-commit hook; reviewers enforce the rest ([SECURITY.md](../../SECURITY.md)).
- **Everything is pinned.** The repository's Python tools by hash (`requirements/dev.txt`, regenerated with
  `uv pip compile` from `dev.in`), npm packages by `pnpm-lock.yaml`, every third-party action by full commit SHA with
  its version in a comment, and each site's toolkit by a release tag or commit of umccr/docs-toolkit, never a branch.
- **Changes reach `main` through pull requests.** Review there is the only gate before prod for `/platform/`, which
  publishes from each merge with no approval, and for the registry, which moves sites to a toolkit release. The
  toolkit's own changes are reviewed in umccr/docs-toolkit.
- **Nothing is named for OrcaBus.** The pipelines and the hosting stack are `UMCCR-Docs…`, tagged
  `umccr-org:Product: Docs`, though the repository follows the OrcaBus service layout.
- **The platform's pages are in `docs/site/`**, and publish with the merge that changes them. A link from them to a
  file outside `docs/site/` becomes a link to that file on GitHub. A decision gets a
  [design record](../design/adr/README.md); a problem that needs a lasting record, a [write-up](../issues/README.md).
- **Toolkit releases** are semantic versions, `0.y.z` until the contract and the engine settle, tagged in
  umccr/docs-toolkit with a changelog entry and a GitHub release
  ([its release steps](https://github.com/umccr/docs-toolkit/blob/main/CONTRIBUTING.md#release)). The registry then
  moves sites to one: [Move sites to a toolkit release](runbook.md#move-sites-to-a-toolkit-release).

## Change these together

| When you change | Also change |
| --- | --- |
| a site's entry in `infrastructure/sites.ts` | nothing else here: the dispatcher's routes, the edge function's slug table and the catalogue all derive from it. The site's `mkdocs.yml` needs `site_url` `https://docs.umccr.org/<slug>/`. For `/platform/`, `test/sites.test.ts` too |
| `DOCS_TOOLKIT_REF` | release its tag in umccr/docs-toolkit first: until the tag exists, every site's releases stop at Build, and CI cannot build `/platform/`. Keep its line as it is: the Makefile reads it, and `test/sites.test.ts` checks it |
| `DOCS_DOMAIN_NAMES` | the Cognito callback URLs (`umccr/infrastructure` `cognito_aai/app_docs.tf`) and the certificate (`umccr_docs_domain`) |
| `SONAR_API_URLS` | OrcaSonar's hosts: the content pages' Content Security Policy and `/_auth/env.js` take their values from it |
| OrcaSonar's stateful stack or ingest bucket name | `ORCASONAR_INGEST_BUCKET_NAME_PREFIX` in `infrastructure/config.ts` |
| where umccr/docs-toolkit keeps its engine pins | `INSTALL_TOOLKIT` in `infrastructure/toolchain/sites-pipeline.ts`, which must still install every ref a site or a rollback may name, and the Makefile's `toolkit` target |
| pipeline 1's trigger paths | the literal lists in `test/pipeline-stack.test.ts`; CodePipeline takes at most 8 patterns in each |
| the session key | `DOCS_SESSION_KEY_GENERATION` in `infrastructure/config.ts`, never the secret's value ([Rotate the session key](runbook.md#rotate-the-session-key)) |

## Deliberate, though it can look wrong

- **The session key is in the edge function's code.** CloudFront KeyValueStore's data API is not permitted in UMCCR's
  accounts, so the key reaches the function at deploy time. Anyone in the stage account who can read the function can
  read the key; they can generally read the content bucket too ([Design](design.md#sign-in)).
- **The dispatcher's function URL is public.** The organisation webhook has to reach it, and it checks the signature
  before it parses anything. [ADR-0009](../design/adr/0009-dispatch-from-github-actions.md) proposes replacing it, and
  is deferred.
- **No approval before prod for site releases.** Documentation changes no data and no running system, and a failure in
  dev stops the release before prod.
- **`/platform/` waits for the registry, like every site.** It builds with `DOCS_TOOLKIT_REF`, so a toolkit change
  shows there only once the registry moves to its release; a release candidate can go to it first.
- **Pipeline 1 ignores Markdown, even under `app/`.** A README beside the code deploys nothing.
- **The toolkit builds untracked files.** A local preview shows a page before it is committed, so a hand publish
  builds from a clean export of the commit ([Publishing by hand](deploy.md#publishing-by-hand)).
