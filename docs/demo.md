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
| **8545** | anvil, chain id 31337 | `scripts/ensure-demo.sh` |
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
./scripts/ensure-demo.sh
```

**One command, safe to run any number of times.** It works out what already
exists and does only what is missing — starts anvil if nothing is listening,
deploys the stack if the contracts are absent, ships the Swap and Grow Aqua
strategies if they are not shipped, then runs the pre-flight and prints a
summary. Re-running a healthy chain changes nothing and says so.

It exists because deploying the contracts and shipping the strategies are
**separate steps**, and a half-finished bring-up produces the worst symptom
available: every contract address has bytecode, so the system looks fully
deployed, while the API answers `STRATEGY_NOT_FOUND`. A strategy is Aqua
*state*, not a contract. If you see that error, run this command — it will say
`shipped by this run` and the chain will be healthy.

It also **re-stamps the reference oracle** when it is past half its one-hour
budget. This is the demo's most likely failure and a silent one: an idle chain
keeps reporting the oracle as fresh, because `block.timestamp` is frozen at the
last block, and then the demo's first transaction mines a block carrying
wall-clock time and every quote and Grow cycle reverts `VortexStaleOracle`. The
re-stamp changes no number — a deliberate `UNISWAP_WINS` mark stays where you
put it — so **running this command before demoing is always safe**.

The last thing it runs is the read-only pre-flight
(`packages/contracts/script/CheckDemoReady.s.sol`), which is the single source
of truth for chain health: core contracts deployed, oracle fresh against **wall
clock**, maker on the competitive baseline, and **both** the Swap and Grow
strategies shipped, funded and covered. Run it on its own immediately before
demoing — see `docs/cli-backup.md`.

The chain is left running in the background (log: `.anvil-8545.log`), so this
terminal is free. Stop it **by PID** (`ss -ltnp "sport = :8545"`), never with a
broad `pkill`.

`scripts/bootstrap-fork.sh` still exists and does the same deployment in the
foreground; use `ensure-demo.sh` unless you specifically want a blocking
process. Fork mode: `FORK_RPC_URL=https://arb1.arbitrum.io/rpc ./scripts/ensure-demo.sh`.

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

### 6.1 — Two live venues on one chain (the real best-execution proof)

The strongest demo: Vortex deployed on an **Arbitrum One fork** alongside the
**real** WBTC and USDC, so the Uniswap Trade API and our Aqua strategy quote
the same assets on the same chain, and **both are executable**. Both legs
report `source: "live"`.

```bash
# 1. Fork Arbitrum, keeping chain id 42161 so the Trade API will quote it
anvil --fork-url <ARBITRUM_RPC> --port 8546 --chain-id 42161

# 2. Deploy Vortex against the REAL tokens (not mocks)
cd packages/contracts
export WBTC_ADDRESS=0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f
export USDC_ADDRESS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831
export WETH_ADDRESS=0x82aF49447D8a07e3bd95BD0d56f35241523fBab1
DEPLOY_OUT=42161.fork.json forge script script/DeployLocal.s.sol   --rpc-url http://127.0.0.1:8546 --private-key $DEPLOYER_KEY --broadcast

# 3. Fund the maker — real tokens are NOT mintable, so impersonate holders
#    (WBTC: Aave v3 aWBTC reserve; USDC: any large holder)
cast rpc anvil_impersonateAccount 0x078f358208685046a11C85e8ad32895DED33A249 --rpc-url http://127.0.0.1:8546
cast send $WBTC_ADDRESS 'transfer(address,uint256)'   0x70997970C51812dc3A010C7d01b50e0d17dc79C8 500000000   --from 0x078f358208685046a11C85e8ad32895DED33A249 --unlocked --rpc-url http://127.0.0.1:8546
# ...and the same for USDC from a USDC holder.

# 4. Seed the strategy WITHOUT minting.
#    SEED_OUT matters: without it SeedDemo writes <chainId>.demo.json — the
#    LOCAL artifact — not the fork one the API reads in step 5.
USE_REAL_TOKENS=true DEPLOY_OUT=42161.fork.json SEED_OUT=42161.fork.demo.json \
  forge script script/SeedDemo.s.sol --rpc-url http://127.0.0.1:8546 \
  --private-key $DEPLOYER_KEY --broadcast

# 5. Point the API at the fork artifacts
cd apps/api
DEPLOYMENT_VARIANT=fork CHAIN_ID=42161 FORK_RPC_URL=http://127.0.0.1:8546   PORT=3991 pnpm start
```

`DEPLOYMENT_VARIANT=fork` reads `42161.fork.json` / `42161.fork.demo.json` and
routes RPC to the local node even though the chain reports 42161. The seeded
strategy hash is deterministic:
`0xd85d02ac546e857d987154a9700785dcb9473a443572935a75c7dd96056f187b`.

