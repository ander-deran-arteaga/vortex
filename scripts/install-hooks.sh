#!/usr/bin/env bash
# Installs the Vortex commit-msg hook into .git/hooks (not tracked by git).
# Run once per clone: bash scripts/install-hooks.sh
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
hook="$repo_root/.git/hooks/commit-msg"

cat >"$hook" <<'HOOK'
#!/usr/bin/env bash
# Vortex commit policy, enforced at commit time (master ruling R-007).
# Subject must match ^(feat|fix|del): .+ ; no body; no attribution trailers.
set -euo pipefail

msg_file="$1"
subject=$(head -1 "$msg_file")
body=$(tail -n +2 "$msg_file" | grep -v '^#' || true)

fail() {
  echo "commit-msg: REJECTED — $1" >&2
  echo "  subject was: $subject" >&2
  echo "  policy: single line, ^(feat|fix|del): .+ , no body, no attribution." >&2
  echo "  'docs:', 'test:', 'chore:', 'refactor:' are NOT valid prefixes." >&2
  exit 1
}

grep -qE '^(feat|fix|del): .+' <<<"$subject" || fail "bad subject prefix"
[[ -z "${body//[[:space:]]/}" ]] || fail "commit body must be empty"
grep -qiE 'co-authored-by|generated with|claude|chatgpt|copilot|cursor|openai|anthropic' "$msg_file" \
  && fail "attribution metadata is forbidden" || true

exit 0
HOOK

chmod +x "$hook"
echo "installed: $hook"
