#!/usr/bin/env bash
set -uo pipefail

# Funds the demo maker and taker with REAL Arbitrum WBTC/USDC on a fork, by
# impersonating large holders. Real tokens cannot be minted, so this is how a
# fork run gets capital.
#
#   ./scripts/fund-fork-accounts.sh [rpc-url]
#
# Idempotent in the sense that matters: it tops accounts up to a target rather
# than transferring a fixed amount every time, so re-running does not drain the
# whale or inflate balances.

RPC="${1:-http://127.0.0.1:8545}"

ARBITRUM_WBTC="0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"
ARBITRUM_USDC="0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
# Aave v3 reserves — large, stable holders.
WBTC_WHALE="0x078f358208685046a11C85e8ad32895DED33A249"
USDC_WHALE="0x724dc807b04555b71ed48a6896b6F41593b8C637"

DEMO_MAKER="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"   # anvil #1
DEMO_TAKER="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"   # anvil #2

topup() { # token whale recipient target
  local token=$1 whale=$2 to=$3 target=$4
  local have
  have=$(cast call "$token" "balanceOf(address)(uint256)" "$to" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
  have=${have:-0}
  if [[ "$have" =~ ^[0-9]+$ ]] && (( have >= target )); then
    return 0
  fi
  local need=$(( target - have ))
  cast rpc anvil_impersonateAccount "$whale" --rpc-url "$RPC" >/dev/null
  cast rpc anvil_setBalance "$whale" 0xDE0B6B3A7640000 --rpc-url "$RPC" >/dev/null
  cast send "$token" "transfer(address,uint256)" "$to" "$need" \
    --from "$whale" --unlocked --rpc-url "$RPC" >/dev/null
  cast rpc anvil_stopImpersonatingAccount "$whale" --rpc-url "$RPC" >/dev/null
}

topup "$ARBITRUM_WBTC" "$WBTC_WHALE" "$DEMO_MAKER" 500000000       # 5 WBTC
topup "$ARBITRUM_USDC" "$USDC_WHALE" "$DEMO_MAKER" 500000000000    # 500k USDC
topup "$ARBITRUM_WBTC" "$WBTC_WHALE" "$DEMO_TAKER" 100000000       # 1 WBTC

echo "  maker WBTC $(cast call "$ARBITRUM_WBTC" 'balanceOf(address)(uint256)' "$DEMO_MAKER" --rpc-url "$RPC" | awk '{print $1}')"
echo "  maker USDC $(cast call "$ARBITRUM_USDC" 'balanceOf(address)(uint256)' "$DEMO_MAKER" --rpc-url "$RPC" | awk '{print $1}')"
