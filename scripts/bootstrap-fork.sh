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

ANVIL_ARGS=(--port "$PORT" --chain-id 31337)
DEPLOY_OUT="31337.json"
RETRIES=50
if [[ -n "${FORK_RPC_URL:-}" ]]; then
  echo "==> starting anvil as Arbitrum One fork (chain id 31337)"
  ANVIL_ARGS+=(--fork-url "$FORK_RPC_URL")
  # Fork addresses depend on the deployer's live nonce — never overwrite the
  # committed deterministic file with them.
  DEPLOY_OUT="31337.fork.json"
  RETRIES=300
else
  echo "==> starting plain anvil (chain id 31337)"
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
[[ "$(cast chain-id --rpc-url "$RPC" 2>/dev/null)" == "31337" ]] \
  || { echo "rpc at $RPC is not our 31337 chain (port in use by something else?)" >&2; exit 1; }

# CANONICAL ORDER — do not reorder or run these individually.
#
# Every script deploys with CREATE, so contract addresses depend on the
# deployer's nonce, which means they depend on WHICH SCRIPTS RAN BEFORE.
# Running SeedDemo between DeployLocal and DeployPermAMM shifts every PermAMM
# address. One entrypoint with a fixed order is what makes the committed
# deployments/31337.json reproducible for everyone.
echo "==> 1/3 deploying Vortex baseline (Aqua, SwapVM router, tokens, oracle, Vortex Swap)"
(
  cd "$ROOT/packages/contracts"
  DEPLOY_OUT="$DEPLOY_OUT" forge script script/DeployLocal.s.sol \
    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast
)

echo "==> 2/3 seeding the demo Vortex Swap strategy"
(
  cd "$ROOT/packages/contracts"
  forge script script/SeedDemo.s.sol \
    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast
)

echo "==> 3/3 deploying Vortex PermAMM (real v4 PoolManager, hook, pool)"
(
  cd "$ROOT/packages/contracts"
  forge script script/DeployPermAMM.s.sol \
    --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast
)

echo "==> deployments/${DEPLOY_OUT} refreshed:"
cat "$ROOT/deployments/${DEPLOY_OUT}"
echo "==> demo strategy:"
cat "$ROOT/deployments/31337.demo.json" 2>/dev/null || true
echo "==> chain ready at $RPC (Ctrl-C to stop)"
wait "$ANVIL_PID"
