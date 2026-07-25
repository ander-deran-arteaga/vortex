# CLI backup path

If the UI or the API is unavailable during the demo, the contract layer can
demonstrate **both** Vortex products on its own. Every command below moves real
ERC-20 balances through the official Aqua and SwapVM contracts and asserts its
own invariants — each script `require`s the outcome it prints, so a broken run
aborts instead of printing a plausible-looking number.

All commands run from `packages/contracts` against the local chain on
`http://127.0.0.1:8545`. `$PK` is anvil account #0.

```bash
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
RPC=http://127.0.0.1:8545
```

## Pre-flight — run this immediately before demoing

```bash
cd packages/contracts && forge script script/CheckDemoReady.s.sol --rpc-url $RPC
```

Read-only, one second, and it **reverts** rather than reporting ready. It
catches the two conditions that are otherwise silent — the chain looks perfectly
healthy in both:

- **A stale oracle.** Vortex Swap pricing rejects an oracle older than one hour.
  Anvil stamps new blocks with wall-clock time, so an idle chain still *reads*
  fresh right up until the demo's first transaction mines a block — and then
  every quote reverts `VortexStaleOracle`. Refresh with section 3's
  `SCENARIO=AQUA_WINS`, which re-stamps the price.
- **A maker left on the losing scenario**, which makes the headline
  best-execution scene show Aqua losing.

## 0. Bring the whole system up (one command, from the repo root)

```bash
bash scripts/bootstrap-fork.sh
```

**If the demo chain is already running on 8545, skip this step** — the script
refuses to start rather than redeploying on top of a live chain, and prints the
PID holding the port. Re-bootstrapping would mint new addresses and strand the
committed artifacts, the running API and any open session. Use
`ANVIL_PORT=<other>` if you genuinely want a second chain alongside it.

Deploys, in a fixed order that the committed addresses depend on: official Aqua
+ AquaSwapVMRouter + tokens + oracle + the Vortex Swap stack; the seeded Vortex
Swap strategy; a real Uniswap v4 PoolManager with the Vortex PermAMM hook at a
mined permission-encoding address; and the Vortex Grow compounder with its
simulated venue and shipped strategy. Output is written to
`deployments/31337.json`, `31337.demo.json` and `31337.grow.json`, and is
byte-reproducible across fresh chains.

Add `FORK_RPC_URL=https://arb1.arbitrum.io/rpc` to run the Vortex Swap stack on
an **Arbitrum One fork** instead — real WBTC/USDC at chain id 42161, which is
the configuration where the Uniswap Trade API can quote the same assets Vortex
settles. Fork output goes to `*.fork.json` and is never committed.

## 1. Vortex Swap — real settlement through official Aqua + SwapVM

```bash
forge script script/ExecuteDemoSwap.s.sol --rpc-url $RPC --private-key $PK --broadcast
```

Quotes the seeded strategy, binds that quote as the router-enforced minimum,
and fills it. Prints both sides' balance deltas.

```
quoted out       4,979.009250 USDC
min out (chain)  4,954.114204 USDC     enforced by the router, not by the caller
amount in        0.05 WBTC
maker WBTC +0.05    maker USDC -4,979.009250    taker USDC +4,979.009250
```

## 2. Vortex Grow — same-asset compounding, maker ends with more WBTC

```bash
forge script script/ExecuteDemoGrow.s.sol --rpc-url $RPC --private-key $PK --broadcast
```

Pulls the maker's WBTC through Aqua, cycles it (Vortex PermAMM exact-output →
external venue), and pushes back more than it took, atomically.

```
wallet  WBTC 7.00000000 -> 7.03475502
virtual WBTC 5.00000000 -> 5.03475502     same delta, fee taken from profit only
```

> The external venue is **simulated** (`MockExternalRouter`, marking WBTC at
> 95k against the pool's 100k). The compounding mechanism, the atomicity and
> the profit floor are real; the arbitrage opportunity is manufactured. Say
> "simulated counterparty" whenever this number is shown.

## 3. Make the router choose against our own venue

```bash
SCENARIO=UNISWAP_WINS forge script script/SetDemoScenario.s.sol --rpc-url $RPC --private-key $PK --broadcast
SCENARIO=AQUA_WINS    forge script script/SetDemoScenario.s.sol --rpc-url $RPC --private-key $PK --broadcast
```

Moves the maker's reference oracle so it **genuinely prices worse** — this does
not fake a comparison or toggle a fixture. Measured through the live pricing
contract:

| scenario | 0.05 WBTC quote | effective price |
|---|---|---|
| `AQUA_WINS` | 4,979.009250 USDC | 99,580 USDC/WBTC |
| `UNISWAP_WINS` | 4,836.425577 USDC | 96,728 USDC/WBTC (−2.9%) |

The move is bounded well inside the PermAMM hook's deviation cap, and that
headroom is pinned by `test_demoScenarioOracleMoveIsWithinTolerance` so the
scenario cannot silently take the pool down with it.

## 4. Inspect state without changing it

```bash
forge script script/QuoteDemo.s.sol --rpc-url $RPC        # what the maker quotes right now
```

**Check this before demoing.** The scenario in section 3 is persistent chain
state, so a chain left in `UNISWAP_WINS` will make the maker look uncompetitive
in the headline best-execution scene. The competitive baseline quotes about
**99,580 USDC/WBTC**; roughly **96,700** means the de-tuned scenario is still
applied. Reset with `SCENARIO=AQUA_WINS` before the run.

## Known limitation: coverage is per strategy, not per maker

Aqua scopes virtual balances by `(maker, app, strategyHash, token)`, and one
wallet can back several strategies. `VortexAquaLens` reports
`executable = min(virtual, wallet balance, Aqua allowance)` **per strategy**, so
two strategies can each report full coverage while together committing more
than the maker holds. On the seeded demo chain the two strategies commit
7.1325 WBTC against a 7.0425 WBTC wallet.

This does not affect either demo — Grow pulls WBTC with ample headroom, and the
Swap demo pays USDC, which is exactly covered — and settlement can never
over-deliver, because Aqua transfers from the maker's wallet at execution time
and reverts if it cannot. A maker who over-commits gets a failed fill, never a
silent shortfall. An aggregate, cross-strategy coverage view is the honest fix
and is out of MVP scope.
