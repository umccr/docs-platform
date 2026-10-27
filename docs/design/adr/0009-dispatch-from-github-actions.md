# 0009: Dispatch from GitHub Actions through OIDC

**Status:** proposed, 2026-10-14; deferred 2026-10-15. Would supersede the organisation webhook, its secret and the
dispatcher's function URL in [0006](0006-dispatched-publishing.md); the dispatcher, the fetch build and the shared
site pipeline would stay. An implementation with tests was written and reverted before merge: the team keeps 0006's
design for now. Tracked in
[issues/2026-10-14-dispatcher-function-url.md](../../issues/2026-10-14-dispatcher-function-url.md).

## Context

GitHub cannot sign AWS requests, so the organisation webhook needed the dispatcher on a function URL that anyone
could call. The dispatcher checked the webhook's signature before reading anything else, but the function's
resource policy still let any caller invoke it, and a function anyone can invoke is one the organisation's
security controls rightly question. Hiding it was not possible without giving up the webhook:

- **API Gateway in front of the function.** GitHub's only proof is a signature over the request body, which neither
  API Gateway nor its authorizers see, so the method would still need no authorization. Restricting callers to
  GitHub's webhook addresses needs upkeep: GitHub changes them and advises against allow-lists.
- **CloudFront with origin access control.** For a request with a body, the caller must send the body's SHA-256 in
  a signed header, which GitHub's webhooks do not.
- **CodeBuild's own organisation webhook,** with no function at all. Creating an organisation webhook needs a
  personal access token or a person's OAuth grant rather than the organisation's GitHub App, and CodeBuild does not
  say whether its file-path filter sees every commit of a push.

## Decision

- Each registered site's repository has a small workflow, from `toolkit/templates/docs-workflow.yml`, that calls the
  shared reusable workflow `.github/workflows/publish-docs.yml` in this repository on a push to the site's branch,
  and on **Run workflow**.
- The shared workflow signs in to the toolchain account through GitHub OIDC as **`docs-dispatch`**. The role trusts
  exactly the registered repositories and branches, `repo:<owner>/<name>:ref:refs/heads/<branch>`, generated from the
  registry, and may only invoke the dispatcher.
- The workflow then asks GitHub for a second OIDC token, for the dispatcher's audience, and invokes the dispatcher
  with it and the files the push changed, which it reads from GitHub's compare API.
- The dispatcher verifies that token against GitHub's published keys and takes the repository, branch and commit
  from its signed claims. It accepts only the shared workflow (`job_workflow_ref`), pushes and manual runs, and
  registered branches; a workflow run attempt starts at most one release. The changed files decide only whether to
  build.
- The dispatcher has no function URL and no resource policy. The webhook and its secret are gone.

## Consequences

- A site needs a dozen-line workflow file as well as its registry entry. The file holds no role, environment or
  secret value of its own: the role's ARN comes from the organisation secret `DOCS_DISPATCH_ROLE_ARN`, which also
  keeps the account ID out of public repositories and their logs.
- Nothing in publishing is reachable from the internet, and there is no shared secret to rotate.
- A site cannot ask for another site's release: the role admits only registered branches, and the dispatcher takes
  the repository and commit from GitHub's signature, not from the request.
- The trust policy grows with the registry. IAM's default limit, 2,048 characters, fits about 30 sites, and synth
  fails before the registry outgrows it. The quota can be raised to 4,096; past that, trust the organisation's
  branches and rely on the dispatcher's own checks.
- The toolchain account's GitHub OIDC provider belongs to this stack. Anything else there that trusts GitHub Actions
  uses it rather than creating another.
- Sites call the shared workflow at `main`, so a change to it reaches every site at once, and the dispatcher keeps
  accepting the request shape of older versions. Running in a site's repository, with read access and its OIDC
  identity, gives this repository's `main` nothing it does not already have: the fetch build clones each site's
  repository. A repository whose GitHub identity also unlocks something else, such as an AWS role trusting
  `repo:<owner>/<repo>:*`, pins the shared workflow to a commit instead, and the template says so.
- Site owners see each request in their repository's Actions tab, and **Run workflow** republishes the branch.
- A private repository spends about one Actions minute per push. A push publishes nothing while Actions is down or
  disabled for the repository; **Run workflow** catches up afterwards.

The plan, step by step with diagrams, what implementing it changes, and how to deploy it:
[publishing from GitHub](../../plans/publishing-from-github.md).
