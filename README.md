# Vortex

Vortex is a dual-intent Aqua and SwapVM liquidity system connected to the
Vortex PermAMM (a Uniswap v4 dynamic-fee pool) and the Uniswap Developer
Platform: takers get the best
safe execution across Aqua and Uniswap, and makers can atomically compound an
asset through profitable same-chain arbitrage.

## Products

| Product | What it does |
| --- | --- |
| **Vortex Swap** | Best execution across two venues. `AQUA_SWAPVM` is a direct official Aqua + SwapVM quote and settlement; `UNISWAP_API` is an external quote with an API-built transaction. Aqua executes only when it beats the best observed executable quote without violating the maker's onchain safety envelope; otherwise the Uniswap API builds the fallback. |
| **Vortex Grow** | Same-asset compounding. A maker ships WBTC through a custom Aqua app; Vortex executes an atomic WBTC → USDC → WBTC cycle using the Vortex PermAMM as one leg and an external venue as the other. The transaction succeeds only if final WBTC exceeds initial WBTC plus the maker's minimum profit; the performance fee comes from realized profit only. |
| **Vortex PermAMM** | A separate Uniswap v4 liquidity venue: a real dynamic-fee pool (`VortexHook`) with controlled liquidity, a mock reference oracle, an immutable safety fee floor, and signed per-swap commercial fees. Usable on its own, comparable as an additional venue later, and one possible leg of Grow. |

### Architectural invariant

**Vortex Swap's Aqua execution does not depend on Vortex PermAMM availability.**
Vortex Swap settles `taker → Aqua router → SwapVM → Aqua settlement → maker`,
never through the Vortex PermAMM. A Vortex Swap succeeds with no Vortex PermAMM contracts
deployed at all. This is enforced in CI by `scripts/check-architecture.sh`,
which fails the build if the Aqua module or the backend's Vortex Swap path
references the Vortex PermAMM module. See `docs/decisions.md` D-015.

## Network

Arbitrum One (`42161`), pair WBTC/USDC (8 / 6 decimals, 1e18 internal price
scale). Development runs on a local Arbitrum mainnet fork (`31337`).

## Monorepo layout

```
apps/web            Next.js App Router + wagmi + viem
apps/api            Fastify + viem + Zod (quote comparator, Uniswap API client,
                    signers, Grow scanner, indexer)
packages/contracts  Foundry (Aqua strategies, VortexCompounder, v4 hook)
packages/shared     Zod schemas, EIP-712 typed data, units, chain metadata
scripts             Commit policy, fork bootstrap, demo runners
deployments         Per-chain deployed addresses
docs                Architecture, economics, security, demo, Uniswap API notes
```

## Quickstart

```bash
pnpm install
cp .env.example .env      # fill UNISWAP_API_KEY and signer keys (backend-only)
pnpm build
pnpm test
pnpm --filter @vortex/api dev
pnpm --filter @vortex/web dev
```

Contracts:

```bash
cd packages/contracts
forge build
forge test
```

## Sponsor qualification

- **Uniswap Developer Platform** — the Trade API is load-bearing: it
  benchmarks every Aqua quote, builds the fallback swap when Uniswap wins, and
  (where feasible) builds the external leg of Vortex Grow. Evidence (request
  IDs, transaction hashes, direct code links) is collected here and in
  [FEEDBACK.md](./FEEDBACK.md) as integration lands.
- **1inch Aqua / SwapVM** — official Aqua contracts, a meaningful SwapVM
  strategy for Vortex Swap, and a custom pull/push Aqua app for Vortex Grow,
  with real ERC-20 settlement proven by tests.

### Verification table

