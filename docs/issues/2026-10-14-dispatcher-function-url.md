# The dispatcher accepts unauthenticated calls through a public function URL

**Status:** open; deferred 2026-10-15, keeping the current design for now
**Found:** 2026-10-14, in the toolchain account's site publishing (`DocsInfrastructurePipeline`), while reviewing which
resources accept calls from the internet

## What happened

Publishing works as [ADR-0006](../design/adr/0006-dispatched-publishing.md) designed it: the umccr organisation's
webhook posts every push in the organisation to the dispatcher's function URL. The URL has no AWS authentication
(`AuthType: NONE`), so the function's resource policy lets anyone invoke it through the URL. The function checks
GitHub's `X-Hub-Signature-256` against the webhook secret before it reads anything else, and answers 401 to
anything unsigned.

The platform aims for nothing in publishing to accept calls from the internet. On 2026-10-14 we compared ways to
remove the public path, and wrote and tested one of them (option A below). On 2026-10-15 the team decided to keep
the current design for now: the implementation was reverted before merge, and the plan is kept in
[ADR-0009](../design/adr/0009-dispatch-from-github-actions.md) and
[plans/publishing-from-github.md](../plans/publishing-from-github.md).

## Why

GitHub's webhooks cannot sign AWS requests, so whatever receives them has to accept unauthenticated HTTPS requests and
check GitHub's signature itself. The function URL is the smallest endpoint that can do that.

What limits it, by design:

- the signature is checked first, with a timing-safe comparison, so an unsigned request costs one HMAC and a 401;
- the slug comes from the registry, never from the event, and a push from an unregistered repository or branch stops
  at a lookup;
- each delivery ID is recorded, so a repeated delivery starts nothing;
- the function's role may only start the fetch build, pass the GitHub connection, write the dispatch table and read
  the webhook secret;
- the build step has no write access, and each publish is narrowed to its own site's prefixes.

## Impact

None: no incident, and no content exposed. This records a design limitation and the decision to keep it for now.

## Resolution

Open. The options compared on 2026-10-14:

| | Option | Removes the public path | Per-site setup | Running cost | Notes |
| --- | --- | --- | --- | --- | --- |
| A | Sites' GitHub Actions workflows sign in through OIDC and invoke the dispatcher ([ADR-0009](../design/adr/0009-dispatch-from-github-actions.md)) | yes: no function URL, no resource policy | one 12-line workflow file | about US$0; about one Actions minute per publish in a private repository | GitHub signs the repository, branch and commit. Written and tested, then reverted; [the plan](../plans/publishing-from-github.md) has every step |
| B | An API Gateway REST API in front of the function | no | none | cents a month; about US$6–7 more with a WAF | API Gateway cannot check GitHub's signature (an authorizer never sees the body), so the method stays unauthenticated; an authorizer could only check a token in the URL or the caller's address. GitHub's webhook addresses change, and GitHub advises against allow-lists. AWS's best-practice checks for a new REST API stage expect a client certificate, execution logs and a WAF |
| C | CloudFront with origin access control | — | — | — | not possible: for a request with a body, the caller must send the body's SHA-256 in a signed header, which GitHub's webhooks do not |
| D | CodeBuild's own organisation webhook, with no function | yes: no function at all | none | about US$0 | CloudFormation cannot create the webhook for manual setup, so CodeBuild needs a personal access token or a person's OAuth grant that may create organisation webhooks. CodeBuild does not say whether its file-path filter sees every commit of a push. Needs a spike |
| E | Keep the function URL | no | none | as today | **chosen for now**; optional hardening below |

**When revisited, A is recommended**: it removes the public path entirely, gives the dispatcher GitHub's signature
on the repository, branch and commit instead of a shared secret, costs nothing to run, and its only per-site cost is
a short workflow file.

**Optional hardening while the URL stays:**

- an alarm on the dispatcher's `bad-signature` log lines (a CloudWatch metric filter, alarming to the alerts Slack
  channel), so unexpected traffic is noticed;
- reserved concurrency on the dispatcher, for example 10, so a burst of unsigned requests cannot use the account's
  Lambda concurrency. GitHub's deliveries need far less: about 75 a day on 2026-10-13;
- rotating the webhook secret on a schedule, and when someone who could read it leaves
  ([runbook](../site/runbook.md#rotate-the-webhook-secret)).

**Next steps:**

- [ ] Record the decision through the organisation's security process, privately ([SECURITY.md](../../SECURITY.md)).
- [ ] Decide on the optional hardening.
- [ ] Revisit before the production rollout ([implementation plan](../plans/implementation-plan.md), Production).
- [ ] For option A, follow the plan's "What implementing it changes", then "Deploying it".

## Follow-ups

- [ADR-0009](../design/adr/0009-dispatch-from-github-actions.md): proposed, deferred.
- [Plan: publishing from GitHub](../plans/publishing-from-github.md): diagrams, the changes, and the deploy steps.
- [Implementation plan](../plans/implementation-plan.md): the risk row for the function URL, and a Production task
  to decide before prod.
