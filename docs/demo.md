# Vortex — judge runbook

Everything needed to take Vortex from a fresh clone to a working demo, in
order, with a way to check each step actually worked.

**Read this first:** a green build is not a running system. We were bitten
twice by exactly that — once by an API pointing at the wrong chain while every
endpoint returned 200, once by a dev server serving 500s from stale compiled
routes while `next build` was clean. **Step 5 (restart and re-probe) is not
optional.**

---

## 0. Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node | ≥ 22 | `node --version` |
| pnpm | 10.x | `pnpm --version` |
| Foundry | any recent | `anvil --version` |

```bash
pnpm install
```

A Uniswap Trade API key is needed only for the live venue comparison (§6).
Put it in the repo-root `.env` as `UNISWAP_API_KEY=…`. It is never committed
and never reaches the browser.

---

## 1. Port ownership — do not deviate

| Port | Service | Started by |
| --- | --- | --- |
| **8545** | anvil, chain id 31337 | `scripts/bootstrap-fork.sh` |
| **3001** | API | `pnpm --filter @vortex/api demo` |
| **3000** | Web | `pnpm --filter @vortex/web dev` |

**Never run a broad `pkill`.** Pattern kills such as
`pkill -f "tsx.*server"` will take down other services that match — this
happened twice during development and cost real time. To stop something:

```bash
ss -ltnp | grep :3001      # find the PID
kill <pid>                 # kill that PID only
```

---

## 2. Start the chain (terminal 1)

```bash
./scripts/bootstrap-fork.sh
```

Deploys, in a fixed order that the committed addresses depend on: Aqua +
SwapVM router + mock tokens + oracle, the seeded Vortex Swap strategy, the
Vortex PermAMM v4 pool, and Vortex Grow. Leave it running.

**Verify:**
```bash
cast chain-id --rpc-url http://127.0.0.1:8545        # -> 31337
cast code $(node -e "console.log(require('./deployments/31337.json').contracts.AquaSwapVMRouter)") \
  --rpc-url http://127.0.0.1:8545 | head -c 20        # -> non-empty
```

The addresses in `deployments/31337.json` are deterministic for a fresh anvil.
If `git diff deployments/` is non-empty after bootstrapping, the scripts ran
out of order — restart anvil and re-run the script, don't commit the drift.

---

## 3. Start the API (terminal 2)

```bash
pnpm --filter @vortex/api demo
```

This loads `apps/api/.env.demo`, which pins `CHAIN_ID=31337`. **Do not use
`pnpm dev:api` for the demo** — it defaults to chain 42161, where no Aqua
strategy is deployed, and every swap reports `AQUA_EXECUTION_UNAVAILABLE`
while still returning 200s. That is the single most likely way this demo dies.

The API runs a preflight before listening. A good start says:

```
preflight: chain 31337 verified: RPC agrees and an Aqua strategy is deployed
```

A bad one is impossible to miss, and tells you the fix:

```
  ┌──────────────────────────────────────────────────────────────
  │ CONFIGURATION ERROR: NO_AQUA_STRATEGY
  │ chain 42161 has no seeded Aqua strategy, so swaps cannot be built
  │ FIX: set CHAIN_ID=31337 — that chain has a seeded strategy
  └──────────────────────────────────────────────────────────────
```

**Verify — `chainId` must be 31337 and `contracts` must not be empty:**
```bash
curl -s localhost:3001/api/v1/health   # {"ok":true,"chainId":31337,...}
curl -s localhost:3001/api/v1/config | jq '{chainId, contracts: (.contracts|length), features}'
# -> chainId 31337, contracts 17, growEnabled true
```

---

## 4. Start the web app (terminal 3)

```bash
pnpm --filter @vortex/web dev
```

**Verify:** `curl -s -o /dev/null -w "%{http_code}" localhost:3000` → `200`.

---

## 5. ⚠️ REQUIRED — restart everything, then re-probe

Do this immediately before presenting, even if everything looks fine.

Both outages we hit were invisible to the build: a running process kept
serving stale or wrongly-configured state while the code on disk was correct.
Restarting is the only way to know the system a judge will touch is the system
you tested.

```bash
# 1. Stop by PID, never by pattern
for p in 3000 3001 8545; do ss -ltnp | grep ":$p " ; done
kill <each pid>

# 2. Start again in order: chain -> api -> web (§2, §3, §4)

# 3. Re-probe all three
cast chain-id --rpc-url http://127.0.0.1:8545                  # 31337
curl -s localhost:3001/api/v1/health                            # chainId 31337
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000         # 200
```

If any probe disagrees, fix it now — not during the demo.

---

## 6. Demo scenes

### Scene 1 — Vortex Swap, Aqua wins

Swap WBTC → USDC in the UI. The comparison panel shows both venues; Aqua wins
on **net** output (after gas), and the Aqua leg is badged with its real
provenance.

```bash
curl -s -X POST localhost:3001/api/v1/quotes/exchange \
  -H 'content-type: application/json' -d '{
    "chainId":31337,
    "strategyHash":"0xa7887853f861f708fbb923fd5a89961f73242a716c2cc6162ec1ed46a02d6382",
    "tokenIn":"0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "tokenOut":"0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "amountIn":"5000000","taker":"0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "slippageBps":30}' | jq '{selectedVenue, aqua: .comparison.aqua.source}'
```

Execute from the browser. The transaction settles through the **official Aqua
and SwapVM contracts**, and the `minimumAmountOut` shown is bound into the
calldata — the router reverts rather than filling below it.

