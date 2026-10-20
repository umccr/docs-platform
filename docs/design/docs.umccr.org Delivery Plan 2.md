UMCCR Platform Services · delivery plan

# docs.umccr.org delivery plan

How docs.umccr.org takes on any number of documentation repositories with two pipelines in total, and adds a budget-capped chat over the documentation on Amazon Bedrock. This replaces the earlier proposal with the decisions the team has made.

Plan · decisions recorded 8 October 2026 · nothing built yet

Builds on the dev deployment of branch `feat/docs-umccr-org` (see the [architecture](https://claude.ai/artifact/TUtBrjcoBmfaLZApu11pAW) page) and reviews the earlier [pipelines and chat proposal](https://claude.ai/artifact/5bBm8WEpWYvB3c1zY7CMMn). AWS and GitHub details checked on 8 October 2026.

[Decisions](#decisions) [What changed](#changes) [Publishing](#publishing) [One release](#release) [Adding sites](#scale) [Knowledge base](#kb) [Chat](#chat) [Cost](#cost) [Records](#records) [Plan](#plan)

## Decisions

| Topic | Decision | Status |
| --- | --- | --- |
| Building and publishing sites | One shared site pipeline in the toolchain account, started per release by a dispatcher behind an organisation-wide GitHub webhook, with the repository and commit as variables. Built with CodePipeline and CodeBuild, the way the portal builds its apps. | decided |
| Number of pipelines | Two in total, however many sites join: DocsInfrastructurePipeline (existing) and DocsSitesPipeline (new). The platform site is just another registry entry. | decided |
| Approval before prod | None. Documentation changes no data and no running system; a release goes to dev and then straight to prod, and a failure in dev stops it. | decided |
| Knowledge base | Bedrock managed knowledge base, serverless and pay as you go, with the default minimal configuration. | decided |
| Questions and answers | Kept 30 days in a bucket, for evaluation. | decided |
| Chat budget | $50 a month for the prod chat, enforced by the application (below). | proposed |

## What changed from the earlier proposal

The earlier proposal generated one pipeline per site. That is simple for a handful of sites but adds a pipeline, its projects and its roles for every repository, in an organisation account that already holds about 100 pipelines. This plan keeps the number of pipelines fixed at two and moves the per-site detail into the registry and the variables of each run.

| Topic | Previous proposal | This plan | Why |
| --- | --- | --- | --- |
| Site pipelines | one generated pipeline per site | one shared pipeline, started by a dispatcher | the org account already holds about 100 pipelines; docs should add a fixed number however many repositories join |
| Trigger | a CodeConnections push trigger per pipeline | one organisation webhook, filtered against the registry by the dispatcher | one integration covers every current and future repository |
| Fetching the code | the pipeline’s own source action | a fetch build that clones through CodeConnections, then an S3 source set per run | still no personal access token; the webhook’s signing secret is the only secret |
| Prod gate | optional approval per site | none: dev, then prod automatically | decided; dev acts as the smoke test |
| Publisher roles | one per site and stage | one per stage, narrowed to the site on every run with a session policy | no new IAM role per site |
| Out-of-order releases | not an issue with one pipeline per site | a release number per site; publishing skips a release older than the live one | parallel runs can finish in any order |
| Knowledge-base ingestion | each publish starts a job | a check every 15 minutes starts at most one job, plus the managed daily sync | many sites can publish at once, and ingestion jobs on one data source can’t overlap |
| Chat cost | open | $50 a month, with daily team and per-reader allowances | proposed |
| Questions and answers | open | 30 days in a records bucket; curated examples kept for evaluation | decided |

## Publishing: one webhook, one dispatcher, two pipelines

Every push in the organisation reaches one small Lambda. It drops everything that isn’t a push to a registered docs repository, and turns the rest into a run of the one shared site pipeline, with the site and commit as variables. Code is fetched through the AWS Connector app the organisation already uses, so no personal access token or GitHub App key is involved.

new or changed a release a registry change

The prod account mirrors the dev account; only the dev side carries the R10 badge. Pipeline 1 deploys everything outlined in blue, in the toolchain and in each stage.

### Each step

1. D1A registry change merges in `frontend-infrastructure-pipelines`. DocsInfrastructurePipeline updates routing and the catalogue in each stage, and the dispatcher’s copy of the registry.
2. R1A writer pushes to `main`. GitHub posts the push event, signed with the webhook secret, to the dispatcher’s URL.
3. R2The dispatcher checks the signature and the registry, records the delivery so a repeat does nothing, and takes the site’s next release number.
4. R3It starts the fetch build for that repository and commit, and answers GitHub straight away.
5. R4The fetch build clones the repository at the commit through the AWS Connector app.
6. R5It zips the files to `sources/<slug>/<commit>.zip` in the source bucket.
7. R6It starts the site pipeline with that object key and the variables `SLUG`, `REPO`, `COMMIT`, `RELEASE` and `TOOLKIT_REF`.
8. R7Build runs the toolkit: check, strict build, verify-site and export-kb. It can’t write anywhere.
9. R8Publish dev assumes the dev publisher role, narrowed to this site, and publishes the pages and the knowledge-base files.
10. R9Publish prod does the same in prod, as soon as dev succeeds.
11. R10Within 15 minutes, the knowledge base in each stage ingests the changed files.

### Each node

Docs repositories

Markdown and `mkdocs.yml`, nothing else: no workflow, no environments, no secrets. `umccr/docs-platform` is one of them and publishes `/platform/`.

Organisation webhook

Created once by an organisation owner. It sends push events for every repository in the umccr organisation, including repositories created later, to the dispatcher’s URL. Each delivery is signed with a secret kept in Secrets Manager.

AWS Connector for GitHub

The CodeConnections GitHub App UMCCR’s pipelines already use. CodeBuild can clone any repository the app can see at any commit, with no token. If the app is installed for selected repositories, an organisation owner adds each docs repository.

Registry, `lib/docs/sites.ts`

One entry per site: repository, slug, branch, docs paths, stages, toolkit tag, title. It drives routing, the catalogue and the dispatcher. On the platform side, onboarding a site is merging one entry.

Pipeline 1 · DocsInfrastructurePipeline

The existing self-mutating pipeline. It keeps deploying `DocsHostingStack` to each stage, and now also the dispatcher, the fetch build and the site pipeline in the toolchain account.

Dispatcher Lambda

Answers GitHub within a second or two. Rejects anything without a valid signature. Ignores events from repositories, branches or paths that aren’t in the registry, so pushes from the organisation’s other repositories cost a few milliseconds each. The slug always comes from the registry, never from the event.

Dispatch table

A DynamoDB table holding delivery IDs, which expire after a few days so a repeated delivery does nothing, and a release counter per site.

Fetch build

A CodeBuild project started once per release, with its source location, commit and CodeConnections authorisation set for that run. It clones the commit, zips the checkout without `.git`, and starts the site pipeline.

Source bucket

Holds one zip per release under `sources/<slug>/<commit>.zip`, so any run can be repeated from exactly the same files. Objects expire after 30 days.

Pipeline 2 · DocsSitesPipeline

A CodePipeline V2 in parallel mode: releases of different sites run side by side, up to 50 at once. Every run carries its site and commit in pipeline variables, so the execution history reads as a release log.

1 · Source

An S3 source action allowed to take its object key from the start request, so each run reads exactly the zip the fetch build wrote.

2 · Build

CodeBuild with no write access, running the toolkit at the tag the registry pins: `umccr-docs check`, `build`, `verify-site` and the new `export-kb`. Repository content never runs with publishing rights.

3 · Publish dev

Assumes the dev account’s `docs-publisher` role with a session policy that allows only `sites/<slug>/` and `kb/<slug>/`. Publishes pages and knowledge-base files, and records the release number in `_publish.json`. If the live release is newer, it skips instead.

4 · Publish prod

The same step in the prod account with the same artifacts, as soon as dev succeeds. No approval.

`docs-publisher`

One role per stage account, replacing the role per site. It trusts only the site pipeline’s publish role and may write `sites/*` and `kb/*`; each run narrows it to one site.

Content bucket

Unchanged. CloudFront serves `sites/<slug>/` to signed-in readers.

Knowledge-base bucket

Private, per stage, never served. Holds the processed Markdown and metadata from `export-kb`.

Managed knowledge base

One per stage, in the default configuration below. A small scheduled check, every 15 minutes, starts an ingestion job when any `kb/` file is newer than the last job. The managed daily sync catches anything missed.

## One release, end to end

The order of events for a single push, and the two rules that keep shared, parallel runs safe.

Solid arrows are requests, dashed arrows are responses. A typical release is live in prod a few minutes after the push.

### Newer release wins

Runs of the same site can overlap and finish in any order. Each run carries the site’s release number, and the publish step compares it with the one in the live `_publish.json`: an older release is skipped, not published over a newer one.

### Repeats do nothing

GitHub can deliver an event twice, and a person can redeliver one from the webhook’s settings. The dispatcher records each delivery ID, so the second copy starts nothing.

### No approval, still a gate

Prod publishing waits for dev to succeed. A broken build, a failed check or a failed publish in dev stops the release before prod, and the pipeline’s failure notification says why.

## Adding sites

Nothing in the AWS accounts grows with the number of sites except objects in the buckets.

| What it takes to add a site | Per new site |
| --- | --- |
| Registry entry in `lib/docs/sites.ts` | one, reviewed in a pull request |
| Pipelines, CodeBuild projects, IAM roles | none |
| Workflows, environments or secrets in the site repository | none |
| GitHub | add the repository to the AWS Connector app, only if the app is limited to selected repositories |
| Edge function | one slug in its route table; CloudFront’s 10 KB limit fits about 50 long slugs, after which the table should go and unknown paths fall through to S3’s 404 |

## Knowledge base: the minimal managed setup

Bedrock’s managed knowledge base is serverless and charged by use: storage of the index and the number of retrievals, with parsing, embeddings and reranking included. Start with its defaults and change only what the spike shows is needed.

| Setting | Start with | Why |
| --- | --- | --- |
| Knowledge bases | one per stage (dev, prod), in ap-southeast-2 | dev content never mixes with prod |
| Data source | the S3 connector on the stage’s knowledge-base bucket, prefix `kb/`, metadata files alongside each page | one data source for every site; the metadata carries url, slug and title |
| Embeddings, reranker | the managed defaults | included in the price, nothing to choose or maintain |
| Retrieval | standard retrieval, top 8 passages | agentic retrieval costs five times as much; add it later for a Plan mode if needed |
| Document-level access control | off | every reader can read every site (ADR-0005). It can’t be switched on later, but a new data source and a re-ingest are cheap |
| Sync | the 15-minute check, plus the managed daily schedule | the daily schedule alone would leave chat up to a day behind the site |
| Infrastructure as code | in `DocsHostingStack` | CloudFormation models managed connectors; confirm the knowledge base resource during the spike, or use a small custom resource |

## Chat

Readers ask on any docs page and get answers drawn only from UMCCR documentation, with links to the pages used. The design is the earlier proposal’s, plus the budget ledger and the records bucket.

new or changed a question ingestion AI tools over MCP, later

Shown for prod; dev has the same pieces with its own budget. The chat is only reachable by readers who are already signed in.

### Each step

1. Q1The chat panel posts the question to `/_api/chat` with the session cookie; the answer streams back the same way.
2. Q2The edge function checks the cookie; CloudFront forwards the request to the chat Lambda, signed with origin access control.
3. Q3The Lambda checks today’s team and reader spend in the budget ledger, and records the cost afterwards.
4. Q4It retrieves the best-matching passages. In Search mode it stops here and lists them.
5. Q5In Ask mode it calls Claude Sonnet 5 with the passages and the guardrail, and streams the answer, then the source links.
6. Q6It writes the exchange to the records bucket.
7. I1Pipeline 2’s publish steps write processed Markdown and metadata under `kb/<slug>/`.
8. I2The 15-minute check starts ingestion when anything changed.
9. M1Later: an AI tool calls the knowledge base’s MCP tool through AgentCore Gateway.
10. M2The gateway runs a retrieval and returns the passages.

### Each node

Chat panel

Part of the UMCCR theme script, so every site gets it with no work per site. Two modes to start: Search, which lists passages, and Ask, which answers. It sends the SHA-256 of the request body, which origin access control requires for a POST to a function URL.

Viewer-request function and `/_api/*`

The existing session check covers chat too: no session, 401. A new behaviour sends `/_api/*` uncached to the chat Lambda through origin access control. The function adds `x-docs-sub` from the verified cookie.

Chat Lambda

Checks the budget, retrieves, builds the prompt, calls Claude with the guardrail, streams the answer through CloudFront, records the cost and writes the exchange to the records bucket. Its logs hold the reader’s `sub` and the outcome, never the question.

Budget ledger

A DynamoDB table with today’s spend per reader and the team’s spend this month, priced from the token counts Bedrock returns with every answer.

Managed knowledge base

Default configuration (above). Each chunk keeps its page’s url, slug and title, so sources become links and a question can be limited to the current site.

Bedrock Guardrail

Applied to every call: topics to refuse, masking of personal data in answers, and a grounding check that flags answers the sources don’t support.

Claude Sonnet 5

Through `au.anthropic.claude-sonnet-5`, which keeps processing in Australia and New Zealand. Haiku 4.5 is the cheaper option if the answers are good enough.

Records bucket

One JSON record per exchange, deleted after 30 days (evaluation, below).

Logs and alarms

Lambda errors and latency, spend per day, and an AWS Budgets alarm on Bedrock at $50, with an action that removes the chat Lambda’s Bedrock access.

AgentCore Gateway (later)

Exposes the knowledge base to MCP clients such as Claude Code. Not part of the first release.

One question in Ask mode. Solid arrows are requests, dashed arrows are responses.

## Cost, and keeping it under $50 a month

Model tokens are almost the whole bill. After about $2 a month of fixed costs, $48 is left for questions: about $1.60 a day.

| Item | Price |
| --- | --- |
| Claude Sonnet 5, `au.` profile | $2.20 per million input tokens, $11 per million output tokens |
| Claude Haiku 4.5, `au.` profile | $1.10 per million input tokens, $5.50 per million output tokens |
| Knowledge base | $0.001 per retrieval; storage $5 per GB-month (well under $1 for the docs) |
| Guardrail | $0.10 to $0.15 per 1,000 characters checked, per check type |
| Lambda, DynamoDB, records bucket, logs | about $2 a month together |

| Use | Tokens assumed | Cost each | Within $48 a month |
| --- | --- | --- | --- |
| Search: ranked passages and links, no model | none | $0.001 | unlimited in practice |
| Ask, with Sonnet 5 | 5,000 in, 400 out | about $0.019 | 2,500 a month, 84 a day |
| Ask, with Haiku 4.5 | 5,000 in, 400 out | about $0.011 | 4,250 a month, 140 a day |
| Plan (later), Sonnet 5 with agentic retrieval | 12,000 in, 2,000 out | about $0.06 | 790 a month, 26 a day |

### How the limit works

1. **Count dollars, not questions.** Bedrock returns the tokens used by every answer, so the Lambda prices each exchange and adds it to the budget ledger.
2. **A team allowance per day**: the money left this month divided by the days left. It starts near $1.60 and unused budget carries forward. When it runs out, Ask replies “try again tomorrow”; Search keeps working, as it costs a tenth of a cent.
3. **A cap per reader of $0.40 a day**, about 20 answers. It takes four readers at their cap to use up a day, so one person can’t block everyone else.
4. **Limits per request** on answer length, passages and conversation history keep the most expensive single answer to about 8 cents.
5. **A backstop**: an AWS Budgets alarm at $50 that removes the chat Lambda’s Bedrock access. Budgets data updates only a few times a day, so the ledger is the real control.

Token counts per request are estimates; the spike measures them. Answering with Haiku 4.5 instead stretches the same budget by about 70%.

## Questions and answers: 30 days, for evaluation

Every exchange is kept for 30 days in a private bucket and then deleted. Examples worth keeping longer are copied, without reader identifiers, into an evaluation set that measures answer quality before anything changes.

Readers are told in the chat panel, and on the platform’s reading page, that questions are kept for 30 days to improve answers.

1. E1The chat Lambda writes one JSON record per exchange: question, answer, cited pages and scores, model, tokens, cost, response time, guardrail outcome, and the reader’s Cognito `sub`. Feedback arrives later as its own record.
2. E2The records bucket deletes everything after 30 days. Only the platform team and the evaluation role can read it.
3. E3Once a week, someone copies thumbs-down answers and good examples into the evaluation set, with reader IDs removed.
4. E4The evaluation set is kept: each question, and the pages that should answer it.
5. E5Before a change to the model, the prompt or the toolkit ships, a Bedrock evaluation job scores retrieval and answers against the set.

Bedrock’s own model invocation logging is a setting for the whole account and Region, and would capture every Bedrock call in the account with full prompts. The chat writes its own records instead; turn invocation logging on only if docs chat is the account’s only Bedrock user.

## Plan

1. **Spike in dev**

   Create the managed knowledge base by hand on a dev bucket, prototype `export-kb` on the knowledgebase vault, and try about 20 real questions in Search and Ask. Confirm the CloudFormation resource for managed knowledge bases, and ask AWS where the managed embedding and reranking models run.

   Done when answers are useful, sources open the right pages, and the residency answer is in.
2. **Dispatched publishing**

   The organisation webhook, the dispatcher, the fetch build, DocsSitesPipeline and one `docs-publisher` role per stage, all deployed by DocsInfrastructurePipeline. Move `/platform/` first, then the knowledgebase, and remove their publish workflows.

   Done when a push to either repository is live in dev and prod within minutes, with nothing in the repositories but docs.
3. **Chat, first release**

   Search and Ask, the budget ledger and its $50 limit, the guardrail, the records bucket, alarms, and the 15-minute ingestion check: in dev, then prod.

   Done when readers use it in prod and the first evaluation set exists.
4. **Later**

   Pull-request checks run by the dispatcher (a check-only build reporting back to GitHub), a Plan mode, rebuilding every site when the toolkit tag moves, and the MCP endpoint through AgentCore Gateway.

   Each when someone needs it.

### To confirm

1. An organisation owner to create the webhook, and where its secret lives (Secrets Manager in the toolchain account).
2. Whether the AWS Connector app is installed for all repositories or for selected ones.
3. The $50 monthly chat budget, and the $0.40 daily cap per reader.
4. CloudFormation support for the managed knowledge base resource, and where its managed models run.

## Sources

- Pipelines: [starting a pipeline with a source override](https://docs.aws.amazon.com/codepipeline/latest/userguide/pipelines-trigger-source-overrides.html); [S3 object key overrides](https://docs.aws.amazon.com/codepipeline/latest/APIReference/API_SourceRevisionOverride.html); [execution modes](https://docs.aws.amazon.com/codepipeline/latest/userguide/execution-modes.html); [CodePipeline pricing](https://aws.amazon.com/codepipeline/pricing); [CodeBuild StartBuild source and CodeConnections overrides](https://docs.aws.amazon.com/codebuild/latest/APIReference/API_StartBuild.html)
- GitHub: [types of webhooks](https://docs.github.com/en/webhooks/types-of-webhooks); [push event payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- Knowledge base: [managed knowledge base](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-managed-knowledge-base/); [sync schedules](https://aws.amazon.com/about-aws/whats-new/2026/09/amazon-bedrock-managed-knowledge-base-automatic-sync-scheduling-data-source-connectors/); [CloudFormation sync schedule](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-properties-bedrock-datasource-syncschedule.html); [S3 connector](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-s3.html); [pricing](https://aws.amazon.com/blogs/machine-learning/build-enterprise-search-for-agents-with-amazon-bedrock-managed-knowledge-base/)
- Models and guardrails: [Claude Sonnet 5 on Bedrock](https://elevata.io/en/claude-sonnet-5-default-model-aws-bedrock); [regional pricing and Haiku 4.5](https://www.cloudzero.com/blog/amazon-bedrock-pricing/); [Guardrails pricing](https://cloudchipr.com/blog/amazon-bedrock-pricing)