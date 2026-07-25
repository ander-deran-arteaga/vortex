#!/usr/bin/env bash
# Vortex architectural invariant (docs/decisions.md D-015):
#
#   Vortex Swap's Aqua execution must not depend on Vortex PermAMM availability.
#
# Vortex Swap settles taker → Aqua router → SwapVM → Aqua → maker. Vortex
# PermAMM is a separate Uniswap v4 venue, reachable only from Vortex Grow (and,
# later, an explicit VORTEX_PERMAMM venue in the comparison). This script fails
# the build if the Aqua settlement path ever references the PermAMM module.
#
# Usage: bash scripts/check-architecture.sh
set -uo pipefail

fail=0

# Identifiers that only exist on the PermAMM / Uniswap-v4 side.
PERMAMM_TOKENS='VortexHook|VortexLiquidityManager|VortexQuoter|VortexFeeAuthorization|IPoolManager|PoolManager|v4-core|v4-periphery|permamm|PermAmm'

report() {
  echo "ARCH VIOLATION — $1" >&2
  fail=1
}

# ── 1. Solidity: the Aqua module must be PermAMM-free ──────────────────
# `VortexRouter` is the PermAMM router; `AquaSwapVMRouter` (official 1inch) is
# the Aqua one, so match VortexRouter only as a whole word.
aqua_sol_paths=(packages/contracts/src/aqua packages/contracts/src/libraries packages/contracts/src/interfaces)
for path in "${aqua_sol_paths[@]}"; do
  [[ -d "$path" ]] || continue
  hits=$(grep -rnE "(${PERMAMM_TOKENS}|\bVortexRouter\b)" "$path" 2>/dev/null || true)
  if [[ -n "$hits" ]]; then
    report "Aqua Solidity module references PermAMM:"
    echo "$hits" >&2
  fi
done

# ── 2. Backend: the Vortex Swap quote/build path must be PermAMM-free ──
# Grow files are exempt by design — PermAMM is a legitimate Grow leg.
if [[ -d apps/api/src ]]; then
  swap_path_files=$(find apps/api/src -type f -name '*.ts' \
    \( -iname '*aqua*' -o -iname '*exchangeQuote*' -o -iname '*venueComparator*' -o -iname '*swapvm*' \) \
    2>/dev/null | grep -viE 'grow|compound' || true)
  for file in $swap_path_files; do
    hits=$(grep -nE "(${PERMAMM_TOKENS}|\bVortexRouter\b)" "$file" 2>/dev/null || true)
    if [[ -n "$hits" ]]; then
      report "Vortex Swap backend path references PermAMM in $file:"
      echo "$hits" >&2
    fi
  done
fi

# ── 3. The two Vortex Swap execution kinds are the only ones ───────────
# A third kind must be a deliberate schema change, not an accident.
schema=packages/shared/src/schemas.ts
if [[ -f "$schema" ]]; then
  kinds=$(grep -oE 'z\.literal\("(AQUA_SWAPVM|UNISWAP_API|VORTEX_PERMAMM)"\)' "$schema" | sort -u | wc -l)
  if [[ "$kinds" -gt 2 ]]; then
    report "more than two Vortex Swap execution kinds in $schema — PermAMM must not become an Aqua execution kind by accident"
  fi
fi

if [[ "$fail" -ne 0 ]]; then
  echo "architecture: FAILED — see docs/decisions.md D-015" >&2
  exit 1
fi

echo "architecture: OK (Vortex Swap Aqua path is independent of Vortex PermAMM)"
