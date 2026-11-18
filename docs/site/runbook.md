# Runbook

Operational procedures for `docs.<stage>.umccr.org`, and for moving sites to a release of the toolkit and theme. The
session key and the site registry are code in this repository, so changing either is a pull request that
`DocsInfrastructurePipeline` deploys: beta, then prod after approval. Content changes are S3 operations with admin
credentials for the stage account; releases are runs of `UMCCR-DocsSitesPipeline` in the toolchain account.
Deploying the platform itself is in [Deploying](deploy.md), and how its pieces fit together in [Design](design.md).

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
  title: 'Example',
  description: 'One line for the catalogue.',
};
```

Only `slug`, `repo` and `title` are required. A field left out takes its default, so set one only where the site
differs from the templates' layout:

| Field | Default |
| --- | --- |
| `description` | none |
| `branch` | `main`: pushes to it publish the site |
| `configPath` | `mkdocs.yml` |
| `docsPaths` | `docs/**` and the configuration file, in the configuration's folder: a push that changes none of them publishes nothing |
| `toolkitRef` | `DOCS_TOOLKIT_REF`, `latest`: the toolkit's latest release when each release of the site starts. A docs-toolkit release tag or full commit SHA pins the site to it; never a branch |
| `stages` | beta (dev), then prod: the platform's two stages |

- **Slug**: lowercase letters, digits and inner hyphens, at most 49 characters. It must not reveal a confidential
  project or repository name. `sites` is reserved.
- **Docs paths**: globs relative to the repository root. Set them when the pages are not in `docs/`, as for an
  Obsidian vault, and keep them tight in code repositories, so code-only pushes don't rebuild the site.
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

A release started with another `TOOLKIT_REF` lasts only until the site's next push, which builds with the registry's
`toolkitRef`: for most sites, the toolkit's latest release. To keep a site on another release,
[pin it](#pin-a-site-to-a-release) first, and wait for the infrastructure pipeline to update the dispatcher;
otherwise the next push moves it back, as happened to `/management-knowledgebase/` with `v0.2.1`.

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

2. Take the site's next release number. A number taken but never used is fine, as release numbers only need to
   rise:

   ```sh
   TABLE=$(aws cloudformation describe-stack-resources --stack-name DocsInfrastructurePipeline \
     --query "StackResources[?starts_with(LogicalResourceId, 'SitePublishingDispatcherDispatchTable')].PhysicalResourceId" \
     --output text)
   aws dynamodb update-item --table-name "$TABLE" --key '{"pk": {"S": "release#<slug>"}}' \
     --update-expression 'ADD #release :one' --expression-attribute-names '{"#release": "release"}' \
     --expression-attribute-values '{":one": {"N": "1"}}' --query 'Attributes.release.N' --return-values UPDATED_NEW
   ```

3. Write `start.json` with those variables, the new `RELEASE`, and `TOOLKIT_REF` changed if the rebuild needs
   another toolkit. `TOOLKIT_REF` is a tag or full commit of umccr/docs-toolkit, which must be on GitHub already, or
   the run stops at Build ("has no ref"). It is never `latest`, which only the fetch build resolves: the run would
   stop at Build ("is not a docs-toolkit release tag or full commit"). The latest release's tag ends the link
   [step 1 of After a toolkit release](#after-a-toolkit-release) prints. JSON, not CLI shorthand, because `STAGES`
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

## Toolkit releases

The toolkit, theme and engine the sites build with are released in
[umccr/docs-toolkit](https://github.com/umccr/docs-toolkit): a tag, and the immutable GitHub release its release
workflow makes ([its release steps](https://github.com/umccr/docs-toolkit/blob/main/CONTRIBUTING.md#release)). Each
site builds with its `toolkitRef` in
[`infrastructure/sites.ts`](https://github.com/umccr/docs-platform/blob/main/infrastructure/sites.ts): for every site
that pins no release of its own, `/platform/` included, that is `DOCS_TOOLKIT_REF`, `latest`
([ADR-0011](../design/adr/0011-latest-toolkit-release.md)).

- **`latest`**: when a release of the site starts, the fetch build asks GitHub for the toolkit's latest release and
  starts the site pipeline with its tag. A toolkit release reaches the site at its next push under its docs paths,
  with no change here. Drafts and pre-releases are never latest, and a patch to an older line is not latest while a
  higher version is released.
- **A release tag or a full commit**: the site stays on it until its entry changes
  ([Pin a site to a release](#pin-a-site-to-a-release)).

Infrastructure changes are separate: a merge to `main` under `bin/`, `infrastructure/` or `app/` starts the
infrastructure pipeline, which deploys to beta and then waits for approval before prod.

The commands run with toolchain credentials (`bastion-admin`) unless a step says otherwise.

### After a toolkit release

1. Check that it is the latest release. Its GitHub page says **Latest**, and this prints a link ending in its tag:

   ```sh
   curl -fsS -o /dev/null -w '%{redirect_url}\n' https://github.com/umccr/docs-toolkit/releases/latest
   ```

2. Nothing merges here. CI's next run builds `/platform/` with the release, and "Strict build of the platform site"
   names it in its summary. A red build there is the first sign that the release cannot build a site.
3. Each site that follows `latest` builds with it at its next push under its docs paths. The run's `TOOLKIT_REF` is
   the tag, and its Build log prints `umccr-docs <version>`.
4. [Rebuild the sites that should not wait](#rebuild-the-sites-that-should-not-wait), and [check](#check) them.

### Rebuild the sites that should not wait

[Start a release by hand](#start-a-release-by-hand) for each, from its live release's source object, with
`TOOLKIT_REF` set to the tag: never `latest`, which the site pipeline refuses. The pipeline's history has every
site's live release, so toolchain credentials are enough to find it. This lists the recent successful runs, newest
first, one per line: commit, release, slug and toolkit.

```sh
for id in $(aws codepipeline list-pipeline-executions --pipeline-name UMCCR-DocsSitesPipeline --max-items 20 \
    --query 'pipelineExecutionSummaries[?status==`Succeeded`].pipelineExecutionId' --output text); do
  aws codepipeline get-pipeline-execution --pipeline-name UMCCR-DocsSitesPipeline --pipeline-execution-id "$id" \
    --query 'pipelineExecution.variables[?contains([`SLUG`, `COMMIT`, `RELEASE`, `TOOLKIT_REF`], name)].resolvedValue' \
    --output text
done
```

For `/management-knowledgebase/` on `v0.2.0`, the variables were:

```json
{
  "name": "UMCCR-DocsSitesPipeline",
  "variables": [
    { "name": "SLUG", "value": "management-knowledgebase" },
    { "name": "REPO", "value": "umccr/management-knowledgebase" },
    { "name": "COMMIT", "value": "<the live release's commit>" },
    { "name": "RELEASE", "value": "<the next number, from step 2 of starting a release by hand>" },
    { "name": "CONFIG_PATH", "value": "mkdocs.yml" },
    { "name": "TOOLKIT_REF", "value": "v0.2.0" },
    { "name": "STAGES", "value": "beta,prod" }
  ],
  "sourceRevisions": [
    {
      "actionName": "Source",
      "revisionType": "S3_OBJECT_KEY",
      "revisionValue": "sources/management-knowledgebase/<the live release's commit>.zip"
    }
  ]
}
```

Replace every `<…>` before starting: a placeholder left in fails at Source, publishing nothing. To check a site in dev
before prod, start it with `STAGES` `beta` first: its prod step logs `<slug> does not publish to prod` and stops. Then
take another release number and start it with `beta,prod`.

### Check

In dev, then prod, for each site on the new release: the release's changes, as its notes in umccr/docs-toolkit list
them, and the pages, navigation, search and chat panel as before; in a vault, the properties and the Bases tables too.
Each stage's `sites/<slug>/_publish.json` shows the new release; read it with that stage's credentials
([Start a release by hand](#start-a-release-by-hand), step 5).

### Pin a site to a release

Pin a site that must not move yet, such as one that needs changes before a breaking release, or one that tries a
pre-release (`v0.4.0-rc.1`) before the others. On a branch off `main`, set the site's `toolkitRef` in
`infrastructure/sites.ts` to the tag, and add a changelog entry saying why. For `/platform/`, change
`test/sites.test.ts` too. CI builds `/platform/` with `DOCS_TOOLKIT_REF`, so a pin on `/platform/` alone shows only
in its releases.

The merge starts `UMCCR-DocsInfrastructure` (pipeline 1), whose self-update gives the dispatcher the pinned route;
then it deploys beta and waits at `PromoteToProd`, with no change in either stage. Approve once beta has deployed.
Until the self-update is done, the site's pushes build with the latest release.

```sh
aws codepipeline get-pipeline-state --name UMCCR-DocsInfrastructure \
  --query 'stageStates[].[stageName, latestExecution.status]' --output table
```

To follow releases again, remove the site's `toolkitRef`, the same way.

### A merge that changes `/platform/`'s own registry entry

The dispatcher learns a changed registry entry only from pipeline 1's self-update, so the merge's own `/platform/`
release still uses the old one. When the merge moves the site's `configPath` or docs paths, as the layout change did on
2026-10-28, or its toolkit, as the move to umccr/docs-toolkit did, that release fails at Build and the live site stays
as it was. Once the self-update is done:

1. Read the failed run's variables ([Start a release by hand](#start-a-release-by-hand), step 1). It has the merge
   commit, and its source object is already in the source bucket.
2. Start a release by hand with those variables, a new release number, the new `CONFIG_PATH`, `COMMIT` the merge
   commit, and `TOOLKIT_REF` the release the site's entry names: for `latest`, the latest release's tag
   ([After a toolkit release](#after-a-toolkit-release), step 1).

Retrying the failed run does not work: the self-update changed the pipeline, and a retry keeps the old variables.

### Versioning

- Toolkit releases are semantic versions, `vMAJOR.MINOR.PATCH`; umccr/docs-toolkit's
  [versioning](https://github.com/umccr/docs-toolkit/blob/main/CONTRIBUTING.md#versioning) says which change takes
  which, and when `v1.0.0` comes. Until then a minor version may need sites to change, and it reaches every site that
  follows `latest` like any other release.
- A registry `toolkitRef` is `latest`, or a release tag or a full commit SHA of umccr/docs-toolkit; never a branch.
  The registry refuses anything else. A run's `TOOLKIT_REF` is always a tag or a commit: the fetch build resolves
  `latest`, and the site pipeline refuses a run started with anything else.
- This repository's tags, `v0.1.0` to `v0.3.1`, are the toolkit releases from before it moved
  ([ADR-0010](../design/adr/0010-toolkit-repository.md)), and stay as they were.

### Repository settings

Review on `main` is the only gate before prod for `/platform/` and for the registry: the site pipeline publishes
`/platform/` from each merge with no approval, and a merge that changes a `toolkitRef` changes the toolkit a site
builds with. A toolkit release reaches the sites with no merge here, so umccr/docs-toolkit's
[settings](https://github.com/umccr/docs-toolkit/blob/main/CONTRIBUTING.md#repository-settings) guard the sites as
much as these. An organisation owner sets these under **Settings → Rules → Rulesets**:

- **`main`**: require a pull request with one approval, and the `ci` checks to pass ("Strict build of the platform
  site", "CDK app tests, lint and synth", "Workflows and secrets"); block force pushes and deletion.
- **`v*` tags**: only the platform owners may create them, and nobody may update or delete one. New toolkit releases
  are tagged in umccr/docs-toolkit; the tags here are the releases from before it moved.

### Roll back a toolkit release

A release that cannot build a site stops that site's releases at Build, and the live site stays as it was. For a
release that builds but publishes something wrong:

- **Every site at once**: on the previous release's page in umccr/docs-toolkit, choose **Edit**, tick **Set as the
  latest release**, and save; immutable releases allow it. Sites that follow `latest` build with it again from their
  next push, with nothing deployed here. The next release made there becomes latest if no released version is higher.
- **One site**: [pin it](#pin-a-site-to-a-release) to the previous tag.

To rebuild a site straight away, [start a release by hand](#start-a-release-by-hand) from its live release's source
object, with `TOOLKIT_REF` set to the previous tag. Re-running an existing release does not do this: it keeps the
`TOOLKIT_REF` it started with, and is skipped when a newer release is live. Then fix the cause in umccr/docs-toolkit
and release the next patch.

### Update pinned dependencies

- CDK app: `pnpm update`, then `pnpm test` and a template diff before merging.
- The checks: `pre-commit autoupdate --freeze` pins every hook to its newest release's commit, with the version in a
  comment (`--repo <url>` for one hook); then `make check`. pre-commit itself is pinned in `.github/workflows/ci.yml`.
- Actions: every third-party action is pinned to a full commit SHA with its version in a comment. Update both.
- The engine, the toolkit's own dependencies and the theme's copy of Mermaid are pinned in umccr/docs-toolkit
  ([its steps](https://github.com/umccr/docs-toolkit/blob/main/CONTRIBUTING.md#update-pinned-dependencies)), and
  reach the sites with a release. The build engine decision and the MkDocs 1.x pin are recorded in
  [ADR-0003](../design/adr/0003-build-engine.md).
