#!/usr/bin/env bash
set -euo pipefail

# Boots the Vortex dev chain and deploys the contracts baseline.
#
#   ./scripts/bootstrap-fork.sh            plain anvil, chain id 31337
#   FORK_RPC_URL=<arbitrum rpc> ./scripts/bootstrap-fork.sh
#                                          anvil fork of Arbitrum One as 31337
#
# Deploys official Aqua + AquaSwapVMRouter + WBTC/USDC/WETH mocks via
# packages/contracts/script/DeployLocal.s.sol and refreshes
# deployments/31337.json. Keeps anvil in the foreground; Ctrl-C stops it.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${ANVIL_PORT:-8545}"
RPC="http://127.0.0.1:${PORT}"
# anvil's default funded account #0 — local development only.
DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

# Real Arbitrum One token addresses, used only in fork mode.
ARBITRUM_WBTC="0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"
ARBITRUM_USDC="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
ARBITRUM_WETH="0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"
# Aave v3 aWBTC / aUSDC reserves — large, stable holders to impersonate.
WBTC_WHALE="0x078f358208685046a11C85e8ad32895DED33A249"
USDC_WHALE="0x724dc807b04555b71ed48a6896b6F41593b8C637"

DEMO_MAKER="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"   # anvil #1
DEMO_TAKER="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"   # anvil #2

ANVIL_ARGS=(--port "$PORT")
RETRIES=50
if [[ -n "${FORK_RPC_URL:-}" ]]; then
  # Fork mode keeps the REAL chain id (42161) and REAL tokens on purpose: the
  # Uniswap Trade API only quotes chains and tokens it knows, so a 31337 chain
  # holding MockWBTC can never produce a live counterparty quote. On a fork,
  # both venues price the same real assets and the comparison is genuine.
  echo "==> starting anvil as an Arbitrum One FORK (real chain id, real tokens)"
  ANVIL_ARGS+=(--fork-url "$FORK_RPC_URL")
  EXPECTED_CHAIN_ID=42161
  # NOT "42161.json": that file is reserved for a genuine Arbitrum One
  # deployment. These addresses exist only on a local fork, and publishing them
  # under the mainnet chain id would read as "we deployed to Arbitrum".
  DEPLOY_OUT="42161.fork.json"
  SEED_OUT="42161.fork.demo.json"
  RETRIES=600
else
  echo "==> starting plain anvil (chain id 31337, mock tokens, fully offline)"
  ANVIL_ARGS+=(--chain-id 31337)
  EXPECTED_CHAIN_ID=31337
  DEPLOY_OUT="31337.json"
  SEED_OUT="31337.demo.json"
fi

# Refuse to start if something is already on the port. The chain-id probe below
# cannot catch this case: another anvil on 31337 answers identically to ours, so
# a squatted port would sail through and we would redeploy on top of a chain the
# demo is already using — new addresses, stale committed artifacts, live session
# broken. Fail before spawning anything.
if ss -ltn "sport = :$PORT" 2>/dev/null | grep -q ":$PORT"; then
  echo "refusing to start: something is already listening on port $PORT." >&2
  echo "  If that is the demo chain, it is already up — skip the bootstrap." >&2
  echo "  To run a second chain alongside it: ANVIL_PORT=<other> $0" >&2
  echo "  Owner of the port (do not pkill by name):" >&2
  ss -ltnp "sport = :$PORT" 2>/dev/null | tail -n +2 >&2
  exit 1
fi

anvil "${ANVIL_ARGS[@]}" &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 "$RETRIES"); do
  kill -0 "$ANVIL_PID" 2>/dev/null || { echo "anvil exited during startup" >&2; exit 1; }
  if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
# The probe must hit OUR anvil, not a pre-existing process squatting the port.
[[ "$(cast chain-id --rpc-url "$RPC" 2>/dev/null)" == "$EXPECTED_CHAIN_ID" ]] \
  || { echo "rpc at $RPC is not chain $EXPECTED_CHAIN_ID (port in use by something else?)" >&2; exit 1; }

