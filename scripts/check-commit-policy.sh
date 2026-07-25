#!/usr/bin/env bash
# Vortex commit policy: every commit has exactly one subject line, no body,
# subject matches ^(feat|fix|del): .+, and carries no co-author or tool
# attribution. Usage:
#   scripts/check-commit-policy.sh              # checks every commit on HEAD
#   scripts/check-commit-policy.sh <range>      # e.g. origin/main..HEAD
set -euo pipefail

range="${1:-HEAD}"
fail=0

commits=$(git rev-list --no-merges "$range")
if [[ -z "$commits" ]]; then
  echo "commit-policy: no commits in range '$range'"
  exit 0
fi

while IFS= read -r sha; do
  subject=$(git show -s --format='%s' "$sha")
  body=$(git show -s --format='%b' "$sha")
  full=$(git show -s --format='%B' "$sha")

  if ! grep -qE '^(feat|fix|del): .+' <<<"$subject"; then
    echo "FAIL $sha: subject must match '^(feat|fix|del): .+' — got: $subject"
    fail=1
  fi

  if [[ -n "${body//[[:space:]]/}" ]]; then
    echo "FAIL $sha: commit body must be empty — got body: $(head -1 <<<"$body")"
    fail=1
  fi

  if grep -qiE 'co-authored-by|generated with|claude|chatgpt|copilot|cursor|openai|anthropic' <<<"$full"; then
    echo "FAIL $sha: commit message contains attribution metadata"
    fail=1
  fi
done <<<"$commits"

# Merge commits are discouraged; when unavoidable their titles still comply.
while IFS= read -r sha; do
  [[ -z "$sha" ]] && continue
  subject=$(git show -s --format='%s' "$sha")
  if ! grep -qE '^(feat|fix|del): .+' <<<"$subject"; then
    echo "FAIL $sha (merge): subject must match '^(feat|fix|del): .+' — got: $subject"
    fail=1
  fi
done < <(git rev-list --merges "$range")

if [[ "$fail" -ne 0 ]]; then
  echo "commit-policy: FAILED"
  exit 1
fi

count=$(wc -l <<<"$commits")
echo "commit-policy: OK ($count commits checked in '$range')"
