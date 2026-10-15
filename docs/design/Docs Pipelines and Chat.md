UMCCR Platform Services · proposal for review

# Docs pipelines and chat

Two proposals that build on docs.umccr.org as it runs in dev today. First, publish every site through a pipeline the platform generates, so a site repository needs no workflow, environment or token. Second, let readers and AI tools ask questions of the documentation through Amazon Bedrock, with answers that link to the pages they came from.

Proposal · nothing built or changed yet

Based on the dev deployment of branch `feat/docs-umccr-org` and on AWS and GitHub documentation checked on 7 October 2026. The current system is described on the [docs.umccr.org architecture](https://claude.ai/artifact/TUtBrjcoBmfaLZApu11pAW) page.

[Summary](#summary) [Part 1: site pipelines](#today) [How a site publishes](#pipeline) [Tokens and options](#options) [Part 2: docs chat](#chat) [Asking a question](#ask) [Keeping it current](#ingest) [Choices and safeguards](#choices) [Plan and decisions](#plan)

## Summary

### Part 1 · Generated site pipelines

- Each registered site gets its own CodePipeline in the toolchain account, generated from `lib/docs/sites.ts` the way the portal’s app pipelines are.
- It reads the repository through the AWS CodeConnections GitHub App UMCCR already uses: no personal access token, nothing stored in the site repository.
- The build has no write access. Publishing assumes the same per-site role as today, now trusted by the pipeline instead of GitHub OIDC.
- Site repositories lose the publishing workflow and environments; a small pull-request check can stay.

### Part 2 · Docs chat on Bedrock

- A chat panel on every docs page, served from the same host and protected by the same session cookie as the pages.
- Answers come from Claude Sonnet 5 in the Australian geography, grounded in a Bedrock managed knowledge base in Sydney, with links to the pages used.
- The pipeline that publishes a site also fills the knowledge base, from the same build, so it never holds anything the site doesn’t.
- Other AI tools reach the same knowledge base as an MCP server through AgentCore Gateway.

Part 1

## Generated site pipelines

Publishing works in dev today, but each site repository carries its own setup: a caller workflow, two GitHub environments with two variables each, and a role per site that trusts that repository. Every new site repeats it, and the platform team can’t see or re-run a publish without access to the site’s repository.

The proposal moves publishing into the platform. A site repository holds only its documentation; the platform builds and publishes it, using the same toolkit and the same per-site role.

new or changed removed from the site repository publishing

**Today, left; proposed, right.** The toolkit, its checks, the per-site role and its prefix, the no-cache publishing rules and the registry as the one place a site is declared all stay as they are. What moves is where the publish runs and what the role trusts.

## How a site publishes

The site pipeline follows `PortalAppPipeline` in `lib/portal/infra/app-pipeline.ts`: a CodePipeline V2 in the toolchain account that pulls another repository through CodeConnections, builds in CodeBuild and deploys cross-account, stage by stage. Docs adds two things: a build step with no write access, and a publish step that assumes a per-site role.

new or changed a site’s release a registry change

The prod account mirrors the dev account. Only the dev side carries step numbers; Publish prod repeats the same calls.

### Each step

1. D1Someone merges a registry change in `frontend-infrastructure-pipelines`.
2. D2`DocsInfrastructurePipeline` creates or updates that site’s pipeline, and its publisher role in each stage.
3. P1A writer merges to `main`. If the change touches the site’s docs paths, the GitHub App starts the site’s pipeline.
4. P2Build checks the project, builds strictly, verifies the output and exports the knowledge-base documents.
5. P3Publish dev assumes the site’s publisher role in the dev account.
6. P4It publishes the pages and the knowledge-base documents, pruning what the build no longer has.
7. P5It starts ingestion and waits for the knowledge base to finish.
8. P6If the site requires it, someone approves the release to prod.
9. P7Publish prod repeats P3 to P5 in the prod account, with the same artifacts.

### Each node

Registry, `lib/docs/sites.ts`

Already allocates each slug, creates its publisher roles and routes its URLs. It would also say which branch to build, which paths start a run (for example `PlatformServices/**` and `mkdocs.yml`, so a README edit publishes nothing), which docs-platform tag builds the site, and whether prod needs an approval.

Site repository

Markdown and `mkdocs.yml`, nothing else. Writers keep merging to `main` as they do today.

AWS Connector for GitHub

The GitHub App behind AWS CodeConnections, installed on the umccr organisation and already used by the portal’s pipelines (its connection ARN is in SSM as `codestar_github_arn`). It delivers push events and source archives to CodePipeline. AWS holds the credential, so there is no token to store, rotate, or lose when someone leaves. If the app is installed for selected repositories only, an organisation owner adds each docs repository once.

umccr/docs-platform

The toolkit and the hash-pinned engine, installed at the tag the registry pins (`v1` today). Pinning per site lets one site try a new toolkit release before the others. Later this can become a prebuilt builder image in the toolchain account, so a build downloads nothing.

DocsInfrastructurePipeline

The existing self-mutating pipeline that deploys `DocsHostingStack` to each stage. Merging a registry change would also deploy one site pipeline per entry, so adding a site never means building a pipeline by hand.

1 · Source

A CodeConnections source action on the site’s `main` branch. A CodePipeline V2 trigger filters pushes on the registry’s paths, as the portal’s app pipelines already do. Its output is a zip of the commit.

2 · Build

CodeBuild runs `umccr-docs check`, `build` and `verify-site` exactly as the workflow does today, plus a new `export-kb` step that writes the knowledge-base documents for part 2. Its role can read the source and write pipeline artifacts, and nothing in any stage account, so repository content never runs with publishing rights.

3 · Publish dev

A CodeBuild project whose role can do one thing in the dev account: assume this site’s publisher role. It runs `umccr-docs publish` (upload, prune with the mass-delete guard, `_publish.json` last), uploads the knowledge-base documents, starts ingestion and waits for it, so a failed ingestion fails the run.

4 · Approve

A manual approval, only for sites whose registry entry asks for one. Merging publishes straight to production today (decision D3), so the default stays off.

5 · Publish prod

The same step against the prod account, with the same artifacts. Nothing is rebuilt between dev and prod.

`docs-publisher-<slug>`

The per-site role each stage already has. Its trust policy changes from GitHub OIDC to this site’s pipeline publish role. It can write `sites/<slug>/` in the content bucket and `kb/<slug>/` in the knowledge-base bucket, and start ingestion. The portal grants its pipelines the whole toolchain account on its buckets; docs keeps the narrower per-site grant.

Content bucket

Unchanged. CloudFront serves `sites/<slug>/` to signed-in readers.

Knowledge-base bucket and managed knowledge base

New in part 2: a private bucket per stage that the knowledge base reads and CloudFront never serves, and the knowledge base it feeds. They belong to `DocsHostingStack`, like the content bucket.

## Tokens, and the options considered

The question was whether a central service could check out the private repositories with a personal access token. It could, but it doesn’t need one. CodeConnections is itself a GitHub App installation that AWS holds; GitHub recommends GitHub Apps rather than tokens for long-lived organisation automation, and an installation token lasts at most an hour.

| Credential | Tied to a person | Lifetime | Reach | Use it? |
| --- | --- | --- | --- | --- |
| Classic personal access token | yes | until revoked, or a set expiry | every repository the person can see | no |
| Fine-grained personal access token | yes | expires and must be renewed | chosen repositories and permissions; org owners can require approval | only as a stopgap |
| GitHub App installation token | no | at most one hour | the repositories the app is installed on, with the app’s permissions | when a raw token can’t be avoided |
| AWS CodeConnections | no | managed by AWS | the AWS Connector app’s installation | **yes, already used at UMCCR** |

### Four ways to run the builds

|  | Today: a workflow in each repository | Central GitHub Actions workflow | CodeBuild organisation webhook | Generated site pipelines (recommended) |
| --- | --- | --- | --- | --- |
| In each site repository | workflow and two environments | a dispatch workflow and a secret, or nothing if it polls | nothing | nothing |
| Credential | GitHub OIDC | a GitHub App’s private key, stored in GitHub | a personal access token or OAuth with organisation-webhook rights | the existing CodeConnections app |
| Access scope | one role per site | one role for every site | one role for every site | one role per site |
| Gate before prod | environment rules | environment rules | none built in | an approval stage |
| Feedback on pull requests | a check on the PR | a check, through the API | build status on the PR | none; keep a small PR check |
| Fits how UMCCR builds | yes | a new pattern | a new pattern | same as the portal’s app pipelines |

### Pull-request checks

A pipeline run doesn’t show up as a check on a pull request, so without one a writer only hears about a broken link after merging. Keep a short workflow that runs on pull requests only and calls the existing build job of `docs.yml@v1`. It has no AWS access and needs no environment or secret. A team that doesn’t want it can drop it; the pipeline still refuses to publish a build that fails its checks.

### Moving over, one site at a time

1. Add the pipeline for the platform site in dev, with its publisher role trusting both GitHub OIDC and the pipeline.
2. Compare the `_publish.json` each writes, then let the pipeline publish that site to prod.
3. Remove the publish job from the site’s workflow, keep the pull-request check, and drop the OIDC trust.
4. Repeat for the knowledgebase and each later site.

Part 2

## Docs chat on Bedrock

Readers ask a question on any docs page and get an answer drawn only from UMCCR documentation, with links to the pages it came from. Other AI tools can search the same content. It all runs in UMCCR’s AWS accounts, in Sydney, with Claude kept in the Australian geography.

### Changes to the first sketch

| In the first sketch | Proposed | Why |
| --- | --- | --- |
| Lambda@Edge auth check | Keep the CloudFront Function and session Lambda we have | Built and tested in dev. Lambda@Edge needs us-east-1 and runs a Lambda on every request. |
| Job B syncs raw Markdown | Upload the toolkit’s processed Markdown, with a `.metadata.json` per page | Raw wikilinks and Bases queries embed badly. The metadata turns citations into links to the page, and the knowledge base never holds anything the site doesn’t. |
| OpenSearch Serverless (“pgvector”) | Bedrock’s managed knowledge base | No vector database to run; embeddings, reranking and hybrid search included. OpenSearch Serverless bills a minimum even when idle, and pgvector is Aurora, not OpenSearch. |
| Claude 3.5 Sonnet | Claude Sonnet 5 through `au.anthropic.claude-sonnet-5` | A current model, kept in the Australian geography. |
| React widget, API Gateway, Cognito authorizer | A chat panel in the UMCCR theme, calling `/_api/chat` on the same host | The edge function already checks the session cookie, so pages and chat share one sign-in: no tokens in page JavaScript, no CORS, no second authorizer. |
| RetrieveAndGenerate | Retrieve, then ConverseStream, in our Lambda | We control the prompt, streaming, the guardrail and the citation format. |
| Not shown | Ingestion trigger, guardrail, per-reader quota, logging, a set of test questions | What production needs. |

new or changed a question ingestion AI tools over MCP

Shown for one stage. The chat runs on the existing distribution, so it is only reachable by readers who are already signed in.

### Each step

1. Q1The chat panel posts the question to `/_api/chat` with the session cookie; the answer streams back the same way.
2. Q2The viewer-request function checks the cookie, and CloudFront forwards the request to the chat Lambda, signed with origin access control.
3. Q3The Lambda checks and counts the reader’s questions for the day.
4. Q4It retrieves the best-matching passages from the knowledge base.
5. Q5It calls Claude Sonnet 5 with the passages and the guardrail, and streams the answer, then the source links.
6. I1The site pipeline writes processed Markdown and metadata under `kb/<slug>/`.
7. I2The knowledge base syncs, reading only new, changed and deleted documents.
8. M1An AI tool calls the knowledge base’s MCP tool through AgentCore Gateway.
9. M2The gateway runs a retrieval and returns the passages.

### Each node

Chat panel

Part of the UMCCR theme script, so it appears on every site with no work per site; the publishing contract still forbids project scripts. It sends the question to `/_api/chat` on the same host with the SHA-256 of the body in `x-amz-content-sha256`, which origin access control requires for a POST to a function URL, and shows the streamed answer and its sources.

Session cookie

The existing `__Host-docs_session`. Chat needs no other sign-in, and page JavaScript never handles a token.

Viewer-request function

Already runs on every request. For `/_api/*` it requires a valid session, answering 401 otherwise as it does for any non-navigation request, and sets `x-docs-sub` from the verified cookie, overwriting any client value, so the Lambda knows who is asking without seeing a token.

Behaviour `/_api/*`

A new CloudFront behaviour: POST allowed, caching disabled, origin is the chat Lambda’s function URL through origin access control, so the Lambda can’t be called directly.

Chat Lambda

Checks the reader’s daily quota, retrieves passages, builds the prompt, calls Claude with the guardrail and streams the answer back through CloudFront; function URLs support response streaming. It follows the session Lambda’s rule: log the reader’s `sub` and the outcome, never a token.

DynamoDB table

Questions per reader per day, for the quota, and an optional thumbs up or down per answer.

Managed knowledge base

Bedrock’s fully managed knowledge base (generally available since June 2026, including in Sydney): parsing, chunking, managed embeddings, a managed reranker and hybrid search, with no vector database to run. Each chunk keeps its page’s url, slug and title.

Bedrock Guardrail

Applied to every Converse call: topics to refuse, masking of personal data in answers, and a grounding check that flags answers the sources don’t support.

Claude Sonnet 5

Called through the `au.anthropic.claude-sonnet-5` geographic inference profile, which keeps processing in Australia and New Zealand. If Australia-only is required, check the destination Regions on the model card first.

Knowledge-base bucket

Private, one per stage. The site pipeline writes `kb/<slug>/`; CloudFront never serves it.

AgentCore Gateway

Exposes the knowledge base as an MCP tool. Callers authenticate with IAM or OAuth. It doesn’t pass the caller on as the document-level user, so any per-user filtering through the gateway has to be explicit.

Logs, metrics and alarms

Bedrock model invocation logging to a bucket or log group in the same account, with a retention the team sets; Lambda errors and latency; questions per reader; and an AWS Budgets alarm on Bedrock spend.

Other AI tools

Claude Code, internal agents and anything else that speaks MCP.

Site pipeline

Part 1’s publish step, which keeps `kb/<slug>/` in step with the published site.

## Asking a question

One question from the chat panel to the streamed answer.

Solid arrows are requests and dashed arrows are responses. Everything between the browser and the Lambda passes through CloudFront, including the streamed answer.

### The prompt

Rules first: answer only from the numbered sources, cite them, and say plainly when the documentation doesn’t cover the question. Then the sources, the last few turns of the conversation for follow-up questions, and the question.

### Citations

Each source carries its page’s `url` and title from the metadata, so the panel lists real links to docs.umccr.org pages. A question can be narrowed to the current site with a filter on `slug`.

### Limits

A daily question limit per reader, reserved concurrency on the chat Lambda, and optionally an AWS WAF rate rule on `/_api/*` keep one reader or one bug from running up the bill.

## Keeping the knowledge base current

The knowledge base is refreshed by the same run that publishes the site, from the same commit. A page appears in chat when it appears on the site, and disappears when it disappears.

Ingestion is incremental: the knowledge base reads only documents that were added, changed or deleted since its last sync.

### Why processed Markdown

Vault notes contain wikilinks, Bases queries and callout syntax that embed badly and can’t be linked. The toolkit already resolves them for the site build, so `export-kb` reuses that output: the same files, under the same exclusions.

### Deletions

The publish step deletes knowledge-base documents the build no longer has, under the same mass-delete guard as the site, and the next sync removes them from the index.

### Two sites at once

If an ingestion job is already running when a second site publishes, that site’s publish step waits and retries rather than failing.

### What one page looks like in the knowledge-base bucket

```
kb/management-knowledgebase/Projects/example-project.md
kb/management-knowledgebase/Projects/example-project.md.metadata.json

{
  "metadataAttributes": {
    "url":    { "value": { "type": "STRING", "stringValue":
                "https://docs.umccr.org/management-knowledgebase/Projects/example-project/" },
                "includeForEmbedding": false },
    "slug":   { "value": { "type": "STRING", "stringValue": "management-knowledgebase" },
                "includeForEmbedding": false },
    "title":  { "value": { "type": "STRING", "stringValue": "Example project" },
                "includeForEmbedding": true },
    "commit": { "value": { "type": "STRING", "stringValue": "<commit sha>" },
                "includeForEmbedding": false }
  }
}
```

Format from the managed S3 connector’s documentation; the page path is an example. Metadata files can sit beside each page or under a separate prefix the data source names.

## Choices and safeguards

### Which knowledge base

|  | Managed knowledge base (recommended) | Self-managed, with S3 Vectors | Self-managed, with OpenSearch Serverless |
| --- | --- | --- | --- |
| What we run | the knowledge base only | a vector bucket and index | a search collection |
| Embeddings and chunking | managed defaults; other Bedrock models at standard prices | our choice of model and chunking | our choice of model and chunking |
| Search | hybrid search and a managed reranker | semantic search | hybrid search |
| Cost at our size | $5 per GB-month indexed, $1 per 1,000 retrievals; parsing, embeddings and reranking included | pay for vector storage and queries | a minimum capacity charge, even when idle |
| Choose it when | by default | we need chunking control, or must prove the embedding model runs in Sydney | we already run OpenSearch |

### Access, residency, quality and cost

| Concern | How it’s handled |
| --- | --- |
| Who can ask about what | Every signed-in reader can read every site (ADR-0005), so one knowledge base with no per-user filtering matches today’s policy. If a site later needs a narrower audience, the managed knowledge base supports ACL files and metadata filters on `slug`. |
| Data residency | The knowledge base, its bucket and the chat Lambda stay in Sydney, and Claude runs in Australia and New Zealand through the `au.` profile. Before indexing anything sensitive, ask AWS where the managed embedding and reranking models run; if that has to be provable, use a self-managed knowledge base with an in-Region embedding model. |
| Wrong or invented answers | Answers come only from retrieved passages, cite them, and say so when the docs don’t cover a question. The guardrail’s grounding check flags unsupported answers, and a fixed set of real questions is re-run on each toolkit release. |
| Sensitive content | The knowledge base holds exactly what the site publishes, under the same classification banner. The guardrail masks personal data in answers. |
| Cost | Index storage and retrieval cost little for a docs corpus. Model tokens dominate, so each reader gets a daily question limit and Bedrock spend has a budget alarm. |
| OrcaBus APIs | Chat never sends the docs-app tokens anywhere; the docs-app client stays out of the OrcaBus API authorizers. |

### Building AI systems on it

The managed knowledge base plugs into AgentCore Gateway as a ready-made MCP target. Claude Code and internal agents can then find a “search UMCCR docs” tool and call it, without anyone writing a separate integration. Callers authenticate to the gateway with IAM or OAuth. Because every reader can read every site today, the gateway can serve all of it; if per-site audiences arrive, filtering through the gateway has to be added explicitly.

## Plan and decisions

1. **Spike in dev**

   Create a managed knowledge base over a dev bucket, hand-run a prototype export of the knowledgebase vault, and try about 20 real questions from the team.

   Done when answers are useful, citations open the right pages, and AWS has answered the residency question.
2. **Site pipelines**

   Generated site pipelines in frontend-infrastructure-pipelines, the platform site first, then the knowledgebase. Publisher roles trust the pipeline; `export-kb` and ingestion join the publish step.

   Done when both sites publish to dev and prod through their pipelines and their publish workflows are gone.
3. **Chat**

   The chat Lambda, the `/_api/*` behaviour, the edge-function change, the chat panel, the guardrail, quotas, logging and alarms, in dev and then prod.

   Done when readers in dev use it and the question set passes.
4. **MCP and evaluation**

   The AgentCore Gateway target, and the question set run on every toolkit release.

   Done when an engineer can search the docs from Claude Code.

### Decisions for the team

1. Keep a pull-request check workflow in site repositories?
2. Should any site need an approval before prod? Today, merging publishes straight to prod.
3. Managed or self-managed knowledge base, decided after the spike.
4. How long to keep questions and answers in invocation logs, and whether to keep them for evaluation.
5. The daily question limit per reader.

## Sources

- CI/CD: [CodeBuild organisation webhooks](https://docs.aws.amazon.com/codebuild/latest/userguide/github-global-organization-webhook-setup.html); [GitHub: when to build a GitHub App](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/deciding-when-to-build-a-github-app); [GitHub: personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens); `lib/portal/infra/app-pipeline.ts` in frontend-infrastructure-pipelines
- Managed knowledge base: [announcement](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-managed-knowledge-base/); [launch post](https://aws.amazon.com/blogs/aws/introducing-amazon-bedrock-managed-knowledge-base-for-faster-more-accurate-enterprise-ai-applications/); [pricing and APIs](https://aws.amazon.com/blogs/machine-learning/build-enterprise-search-for-agents-with-amazon-bedrock-managed-knowledge-base/); [Regions](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-regions.html); [S3 connector and metadata files](https://docs.aws.amazon.com/bedrock/latest/userguide/kb-managed-ds-s3.html); [a developer’s caveats](https://builder.aws.com/content/3GSHEqVSuzVR0d8x4TJh2RWsXaE/amazon-bedrock-managed-knowledge-base-a-developers-take)
- Vector store: [S3 Vectors generally available](https://aws.amazon.com/blogs/aws/amazon-s3-vectors-now-generally-available-with-increased-scale-and-performance/)
- Models: [Australian cross-Region inference](https://aws.amazon.com/blogs/machine-learning/introducing-amazon-bedrock-cross-region-inference-for-claude-sonnet-4-5-and-haiku-4-5-in-japan-and-australia/); [Claude Sonnet 5 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5.html)
- Serving: [origin access control with function URLs](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html); [streaming through function URLs](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html)