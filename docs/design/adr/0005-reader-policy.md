# 0005: Reader policy

**Status:** accepted, 2026-09-29; amended 2026-10-31 (no classification banner)

## Decision

Anyone who can sign in to the UMCCR Cognito user pool can read every site. The pool's Google identity provider only
admits UMCCR Workspace accounts.

## Consequences

- Site owners decide what is fit for every signed-in UMCCR reader (amended 2026-10-31: the classification banner,
  `extra.classification`, no longer says so on every page. Only signed-in UMCCR staff reach a page, so it told them
  nothing sign-in had not).
- A site that needs a narrower audience is not onboarded until per-site groups exist: a group claim in the session
  cookie and a check at the edge, driven by the registry.
