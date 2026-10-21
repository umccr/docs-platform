# Docs runbooks

Operational procedures for `docs.<stage>.umccr.org`. The session key and the site registry are code in this
repository, so changing either is a pull request that `DocsInfrastructurePipeline` deploys: beta, then prod after
approval. Content changes are S3 operations with admin credentials for the stage account; releases are runs of
`UMCCR-DocsSitesPipeline` in the toolchain account.

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

1. In [`infrastructure/config.ts`](../../infrastructure/config.ts), increase the stage's `DOCS_SESSION_KEY_GENERATION`.
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

- **keep it offline**: remove the site's entry in [`sites.ts`](../../infrastructure/sites.ts) and merge, so the slug
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
