# 0009: Dispatch from GitHub Actions through OIDC

**Status:** proposed, 2026-10-14; deferred 2026-10-15; revised and taken up again 2026-11-19. Would supersede the
organisation webhook, its secret and the dispatcher's function URL in [0006](0006-dispatched-publishing.md); the
dispatcher, the fetch build and the shared site pipeline would stay. The first version was implemented with tests on
2026-10-14 and reverted before merge; [the revision](#revised-2026-11-19) lists what has changed since. Tracked in
[issues/2026-10-14-dispatcher-function-url.md](../../issues/2026-10-14-dispatcher-function-url.md).

## Context

GitHub cannot sign AWS requests, so the organisation webhook needed the dispatcher on a function URL that anyone
could call. The dispatcher checked the webhook's signature before reading anything else, but the function's
resource policy still let any caller invoke it, and a function anyone can invoke is one the organisation's
security controls rightly question. The signature also rests on a shared secret, kept in two places and rotated by
hand. Hiding the function was not possible without giving up the webhook:

- **API Gateway in front of the function.** GitHub's only proof is a signature over the request body, which neither
  API Gateway nor its authorizers see, so the method would still need no authorization. Restricting callers to
  GitHub's webhook addresses needs upkeep: GitHub changes them and advises against allow-lists.
- **CloudFront with origin access control.** For a request with a body, the caller must send the body's SHA-256 in
  a signed header, which GitHub's webhooks do not.
- **CodeBuild's own organisation webhook,** with no function at all. Creating an organisation webhook needs a
  personal access token or a person's OAuth grant rather than the organisation's GitHub App, and CodeBuild does not
  say whether its file-path filter sees every commit of a push.

Two things have changed since the first version:

- GitHub builds a token's subject (`sub`) in one of two formats. Repositories created since 15 July 2026, renamed or
  transferred since, or opted in, carry their owner's ID and their own in it:
  `repo:<owner>@<owner ID>/<name>@<repository ID>:ref:refs/heads/<branch>`. Other repositories keep
  `repo:<owner>/<name>:ref:refs/heads/<branch>`, the format the first version trusted. Every registered repository
  uses the new format, so the first version's role would have refused all of them.
- IAM reads more of GitHub's claims in a role's trust policy, among them the repository, its owner's ID, the ref and
  the reusable workflow a job runs (`job_workflow_ref`). For GitHub's provider, IAM accepts `job_workflow_ref` in
  place of the subject.

## Decision

- Each registered site's repository has a small workflow, copied from `templates/docs-workflow.yml` in
  [umccr/docs-toolkit](https://github.com/umccr/docs-toolkit), that calls the shared reusable workflow
  `.github/workflows/publish-docs.yml` in this repository on a push to the site's branch, and on **Run workflow**.
- The shared workflow signs in to the toolchain account through GitHub OIDC as **`docs-dispatch`**, whose ARN is
  written in it, so site workflows pass it nothing. The role may only invoke the dispatcher.
- The role trusts the account's GitHub OIDC provider, which umccr/infrastructure's Terraform owns. It admits a token
  only when GitHub issued it for audience `sts.amazonaws.com` to a job running the shared workflow, at `main` or at a
  commit (`job_workflow_ref`), for a registered repository of the umccr organisation, checked by the organisation's
  ID, on a registered branch. The repositories and branches are generated from the registry. The policy never
  matches the subject.
- The workflow then asks GitHub for a second OIDC token, for the dispatcher's audience, and invokes the dispatcher
  with it and the files the push changed, which it reads from GitHub's compare API.
- The dispatcher verifies that token against GitHub's published keys and takes the repository, branch and commit
  from its signed claims. It accepts only the shared workflow in the umccr organisation, pushes and manual runs, and
  a registered repository on its own registered branch; a workflow run attempt starts at most one release. The
  changed files decide only whether to build.
- The dispatcher has no function URL and no resource policy. The webhook and its secret are gone.

## Consequences

- A site needs a dozen-line workflow file as well as its registry entry. The file holds no role, environment,
  secret or variable.
- Nothing in publishing is reachable from the internet, and there is no shared secret to rotate.
- A site cannot ask for another site's release, or for a commit it did not push: the dispatcher takes the
  repository, branch and commit from GitHub's signature, never from the request, and the slug from the registry. The
  role checks repositories and branches as two lists, so it admits a registered repository on another site's branch;
  the dispatcher pairs them.
- The trust policy follows the registry. Registering a site adds its repository and branch when pipeline 1's
  self-update deploys the registry, with the site's route, so a new site's first run waits for that deploy. IAM's
  default limit for a trust policy, 2,048 characters, fits about 40 repositories, and synth fails before the
  registry outgrows it. The quota can be raised to 4,096, about 100; past that, the role would trust the
  organisation and the shared workflow only, and rely on the dispatcher's registry check.
- The GitHub OIDC provider belongs to umccr/infrastructure's `bastion_oidc` stack, which holds the account's OIDC
  providers, rather than to this stack: IAM allows one provider per URL in an account, and any other service there
  that lets GitHub Actions call it trusts the same provider, with roles of its own. The provider is applied before
  this stack deploys, and this stack reads its ARN from SSM at deploy time, so a missing provider stops the deploy
  early.
- The role's ARN, and with it the toolchain account's ID, is public in the shared workflow and in run logs. Neither
  is a credential ([SECURITY.md](../../../SECURITY.md)), and the role admits only the shared workflow in registered
  repositories. A test keeps the ARN in step with the CDK app's account and the role's name.
- Sites call the shared workflow at `main`, so a change to it reaches every site at once, and the dispatcher keeps
  accepting the request shape of older versions. The shared workflow runs with the calling repository's OIDC
  identity, which gives this repository's `main` nothing it does not already have: the fetch build clones each
  site's repository. A repository whose GitHub identity also unlocks something else, such as an AWS role trusting
  its branch, either has that role require its own workflow (`job_workflow_ref`) or pins the shared workflow to a
  commit; the template says so.
- Site owners see each request in their repository's Actions tab, and **Run workflow** republishes the branch.
- A private repository spends about one Actions minute per push. A push publishes nothing while Actions is down or
  disabled for the repository; **Run workflow** catches up afterwards.

## Revised 2026-11-19

What changed from the first version, written on 2026-10-14:

| | First version | This version | Why |
| --- | --- | --- | --- |
| The role's trust | exact subjects, `repo:<owner>/<name>:ref:refs/heads/<branch>`, from the registry | GitHub's claims: the organisation's ID, the registered repositories and branches, and the shared workflow | subjects now come in two formats, and every registered repository uses the one the first version did not match |
| The shared workflow | checked by the dispatcher | required by the role's trust too, and checked by the dispatcher | IAM now reads `job_workflow_ref` |
| The GitHub OIDC provider | owned by this stack | owned by umccr/infrastructure's `bastion_oidc` stack | there is one per URL in an account, shared by every service there that trusts GitHub Actions |
| The role's ARN | the organisation secret `DOCS_DISPATCH_ROLE_ARN`, passed by each site | written in the shared workflow | it is not a credential; sites pass nothing, and the organisation has one setting fewer |
| The site's template | `toolkit/templates/docs-workflow.yml` in this repository | `templates/docs-workflow.yml` in umccr/docs-toolkit | the toolkit moved there ([0010](0010-toolkit-repository.md)) |

The plan, step by step with diagrams, what implementing it changes, and how to deploy it:
[publishing from GitHub](../../plans/publishing-from-github.md).
