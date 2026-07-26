#!/usr/bin/env bash
# End-to-end demo verification, exactly the path a judge walks.
#
#   ./scripts/verify-demo.sh            verify against whatever is running
#   FRESH=1 ./scripts/verify-demo.sh    stop everything, reset the chain, rebuild, then verify
#
# Exits non-zero on the first failed flow, and says which layer owns it.
#
# Why this exists: "the tests pass" and "the demo works" are different claims.
# Every failure this catches was invisible to `pnpm test` — an API on the wrong
# chain, a strategy deployed but never shipped, a dev server serving stale
# routes. This walks the real HTTP and RPC surface instead.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
RPC=http://127.0.0.1:8545
API=http://127.0.0.1:3001
WEB=http://127.0.0.1:3000
FAILED=0

pass() { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m  %s\n        layer: %s\n' "$1" "$2"; FAILED=1; }
head() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# Stop by PID and then WAIT FOR THE PORT TO ACTUALLY BE FREE.
#
# `kill` returning is not the same as the socket being released, and if 3000 is
# still held when `next dev` starts, Next does not fail — it prints "Port 3000
# is in use … using available port 3004 instead" and serves happily on the
# wrong port. Everything looks up while the runbook, and the judge, are pointed
# at 3000. Silent port drift is exactly the failure this project keeps hitting,
# so it is treated as fatal rather than tidied around.
stop_by_pid() {
  for p in 3000 3001 8545; do
    local pid
    pid=$(ss -ltnp 2>/dev/null | grep ":$p " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | head -1)
    if [[ -n "$pid" ]]; then
      # Kill the socket holder by PID. Services started by this script get their
      # own session via `setsid`, so their children go with them; anything
      # started by hand outside the script is left to its owner to stop.
      kill "$pid" 2>/dev/null
      for _ in $(seq 1 15); do
        ss -ltn 2>/dev/null | grep -q ":$p " || break
        sleep 1
      done
      if ss -ltn 2>/dev/null | grep -q ":$p "; then
        pid=$(ss -ltnp 2>/dev/null | grep ":$p " | grep -oE 'pid=[0-9]+' | cut -d= -f2 | head -1)
        [[ -n "$pid" ]] && kill -9 "$pid" 2>/dev/null && sleep 2
      fi
      if ss -ltn 2>/dev/null | grep -q ":$p "; then
        echo "  WARNING: :$p is still held — a new server would silently move to another port"
      else
        echo "  stopped :$p"
      fi
    fi
  done
}

# Wait for an actual 200. `curl -o /dev/null` succeeds on a 500 too, so the
# obvious version of this returns while `next dev` is still compiling its first
# route and every page is briefly a 500. That is also what a judge sees if they
# open the page the instant the server starts, so the wait is real, not cosmetic.
wait_for_200() { # url, attempts
  for _ in $(seq 1 "$2"); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$1" 2>/dev/null)" == "200" ]] && return 0
    sleep 2
  done
  return 1
}

if [[ "${FRESH:-0}" == "1" ]]; then
  head "FRESH START — stopping services, resetting chain and build artifacts"
  stop_by_pid
  rm -rf apps/web/.next .anvil-8545.log
  bash scripts/ensure-demo.sh >/tmp/verify-chain.log 2>&1
  grep -q "READY" /tmp/verify-chain.log && echo "  chain READY" || { fail "chain bring-up" "contracts/deployment"; tail -5 /tmp/verify-chain.log; exit 1; }
  # `setsid` puts each service in its own session, so stopping it later takes
  # its children with it instead of orphaning workers that keep holding a port.
  setsid nohup pnpm --filter @vortex/api demo >/tmp/verify-api.log 2>&1 < /dev/null &
  setsid nohup pnpm --filter @vortex/web dev  >/tmp/verify-web.log 2>&1 < /dev/null &
  wait_for_200 "$API/api/v1/health" 45 || { fail "API never became ready" "backend"; exit 1; }
  # First-request compile in dev mode is slow; give it a real budget.
  wait_for_200 "$WEB/" 90              || { fail "web never served a 200" "frontend"; exit 1; }
  # Catch the silent-port-drift case explicitly: a green page on :3004 is not a
  # green demo when every instruction says :3000.
  if grep -q "using available port" /tmp/verify-web.log 2>/dev/null; then
    fail "web moved off port 3000 ($(grep -o 'using available port [0-9]*' /tmp/verify-web.log | head -1))" "environment"
    exit 1
  fi
fi