# ── fork mode: use the real tokens, and fund the demo accounts from whales ──
# Real WBTC/USDC cannot be minted, so the accounts are funded by impersonating
# large holders. Everything downstream then runs against genuine assets.
if [[ -n "${FORK_RPC_URL:-}" ]]; then
  export WBTC_ADDRESS="$ARBITRUM_WBTC"
  export USDC_ADDRESS="$ARBITRUM_USDC"
  export WETH_ADDRESS="$ARBITRUM_WETH"
  export USE_REAL_TOKENS=true

  fund() { # token whale recipient amount
    cast rpc anvil_impersonateAccount "$2" --rpc-url "$RPC" >/dev/null
    cast rpc anvil_setBalance "$2" 0xDE0B6B3A7640000 --rpc-url "$RPC" >/dev/null
    cast send "$1" "transfer(address,uint256)" "$3" "$4" \
      --from "$2" --unlocked --rpc-url "$RPC" >/dev/null
    cast rpc anvil_stopImpersonatingAccount "$2" --rpc-url "$RPC" >/dev/null
  }

  echo "==> funding demo accounts with REAL WBTC/USDC from whales"
  fund "$ARBITRUM_WBTC" "$WBTC_WHALE" "$DEMO_MAKER" 500000000          # 5 WBTC
  fund "$ARBITRUM_USDC" "$USDC_WHALE" "$DEMO_MAKER" 500000000000       # 500k USDC
  fund "$ARBITRUM_WBTC" "$WBTC_WHALE" "$DEMO_TAKER" 100000000          # 1 WBTC

  echo "    maker WBTC $(cast call "$ARBITRUM_WBTC" 'balanceOf(address)(uint256)' "$DEMO_MAKER" --rpc-url "$RPC")"
  echo "    maker USDC $(cast call "$ARBITRUM_USDC" 'balanceOf(address)(uint256)' "$DEMO_MAKER" --rpc-url "$RPC")"
fi

# CANONICAL ORDER — do not reorder or run these individually.
#
# Every script deploys with CREATE, so contract addresses depend on the
# deployer's nonce, which means they depend on WHICH SCRIPTS RAN BEFORE.
# Running SeedDemo between DeployLocal and DeployPermAMM shifts every PermAMM
# address. One entrypoint with a fixed order is what makes the committed
# deployments/31337.json reproducible for everyone.
echo "==> [1] deploying Vortex baseline (Aqua, SwapVM router, tokens, oracle, Vortex Swap)"
(
  cd "$ROOT/packages/contracts"
  DEPLOY_OUT="$DEPLOY_OUT" forge script script/DeployLocal.s.sol \
    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast
)

echo "==> [2] seeding the demo Vortex Swap strategy"
(
  cd "$ROOT/packages/contracts"
  DEPLOY_OUT="$DEPLOY_OUT" SEED_OUT="$SEED_OUT" forge script script/SeedDemo.s.sol \
    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast
)

# PermAMM and Grow deploy their own pool and mint mock inventory, so they are
# local-chain only for now. On a fork the demo is Vortex Swap vs the live
# Uniswap API, which is exactly the comparison that needs a real chain id.
if [[ -z "${FORK_RPC_URL:-}" ]]; then
echo "==> [3] deploying Vortex PermAMM (real v4 PoolManager, hook, pool)"
(
  cd "$ROOT/packages/contracts"
  forge script script/DeployPermAMM.s.sol \
    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast
)

echo "==> [4] deploying Vortex Grow (compounder, simulated venue, shipped strategy)"
(
  cd "$ROOT/packages/contracts"
  forge script script/DeployGrow.s.sol \
    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast
)

fi

echo "==> deployments/${DEPLOY_OUT} refreshed:"
cat "$ROOT/deployments/${DEPLOY_OUT}"
echo "==> demo Vortex Swap strategy:"
cat "$ROOT/deployments/${SEED_OUT}" 2>/dev/null || true
if [[ -z "${FORK_RPC_URL:-}" ]]; then
  echo "==> Vortex Grow strategy:"
  cat "$ROOT/deployments/31337.grow.json" 2>/dev/null || true
fi
echo "==> chain ready at $RPC (Ctrl-C to stop)"
wait "$ANVIL_PID"
