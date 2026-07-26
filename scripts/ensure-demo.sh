#!/usr/bin/env bash
set -uo pipefail

# One command to get a working Vortex demo chain, safe to run any number of times.
#
#   ./scripts/ensure-demo.sh
#
# It figures out what already exists and does only what is missing:
#   chain not running      -> starts anvil (detached) and waits for it
#   contracts missing      -> deploys the full stack
#   strategies not shipped -> ships them
#   already complete       -> changes nothing and says so
#
# Why this exists: deploying the contracts and shipping the Aqua strategies are
# separate steps, and a half-finished bring-up produces the worst possible
# symptom — every contract address has bytecode, so the system *looks* deployed,
# while the API answers STRATEGY_NOT_FOUND. A strategy is Aqua state, not a
# contract. This makes that state impossible to half-complete.
#
# Env: ANVIL_PORT (default 8545), FORK_RPC_URL (Arbitrum fork mode).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ANVIL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
CONTRACTS="$ROOT/packages/contracts"
LOG="$ROOT/.anvil-${PORT}.log"
# anvil's default funded account #0 — local development only.
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

if [[ -n "${FORK_RPC_URL:-}" ]]; then
  DEPLOY_OUT="42161.fork.json"; SEED_OUT="42161.fork.demo.json"; EXPECT_CHAIN=42161
else
  DEPLOY_OUT="31337.json"; SEED_OUT="31337.demo.json"; EXPECT_CHAIN=31337
fi
export DEPLOY_OUT SEED_OUT

started_chain=0
deployed=0
shipped=0

say()  { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }

# ── 1. chain ────────────────────────────────────────────────────────────────
step "chain on port $PORT"
if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
  actual=$(cast chain-id --rpc-url "$RPC")
  if [[ "$actual" != "$EXPECT_CHAIN" ]]; then
    echo "  something on port $PORT reports chain $actual, expected $EXPECT_CHAIN." >&2
    echo "  Not touching it. Use ANVIL_PORT=<other>, or stop it BY PID:" >&2
    ss -ltnp "sport = :$PORT" 2>/dev/null | tail -n +2 >&2
    exit 1
  fi
  say "already running (chain $actual) - leaving it alone"
else
  ANVIL_ARGS=(--port "$PORT")
  if [[ -n "${FORK_RPC_URL:-}" ]]; then
    ANVIL_ARGS+=(--fork-url "$FORK_RPC_URL")
    [[ -n "${FORK_BLOCK:-}" ]] && ANVIL_ARGS+=(--fork-block-number "$FORK_BLOCK")
  else
    ANVIL_ARGS+=(--chain-id 31337)
  fi
  nohup anvil "${ANVIL_ARGS[@]}" >"$LOG" 2>&1 &
  disown || true
  for _ in $(seq 1 300); do
    cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break
    sleep 0.2
  done
  cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 || { echo "  anvil did not start; see $LOG" >&2; exit 1; }
  started_chain=1
  say "started anvil (log: ${LOG#"$ROOT"/})"
fi

# ── 2. contracts ────────────────────────────────────────────────────────────
step "contracts"
need_deploy=0
if [[ ! -f "$ROOT/deployments/$DEPLOY_OUT" ]]; then
  need_deploy=1
  say "no deployment artifact yet"
else
  for name in Aqua AquaSwapVMRouter VortexAquaPricing VortexHook VortexRouter VortexCompounder; do
    addr=$(python3 -c "import json,sys;print(json.load(open('$ROOT/deployments/$DEPLOY_OUT'))['contracts'].get('$name',''))" 2>/dev/null)
    if [[ -z "$addr" ]] || [[ "$(cast code "$addr" --rpc-url "$RPC" 2>/dev/null)" == "0x" ]]; then
      need_deploy=1
      say "$name missing on this chain"
      break
    fi
  done
fi

if [[ "$need_deploy" == "1" ]]; then
  say "deploying the full stack"
  if [[ -n "${FORK_RPC_URL:-}" ]]; then
    bash "$ROOT/scripts/fund-fork-accounts.sh" "$RPC" || true
  fi
  ( cd "$CONTRACTS" && forge script script/DeployLocal.s.sol --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast >/dev/null ) || exit 1
  ( cd "$CONTRACTS" && forge script script/SeedDemo.s.sol   --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast >/dev/null ) || exit 1
  if [[ -z "${FORK_RPC_URL:-}" ]]; then
    ( cd "$CONTRACTS" && forge script script/DeployPermAMM.s.sol --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast >/dev/null ) || exit 1
    ( cd "$CONTRACTS" && forge script script/DeployGrow.s.sol    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast >/dev/null ) || exit 1
  fi
  deployed=1
  say "deployed"
else
  say "all present - skipping deployment"
fi

# ── 3. Aqua strategies (the step that silently gets missed) ─────────────────
step "Aqua strategies"
if [[ -z "${FORK_RPC_URL:-}" ]]; then
  out=$( cd "$CONTRACTS" && forge script script/EnsureDemoState.s.sol \
           --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast 2>&1 )
  echo "$out" | grep -aE "(ok|SHIP|DOCKED) +(swap|grow)|shipped,|nothing to do|action\(s\) taken" | sed 's/^ *//; s/^/  /'
  echo "$out" | grep -aq "SHIP" && shipped=1
else
  say "fork mode: Vortex Swap only, seeded by SeedDemo"
fi

# ── 4. verdict ──────────────────────────────────────────────────────────────
step "pre-flight"
( cd "$CONTRACTS" && forge script script/CheckDemoReady.s.sol --rpc-url "$RPC" 2>&1 ) \
  | grep -aE "^  (ok|note|WARN|FAIL)|READY" | sed 's/^/  /'

step "summary"
say "chain      : $([[ $started_chain == 1 ]] && echo 'started by this run' || echo 'was already running') ($RPC)"
say "contracts  : $([[ $deployed == 1 ]] && echo 'deployed by this run' || echo 'already present')"
say "strategies : $([[ $shipped == 1 ]] && echo 'shipped by this run' || echo 'already shipped')"
say "artifacts  : deployments/$DEPLOY_OUT, deployments/$SEED_OUT"
printf '\nSafe to re-run. It will report "already present" and change nothing.\n'
