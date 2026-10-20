#!/usr/bin/env bash
#
# Information-boundary check for this public repository (see docs/plans/proposal.md, "Repository visibility").
#
# Fails when a file git would commit contains account-specific identifiers or credentials, or when generated sites,
# build output or state files are about to be committed. A line may opt out with the marker `boundary: allow`
# (for example a test fixture), which reviewers should question.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Hash-locked requirement files and pnpm-lock.yaml's integrity hashes are long hex and base64 strings that can contain
# twelve-digit runs; this script names the patterns it searches for.
# A read loop rather than mapfile, so it also runs on macOS's bash 3.2.
files=()
while IFS= read -r file; do
  [[ -f "$file" ]] && files+=("$file")
done < <(git ls-files --cached --others --exclude-standard |
  grep -v -E '^(requirements/[^/]+\.txt|scripts/check-boundary\.sh|pnpm-lock\.yaml)$')

status=0

check() {
  local description="$1" pattern="$2" matches
  matches="$(grep -n -I -E -- "$pattern" "${files[@]}" 2>/dev/null | grep -v 'boundary: allow' || true)"
  if [[ -n "$matches" ]]; then
    echo "✗ ${description}:"
    printf '%s\n' "$matches" | sed 's/^/    /'
    status=1
  fi
}

check "AWS account IDs" '(^|[^0-9A-Za-z])[0-9]{12}([^0-9A-Za-z]|$)'
check "ARNs" 'arn:aws[a-z-]*:[a-z0-9-]+:'
check "CloudFront distribution domains" '[a-z0-9]{10,}\.cloudfront\.net'
check "docs bucket names" 'docs-cloudfront-(logs-)?[0-9]'
check "AWS access key IDs" 'AKIA[0-9A-Z]{16}'
check "private keys" '-----BEGIN [A-Z ]*PRIVATE KEY-----'

# app/site/ is the platform site's source, so below it only its own build output (site/, .umccr-docs/) counts.
generated="$(printf '%s\n' "${files[@]}" | awk '
  { path = "/" $0; sub("^/app/site/", "/", path) }
  path ~ /\/(site|\.umccr-docs)\// || path ~ /\.tfstate|\/\.env$|terraform\.tfvars$/
' || true)"
if [[ -n "$generated" ]]; then
  echo "✗ generated output, state or environment files:"
  printf '%s\n' "$generated" | sed 's/^/    /'
  status=1
fi

if [[ $status -eq 0 ]]; then
  echo "✓ information boundary: nothing account-specific or generated found in ${#files[@]} files"
fi
exit $status