### Scene 2 — the router routes *away* from us

```bash
cd packages/contracts
SCENARIO=UNISWAP_WINS forge script script/SetDemoScenario.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

This moves the maker's **reference oracle**, so the maker genuinely prices
~3% worse. Nothing about the comparison is faked. Re-quote and the maker is
now the worse venue on the numbers.

### ⚠️ Reset the oracle before Scene 3 — this is required, not tidy-up

```bash
SCENARIO=AQUA_WINS forge script script/SetDemoScenario.s.sol \
  --rpc-url http://127.0.0.1:8545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

**Scene 2 leaves the chain in a state where Scene 3 fails.** `UNISWAP_WINS`
marks the oracle ~3% away from the PermAMM pool price. Grow's first leg swaps
*on that pool*, and the hook enforces a maximum pool-vs-oracle deviation in
`beforeSwap`, so with the oracle moved the Grow cycle reverts:

```
GROW_EXECUTION_FAILED
custom error 0x90bfb865 (v4 WrappedError) -> hook 0x982Ac44…, selector 0x575e24b4 (beforeSwap)
```

Reproduced and fixed by the reset above: identical scan → prepare → execute
succeeded immediately afterwards (`0x58887afece99246eb6d827fe429687c69aa41326e13186aceb7eeae2f99712f9`).
Run the scenes in order 1 → 2 → **reset** → 3, or run Scene 3 before Scene 2.

> **Honest limitation.** The Uniswap Trade API cannot quote chain 31337 — the
> local tokens are mocks at addresses it has never seen. So on the local chain
> the comparison has no Uniswap counterparty and the router falls back to Aqua
> with `UNISWAP_UNAVAILABLE`. The **live** Uniswap-wins case is demonstrated
> against Arbitrum One in §6.1. Do not claim otherwise.

### 6.1 — Live Uniswap comparison (needs the API key, real Arbitrum)

```bash
cd apps/api
CHAIN_ID=42161 AQUA_FIXTURE_PROFILE=uncompetitive PORT=3995 pnpm start
```
Quote WBTC→USDC on 42161: `selectedVenue` is **UNISWAP**, beating the Aqua leg
on net, with a real `requestId` in the response. The Aqua side here is
labelled `source: "fixture"` — say so; it is simulated, and the UI badges it.

Stop this instance by PID when done; it is not part of the main demo.

### Scene 3 — Vortex Grow, a real compounding cycle

```bash
OPP=$(curl -s -X POST localhost:3001/api/v1/grow/scan \
  -H 'content-type: application/json' -d '{
    "chainId":31337,
    "strategyHash":"0xcf197695884158f8fa965ce83d23d4242c8d7f5b013ab186d018a23b9d4c18df",
    "principalAmount":"100000000","direction":"AUTO"}' | jq -r .opportunityId)

curl -s -X POST localhost:3001/api/v1/grow/prepare \
  -H 'content-type: application/json' -d "{\"opportunityId\":\"$OPP\"}" | jq '{to, minFinalAsset}'

curl -s -X POST localhost:3001/api/v1/grow/execute \
  -H 'content-type: application/json' -d "{\"opportunityId\":\"$OPP\"}" | jq
```

The maker ships 1 WBTC and ends with **more WBTC**; the performance fee is
taken from realized profit only. `opportunityFound: false` is a normal,
expected answer — it means no cycle currently clears the maker's minimum
profit, not that anything is broken.

---

## 7. If something is wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| `AQUA_EXECUTION_UNAVAILABLE` | API on chain 42161 | Use `pnpm --filter @vortex/api demo`; check `/health` says 31337 |
| `/api/v1/config` shows 0 contracts | API on the wrong chain, or chain not bootstrapped | §2, then §3 |
| Quote 503 `NO_VENUE_AVAILABLE` | Neither venue can price it | Expected on 31337 if the maker is also unavailable; check the oracle scenario |
| `GROW_UNAVAILABLE` | Grow not deployed on this chain | Re-run `scripts/bootstrap-fork.sh` |
| Web 500 on a route that builds fine | Dev server compiled against moved files | Restart the web server (§5) |
| Uniswap 429 | Rate limit (~6 req/s per key) | Wait; the client already paces and backs off |
| A service vanished | Someone ran a broad `pkill` | Restart it; kill by PID only (§1) |
| `GROW_EXECUTION_FAILED`, hook error in `beforeSwap` | Oracle left on `UNISWAP_WINS`; pool-vs-oracle deviation trips the hook guard | `SCENARIO=AQUA_WINS` reset (§6 Scene 2), then re-scan |
| Grow `prepare` succeeds but `execute` reverts | Chain state moved between the simulation and the broadcast | Re-scan — opportunities are 30 s for this reason. If it repeats, reset the oracle and re-bootstrap |

---

## 8. Offline / no-API-key path

Everything except §6.1 works with no Uniswap API key and no internet: the
chain is local, the Aqua strategy is seeded locally, and Grow's external leg
is a deterministic simulated venue. With no key configured the comparison
simply reports no Uniswap side rather than failing.

## 9. Running the tests

```bash
pnpm test                      # all workspaces
pnpm --filter @vortex/api test # api only
cd packages/contracts && forge test
```

Opt-in integration tests need the local chain from §2 (and an API key for the
Uniswap one):

```bash
cd apps/api
VORTEX_INTEGRATION=1 npx vitest run tests/integration
```
