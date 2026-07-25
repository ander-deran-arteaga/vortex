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
if [[ -n "${FORK_RPC_URL:-}" ]]; then
  echo "==> starting anvil as Arbitrum One fork (chain id 31337)"
  ANVIL_ARGS+=(--fork-url "$FORK_RPC_URL")
else
  echo "==> starting plain anvil (chain id 31337)"
fi

anvil "${ANVIL_ARGS[@]}" &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 50); do
  if cast chain-id --rpc-url "$RPC" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done
cast chain-id --rpc-url "$RPC" >/dev/null || { echo "anvil did not come up" >&2; exit 1; }

echo "==> deploying Vortex baseline"
(
  cd "$ROOT/packages/contracts"
  forge script script/DeployLocal.s.sol \
    --rpc-url "$RPC" \
    --private-key "$DEPLOYER_KEY" \
    --broadcast
)

echo "==> deployments/31337.json refreshed:"
cat "$ROOT/deployments/31337.json"
echo "==> chain ready at $RPC (Ctrl-C to stop)"
wait "$ANVIL_PID"
