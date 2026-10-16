# Issues

Write-ups of problems found while building, deploying or running docs.umccr.org, and how they were resolved. Track
the work itself in GitHub issues; write a file here when the problem needs a lasting record: what happened, why,
and what changed because of it.

**Never write a security finding here.** This repository is public: report vulnerabilities privately, as
[SECURITY.md](../../SECURITY.md) describes, and keep account IDs, ARNs, bucket names and private content out of
every write-up.

## Writing one

Name the file `YYYY-MM-DD-short-description.md`, with the date the problem was found, for example
`2026-10-12-gamma-deploy-before-stg-terraform.md`, and use this outline:

```markdown
# <What went wrong, in one line>

**Status:** open | resolved YYYY-MM-DD | won't fix
**Found:** YYYY-MM-DD, in <stage or component>, while <doing what>

## What happened

What was seen, and how it showed: the error, the log line, the symptom readers had.

## Why

The cause, once known. Until then, what has been ruled out.

## Impact

Who or what was affected, and for how long.

## Resolution

What was changed, with links to the pull requests, and how it was checked. For an open issue, the next steps.

## Follow-ups

Changes to code, runbooks or design records this led to, with links.
```

Link from a write-up to the runbook or design record it changed, and from there back to the write-up when the
history helps the next reader.
