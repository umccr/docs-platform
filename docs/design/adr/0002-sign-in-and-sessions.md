# 0002: Sign-in and sessions

**Status:** accepted, 2026-09-29; revised 2026-09-30, when the session key moved from CloudFront KeyValueStore to
Secrets Manager

## Context

Readers should sign in exactly as they do in the UMCCR portal apps: Amplify in the browser, the Cognito hosted UI,
Google Workspace accounts. In the portal apps, the HTML and JavaScript are public and the APIs protect the data. On
docs.umccr.org the pages themselves are the data, so the edge must refuse to serve them without a sign-in.

CloudFront Functions can compute HMAC signatures but cannot verify the RSA signatures on Cognito's tokens, and they
cannot call AWS APIs.

## Decision

- A static `/_auth/` page signs readers in with Amplify v6, adapted from the portal apps' code, using a public
  `docs-app` Cognito client in the existing user pool.
- The page sends the Cognito ID token once to one small Lambda, which verifies it (signature, issuer, audience,
  token use, expiry) and sets an HttpOnly, host-only session cookie signed with the session key.
- A CloudFront Function checks that cookie on every request, before the cache.
- The session key is a Secrets Manager secret whose value CloudFormation generates, one per stage. The Lambda reads
  it at run time; the function receives it at deploy time through a CloudFormation dynamic reference, so the
  template and the repositories only ever hold the reference. Rotating the key means deploying a new generation of
  the secret.
- The Lambda signs a cookie only when the edge function forwarding the request proves it holds the same key, so a
  reader is never given a cookie the edge would reject.
- When the cookie expires (after 8 hours), the next page load returns through `/_auth/`, where Amplify renews
  silently; readers see the sign-in button only when their Cognito session has ended.

## Alternatives rejected

- **Amplify only, as in the portal apps:** pages would stay downloadable without signing in.
- **Amplify tokens in cookies, checked by Lambda@Edge:** needs deployments in us-east-1 in every account, runs a
  Lambda on every request, and cookies written by JavaScript cannot be HttpOnly.
- **An Application Load Balancer's built-in Cognito sign-in:** no Lambda at all, but no Amplify, a load balancer and
  VPC endpoint per stage, and no CDN.
- **The session key in CloudFront KeyValueStore** (the first implementation): it keeps the key out of the
  function's code, and allows cutting off one reader or one site instantly without a deploy. But the KeyValueStore
  data API is not permitted in UMCCR's AWS accounts, for the Lambda's role as much as for operators.
- **CloudFront signed cookies:** CloudFront checks an RSA signature itself, so the private key would stay in
  Secrets Manager alone. But requests without a session become CloudFront 403s that need a custom error page to
  reach sign-in, the session Lambda could no longer answer 403 itself, and rotation goes through CloudFront key
  groups. It remains the fallback if the key's visibility (below) becomes unacceptable.

## Consequences

- One Lambda, invoked once per sign-in or renewal. No other Lambda: pages are served `no-cache`, so publishing needs
  no cache invalidation, and the stack generates the session key.
- Anyone in a stage account who can read the CloudFront function's code can read that stage's session key and
  forge a cookie. Such principals can generally read the content bucket directly too.
- Cutting off one reader: disable them in Cognito, effective when their cookie expires (at most 8 hours), or at
  once by rotating the key, which sends every other reader through a silent renewal. Taking a site offline means
  deleting its objects, effective on the next request.
- Rotation is a deploy rather than a script. For the few minutes the new function takes to reach every edge
  location, some sign-ins are refused as temporarily unavailable instead of looping.
- The docs app client's tokens are not accepted by OrcaBus APIs.
