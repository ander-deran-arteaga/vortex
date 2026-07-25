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
never through the PermAMM. A Vortex Swap succeeds with no PermAMM contracts
deployed at all. This is enforced in CI by `scripts/check-architecture.sh`,
which fails the build if the Aqua module or the backend's Vortex Swap path
references the PermAMM module. See `docs/decisions.md` D-015.

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

A full requirement → evidence table with direct GitHub links is added at
feature freeze.

## Docs

See `docs/` for the master plan, architecture, economic model, security
model, demo script, and Uniswap API integration notes.