Every link is pinned to commit
[`908f8b9`](https://github.com/ander-deran-arteaga/vortex/tree/908f8b9284f7014822417c9d5602f9bf88fc2d50)
so the line ranges stay valid. Each row is checkable two ways: open the range,
or run the named test from `packages/contracts` with
`forge test --match-test <name>`.

| Requirement | Evidence | Test proving it |
| --- | --- | --- |
| **Official Aqua used** | [`VortexCompounder.sol` L34-235](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/compound/VortexCompounder.sol#L34-L235) — imports `AquaApp`/`IAqua` from `@1inch/aqua`; real settlement at [`AQUA.pull` L113](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/compound/VortexCompounder.sol#L113) and [`AQUA.push` L136](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/compound/VortexCompounder.sol#L136) | `test_pullTransfersRealToken`, `test_shipDoesNotTransferTokens` |
| **Meaningful SwapVM** | [`VortexAquaPricing.extruction()` L180-218](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/aqua/VortexAquaPricing.sol#L180-L218) — the SwapVM `Extruction` target pricing every fill; program assembled in [`VortexAquaOrderBuilder.buildProgram()` L101-122](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/aqua/VortexAquaOrderBuilder.sol#L101-L122) | `test_programEncodingMatchesOfficialBuilder` — our program bytes pinned to 1inch's own `ProgramBuilder` |
| **Real ERC-20 settlement** | Settles through the official `AquaSwapVMRouter` | `test_exactInputSwapMovesRealTokens` — asserts both wallets, exact Aqua virtual deltas, router retains nothing; `test_quoteMatchesSwap` |
| **Sophisticated Aqua position** | [`VortexAquaPricing._evaluate()` L308-415](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/aqua/VortexAquaPricing.sol#L308-L415) — oracle-anchored two-way quoting, inventory-aware fee, immutable safety floor, max-trade cap, hard inventory bounds, phantom-liquidity guard | `test_recentringFlowGetsLowerFee`, `test_worseningFlowGetsHigherFee`, `test_maxTradeReverts`, `test_postTradeHardBoundaryReverts`, `test_lensReportsPhantomLiquidity` |
| **Dynamic v4 fee** | [`VortexHook.beforeSwap()` L210-233](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/permamm/VortexHook.sol#L210-L233) returning `feePips \| OVERRIDE_FEE_FLAG`; signer clamped by [`_authorizedFee()` L331-377](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/permamm/VortexHook.sol#L331-L377) | `test_validAuthorizationOverridesFee` — two identical swaps differing only in signed fee produce different outputs; `test_feeIsClampedIntoTheImmutableBand` — a signed request of **0** still pays `safety + minCommercial` |
| **Same-asset profit** | [`VortexCompounder.executeCompound()` L79-155](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/packages/contracts/src/compound/VortexCompounder.sol#L79-L155), profit and fee arithmetic at L129-131 | `test_successfulCycleReturnsMoreWBTC`, `test_virtualBalanceGrowsByNetProfit`, `test_feeOnlyTakenFromProfit` |
| **Swap independent of Vortex PermAMM** | Architectural invariant D-015, enforced in CI by [`check-architecture.sh`](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/scripts/check-architecture.sh) | `test_swapSucceedsWithoutPermAmmDeployed` — Vortex Swap settles with **no Vortex PermAMM deployed at all** |
| **Uniswap API client** | [`uniswapApiClient.ts`](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/apps/api/src/clients/uniswapApiClient.ts) — authenticated, paced, backoff on 429/5xx | 43 tests against payloads captured from the live API |
| **Net-output venue comparison** | [`venueComparator.ts`](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/apps/api/src/services/venueComparator.ts) — ranks on `minimum − gas priced in the output token`, using Uniswap's own `gasFeeQuote` so no ETH feed is needed | `venueComparator.test.ts` |
| **API-built transaction onchain** | [`uniswapFork.integration.test.ts`](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/apps/api/tests/integration/uniswapFork.integration.test.ts) | Transaction hashes below |
| **FEEDBACK.md** | [FEEDBACK.md](./FEEDBACK.md) | — |
| **Git history** | 154 commits, `feat:`/`fix:`/`del:` only, enforced by [`check-commit-policy.sh`](https://github.com/ander-deran-arteaga/vortex/blob/908f8b9284f7014822417c9d5602f9bf88fc2d50/scripts/check-commit-policy.sh) in CI | — |

### Uniswap Trade API request IDs

Verifiable by Uniswap server-side — the strongest evidence that the API was
genuinely used.

| Flow | Chain | Request ID |
| --- | --- | --- |
| `/quote` — Aqua wins the comparison | 42161 | `1ccfe698432715a192bd871c0895f57d` |
| `/quote` — Uniswap wins the comparison | 42161 | `e138fcf2e652b16d98041a83cd643441` |
| `/swap` — fallback transaction built | 42161 | `74573f77e2d8ee6ffcc189711005ff7c` |
| `/quote` — Uniswap-wins demo case | 42161 | `54b70d748670f06ab5d3cc26bf02cac5` |
| `/quote` — used by the executed fork transaction | 42161 fork | `4e9ab8fad895f5faf57aa797b9a0ec77` |
| `/swap` — calldata that was broadcast | 42161 fork | `dfcf85a848a118e5d8f7e9ad8473b741` |

### Transaction hashes

**These executed on forks and local chains, not on public Arbitrum, so they do
not resolve on Arbiscan.** They are real EVM execution against real state at a
pinned block, reproducible via `scripts/bootstrap-fork.sh`. We label them
rather than implying mainnet finality.

| Flow | Chain | Hash | Result |
| --- | --- | --- | --- |
| Uniswap API-built swap, calldata unmodified | Arbitrum One **fork**, block 487597751 | `0xaae23e0178e7918d8c68bbc2392058bfa53adb68dbe0e3c7ed67958a31437622` | 0.01 WBTC → 640.148194 USDC through Universal Router 2.0 |
| Contract-as-swapper spike | Arbitrum One **fork** | `0xe41adb01d06c9240b99a8cd88a258e957dc372ed2f1f5e5e9ac0eda2d6e4e3b1` | A contract approved the proxy and executed API calldata in one transaction, relayed by a different EOA |
| Vortex Swap via `/transactions/aqua` | local 31337 | `0x3127aaa299579ffaf39e79cc7bf35cec4f399c3e46b16225f936e67b3feb2fea` | 0.02 WBTC → 1988.205400 USDC |
| Vortex Grow full cycle | local 31337 | `0x012e0bff54f882d34578bc49f68c95a255cbe077dcaf8abd40d808eae499eed6` | Maker 1.00000000 → **1.03311528 WBTC**, fee exactly 20% of realised profit |

### Known limitations

Stated plainly, because a judge will find them anyway.

- **The Grow arbitrage opportunity is manufactured.** The external leg runs a
  deterministic simulated venue (`externalVenueKind: "SIMULATED"`) at a fixed
  mark. The *mechanism* — atomic execution, the onchain profit floor, fee from
  realised profit only — is real and tested; the *opportunity* is seeded so the
  demo is reproducible.
- **No public-chain deployment.** Everything runs on a pinned Arbitrum fork or
  a local chain. `deployments/42161.json` is intentionally empty.
- **The reference oracle is a mock.** `MockReferenceOracle` implements a
  pull-oracle-shaped interface (bid/mid/ask + timestamp). Freshness enforcement
  is real and reverts on every swap — `VortexStaleOracle`,
  `VortexFutureOracleTimestamp`, `VortexOracleSpreadTooWide` — but no
  third-party feed is integrated.
- **The Trade API cannot quote chain 31337**, so the live two-venue comparison
  is demonstrated against Arbitrum One separately from the local demo.
- **Competitive rebate signing is cut from the MVP.** The contract verifies
  `VortexQuoteAuthorization` and the typed data is canonical, but the backend
  does not derive a rebate from the competitor quote.
- **Resolver endpoints are not implemented.** No production 1inch discovery
  integration is claimed.

## Docs

See `docs/` for the master plan, architecture, economic model, security
model, demo script, and Uniswap API integration notes.
