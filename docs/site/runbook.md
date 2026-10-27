# Runbook

Operational procedures for `docs.<stage>.umccr.org`, and for releasing the toolkit and theme. The session key and the
site registry are code in this repository, so changing either is a pull request that `DocsInfrastructurePipeline`
deploys: beta, then prod after approval. Content changes are S3 operations with admin credentials for the stage
account; releases are runs of `UMCCR-DocsSitesPipeline` in the toolchain account. Deploying the platform itself is in
[Deploying](deploy.md), and how its pieces fit together in [Design](design.md).

This page is `docs/site/runbook.md` in [umccr/docs-platform](https://github.com/umccr/docs-platform), so it can be
read on GitHub when docs.umccr.org itself is down.

## First deploy of a stage

There is no key to create. The deploy generates the session key in Secrets Manager (`DocsSessionKeyV<generation>`)
and builds it into the viewer-request function.

## Set up the organisation webhook

Once, after `DocsInfrastructurePipeline` has deployed the toolchain stack. An organisation owner:

1. reads the stack outputs `WebhookUrl` and `WebhookSecretName` in the toolchain account, and the secret's value:

   ```sh
   aws cloudformation describe-stacks --stack-name DocsInfrastructurePipeline \
     --query "Stacks[0].Outputs[?starts_with(OutputKey, 'SitePublishingDispatcher')]"
   aws secretsmanager get-secret-value --secret-id docs/github-webhook-secret --query SecretString --output text
   ```

2. in the umccr organisation's settings, adds a webhook: payload URL `WebhookUrl`, content type
   `application/json`, the secret, SSL verification on, **Just the push event**, active.

GitHub sends a ping when the webhook is saved; the dispatcher answers 200. Check **Recent Deliveries** for it.

## Rotate the webhook secret

1. Generate a new value in the secret: `aws secretsmanager put-secret-value --secret-id docs/github-webhook-secret
   --secret-string "$(openssl rand -hex 24)"`.
2. Paste the same value into the organisation webhook's settings straight away.
3. The dispatcher reads the secret again when a signature does not match, at most once a minute per execution
   environment, and at least every five minutes. Deliveries signed between steps 1 and 2 fail with 401, and so may
   one or two just after; redeliver any that failed (below).

## Register a site

Registering a repository's documentation at `docs.umccr.org/<slug>/`. The site's own side is one `mkdocs.yml`; see
[Onboarding a repository](onboarding.md).

### 1. Register the site

Append a `DocsSite` to `DOCS_SITES` in [`infrastructure/sites.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/sites.ts):

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

### 2. Check GitHub access

The fetch build clones through the AWS Connector for GitHub app. If the app is installed for selected repositories
only, an organisation owner adds the site's repository in the organisation's settings (**GitHub Apps → AWS
Connector for GitHub → Configure**). Nothing else is needed: the organisation webhook already covers every
repository.

### 3. First release

The next push to the site's branch that changes its docs paths publishes it. Watch the release in the
`UMCCR-DocsSitesPipeline` execution history, where each run's variables name the site, commit and release. To publish
without waiting for a new push, redeliver the latest push that changed the site's docs paths from the webhook's
settings: the dispatcher ignored it while the site was unregistered, so it is not a duplicate (see
[Re-run or force a release](#re-run-or-force-a-release)).

## Re-run or force a release

- **Redeliver a push**: in the webhook's **Recent Deliveries**, choose the delivery and **Redeliver**. The dispatcher
  starts nothing for a delivery it has already handled; a redelivery after a failed start is handled normally,
  unless the `start-failed` log line has a `forgetError`: then start the release by hand (below).
- **Re-run a release**: in `UMCCR-DocsSitesPipeline`'s execution history, open the run and choose **Retry** on the
  failed stage. A retry keeps the run's variables, `TOOLKIT_REF` included, and a newer release that is already live
  is never overwritten; to publish older files or another toolkit, start a release by hand (below). CodePipeline
  refuses to retry a run that started before the pipeline last changed, which pipeline 1's self-update does: start
  that release by hand too.
- **Publish without a content change**: re-run the last release (above), or push a commit that changes a file
  under the site's docs paths. An empty commit changes no file, so the dispatcher ignores it (`no-docs-change`),
  and redelivering a push that already started a release starts nothing.

## Start a release by hand

For a rollback; a rebuild with another toolkit, such as moving a site to a fixed release straight away instead of at
its next push; or a release whose run cannot be retried. A publish is skipped when a newer release is live, so the
run needs a new release number, taken from the site's counter so that the dispatcher's next release is newer still.
Steps 1 to 4 run with toolchain credentials.

1. Read the variables of the release to start from (the live one, or the last good one). The site's live
   `_publish.json`, in a stage's content bucket under `sites/<slug>/`, gives its `release` and `commit`; the run is
   the one with that `RELEASE` in the pipeline's execution history:

   ```sh
   aws codepipeline list-pipeline-executions --pipeline-name UMCCR-DocsSitesPipeline --max-items 10 \
     --query 'pipelineExecutionSummaries[].[pipelineExecutionId, status, startTime]' --output table
   aws codepipeline get-pipeline-execution --pipeline-name UMCCR-DocsSitesPipeline \
     --pipeline-execution-id <execution-id> --query 'pipelineExecution.variables'
   ```

   Its files are `sources/<SLUG>/<COMMIT>.zip` in the source bucket, kept for 30 days. Check that the object is still
   there; after 30 days, push a change under the site's docs paths instead:

   ```sh
   SOURCE_BUCKET=$(aws codepipeline get-pipeline --name UMCCR-DocsSitesPipeline \
     --query 'pipeline.stages[0].actions[0].configuration.S3Bucket' --output text)
   aws s3api head-object --bucket "$SOURCE_BUCKET" --key "sources/<slug>/<commit>.zip" --query LastModified
   ```

2. Take the site's next release number:

   ```sh
   TABLE=$(aws cloudformation describe-stack-resources --stack-name DocsInfrastructurePipeline \
     --query "StackResources[?starts_with(LogicalResourceId, 'SitePublishingDispatcherDispatchTable')].PhysicalResourceId" \
     --output text)
   aws dynamodb update-item --table-name "$TABLE" --key '{"pk": {"S": "release#<slug>"}}' \
     --update-expression 'ADD #release :one' --expression-attribute-names '{"#release": "release"}' \
     --expression-attribute-values '{":one": {"N": "1"}}' --query 'Attributes.release.N' --return-values UPDATED_NEW
   ```

3. Write `start.json` with those variables, the new `RELEASE`, and `TOOLKIT_REF` changed if the rebuild needs
   another toolkit. A release tag must be on GitHub already, or the run stops at Build ("has no ref"); `/platform/`
   builds with its own commit, so its `TOOLKIT_REF` stays equal to `COMMIT`. JSON, not CLI shorthand, because `STAGES`
   holds a comma:

   ```json
   {
     "name": "UMCCR-DocsSitesPipeline",
     "variables": [
       { "name": "SLUG", "value": "<slug>" },
       { "name": "REPO", "value": "<owner>/<repo>" },
       { "name": "COMMIT", "value": "<commit>" },
       { "name": "RELEASE", "value": "<new release number>" },
       { "name": "CONFIG_PATH", "value": "<config path>" },
       { "name": "TOOLKIT_REF", "value": "<toolkit ref>" },
       { "name": "STAGES", "value": "beta,prod" }
     ],
     "sourceRevisions": [
       { "actionName": "Source", "revisionType": "S3_OBJECT_KEY", "revisionValue": "sources/<slug>/<commit>.zip" }
     ]
   }
   ```

4. Start it: `aws codepipeline start-pipeline-execution --cli-input-json file://start.json`. Delete `start.json`
   afterwards, so it is not committed by mistake.

5. Check: the run builds, then publishes to dev and prod, in a few minutes. Afterwards each stage's
   `sites/<slug>/_publish.json` shows the new `release`. Read it with that stage's credentials:

   ```sh
   DOCS_BUCKET=$(aws ssm get-parameter --name /docs/content-bucket-name --query Parameter.Value --output text)
   aws s3 cp "s3://$DOCS_BUCKET/sites/<slug>/_publish.json" -
   ```

## A release failed

The pipeline posts failed runs to the alerts Slack channel. Each run's variables name the site, commit and release.

- **Build failed**: the site's content broke the contract or the strict build. The build log has the same report
  `umccr-docs build` gives locally; the site's owners fix it and push. The live site is unchanged.
- **Publish failed**: usually permissions or a missing parameter. `/docs/content-bucket-name` missing means the
  stage's hosting stack is not deployed. A missing `/orcasonar/ingest-bucket-name` is only a warning: OrcaSonar is
  not deployed in that stage yet, and pages still publish.
- **No run at all**: check the webhook's **Recent Deliveries** and the dispatcher's log group. Its log lines say why
  a push was ignored: `bad-signature`, `not-registered`, `no-docs-change` or `duplicate`.

## Rotate the session key

Routinely, for example every 90 days, or whenever anyone may have seen the key:

1. In [`infrastructure/config.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/config.ts), increase the stage's `DOCS_SESSION_KEY_GENERATION`.
2. Merge, and let the pipeline deploy it; for prod, approve **PromoteToProd**.

The deploy creates a new secret with a new generated value, builds it into the viewer-request function, points the
session Lambda at it and deletes the old secret. Every existing cookie stops working: on their next page load,
readers pass through "Checking sign-in…" and carry on without a prompt, for as long as their Cognito session lasts.

For a few minutes after the deploy, while the new function reaches every edge location, some readers may see "Sign-in
is temporarily unavailable". The session Lambda refuses to sign with a key the forwarding edge location does not
hold yet, and logs `key-mismatch`; `DocsSessionUnavailableAlarm` may fire. Both clear on their own.

**Never change the secret's value in Secrets Manager.** The edge function keeps the value it was deployed with, so
every sign-in would fail with `key-mismatch` until the key is rotated as above.

## Cut off one reader

1. In the `data-portal-<stage>` Cognito pool, disable the user and end their Cognito sessions:

   ```sh
   aws cognito-idp admin-disable-user --user-pool-id <pool-id> --username <username>
   aws cognito-idp admin-user-global-sign-out --user-pool-id <pool-id> --username <username>
   ```

   They cannot renew, so their access ends when their current docs cookie expires, within 8 hours.

2. To end it now, rotate the session key (above). Everyone else renews without noticing; the disabled reader is
   sent to sign in, and cannot.

The session Lambda logs each reader's Cognito `sub` (never the email), which identifies them in the pool.

## Sign everyone out

For a suspected key compromise, or to send every reader back through sign-in: rotate the session key. Readers with
a live Cognito session are signed back in without a prompt; the old cookies are useless.

## Take a site offline

For example, if sensitive content was published by mistake. Pages are served `no-cache`, so deleting the objects
takes effect on the next request:

```sh
aws s3 rm s3://<DocsBucketName>/sites/<slug>/ --recursive   # the site is a 404 from now on
```

The bucket is versioned, so this can be undone (below). Then either:

- **keep it offline**: remove the site's entry in [`sites.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/sites.ts) and merge, so the slug
  is unregistered and the dispatcher ignores its pushes; or
- **bring it back**: fix the content in the site's repository and publish, or restore previous versions.

## Roll back a site

- **Usual path**: revert the change in the site repository and push; the next release republishes.
- **Faster**: [start a release by hand](#start-a-release-by-hand) from the last good release's source object and
  variables, with a new `RELEASE` number from the site's counter. Re-running the last good release itself is
  skipped, because the newer release is live.
- **From the bucket**: the content bucket is versioned and keeps previous versions for 30 days. Restore an
  object by copying a previous version over the current one:

  ```sh
  aws s3api list-object-versions --bucket <DocsBucketName> --prefix sites/<slug>/<path>
  aws s3api copy-object --bucket <DocsBucketName> --key sites/<slug>/<path> \
    --copy-source "<DocsBucketName>/sites/<slug>/<path>?versionId=<version>"
  ```

  Undelete an object by deleting its delete marker (`aws s3api delete-object --version-id <marker-id>`).

## Remove content permanently

Delete the objects and their previous versions under `sites/<slug>/`, and ask the OrcaSonar team to do the same for
`docs/<slug>/` in its ingest bucket, so the chat stops quoting the content:

```sh
aws s3api list-object-versions --bucket <DocsBucketName> --prefix sites/<slug>/ \
  --query '{Objects: [Versions, DeleteMarkers][][].{Key: Key, VersionId: VersionId}}' --output json > /tmp/v.json
aws s3api delete-objects --bucket <DocsBucketName> --delete file:///tmp/v.json
```

Every file without a fingerprint in its name is published `no-cache`, so CloudFront revalidates it on every
request and a deleted page stops being served immediately. Only fingerprinted theme assets are cached long-term,
and they hold no content.

## Remove a site

1. Take it offline immediately by deleting its objects under `sites/<slug>/`; pages are served `no-cache`, so it
   is a 404 on the next request (see [Take a site offline](#take-a-site-offline)).
2. Remove its registry entry. The pipeline unregisters the slug, and the dispatcher ignores its pushes from then on.
3. Ask the OrcaSonar team to remove its documents under `docs/<slug>/`, or delete them with admin credentials.
4. If the content must not be recoverable, also delete the previous object versions
   ([Remove content permanently](#remove-content-permanently)).

## Sign-in fails for everyone

1. Check the session Lambda's log group (`DocsSessionLogGroup`) for the outcome:
   - `key-mismatch`: the Lambda's key differs from the one the edge function was deployed with. Expected for a few
     minutes after a rotation. If it persists, the secret's value was changed by hand: rotate the key, which
     deploys one new value to both sides.
   - `unavailable`: the Lambda could not read the secret; the log line carries the error. If the secret was deleted
     outside CloudFormation, rotate the key to create a new one.
   - `invalid-token`: the ID token was rejected. Check that `/_auth/env.js` has the stage's docs client ID and pool.
2. `redirect_mismatch` on the Cognito page means the host's `/_auth/` URL is missing from `cognito_aai/app_docs.tf`
   for that workspace.
3. The alarms `DocsSessionUnavailableAlarm` (sign-ins refused as unavailable), `DocsSessionErrorsAlarm` and
   `DocsSessionThrottlesAlarm` track the session Lambda.

## Release the toolkit and theme

The site registry pins the toolkit, theme and engine version each site builds with: `toolkitRef` in
[`infrastructure/sites.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/sites.ts). A release of this repository therefore changes no site
until its registry entry moves to it, so sites move deliberately, one at a time or together. The platform's own site,
`/platform/`, builds with the toolkit at the pushed commit, so a theme or toolkit change shows there first.

Infrastructure changes are separate: a merge to `main` under `bin/`, `infrastructure/` or `app/` starts the
infrastructure pipeline, which deploys to beta and then waits for approval before prod.

1. Make sure `main` is green, and that the platform site on docs.dev.umccr.org and the example builds look right.
   CI's site builds install the toolkit from its wheel, as the site pipeline does. `make install` installs it
   editable, which reads the theme from the source tree, so a local build cannot show a file the package leaves out
   ([2026-10-21](../issues/2026-10-21-theme-script-missing-from-wheel.md)).
2. Update the [changelog](changelog.md) and the toolkit's version (`toolkit/pyproject.toml`,
   `toolkit/src/umccr_docs/__init__.py`), and merge.
3. Tag the merge commit and push the tag:

   ```sh
   git tag -s v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

   `-s` signs the tag; without a signing key, `-a` makes an annotated tag instead.

4. Move sites to the new tag: change their `toolkitRef` in the registry (`DOCS_TOOLKIT_REF` for every site that uses
   the default) and merge. The infrastructure pipeline updates the dispatcher; each site builds with the new version
   on its next push.
5. Rebuild the sites that should not wait for their next push, such as after a fix: start a release by hand for
   each, with `TOOLKIT_REF` set to the tag ([Start a release by hand](#start-a-release-by-hand)). A merge that
   changes the toolkit's package already starts a `/platform/` release built with that commit. Then check each site
   in dev and prod.

Steps 2 and 4 can be one merge, as for `v0.1.0` and `v0.1.1`: then tag that merge straight away, since the sites'
releases stop at Build ("has no ref") until the tag exists. Re-run any that stopped once it does.

### Versioning

- Releases are semantic versions, `vMAJOR.MINOR.PATCH`. The toolkit's package version (`toolkit/pyproject.toml` and
  `umccr_docs.__version__`) is the same as the tag.
- Until `v1.0.0` the platform is in initial development, `0.y.z`: the authoring contract and the engine
  ([ADR-0003](../design/adr/0003-build-engine.md)) can still change. A change that could break an existing site,
  such as a contract rule, a removed extension or an engine change, takes the next minor version (`v0.2.0`) and a
  migration note; fixes and compatible additions take the next patch (`v0.1.1`).
- `v1.0.0` comes once the engine is decided, the first users' feedback is in, and a team outside the platform team
  depends on the contract with a site of its own. From then on, a breaking change needs a new major version.
- A registry `toolkitRef` is a release tag or a full commit SHA, never a branch; the registry refuses anything else.

### Repository settings

Review on `main` is the only gate before prod for the toolkit, the theme and `/platform/`: the site pipeline
publishes `/platform/` from each merge with no approval, and the other sites build with tags cut from `main`. An
organisation owner sets these under **Settings → Rules → Rulesets**:

- **`main`**: require a pull request with one approval, and the `ci` checks to pass ("Toolkit tests and lint",
  "Strict builds of the examples and the platform site", "CDK app tests, lint and synth", "Workflows, secrets and
  information boundary"); block force pushes and deletion.
- **`v*` tags**: only the platform owners may create them, and nobody may update or delete one: a moved tag would
  change how sites build without a registry change.
- **Code owners**, later: once the owners' team is named in [`.github/CODEOWNERS`](https://github.com/umccr/docs-platform/blob/main/.github/CODEOWNERS), which
  holds a placeholder for now, require their review on `main` too.

### Roll back a release

Point the affected sites' `toolkitRef` back at the previous tag and merge. Once the infrastructure pipeline has
updated the dispatcher, each site builds with that tag on its next push under its docs paths.

To rebuild a site straight away, [start a release by hand](#start-a-release-by-hand) from its live release's source
object, with `TOOLKIT_REF` set to the previous tag. Re-running an existing release does not do this: it keeps the
`TOOLKIT_REF` it started with, and is skipped when a newer release is live.

### Update pinned dependencies

- Engine and toolkit runtime: edit `toolkit/requirements/build.in` and regenerate `toolkit/requirements/build.txt`
  with the command at the top of the file. The hashes change with it.
- CDK app: `pnpm update`, then `pnpm test` and a template diff before merging.
- Actions: every third-party action is pinned to a full commit SHA with its version in a comment. Update both.
- The build engine decision and the MkDocs 1.x pin are recorded in
  [ADR-0003](../design/adr/0003-build-engine.md).
