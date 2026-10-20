UMCCR Platform Services · architecture reference

# docs.umccr.org architecture

Authenticated documentation for UMCCR staff. Each participating repository builds its own Markdown into a static site and publishes it to a private bucket. CloudFront serves every site at `docs.umccr.org/<slug>/`, but only to readers signed in with their UMCCR Google Workspace account, through the same Cognito user pool the portal uses.

Branch `feat/docs-umccr-org`, as deployed and tested in dev on 7 October 2026. The figures show the dev stage, `docs.dev.umccr.org`; stg and prod have the same shape in their own accounts.

[At a glance](#glance) [Signing in](#signin) [The edge function](#edge) [Publishing](#publish) [Provisioning](#provision) [The session key](#key) [Reference](#reference)

## At a glance

A reader’s requests only ever reach the stage account. GitHub writes into it through one narrow role per site, and an engineer running Terraform and the pipeline in the toolchain account build it. Four flows run through the system; their steps are numbered in the order they happen.

### Reading a page

1. R1`docs.dev.umccr.org` is an alias A record in the stage’s Route 53 zone, pointing at the distribution.
2. R2Every request, with its `__Host-docs_session` cookie, meets the viewer-request function first. It runs before the cache, on every behaviour.
3. R3With a valid cookie the request goes on to the shared cache, rewritten from `/<slug>/page/` to `/sites/<slug>/page/index.html`.
4. R4On a miss or revalidation, CloudFront reads the object from the private bucket through origin access control.

### Signing in

1. A1On a first visit, Amplify sends the reader to the Cognito hosted UI (code flow with PKCE) and back to `/_auth/`.
2. A2Cognito federates to Google, which admits UMCCR Workspace accounts only.
3. A3The sign-in page sends the ID token to `/_auth/session`. CloudFront forwards it to the session Lambda’s function URL, signed with origin access control.
4. A4The Lambda verifies the token against the pool’s JWKS: signature, issuer, audience `docs-app`, token use, expiry.
5. A5It signs the cookie with the key from Secrets Manager, read once per execution environment, and returns it: HttpOnly, 8 hours.

### Publishing

1. P1A site’s publish job, inside its GitHub environment, exchanges a GitHub OIDC token for that site’s `docs-publisher-<slug>` role.
2. P2The role can list, put and delete under `sites/<slug>/` and nothing else. Pages go up `no-cache`, so they are live on the next request.

### Provisioning

1. D1An engineer applies Terraform per workspace: the `docs-app` Cognito client, the certificate in us-east-1 and SSM parameters.
2. D2A push to `main` that changes `lib/docs/**` starts `OrcaBus-DocsInfrastructure` in the toolchain account.
3. D3The pipeline deploys `DocsHostingStack` to beta, then gamma, then prod after a manual approval.
4. D4The stack reads the SSM parameters at deploy time.
5. D5CloudFormation generates the session key and writes it into the function’s code during the deploy.

Solid lines happen on requests and publishes; dashed lines happen while provisioning or deploying. **TF** marks resources Terraform creates in `umccr/infrastructure`; **CDK** marks resources `DocsHostingStack` creates. The session Lambda’s response sets the cookie on its way back through CloudFront.

## Signing in

Readers sign in the way they do in the portal apps: Amplify in the browser, the Cognito hosted UI, then Google. What differs is what needs protecting. The portal’s pages are public and its APIs check tokens; here the pages are the data, so CloudFront has to see a sign-in before it serves anything. CloudFront Functions can verify an HMAC but not Cognito’s RSA signatures, so one small Lambda checks the ID token once and exchanges it for a cookie the edge can check on every request.

A reader opening a site, for example `/management-knowledgebase/`. Solid arrows are requests and dashed arrows are responses. Every request to `docs.dev.umccr.org` passes through CloudFront, including the Lambda’s response.

### Renewal

The cookie expires after 8 hours. The next page load passes through `/_auth/`, where Amplify refreshes its tokens without a prompt and phase 3 runs again. Readers only see the sign-in button once their Cognito session ends after 30 days, or if their account is disabled.

### Sign-out

`/_auth/signout` clears the cookie at the edge. The sign-in page then calls Amplify’s `signOut()`, which revokes the refresh token and ends the Cognito session. It does not sign the reader out of Google.

### Loops

If the edge keeps rejecting fresh cookies, usually because the browser blocks them, the sign-in page stops at the fourth exchange within two minutes and says so, instead of redirecting forever.

| Response | When |
| --- | --- |
| `204` with the cookie | the token is valid, the host is one of the stage’s hostnames, the sign-in page asked from the same origin, and the edge’s key check matches |
| `401 missing-token` | the request has no `x-docs-id-token` header |
| `401 invalid-token` | the token’s signature, issuer, audience, token use or expiry is wrong |
| `403 cross-site` | `Sec-Fetch-Site` isn’t `same-origin` |
| `400 unknown-host` | `x-docs-host` isn’t one of the stage’s hostnames |
| `405 method-not-allowed` | anything but GET |
| `503 unavailable` | the key couldn’t be read, or the edge holds a different key (logged as `key-mismatch`; expected for a few minutes after a rotation). The page says sign-in is temporarily unavailable. |

The session Lambda logs each reader’s Cognito `sub` and the outcome, never the token, the email address or the key.

## What the edge function does with each request

One CloudFront Function runs on every request and every behaviour, before the cache. Its checks run top to bottom and the first match wins. The site list, the canonical host and the session key are written into its code at deploy time, because CloudFront Functions have no environment variables and can’t call AWS APIs.

Only the sign-in page and a few public files are reachable without a session, so someone who isn’t signed in can’t tell which pages exist. The cache key holds no cookies, headers or query strings, so every signed-in reader shares one cache.

## Publishing a site

Sites publish themselves. Each repository calls the reusable workflow in `umccr/docs-platform`. Its build job has no AWS access, and its publish job runs only inside the repository’s GitHub environment, through a role that can write nowhere but the site’s own prefix.

The knowledgebase publishes to production on every push to `main`; a manual run can publish to `docs-dev` instead. The platform’s own site, `/platform/`, publishes to dev on every merge and to stg, then prod, on each release.

| Files | Cache-Control | Effect |
| --- | --- | --- |
| Theme assets with a content hash: `*.<hash>.min.js`, `*.<hash>.min.css` | `public, max-age=31536000, immutable` | cached for a year; a changed asset gets a new name |
| Everything else: pages, the search index, images, `_publish.json` | `no-cache` | CloudFront and browsers revalidate on every request, so a publish or a deletion shows on the next one |

## Provisioning a stage

No stage resource is made by hand. Terraform in `umccr/infrastructure` owns the Cognito client and the certificate; the CDK pipeline owns everything else and reads Terraform’s outputs from SSM when it deploys. Apply both Terraform stacks to a workspace before that stage’s first deploy.

Each stack also writes the sign-in page’s `env.js` from the SSM values, so one build of the page serves every stage. In prod, `docs.umccr.org` also needs records in the `umccr.org` zone, which another account manages; the `umccr_docs_domain` outputs list them.

## The session key

The session Lambda and the edge function share one HMAC key. It lives in Secrets Manager and CloudFormation generates it, so nobody creates, copies or sees it. CloudFront Functions can’t call AWS APIs, so the function receives the key at deploy time. CloudFront KeyValueStore would have kept the key out of the function’s code, but its data API isn’t permitted in UMCCR’s AWS accounts.

The trade-off: anyone in the stage account who can read the function’s code can read the key, and such principals can generally read the bucket too. Never edit the secret’s value by hand. The function keeps the value it was deployed with, so every sign-in would fail the key check until the next rotation.

## Reference

### Stages

| Stage | Account | Hostnames | Cognito pool | Sites | GitHub environment |
| --- | --- | --- | --- | --- | --- |
| beta | dev | `docs.dev.umccr.org` | `data-portal-dev` | platform, management-knowledgebase | `docs-dev` |
| gamma | stg | `docs.stg.umccr.org` | `data-portal-stg` | platform | `docs-stg` |
| prod | prod | `docs.umccr.org`, `docs.prod.umccr.org` | `data-portal-prod` | platform, management-knowledgebase | `docs-prod` |

The pipeline runs in the toolchain account. `docs.umccr.org` needs records in the `umccr.org` zone before prod uses it; until then the prod canonical-host redirect stays off.

### Content bucket, `docs-cloudfront-<account>`

| Prefix | Written by | Served at | Sign-in |
| --- | --- | --- | --- |
| `sites/<slug>/` | the site’s publisher role, from its repository’s workflow | `/<slug>/…` | required |
| `_auth/` | `DocsHostingStack`: the sign-in page and its `env.js` | `/_auth/` | public |
| `_platform/public/` | `DocsHostingStack`: 404 page, `robots.txt`, favicon | `/robots.txt`, `/favicon.ico`, errors | public |
| `_platform/data/catalog.json` | `DocsHostingStack`, from the site registry | `/_platform/data/catalog.json` | required |

Versioned: overwritten and deleted objects stay recoverable for 30 days.

### Trust boundaries

| Boundary | What holds it |
| --- | --- |
| Internet → bucket | Public access blocked; only this distribution may read, through origin access control with a source-ARN condition. |
| Internet → session Lambda | The function URL requires IAM auth, and only CloudFront can sign for it. |
| Reader without a session → pages | The edge function checks the cookie before the cache; unknown paths redirect too, so nothing reveals which pages exist. |
| Browser scripts → session | The cookie is `__Host-`, HttpOnly, Secure and SameSite=Lax, so it is bound to one host and unreadable from JavaScript. |
| Other sites → `/_auth/session` | It requires `Sec-Fetch-Site: same-origin` and a custom header, which needs a CORS preflight that is never granted. |
| GitHub → AWS | Each role trusts one repository and one GitHub environment, writes only `sites/<slug>/` and has no CloudFront rights. |
| Docs tokens → OrcaBus APIs | The `docs-app` client ID is not in the API authorizers’ client list, and must never be added. |
| Site content → Amplify tokens | The publishing contract forbids project scripts, and the Content Security Policy allows only this origin. |
| The session key | Secrets Manager, readable by the session Lambda’s role; also visible to anyone in the stage account who can read the function’s code. |

### Where each piece lives

| Repository | Path | Owns |
| --- | --- | --- |
| `umccr/infrastructure` | `terraform/stacks/cognito_aai/app_docs.tf` | the `docs-app` Cognito client and its SSM parameter |
|  | `terraform/stacks/umccr_docs_domain/` | the certificate (us-east-1) and its SSM parameter |
| `umccr/frontend-infrastructure-pipelines` | `lib/docs/` | hosting stack, sign-in page, edge function, session Lambda, site registry, pipeline |
| `umccr/docs-platform` | `.github/workflows/docs.yml`, `toolkit/` | reusable workflow, `umccr-docs` toolkit and theme, the `/platform/` site |
| `umccr/management-knowledgebase` | `mkdocs.yml`, `.github/workflows/docs.yml` | the pilot vault’s site settings and caller workflow |

## Sources

- `frontend-infrastructure-pipelines/lib/docs/`: `hosting-stack.ts`, `lambda/viewer-request.js`, `lambda/session/`, `auth-web/`, `sites.ts`, `config.ts`, `pipeline-stack.ts`
- `infrastructure/terraform/stacks/cognito_aai/app_docs.tf` and `umccr_docs_domain/`
- `docs-platform/.github/workflows/docs.yml` and `site.yml`; `toolkit/src/umccr_docs/publish.py`
- `management-knowledgebase/.github/workflows/docs.yml` and `mkdocs.yml`