SWAP_HASH=$(node -e "console.log(require('$ROOT/deployments/31337.demo.json').strategyHash)" 2>/dev/null)
GROW_HASH=$(node -e "console.log(require('$ROOT/deployments/31337.grow.json').growStrategyHash)" 2>/dev/null)
WBTC=$(node -e "console.log(require('$ROOT/deployments/31337.json').contracts.MockWBTC)")
USDC=$(node -e "console.log(require('$ROOT/deployments/31337.json').contracts.MockUSDC)")
TAKER=0x90F79bf6EB2c4f870365E785982E1f101E93b906

# ── Flow 1 — environment ────────────────────────────────────────────
head "Flow 1 — environment"
[[ "$(cast chain-id --rpc-url $RPC 2>/dev/null)" == "31337" ]] \
  && pass "chain is 31337" || fail "chain id" "environment"
H=$(curl -s -m 8 "$API/api/v1/health")
[[ "$(node -pe "JSON.parse(process.argv[1]).chainId" "$H" 2>/dev/null)" == "31337" ]] \
  && pass "API serves chain 31337" || fail "API chain ($H)" "backend"
C=$(curl -s -m 8 "$API/api/v1/config")
[[ "$(node -pe "Object.keys(JSON.parse(process.argv[1]).contracts).length" "$C" 2>/dev/null)" -ge 17 ]] \
  && pass "API reports the deployed contracts" || fail "API config contracts" "backend"
for p in / /swap /grow /maker; do
  # Each route compiles on its first request in dev, so a single probe can
  # catch a 500 that is really "not compiled yet". Retry before failing.
  if wait_for_200 "$WEB$p" 20; then pass "web $p renders"
  else fail "web $p -> $(curl -s -o /dev/null -w '%{http_code}' -m 20 "$WEB$p")" "frontend"; fi
done
[[ -z "$(git status --porcelain deployments/)" ]] \
  && pass "no deployment artifact drift" || fail "deployments/ drifted" "deployment"