**Those two files are generated by steps 2 and 4 above, not committed** —
`deployments/*fork*.json` is gitignored because fork addresses depend on the
deployer's live nonce, so a committed copy would go stale and silently point at
the wrong contracts. Expect them to be absent on a fresh clone; run the steps.

**⚠️ Set the oracle to the real market price first.** The deploy script marks
WBTC at 100,000 USDC. Real WBTC is far from that, so Aqua would "win" purely
by mispricing — which is not best execution, it is a broken oracle. Read the
live Uniswap quote, then set the oracle to that price:

```bash
cast send <MockReferenceOracle from 42161.fork.json>   'setPrice(uint256,uint256,uint256)' <mid> <bid> <ask>   --private-key $DEPLOYER_KEY --rpc-url http://127.0.0.1:8546
```

With the oracle **at** market, Uniswap wins — Aqua's fee and higher gas make
it the worse venue, and the router says so. Nudge the oracle ~0.5% in the
maker's favour and Aqua wins. Both were captured on live data:

```
oracle AT market      selectedVenue UNISWAP  aqua net 3199034647  uni net 3203833341
oracle +0.5%          selectedVenue AQUA     aqua net 3215029865  uni net 3203833621
```

Both legs `source: "live"`; the Uniswap side carries a real `requestId`.

> The **local 31337 chain cannot do this** — its tokens are mocks at addresses
> the Trade API has never seen, so only Aqua quotes there and the router falls
> back with `UNISWAP_UNAVAILABLE`. Use this fork configuration for any
> two-venue claim.

Stop this instance by PID when done; it is not part of the §2–§4 demo.

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

### Grow's edge is a consumable resource — budget ~8 cycles

The profit comes from the gap between the PermAMM pool and the external venue,
and **every cycle narrows it**: the demo arbitrages away its own opportunity.
Measured on this chain: **526 bps at deploy, ~57 bps consumed per cycle**, and
the scanner stops finding work at roughly **75 bps**. So after eight or so
cycles `scan` answers `CYCLE_NOT_PROFITABLE` — which is the compounder
correctly refusing to trade, and looks exactly like a broken demo.

Nothing else on the chain changes, so this is invisible unless measured. The
pre-flight measures it and warns with a couple of cycles still in hand:

```
WARN  Grow's edge is nearly spent: pool 95721 vs venue 95000 (75 bps)
      fix: FRESH=1 ./scripts/verify-demo.sh rebuilds the chain and the edge
```

**Practical rule: don't rehearse Grow more than a few times before a judged
run, and rebuild with `FRESH=1` if you have.** A rebuild restores the pool to
its 100,000 mark and the full 526 bps.

---

## 7. If something is wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| `AQUA_EXECUTION_UNAVAILABLE` | API on chain 42161 | Use `pnpm --filter @vortex/api demo`; check `/health` says 31337 |
| `/api/v1/config` shows 0 contracts | API on the wrong chain, or chain not bootstrapped | §2, then §3 |
| Quote 503 `NO_VENUE_AVAILABLE` | Neither venue can price it | Expected on 31337 if the maker is also unavailable; check the oracle scenario |
| `GROW_UNAVAILABLE` | Grow not deployed on this chain | `./scripts/ensure-demo.sh` |
| `STRATEGY_NOT_FOUND`, all contracts present | contracts deployed but the Aqua strategy was never shipped — deploy and ship are separate steps | `./scripts/ensure-demo.sh` (reports `shipped by this run`) |
| Web 500 on a route that builds fine | Dev server compiled against moved files | Restart the web server (§5) |
| Web 500s, or `next build` fails with `Cannot find module for page: /_not-found` | `next build` was run while `next dev` was up — both write the same `.next`, so each corrupts the other | Stop the dev server, `rm -rf apps/web/.next`, build, then restart dev. Never build while the dev server is running |
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

---

## 7. One-command verification

```bash
./scripts/verify-demo.sh              # verify whatever is currently running
FRESH=1 ./scripts/verify-demo.sh      # stop everything, reset the chain, rebuild, then verify
```

Walks the judge path over real HTTP and RPC: chain id, API chain and contract
count, every web route, deployment-artifact drift, both strategies' executable
liquidity, a Vortex Swap quote → build → single-use session, an oversized trade
being refused with an actionable reason, a full Grow cycle with the maker's
virtual balance growing, and an unprofitable cycle reported as a clean no-op
with balances untouched. Exits non-zero on the first failure and names the
layer that owns it.

`FRESH=1` also **proves** the chain is new rather than assuming it: a freshly
shipped Grow strategy sits at exactly its seeded baseline, so carried-over
profit from a previous run is a failure, not a silent pass.

Three things this caught that `pnpm test` cannot:

- `next dev` **silently moving to another port** when 3000 is still held, so
  every instruction points at a server nobody is running.
- A first page load returning **500 while Next compiles**, which looks
  identical to a broken build if you probe once and trust it.
- A stopped service **whose workers keep the port**, because killing the socket
  holder just makes `next` respawn it. Services are started with `setsid` and
  stopped by session id for exactly this reason.
