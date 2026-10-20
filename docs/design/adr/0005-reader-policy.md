# 0005: Reader policy

**Status:** accepted, 2026-09-29

## Decision

Anyone who can sign in to the UMCCR Cognito user pool can read every site. The pool's Google identity provider only
admits UMCCR Workspace accounts.

## Consequences

- Site owners decide what is fit for every signed-in UMCCR reader; the classification banner (`extra.classification`)
  can say so on every page.
- A site that needs a narrower audience is not onboarded until per-site groups exist: a group claim in the session
  cookie and a check at the edge, driven by the registry.