# ── Flow 3 — maker state is real ────────────────────────────────────
head "Flow 3 — maker onboarding state"
for pair in "swap:$SWAP_HASH" "grow:$GROW_HASH"; do
  name=${pair%%:*}; hash=${pair#*:}
  S=$(curl -s -m 20 "$API/api/v1/strategies/$hash")
  node -e '
    const d=JSON.parse(process.argv[1]);
    if(d.error){console.log("ERR "+d.error.code);process.exit(1)}
    if(!d.active||!d.solvent){console.log("ERR inactive/insolvent");process.exit(1)}
    for(const t of d.tokens){
      const m=[t.virtualBalance,t.actualBalance,t.aquaAllowance].map(BigInt).reduce((a,b)=>a<b?a:b);
      if(BigInt(t.executableBalance)!==m){console.log("ERR "+t.symbol+" executable != min");process.exit(1)}
    }
  ' "$S" >/tmp/vf.txt 2>&1 \
    && pass "$name strategy active, executable == min(virtual, actual, allowance)" \
    || fail "$name strategy: $(cat /tmp/vf.txt)" "backend/contracts"
done

# ── Flow 4 — Aqua wins, quote -> build -> settle ────────────────────
head "Flow 4 — Vortex Swap (Aqua)"
Q=$(curl -s -m 30 -X POST "$API/api/v1/quotes/exchange" -H 'content-type: application/json' \
  -d "{\"chainId\":31337,\"strategyHash\":\"$SWAP_HASH\",\"tokenIn\":\"$WBTC\",\"tokenOut\":\"$USDC\",\"amountIn\":\"20000000\",\"taker\":\"$TAKER\",\"slippageBps\":30}")
VENUE=$(node -pe "JSON.parse(process.argv[1]).selectedVenue||''" "$Q" 2>/dev/null)
SRC=$(node -pe "JSON.parse(process.argv[1]).comparison?.aqua?.source||''" "$Q" 2>/dev/null)
[[ "$VENUE" == "AQUA" && "$SRC" == "live" ]] \
  && pass "quote: venue AQUA, aqua source live" || fail "quote venue=$VENUE source=$SRC" "backend"
SESSION=$(node -pe "JSON.parse(process.argv[1]).quoteSessionId||''" "$Q" 2>/dev/null)
B=$(curl -s -m 30 -X POST "$API/api/v1/transactions/aqua" -H 'content-type: application/json' -d "{\"quoteSessionId\":\"$SESSION\"}")
TO=$(node -pe "JSON.parse(process.argv[1]).to||''" "$B" 2>/dev/null)
[[ "$TO" =~ ^0x ]] && pass "builder returned executable calldata" || fail "builder: $B" "backend"
R=$(curl -s -m 20 -X POST "$API/api/v1/transactions/aqua" -H 'content-type: application/json' -d "{\"quoteSessionId\":\"$SESSION\"}")
[[ "$R" == *SESSION_ALREADY_USED* ]] && pass "quote session is single-use" || fail "replay not rejected" "backend"
# A guard refusal must explain itself, not just name the revert.
G=$(curl -s -m 25 -X POST "$API/api/v1/quotes/exchange" -H 'content-type: application/json' \
  -d "{\"chainId\":31337,\"strategyHash\":\"$SWAP_HASH\",\"tokenIn\":\"$WBTC\",\"tokenOut\":\"$USDC\",\"amountIn\":\"100000000\",\"taker\":\"$TAKER\",\"slippageBps\":30}")
[[ "$G" == *"try a smaller amount"* ]] \
  && pass "oversized trade is refused with an actionable reason" || fail "guard message: $G" "backend"

# ── Flow 6 — Grow succeeds ──────────────────────────────────────────
head "Flow 6 — Vortex Grow (success)"
VB=$(curl -s -m 15 "$API/api/v1/strategies/$GROW_HASH" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).tokens[0].virtualBalance" 2>/dev/null)
S=$(curl -s -m 30 -X POST "$API/api/v1/grow/scan" -H 'content-type: application/json' \
  -d "{\"chainId\":31337,\"strategyHash\":\"$GROW_HASH\",\"principalAmount\":\"100000000\",\"direction\":\"AUTO\"}")
OPP=$(node -pe "JSON.parse(process.argv[1]).opportunityId||''" "$S" 2>/dev/null)
[[ -n "$OPP" ]] && pass "scan found an opportunity" || fail "scan: $S" "backend"
curl -s -m 30 -X POST "$API/api/v1/grow/prepare" -H 'content-type: application/json' -d "{\"opportunityId\":\"$OPP\"}" >/tmp/vprep.json
node -pe "JSON.parse(require('fs').readFileSync('/tmp/vprep.json','utf8')).to" >/dev/null 2>&1 \
  && pass "route prepared" || fail "prepare: $(cat /tmp/vprep.json)" "backend"
E=$(curl -s -m 120 -X POST "$API/api/v1/grow/execute" -H 'content-type: application/json' -d "{\"opportunityId\":\"$OPP\"}")
TX=$(node -pe "JSON.parse(process.argv[1]).txHash||''" "$E" 2>/dev/null)
[[ "$TX" =~ ^0x ]] && pass "cycle executed ($TX)" || fail "execute: $E" "backend/contracts"
VA=$(curl -s -m 15 "$API/api/v1/strategies/$GROW_HASH" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).tokens[0].virtualBalance" 2>/dev/null)
[[ -n "$VB" && -n "$VA" && "$VA" -gt "$VB" ]] \
  && pass "maker virtual WBTC grew ($VB -> $VA)" || fail "virtual balance did not grow ($VB -> $VA)" "contracts"

# ── Flow 7 — Grow refuses an unprofitable cycle ─────────────────────
head "Flow 7 — Vortex Grow (failure protection)"
EXT=$(node -e "console.log(require('$ROOT/deployments/31337.grow.json').externalTarget)")
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
BEFORE=$(curl -s -m 15 "$API/api/v1/strategies/$GROW_HASH" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).tokens[0].virtualBalance")
cast send "$EXT" 'setShortfall(uint256)' 5000000 --private-key $KEY --rpc-url $RPC >/dev/null 2>&1
N=$(curl -s -m 30 -X POST "$API/api/v1/grow/scan" -H 'content-type: application/json' \
  -d "{\"chainId\":31337,\"strategyHash\":\"$GROW_HASH\",\"principalAmount\":\"100000000\",\"direction\":\"AUTO\"}")
[[ "$N" == *'"opportunityFound":false'* ]] \
  && pass "unprofitable cycle reported as a clear no-op, not a trade" || fail "scan while unprofitable: $N" "backend"
AFTER=$(curl -s -m 15 "$API/api/v1/strategies/$GROW_HASH" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).tokens[0].virtualBalance")
[[ "$BEFORE" == "$AFTER" ]] && pass "maker virtual balance untouched" || fail "balance moved on a failed cycle" "contracts"
cast send "$EXT" 'setShortfall(uint256)' 0 --private-key $KEY --rpc-url $RPC >/dev/null 2>&1

head "RESULT"
if [[ "$FAILED" == "0" ]]; then printf '  \033[32mDEMO GREEN\033[0m — every flow passed\n\n'; else printf '  \033[31mDEMO NOT GREEN\033[0m\n\n'; fi
exit "$FAILED"
