# Deploying docs.umccr.org

Every step to deploy docs.umccr.org from this repository: the Terraform it depends on, the hosting stack in each stage account, the toolchain stack with both pipelines, the organisation webhook, and the first site releases.
OrcaSonar, the chat service, has its own guide in [umccr/orcasonar](https://github.com/umccr/orcasonar/blob/main/docs/deploy.md); [step 7](#step-7-orcasonar) covers where the two meet.
Operating the platform once it is deployed is in the [runbook](runbook.md). This page is `docs/site/deploy.md` in [umccr/docs-platform](https://github.com/umccr/docs-platform), so it can be read on GitHub before docs.umccr.org is up, or while it is down.

> **This repository is public.** The commands below print account IDs, ARNs, bucket names and secret values. Keep them in your terminal or a private note: never paste them into this repository, a pull request or an issue.

## What gets deployed

| Piece                                                                                                                                                                   | Source                                                            | Account          | Deployed by                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------- | ------------------------------------------------------------- |
| Cognito app client `docs-app-<stage>`, SSM `/cognito/docs-app/app-client-id`                                                                                            | `umccr/infrastructure` `terraform/stacks/cognito_aai/app_docs.tf` | dev and prod     | Terraform, by hand                                            |
| Certificate for the stage's docs hosts (us-east-1), SSM `/docs/certificate_arn`                                                                                         | `umccr/infrastructure` `terraform/stacks/umccr_docs_domain/`      | dev and prod     | Terraform, by hand                                            |
| `docs.umccr.org` and its certificate validation record, in the `umccr.org` zone                                                                                         | the prod `umccr_docs_domain` output `umccr_org_zone_records`      | toolchain        | by hand, once ([step 1](#prod-the-umccrorg-records))          |
| `DocsInfrastructurePipeline`: pipeline 1, the dispatcher, the fetch build, `UMCCR-DocsSitesPipeline`                                                                    | `bin/deploy.ts`, `infrastructure/toolchain/`, `app/dispatcher/`   | toolchain        | `cdk deploy` once, by hand; after that, pipeline 1 updates it |
| `DocsHostingStack`: buckets, CloudFront, the edge function, the session key and Lambda, the `docs/docs-publisher` role, SSM `/docs/content-bucket-name`, the DNS record | `infrastructure/stage/`, `app/`                                   | dev (beta), prod | pipeline 1; beta can also be deployed by hand                 |
| The organisation webhook                                                                                                                                                | the umccr organisation's settings on GitHub                       |                  | an organisation owner, once                                   |
| Site content: `/platform/` (from `docs/site/`) and every registered site                                                                                                | each site's repository                                            | dev and prod     | `UMCCR-DocsSitesPipeline`, on push                            |

The hosting stack is CloudFormation stack `UMCCR-DocsHostingStack` in each stage account, tagged `umccr-org:Product: Docs`. `cdk diff` and `cdk deploy` select it by its construct path, `DocsInfrastructurePipeline/DeploymentPipeline/<Stage>/DocsHostingStack` with `<Stage>` either `Beta` or `Prod`, which also name pipeline 1's stages. Pipeline 1 is this repository's own construct, `infrastructure/toolchain/deployment-pipeline.ts`, adapted from the OrcaBus one so that nothing is named for OrcaBus.
Both pipelines deploy to dev and prod only: the stg account runs no docs stage.

## State on 2026-10-15

Read-only checks of the toolchain and dev accounts found:

|                | Toolchain account                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | dev account                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prerequisites  | all present: `codestar_github_arn` (connection `AVAILABLE`), `/chatbot_arn/slack/alerts-build`, CDK bootstrap version 32                                                                                                                                                                                                                                                                                                                                                                      | all present: every parameter the hosting stack reads; CDK bootstrap version 32, trusting the toolchain account for deploys and lookups                                                         |
| docs.umccr.org | `DocsInfrastructurePipeline` deployed by hand from the branch (step 4), last on 2026-10-15, matching this branch: pipeline 1 `UMCCR-DocsInfrastructure`, the dispatcher, the fetch build and `UMCCR-DocsSitesPipeline`. The organisation webhook (step 5) delivers, and its signatures check: four knowledgebase pushes were dispatched and fetched on 2026-10-15. Pipeline 1 fails at Build, and every release at Build, because `main` on GitHub does not hold this code or the toolkit yet | `UMCCR-DocsHostingStack` (step 3), matching this branch. `/platform/` and `/management-knowledgebase/` are published by hand. OrcaSonar is deployed by hand and answers (its own deploy guide) |
| Still to do    | merge this repository; after that, pipeline 1 updates this stack and the stages itself, and releases build                                                                                                                                                                                                                                                                                                                                                                                    | nothing until prod (step 8)                                                                                                                                                                    |

**Since then**, as of 2026-10-21: this repository is merged to `main` and tagged `v0.1.0`, and a ruleset protects
`main`. Pipeline 1 updated itself, so the site pipeline runs one release at a time, and deployed beta. Its gamma
stage then failed on stg's missing parameters; the stage has been removed since, as stg runs no docs stage. The first
`/platform/` release failed at Publish beta: `docs-publisher` had no grant for OrcaSonar's ingest bucket, which the
hosting stack now gives it. A read-only check of prod found every parameter the hosting stack reads and a CDK
bootstrap that trusts the toolchain, but a certificate that timed out (step 8). It was requested again the same
day, and the first prod deploy failed at the distribution, as the `umccr.org` records were not there yet; the failed
create left the stack `ROLLBACK_FAILED` ([troubleshooting](#troubleshooting)). The records were added later on
2026-10-21 ([step 1](#prod-the-umccrorg-records)), and the certificate was issued within the hour. The next create
was refused too: the content bucket, kept when the failed stack was deleted, still held old versions. Once it was
emptied and deleted, prod deployed, and `/platform/` (release 2, started by hand) and the knowledgebase (release 28)
published to dev and prod. Their pages lacked the theme's script, which `v0.1.0`'s package left out, so they showed
no catalogue, account menu or chat panel; `v0.1.1` fixes that
([write-up](../issues/2026-10-21-theme-script-missing-from-wheel.md)). stg holds no docs or OrcaSonar resources.

The [implementation plan](../plans/implementation-plan.md#6-rollout) tracks what is left.

## Before you start

**Access:**

| For                                                    | You need                                   |
| ------------------------------------------------------ | ------------------------------------------ |
| Terraform, the hosting stack, stage checks             | admin on the stage account through AWS SSO |
| The toolchain stack, the pipelines, the webhook secret | admin on the toolchain (bastion) account   |
| The `umccr.org` records                                | admin on the toolchain (bastion) account   |
| The webhook, the AWS Connector for GitHub app          | an owner of the umccr GitHub organisation  |

The examples use the SSO profiles `bastion-admin` for the toolchain account and `dev` for the dev account; use
yours if they are named differently, and `prod-admin` (or yours) for prod. The shared profiles are
defined in `umccr/infrastructure` `scripts/all-accounts-aws-config.ini`.

```sh
aws sso login --profile bastion-admin && export AWS_PROFILE=bastion-admin   # the toolchain account
aws sso login --profile dev && export AWS_PROFILE=dev                       # a stage account
export AWS_REGION=ap-southeast-2
aws sts get-caller-identity --query Account --output text                   # check it is the account you expect
```

Everything runs in ap-southeast-2, except the docs certificate, which CloudFront needs in us-east-1.

**Tools:**

| Tool                                 | Version                                                                                                                                                                                                                              | Used in                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| AWS CLI                              | v2                                                                                                                                                                                                                                   | every step                                                       |
| Terraform                            | 1.5.7 or later                                                                                                                                                                                                                       | step 1                                                           |
| Node.js with Corepack                | 22 or later (`.nvmrc`); Corepack provides pnpm 10.34.5. If another pnpm is first on your `PATH`, run `corepack pnpm@10.34.5 …` instead: a newer pnpm rewrites `packageManager` in `package.json` and adds itself to `pnpm-lock.yaml` | steps 3 and 4                                                    |
| Python                               | 3.12                                                                                                                                                                                                                                 | step 3, where `make install` creates `.venv`; publishing by hand |
| [pre-commit](https://pre-commit.com) | any recent                                                                                                                                                                                                                           | step 3, where `make install` installs its git hook               |
| `git`, `curl`, `dig`, `jq`           | any recent                                                                                                                                                                                                                           | every step                                                       |

**Checkouts:** `umccr/infrastructure`, `umccr/docs-platform` and `umccr/management-knowledgebase`, side by side.

## Order

```text
1. Terraform, in dev and prod: cognito_aai (app_docs.tf), then umccr_docs_domain
2. Pre-flight checks, read-only: the toolchain account and each stage account
3. dev: update the beta hosting stack by hand (optional: lets you check dev before merging)
4. Merge, then deploy DocsInfrastructurePipeline to the toolchain account, once
5. GitHub: the organisation webhook, and the AWS Connector app's repository access
6. First releases: /platform/ and /management-knowledgebase/
7. OrcaSonar, from its own repository: documents export, then the chat answers
8. prod: Terraform and the umccr.org records, then PromoteToProd and the canonical host
```

Each step needs the ones before it. Steps 1 and 2 repeat for dev and prod. Allow an hour for a first stage, most of it waiting for the certificate and CloudFront.

---

## Step 1: Terraform prerequisites

In `umccr/infrastructure`, once per workspace (`dev`, `prod`). The hosting stack reads both SSM parameters when it deploys, and CloudFront needs the certificate already issued. Apply from the branch, then merge the pull request once the stage is verified, so `master` matches what is applied.

The hosting stack copies these values, with the Cognito pool's, into the distribution and `/_auth/env.js` when it deploys. If a later Terraform change alters them, deploy the hosting stack again: start pipeline 1 (step 8 shows how).

### Cognito app client (`cognito_aai`)

Adds the public `docs-app-<stage>` client to the existing `data-portal-<stage>` pool, and the SSM parameter `/cognito/docs-app/app-client-id`.

```sh
cd infrastructure/terraform/stacks/cognito_aai
terraform init
terraform workspace select dev      # or prod
terraform plan
```

Check the plan before applying:

- It adds `aws_cognito_user_pool_client.docs_app_client` and `aws_ssm_parameter.docs_app_client_id`.
- In-place (`~`) callback URL changes on other clients mean earlier `master` commits were never applied to this
  workspace. They only add URLs; confirm they are expected before continuing.
- **Anything that replaces (`-/+`) or destroys an existing client: stop.** A replaced client gets a new client ID,
  which signs every portal user out.

```sh
terraform apply   # the same plan again: answer yes
aws ssm get-parameter --name /cognito/docs-app/app-client-id --query Parameter.Value --output text
```

**Never run `terraform destroy` on `cognito_aai`.** It owns the user pool for the whole portal.

### Certificate (`umccr_docs_domain`)

A stack with its own state, so each workspace is created the first time:

```sh
cd ../umccr_docs_domain
terraform init
terraform workspace select dev || terraform workspace new dev
terraform plan    # dev: 4 to add
terraform apply
```

The apply creates the ACM certificate for the stage's docs hosts in us-east-1 and its DNS validation record, waits
for the certificate to be issued, and writes `/docs/certificate_arn`. The `umccr_org_zone_records` output is empty
in dev. In prod the apply does not wait: the certificate also names `docs.umccr.org`, which validates only once its
record is in the `umccr.org` zone. Add the records next ([below](#prod-the-umccrorg-records)), within 72 hours:
ACM stops trying after that (`VALIDATION_TIMED_OUT`), and the certificate must be requested again (step 8).

```sh
CERT_ARN=$(aws ssm get-parameter --name /docs/certificate_arn --query Parameter.Value --output text)
aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query Certificate.Status --output text   # ISSUED; in prod, only once the umccr.org records exist
```

### prod: the `umccr.org` records

**Done in prod on 2026-10-21.** Needed again only if a new certificate lists a different validation record, or for
another host directly under `umccr.org`.

`docs.umccr.org` is a name in the `umccr.org` zone, which is in the toolchain account, not in prod. No Terraform or
CDK manages that zone, so `umccr_docs_domain` cannot write to it: its records are added by hand, as the portal's
are. Until the first one exists, the prod certificate stays `PENDING_VALIDATION`, and a prod deploy fails at the
distribution ([troubleshooting](#troubleshooting)).

| Record                     | Type  | Value                                | What it is for                                                                                                    |
| -------------------------- | ----- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `_<token>.docs.umccr.org.` | CNAME | `_<token>.<id>.acm-validations.aws.` | ACM's proof that the certificate may name `docs.umccr.org`. Keep it: every renewal checks it again                |
| `docs.umccr.org.`          | CNAME | `docs.prod.umccr.org.`               | readers. The prod hosting stack creates `docs.prod.umccr.org` in prod's own zone, as an alias of the distribution |

The second record leads nowhere until prod's hosting stack exists. That is harmless, and adding both together saves
a second change.

1. Read both records from the prod workspace:

   ```sh
   cd infrastructure/terraform/stacks/umccr_docs_domain
   aws sso login --profile prod-admin && export AWS_PROFILE=prod-admin
   terraform workspace select prod
   terraform output -json umccr_org_zone_records > /tmp/umccr-org-records.json
   jq . /tmp/umccr-org-records.json   # the validation record, then docs.umccr.org
   ```

2. Create them with toolchain credentials. `CREATE` never overwrites: if either record exists already, Route 53
   refuses the whole change (`InvalidChangeBatch`) and changes nothing, so compare what is in the zone with the
   output instead.

   ```sh
   aws sso login --profile bastion-admin && export AWS_PROFILE=bastion-admin
   ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name umccr.org --max-items 1 \
     --query "HostedZones[?Name=='umccr.org.'].Id | [0]" --output text)
   jq '{Comment: "docs.umccr.org: certificate validation, and the prod host",
     Changes: [.[] | {Action: "CREATE", ResourceRecordSet: {Name: .name, Type: .type, TTL: 300,
       ResourceRecords: [{Value: .value}]}}]}' /tmp/umccr-org-records.json > /tmp/umccr-org-change.json
   CHANGE_ID=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
     --change-batch file:///tmp/umccr-org-change.json --query ChangeInfo.Id --output text)
   aws route53 wait resource-record-sets-changed --id "$CHANGE_ID"
   ```

   Or in the toolchain account's Route 53 console: **Hosted zones → umccr.org → Create record**, once for each, as
   a CNAME with TTL 300 and no alias. The name box already ends in `.umccr.org`, so type only what comes before it;
   a pasted full name becomes `….umccr.org.umccr.org`.

3. Check both at the zone's own name server, which answers at once: a public resolver can keep the earlier "no such
   name" for up to 15 minutes. Then wait for the certificate, with prod credentials:

   ```sh
   NS=$(dig +short NS umccr.org | head -1)
   jq -r '.[].name' /tmp/umccr-org-records.json | while read -r NAME; do dig +short CNAME "$NAME" "@$NS"; done
   # each record's value, as the output lists it

   export AWS_PROFILE=prod-admin
   CERT_ARN=$(aws ssm get-parameter --name /docs/certificate_arn --query Parameter.Value --output text)
   aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
     --query 'Certificate.[Status, DomainValidationOptions[].ValidationStatus]' --output text
   # ISSUED, then SUCCESS for each name
   ```

   ACM usually issues within half an hour of the record resolving, and sometimes takes a few hours. Deploy prod only
   once it shows `ISSUED` (step 8).

ACM gives a name the same validation record for every certificate in the same account, so a certificate requested
again (step 8) normally validates with the record already in the zone: check that the output still matches, and
add only what differs.

## Step 2: Pre-flight checks

Each check stands for a failure a deploy would otherwise hit halfway through. All of them only read.

### The toolchain account

```sh
aws sso login --profile bastion-admin && export AWS_PROFILE=bastion-admin AWS_REGION=ap-southeast-2

# a) The parameters the toolchain stack reads: InvalidParameters must be empty
aws ssm get-parameters --query InvalidParameters --names \
  codestar_github_arn /chatbot_arn/slack/alerts-build /cdk-bootstrap/hnb659fds/version

# b) The GitHub connection that pipeline 1 and the fetch build clone through: AVAILABLE
aws codeconnections get-connection --query Connection.ConnectionStatus --output text \
  --connection-arn "$(aws ssm get-parameter --name codestar_github_arn --query Parameter.Value --output text)"

# c) First deploy only: none of these exists yet, so each command reports that it is not found
aws cloudformation describe-stacks --stack-name DocsInfrastructurePipeline
aws codepipeline get-pipeline --name UMCCR-DocsInfrastructure
aws codepipeline get-pipeline --name UMCCR-DocsSitesPipeline
aws iam get-role --role-name docs-sites-publish
aws secretsmanager describe-secret --secret-id docs/github-webhook-secret
```

### Each stage account

```sh
aws sso login --profile dev && export AWS_PROFILE=dev AWS_REGION=ap-southeast-2

# a) The parameters the hosting stack reads: InvalidParameters must be empty
aws ssm get-parameters --query InvalidParameters --names \
  /cognito/docs-app/app-client-id /docs/certificate_arn \
  /data_portal/client/cog_user_pool_id /data_portal/client/oauth_domain \
  /hosted_zone/umccr/id /hosted_zone/umccr/name

# b) The CDK bootstrap, trusting the toolchain account so pipeline 1 can deploy here
aws cloudformation describe-stacks --stack-name CDKToolkit --query "Stacks[0].{
  version: Outputs[?OutputKey=='BootstrapVersion'] | [0].OutputValue,
  trusted: Parameters[?ParameterKey=='TrustedAccounts'] | [0].ParameterValue}"

# c) First deploy of the stage only: the bucket names and the host are free
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
aws s3api head-bucket --bucket "docs-cloudfront-$ACCOUNT" 2>&1 | grep -q 404 && echo "content bucket name free"
aws s3api head-bucket --bucket "docs-cloudfront-logs-$ACCOUNT" 2>&1 | grep -q 404 && echo "log bucket name free"
dig +short docs.dev.umccr.org   # docs.prod.umccr.org in prod: expect no answer
```

The certificate's status (step 1) is the remaining check.

| If                                               | Then                                                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| a parameter is missing                           | redo step 1, or check you are in the right account                                                                   |
| the connection is not `AVAILABLE`                | an organisation owner completes it under Developer Tools → Settings → Connections in the toolchain account's console |
| `trusted` does not include the toolchain account | bootstrap the account as `umccr/infrastructure` `scripts/aws_bootstrap` describes                                    |
| a name is taken, or the host resolves            | stop, and find out what owns it before going further                                                                 |

## Step 3: Deploy the hosting stack in dev

Deploying the beta stage's stack by hand, from the branch, lets you check dev before anything is merged; pipeline 1
takes over the same stack later. To skip it, go to step 4, and pipeline 1 deploys it instead.

### Moving from `OrcaBusBeta-DocsHostingStack` (dev, once)

**Done in dev on 2026-10-13.** prod never ran the old name, so this applies nowhere else; it stays as a
record of the move.

Until 2026-10-13 the stack was named `OrcaBusBeta-DocsHostingStack`, and dev ran it under that name. A new
name is a new stack, and the host `docs.dev.umccr.org`, its DNS record, the `docs/docs-publisher` role, the
`/docs/content-bucket-name` parameter and the buckets' names can each belong to one stack only, so the old stack
goes first. Nothing else depends on it: it has no exports and no termination protection. docs.dev.umccr.org is down
from the delete until the new stack is deployed, about 30 to 40 minutes, and readers sign in again afterwards. While
the name has no record, a lookup is cached as missing for up to 15 minutes (the zone's SOA TTL), so wait or flush
your DNS cache if the host does not resolve right after the deploy.

```sh
aws sso login --profile dev && export AWS_PROFILE=dev AWS_REGION=ap-southeast-2
aws cloudformation delete-stack --stack-name OrcaBusBeta-DocsHostingStack
aws cloudformation wait stack-delete-complete --stack-name OrcaBusBeta-DocsHostingStack   # 10 to 20 minutes
```

The old stack keeps its content and log buckets (their deletion policy was `Retain`), and their fixed names would
stop the new stack. Empty them, every object version included, and delete them; or use **Empty**, then **Delete**,
in the S3 console. The content comes back with each site's next release.

```sh
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
for BUCKET in "docs-cloudfront-$ACCOUNT" "docs-cloudfront-logs-$ACCOUNT"; do
  while :; do
    BATCH=$(aws s3api list-object-versions --bucket "$BUCKET" --max-items 1000 --output json \
      --query '{Objects: [Versions, DeleteMarkers][][].{Key: Key, VersionId: VersionId}, Quiet: `true`}')
    [ "$(echo "$BATCH" | jq '.Objects | length')" -gt 0 ] || break
    aws s3api delete-objects --bucket "$BUCKET" --delete "$BATCH" > /dev/null
  done
  aws s3api delete-bucket --bucket "$BUCKET"
done
```

It also keeps the session Lambda's log group, which blocks nothing; delete it if the old sign-in logs are not
needed (`aws logs describe-log-groups --log-group-name-prefix OrcaBusBeta-DocsHostingStack`).

### Deploy

```sh
cd docs-platform
corepack enable
make install
make test                          # jest with cdk-nag, and the toolkit's tests

aws sso login --profile dev && export AWS_PROFILE=dev AWS_REGION=ap-southeast-2
STACK='DocsInfrastructurePipeline/DeploymentPipeline/Beta/DocsHostingStack'   # creates UMCCR-DocsHostingStack
pnpm cdk diff "$STACK" --method template   # read-only: a first deploy shows every resource as new
pnpm cdk deploy "$STACK"                   # review the IAM and security changes when asked, then answer y
```

A first deploy takes 10 to 20 minutes, most of it CloudFront. It generates a new session key, so every reader signs
in again. Later deploys update the stack in place: check that `cdk diff` shows only the changes you expect, and
nothing replaced.

Then check, still with dev credentials:

```sh
BASE=https://docs.dev.umccr.org
curl -sI "$BASE/" | grep -i -E '^(HTTP|location)'                 # 302, location: /_auth/?rd=%2F
curl -sI -H 'sec-fetch-mode: cors' "$BASE/platform/" | head -1    # 401: non-navigation requests are refused
curl -sI "$BASE/_auth/" | head -1                                 # 200: the sign-in page is public
curl -s "$BASE/_auth/env.js" | grep -o 'VITE_SONAR_API_URL[^,}]*'    # https://sonar.dev.umccr.org/api/v1
curl -sI "$BASE/_auth/token.js" | head -1                         # 200
aws ssm get-parameter --name /docs/content-bucket-name --query Parameter.Value --output text
aws cloudformation describe-stacks --stack-name UMCCR-DocsHostingStack \
  --query 'Stacks[0].Outputs[].[OutputKey, OutputValue]' --output table   # DocsBucketName, DocsDistributionId, DocsPublisherRoleArn
```

In a private browser window, open `https://docs.dev.umccr.org/`, choose **Sign in with UMCCR account**, and
check that you come back to the site signed in. Always test through the registered host, never the
`*.cloudfront.net` name: the session Lambda only issues cookies for registered hosts. The sites are 404s until
they are published again: publish `/platform/` and `/management-knowledgebase/` [by hand](#publishing-by-hand),
each from its own repository, until dispatched publishing runs.

## Step 4: Deploy the toolchain stack

Pipeline 1 builds `umccr/docs-platform` `main` and updates itself from it, so deploy it only once this
repository's changes are merged. Deployed earlier, its first run would build a `main` without the CDK app and fail.

**Done once, from the branch, between 2026-10-13 and 2026-10-15** (see [State](#state-on-2026-10-15)): pipeline 1
exists, and its first run failed as described. From the merge on, pipeline 1 updates this stack itself, so this
step is needed again only for a new toolchain account or after a teardown.

Before deploying:

- **Protect** `main` and the release tags first ([repository settings](runbook.md#repository-settings)):
  from the merge on, a merge to `main` publishes `/platform/` to prod with no approval, and deploys infrastructure
  to beta.
- **Merge** the pull requests: `umccr/infrastructure`, then this repository, then `umccr/management-knowledgebase`.
- **Tag** the commit that merges this repository `v0.1.0` straight away ([releasing](runbook.md#release-the-toolkit-and-theme),
  step 3). Every site but `/platform/` builds with that tag, so their releases stop at Build ("has no ref v0.1.0")
  until it exists; re-run them afterwards ([runbook](runbook.md#re-run-or-force-a-release)).
- **GitHub access**: the AWS Connector for GitHub app must be able to read `umccr/docs-platform` (step 5), or the
  first run fails at its source.

```sh
cd docs-platform
git switch main && git pull --ff-only
corepack enable
pnpm install --frozen-lockfile
pnpm test

aws sso login --profile bastion-admin && export AWS_PROFILE=bastion-admin AWS_REGION=ap-southeast-2
pnpm cdk diff DocsInfrastructurePipeline --method template   # first deploy: every resource is new
pnpm cdk deploy DocsInfrastructurePipeline                   # review the IAM changes when asked, then answer y
```

The stack creates:

| Resource                                                                                         | What it is                                                                                      |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| CodePipeline `UMCCR-DocsInfrastructure`                                                          | pipeline 1, which deploys the hosting stack and updates this stack                              |
| An S3 bucket and a KMS key                                                                       | pipeline 1's artifacts, which the stage accounts' CDK deploy roles read; the key rotates yearly |
| A Lambda function behind a function URL                                                          | the dispatcher, which the organisation webhook calls                                            |
| Secret `docs/github-webhook-secret`                                                              | the webhook's secret; CloudFormation generates the value                                        |
| A DynamoDB table                                                                                 | the deliveries the dispatcher has handled, and each site's release counter                      |
| A CodeBuild project and an S3 bucket                                                             | the fetch build, and the sources it writes (`sources/<slug>/<commit>.zip`, kept 30 days)        |
| CodePipeline `UMCCR-DocsSitesPipeline`, two CodeBuild projects and IAM role `docs-sites-publish` | pipeline 2: build each release, then publish it to dev and prod                                 |

Pipeline 1 starts as soon as it exists:

```text
Source (main) ─▶ unit tests (pnpm run test) ─▶ synth ─▶ self-update ─▶ assets
  ─▶ Beta: UMCCR-DocsHostingStack in dev   (no change if step 3 deployed the same code)
  ─▶ Prod: PromoteToProd (approval), then UMCCR-DocsHostingStack in prod
```

**PromoteToProd** waits 60 minutes, then fails the run, so that an unanswered approval never holds back newer runs.
Until prod is ready (step 8), let it time out: that is harmless, and every run asks again.

```sh
aws codepipeline get-pipeline-state --name UMCCR-DocsInfrastructure \
  --query 'stageStates[].[stageName, latestExecution.status]' --output table
aws cloudformation describe-stacks --stack-name DocsInfrastructurePipeline \
  --query 'Stacks[0].Outputs[].[OutputKey, OutputValue]' --output table
```

The two outputs, `SitePublishingDispatcherWebhookUrl…` and `SitePublishingDispatcherWebhookSecretName…`, are for
step 5. From now on, pipeline 1 deploys every merge to `main` that changes `bin/`, `infrastructure/` or `app/`,
including changes to this stack.

The site pipeline was called `DocsSitesPipeline` until 2026-10-15. The first deploy after that replaces it with
`UMCCR-DocsSitesPipeline`: the old pipeline and its run history are deleted, the artifact bucket and roles stay, and
the Slack failure rule becomes `UMCCR-DocsSitesPipeline-Failures`. Its name differs from the pipeline's because
CloudFormation creates the replacement rule before deleting the old one, and rule names must be unique in the
account. Re-run any release that failed under the old name
([runbook](runbook.md#re-run-or-force-a-release)).

## Step 5: GitHub

### The organisation webhook

An organisation owner, once:

1. Reads the webhook's URL and secret, with toolchain credentials:

   ```sh
   aws cloudformation describe-stacks --stack-name DocsInfrastructurePipeline --output text --query \
     "Stacks[0].Outputs[?starts_with(OutputKey, 'SitePublishingDispatcherWebhookUrl')].OutputValue"
   aws secretsmanager get-secret-value --secret-id docs/github-webhook-secret --query SecretString --output text
   ```

2. In the umccr organisation's **Settings → Webhooks → Add webhook**, sets:

   | Field            | Value                   |
   | ---------------- | ----------------------- |
   | Payload URL      | the webhook URL         |
   | Content type     | `application/json`      |
   | Secret           | the secret's value      |
   | SSL verification | enabled                 |
   | Which events     | **Just the push event** |
   | Active           | checked                 |

3. Checks **Recent Deliveries**: GitHub sends a ping when the webhook is saved, and the dispatcher answers 200.

One webhook covers every site. The dispatcher checks each delivery's signature, reads only push events, and starts
nothing for a repository and branch that are not in the registry.

### The AWS Connector for GitHub app

Pipeline 1, the fetch build and OrcaSonar's pipelines clone through the organisation's AWS Connector for GitHub app
(the `codestar_github_arn` connection). If the app is installed for selected repositories only, the owner adds these
under **Settings → GitHub Apps → AWS Connector for GitHub → Configure**:

- `umccr/docs-platform`, for pipeline 1 and the `/platform/` site;
- `umccr/management-knowledgebase`, and each site repository registered later;
- `umccr/orcasonar`, for its pipelines.

## Step 6: First releases

A release starts when a push to a registered site's branch changes one of its `docsPaths`
(`infrastructure/sites.ts`):

| Site                         | Repository and branch                   | Paths that publish it                                                                                      | Builds with                      |
| ---------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `/platform/`                 | `umccr/docs-platform` `main`            | `mkdocs.yml`, `docs/site/**`, `toolkit/src/**`, `toolkit/pyproject.toml`, `toolkit/requirements/build.txt` | the toolkit at the pushed commit |
| `/management-knowledgebase/` | `umccr/management-knowledgebase` `main` | `PlatformServices/**`, `mkdocs.yml`                                                                        | `DOCS_TOOLKIT_REF`, `v0.1.2`     |

The webhook exists before this repository is merged, so the merge itself starts the first `/platform/` release: it
is a push under `docs/site/` and `toolkit/`. The knowledgebase's first release starts with its next push under its
paths once `v0.1.0` is tagged (step 4). Its earlier releases failed at Build because `main` here did not hold the
toolkit yet; re-running one of them ([runbook](runbook.md#re-run-or-force-a-release)) works too, but
builds with `main`, the toolkit ref it started with.

The dispatcher starts the fetch build within seconds, and the fetch build starts `UMCCR-DocsSitesPipeline` a minute
or two later. Each run's variables name the site, the commit and the release number. Releases run one at a time, so
a release can wait a few minutes behind another site's.

```sh
# Toolchain credentials: the latest releases
aws codepipeline list-pipeline-executions --pipeline-name UMCCR-DocsSitesPipeline --max-items 5 \
  --query 'pipelineExecutionSummaries[].[pipelineExecutionId, status, startTime]' --output table

# dev credentials: the live release of a site
DOCS_BUCKET=$(aws ssm get-parameter --name /docs/content-bucket-name --query Parameter.Value --output text)
aws s3 cp "s3://$DOCS_BUCKET/sites/platform/_publish.json" -
```

Then open `https://docs.dev.umccr.org/platform/`: the catalogue lists both sites.

Until prod's hosting stack exists (step 8), every release fails at **Publish prod** after dev succeeds, and posts
the failure to the alerts Slack channel. That does no harm. To keep the channel quiet until then, register the
sites for beta only (`stages: [AppStage.BETA]` in `infrastructure/sites.ts`, and the stage lists in
`test/sites.test.ts`), and add `AppStage.PROD` back as part of step 8.

## Step 7: OrcaSonar

OrcaSonar deploys from its own repository; see its [deploy guide](https://github.com/umccr/orcasonar/blob/main/docs/deploy.md). Nothing on this side needs a deploy for it:

- **Documents**: once OrcaSonar's stateful stack is in a stage, `/orcasonar/ingest-bucket-name` exists there, and
  each site's next release also uploads its pages, as Markdown with metadata, under `docs/<slug>/` in OrcaSonar's
  ingest bucket. Until then the publish step logs a warning and publishes the pages only. Release each site once
  more (step 6) to fill the index straight away.
- **Chat**: once OrcaSonar's stateless stack serves `https://sonar.<stage>.umccr.org/api/v1`, the chat panel
  answers. The hosting stack's Content Security Policy and `env.js` already point there.
- **Theme**: the chat panel ships with the toolkit, so `/platform/` has it at once, and other sites when their
  `toolkitRef` includes it.

To check, open any page on `https://docs.dev.umccr.org/` signed in, open the chat panel, and ask something the site answers. The answer streams in, with its sources linking to docs pages.

## Step 8: prod

1. **Terraform and checks**: steps 1 and 2 for `prod`. Add the `umccr.org` records the `umccr_docs_domain` output lists ([step 1](#prod-the-umccrorg-records)), and wait for the certificate to be `ISSUED`: CloudFront refuses any other. A certificate that shows `VALIDATION_TIMED_OUT` never recovers, because ACM stopped trying when its `docs.umccr.org` record was not there within 72 hours. Request a new one with `terraform apply -replace=aws_acm_certificate.docs` in `umccr_docs_domain` (workspace `prod`), which creates it before removing the old one and updates `/docs/certificate_arn`; then check the records the output lists against the zone, add any that differ, and wait for `ISSUED`. A stage's first deploy also creates its session key: CloudFormation generates the secret and builds it into the edge function, so there is nothing to run for it.
2. **Prod**: approve **PromoteToProd**, the first action of `UMCCR-DocsInfrastructure`'s prod stage, in the toolchain account's CodePipeline console, within 60 minutes of the run reaching it. Otherwise start the pipeline again, with toolchain credentials:

   ```sh
   aws codepipeline start-pipeline-execution --name UMCCR-DocsInfrastructure
   ```

   The prod stage deploys `UMCCR-DocsHostingStack` there. If an earlier first deploy failed, its stack must go first: see `ROLLBACK_COMPLETE` and `ROLLBACK_FAILED` under [troubleshooting](#troubleshooting). Then start the pipeline again as above: retrying the failed action would run the deleted stack's change set. If the sites were registered for beta only (step 6), add `AppStage.PROD` back now; then release each site once (step 6), so prod gets its content.

3. **Canonical host**: once `docs.umccr.org` resolves to the prod distribution, set `DOCS_CANONICAL_HOST[AppStage.PROD]` to `'docs.umccr.org'` in `infrastructure/config.ts`, merge, and approve PromoteToProd. Other prod hosts then redirect to it, so readers hold one session cookie.

## Later deploys

| A change to                                                                                                                                         | Deploys through                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `bin/`, `infrastructure/`, `app/`                                                                                                                   | merge to `main`, then pipeline 1: the self-update (toolchain changes), beta, PromoteToProd, prod              |
| the site registry, `infrastructure/sites.ts`                                                                                                        | the same; see [registering a site](runbook.md#register-a-site)                                                |
| `mkdocs.yml`, `docs/site/`, the toolkit's package (`toolkit/src/`, `toolkit/pyproject.toml`) and its engine pins (`toolkit/requirements/build.txt`) | merge to `main`, then `UMCCR-DocsSitesPipeline`: `/platform/` in dev, then prod                               |
| a site's docs, in its own repository                                                                                                                | push, then `UMCCR-DocsSitesPipeline`                                                                          |
| the toolkit and theme, for the other sites                                                                                                          | a release tag, then their `toolkitRef`; see [releasing the toolkit](runbook.md#release-the-toolkit-and-theme) |
| the session key                                                                                                                                     | see the [runbook](runbook.md#rotate-the-session-key)                                                          |
| the rest of `docs/`, the toolkit's examples and templates, and Markdown outside `docs/site/`                                                        | nothing deploys; CI runs                                                                                      |

## Verification checklist

Before calling a stage done:

- [ ] Without a session, `/` and every site path redirect to `/_auth/`; requests with `sec-fetch-mode: cors` get
      401; `/_platform/data/catalog.json` is not readable.
- [ ] Sign-in returns to a deep link with its query string, for example `/platform/publishing/?x=1`.
- [ ] Silent renewal: delete the `__Host-docs_session` cookie and reload. You pass through "Checking sign-in…"
      without a click.
- [ ] Sign-out ends the session: the next visit shows the sign-in card.
- [ ] Only UMCCR accounts sign in: in a private window, sign in with a personal Google account. Google refuses it
      (`org_internal`), since the stage's Google OAuth client is internal to the UMCCR Workspace
      ([ADR-0005](../design/adr/0005-reader-policy.md)); the pages and the chat panel both rely on that.
- [ ] Loop guard: delete the cookie and reload several times in quick succession. By the fourth renewal within
      two minutes, the sign-in page stops with "Signing in keeps repeating".
- [ ] The webhook's ping and push deliveries show success in **Recent Deliveries**.
- [ ] A push under a site's docs paths starts one release, which publishes to dev and then prod; a push outside
      them starts none, and the dispatcher logs `no-docs-change`.
- [ ] A page deleted in its repository is gone from the site after the next release.
- [ ] Taking a site offline ([runbook](runbook.md#take-a-site-offline)) makes it a 404 on the next
      request; the next release restores it.
- [ ] Once OrcaSonar is in the stage: after a release, documents appear under `docs/<slug>/` in its ingest bucket,
      and the chat panel answers with sources.

## Troubleshooting

The dispatcher logs one line per delivery, saying what it did and why:

```sh
LOG_GROUP=$(aws cloudformation describe-stack-resources --stack-name DocsInfrastructurePipeline \
  --query "StackResources[?starts_with(LogicalResourceId, 'SitePublishingDispatcherLogGroup')].PhysicalResourceId" \
  --output text)
aws logs tail "$LOG_GROUP" --since 1h
```

| Symptom                                                                                                                            | Likely cause                                                                                                                                                                 | Fix                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A deploy fails: `Parameter ... not found`                                                                                          | step 1 not applied in that account, or the wrong account                                                                                                                     | step 1; `aws sts get-caller-identity`                                                                                                                                                                                   |
| A deploy fails: CloudFront rejects the certificate (`The specified SSL certificate doesn't exist, …`)                              | the certificate is not `ISSUED` yet; in prod, usually because a `umccr.org` record is missing                                                                                | add the records ([step 1](#prod-the-umccrorg-records)), wait for `ISSUED`, then deploy again; `VALIDATION_TIMED_OUT` needs a new certificate (step 8). After a failed first deploy, clear its stack first (below)       |
| A deploy fails: `CNAMEAlreadyExists`                                                                                               | the host is attached to another distribution                                                                                                                                 | find and detach it                                                                                                                                                                                                      |
| A stage's stack is in `ROLLBACK_COMPLETE`                                                                                          | its first deploy failed and rolled back; CloudFormation cannot update it                                                                                                     | delete the stack, fix the cause, and run the stage again                                                                                                                                                                |
| A stage's stack is in `ROLLBACK_FAILED`: its content bucket failed to delete, `The bucket you tried to delete is not empty`        | its first deploy failed after files were copied into the content bucket; a failed first create deletes that bucket, and S3 refuses while it holds any object version         | empty `docs-cloudfront-<account>`, versions included (S3 console: **Empty**), then delete the stack without `--retain-resources`, as the bucket's fixed name would stop the next create; fix the cause, then step 8     |
| Prepare fails: `AWS::EarlyValidation::ResourceExistenceCheck`; the change set's events say `… already exists`                      | a resource with a fixed name outlived its stack: usually the content bucket, kept when a failed stack was deleted with retained resources                                    | `aws cloudformation describe-events --change-set-name <arn>` names it. Empty the bucket, every version and delete marker (step 3's loop), delete it, retry                                                              |
| `DocsInfrastructurePipeline` is in `ROLLBACK_COMPLETE`                                                                             | its first `cdk deploy` failed                                                                                                                                                | fix the cause and run `pnpm cdk deploy DocsInfrastructurePipeline` again: the CDK CLI deletes a stack that failed creation and creates it anew. Nothing is left behind: every kept resource uses `RetainExceptOnCreate` |
| Creating pipeline 1 fails: `filePaths.excludes` (or `includes`) `must have length less than or equal to 8`                         | a trigger filter list has more than 8 patterns, CodePipeline's limit                                                                                                         | keep `DOCS_INFRASTRUCTURE_FILE_PATHS` and `DOCS_INFRASTRUCTURE_EXCLUDED_FILE_PATHS` to 8 each; `cdk synth` refuses longer lists                                                                                         |
| Pipeline 1's first run fails at its source                                                                                         | the AWS Connector app cannot read `umccr/docs-platform`                                                                                                                      | step 5                                                                                                                                                                                                                  |
| Pipeline 1 fails at unit tests or synth                                                                                            | `main` does not hold this code yet, or a test fails                                                                                                                          | merge first; run `pnpm test` locally                                                                                                                                                                                    |
| Webhook deliveries get 401                                                                                                         | the webhook's secret differs from `docs/github-webhook-secret` (log: `bad-signature`)                                                                                        | paste the value again (step 5)                                                                                                                                                                                          |
| A push starts no release                                                                                                           | the dispatcher ignored it                                                                                                                                                    | its log says why: `not-registered`, `no-docs-change` or `duplicate`                                                                                                                                                     |
| The dispatcher logs `start-failed`: `OAuthProviderException: User is not authorized to access connection`                          | the fetch build's role lacks `codeconnections:GetConnection` on the connection; CloudTrail shows its `GetConnection` `AccessDenied`                                          | deploy a version with the grant, then redeliver the push from the webhook's **Recent Deliveries**                                                                                                                       |
| The dispatcher logs `start-failed` with a `forgetError`                                                                            | DynamoDB failed twice: the release did not start, and the delivery's record stayed, so a redelivery is refused as a `duplicate`                                              | [start the release by hand](runbook.md#start-a-release-by-hand)                                                                                                                                                         |
| The fetch build cannot clone                                                                                                       | the connector app's repository access, or the connection's status                                                                                                            | step 5; step 2                                                                                                                                                                                                          |
| `UMCCR-DocsSitesPipeline` fails at Source: `The object with key 'sources/<slug>/<commit>.zip' returned a Forbidden error`          | the source action's role may read only its configured placeholder key, `sources/unset.zip`: CDK grants an S3 source action nothing more, and every run overrides the key     | deploy a version whose `SourceActionRole` may read `sources/*`, then re-run the release ([runbook](runbook.md#re-run-or-force-a-release))                                                                               |
| A release fails at Build: `docs-platform at <ref> has no toolkit` (before 2026-10-15: pip could not open `requirements/build.txt`) | the site's `toolkitRef` names a docs-platform ref without the toolkit, such as `main` before this repository is merged                                                       | merge this repository first, or pin the site's `toolkitRef` to a ref that has the toolkit; to try a branch once, start the run with `TOOLKIT_REF` set to it                                                             |
| A release fails at Build: `docs-platform has no ref <ref>`                                                                         | the site's `toolkitRef` names a tag or commit docs-platform does not have, such as `v0.1.0` before the merge is tagged                                                       | push the tag ([releasing](runbook.md#release-the-toolkit-and-theme)), then re-run the release ([runbook](runbook.md#re-run-or-force-a-release))                                                                         |
| Publish fails: `AccessDenied` on `AssumeRole`                                                                                      | the stage has no `docs/docs-publisher` role: its hosting stack is missing or older than this design                                                                          | deploy the stage's hosting stack (step 3 or 8)                                                                                                                                                                          |
| Publish fails: `/docs/content-bucket-name is missing here`                                                                         | the same                                                                                                                                                                     | the same                                                                                                                                                                                                                |
| Publish fails: `AccessDenied` on `ListObjectsV2` for OrcaSonar's ingest bucket                                                     | the stage's hosting stack predates the publisher's grant for that bucket (OrcaSonar's bucket policy only defers to IAM), or OrcaSonar's stateful stack or bucket was renamed | deploy the current hosting stack (pipeline 1); after a rename, update `ORCASONAR_INGEST_BUCKET_NAME_PREFIX` in `infrastructure/config.ts`                                                                               |
| Publish warns that `/orcasonar/ingest-bucket-name` does not exist                                                                  | OrcaSonar is not deployed in that stage                                                                                                                                      | nothing: the pages publish, and documents follow once OrcaSonar is there                                                                                                                                                |
| Cognito shows `redirect_mismatch`                                                                                                  | the host's `/_auth/` URL is missing from `app_docs.tf` for the workspace                                                                                                     | step 1, and use the registered host                                                                                                                                                                                     |
| "Sign-in is temporarily unavailable"                                                                                               | right after a session key change; otherwise the session Lambda cannot read its key                                                                                           | wait a few minutes; then see the [runbook](runbook.md#sign-in-fails-for-everyone)                                                                                                                                       |
| "Sign-in did not complete" after Google                                                                                            | the ID token was rejected (log: `invalid-token`)                                                                                                                             | check that `/_auth/env.js` holds the stage's docs client ID                                                                                                                                                             |
| The chat panel cannot answer                                                                                                       | OrcaSonar is not deployed in the stage, or today's allowance is used                                                                                                         | OrcaSonar's runbook                                                                                                                                                                                                     |
| The chat panel says an answer stalled, or a search took too long                                                                   | OrcaSonar sent nothing for 90 seconds (an answer) or did not answer in 45 (a search)                                                                                         | OrcaSonar's runbook: its chat function's logs, and Bedrock throttling                                                                                                                                                   |
| Pages show no catalogue, account menu or chat panel; the browser console reports a 404 for `assets/umccr/umccr.js`                 | the site was built with a toolkit older than `v0.1.1`, whose package left the theme's script out ([write-up](../issues/2026-10-21-theme-script-missing-from-wheel.md))       | move the site to `v0.1.1` or later (`toolkitRef`), then release it again ([runbook](runbook.md#start-a-release-by-hand)); `verify-site` now refuses such a site                                                         |
| `umccr-docs publish` refuses a mass delete                                                                                         | the build lost more than half its pages                                                                                                                                      | check the build; if intended, publish by hand with `--allow-mass-delete`                                                                                                                                                |
| A build warns `[[name]] does not match any note`, and the page shows `[[name]]` as text                                            | a note links to one that is not in the build, often a note nobody has committed yet                                                                                          | commit the linked note, or change the link; a working-tree build may be finding an uncommitted note. Before `v0.1.2` this failed the build                                                                              |

## Teardown

Only to remove a deployment.

1. **Toolchain**: delete the organisation webhook first, then, with toolchain credentials:

   ```sh
   pnpm cdk destroy DocsInfrastructurePipeline
   ```

   This deletes both pipelines, the dispatcher and the webhook secret. CloudFormation keeps the source bucket, the
   site pipeline's artifact bucket and the dispatch table, whose release counters must never restart: empty and
   delete them by hand if they should go too. The hosting stacks pipeline 1 deployed are not deleted with it.

2. **A stage**: with that account's credentials,

   ```sh
   pnpm cdk destroy 'DocsInfrastructurePipeline/DeploymentPipeline/Beta/DocsHostingStack'
   ```

   (`Prod` in the path for prod; the stack is `UMCCR-DocsHostingStack` in both). This deletes
   the distribution, the edge function, the session key, the session Lambda, the roles and the DNS record. The
   content and log buckets, `docs-cloudfront-<account>` and `docs-cloudfront-logs-<account>`, are kept: empty them,
   including object versions, and delete them by hand if they should go too.

3. **Certificate**: `terraform destroy` in `umccr_docs_domain` for the workspace, after the stage's stack is gone:
   ACM refuses to delete a certificate CloudFront still uses. In prod, delete the two `umccr.org` records too, with
   toolchain credentials: the change in [step 1](#prod-the-umccrorg-records) with `DELETE` in place of `CREATE`,
   from the output read before the destroy.
4. **Cognito client**: delete `app_docs.tf` and apply `cognito_aai`. **Never run `terraform destroy` on
   `cognito_aai`.**

## Publishing by hand

Before pipeline 2 exists, or in an emergency. It uses your admin credentials in the stage account instead of
`docs-publisher`, so nothing narrows it to one site: check `--slug` and the site directory.

**Publish committed content only.** The toolkit builds every file git would commit, untracked files included, so
that a local preview shows a new page before it is committed. Published from a working tree, that would put notes
nobody has committed or reviewed on the site and into OrcaSonar's index. The pipeline builds only the pushed commit;
to do the same by hand, build from a clean export of the commit, as the knowledgebase example below does. Outside a
git checkout the toolkit takes every file in the folder.

```sh
cd docs-platform
python3.12 -m venv .venv && source .venv/bin/activate
pip install --require-hashes --no-deps -r toolkit/requirements/build.txt
pip install --no-deps ./toolkit

aws sso login --profile dev && export AWS_PROFILE=dev AWS_REGION=ap-southeast-2
export UMCCR_DOCS_SOURCE_REPO=umccr/docs-platform UMCCR_DOCS_COMMIT=$(git rev-parse HEAD)
DOCS_BUCKET=$(aws ssm get-parameter --name /docs/content-bucket-name --query Parameter.Value --output text)

umccr-docs check --config mkdocs.yml
umccr-docs build --config mkdocs.yml --site-dir /tmp/platform-site
umccr-docs verify-site /tmp/platform-site
umccr-docs publish /tmp/platform-site --slug platform --bucket "$DOCS_BUCKET" --dry-run
umccr-docs publish /tmp/platform-site --slug platform --bucket "$DOCS_BUCKET"
```

For another site, run the same from its repository with its own `--config` and `--slug`, and its name in
`UMCCR_DOCS_SOURCE_REPO`. To send the documents to OrcaSonar as well, export them and name its bucket:

```sh
umccr-docs export-kb --config mkdocs.yml --commit "$UMCCR_DOCS_COMMIT" --out /tmp/platform-kb
umccr-docs publish /tmp/platform-site --slug platform --bucket "$DOCS_BUCKET" --documents /tmp/platform-kb \
  --documents-bucket "$(aws ssm get-parameter --name /orcasonar/ingest-bucket-name --query Parameter.Value --output text)"
```

The knowledgebase, from its committed notes only:

```sh
cd management-knowledgebase
SRC=$(mktemp -d)
git archive HEAD PlatformServices | tar -x -C "$SRC"   # committed notes only
cp mkdocs.yml "$SRC/"                                   # until mkdocs.yml is committed; then add it to the archive
export UMCCR_DOCS_SOURCE_REPO=umccr/management-knowledgebase UMCCR_DOCS_COMMIT=$(git rev-parse HEAD)
(cd "$SRC" && umccr-docs build --site-dir /tmp/kb-site && umccr-docs verify-site /tmp/kb-site &&
  umccr-docs export-kb --commit "$UMCCR_DOCS_COMMIT" --out /tmp/kb-kb)
umccr-docs publish /tmp/kb-site --slug management-knowledgebase --bucket "$DOCS_BUCKET" --documents /tmp/kb-kb \
  --documents-bucket "$(aws ssm get-parameter --name /orcasonar/ingest-bucket-name --query Parameter.Value --output text)"
```

A hand publish has no release number, so it replaces whatever is live; the pipeline's next release replaces it in
turn. Never publish a site by hand while the pipeline is publishing it: the two would overlap and could leave a mix
of both releases.
