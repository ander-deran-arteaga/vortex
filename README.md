# Vortex

Vortex is a permissioned-liquidity AMM stack built for the hackathon: a real
Uniswap v4 pool with a signed per-swap dynamic-fee hook, 1inch Aqua strategies
for best execution and JIT compounding, and the Uniswap Trade API as a
load-bearing external venue.

## Products

| Product | What it does |
| --- | --- |
| **Vortex AMM** | Real Uniswap v4 pool + hook, mock oracle, signed per-swap dynamic fee. One leg of the JIT arbitrage. |
| **Aqua Best Execution** | Official Aqua + SwapVM, inventory-aware oracle pricing. Competes against Uniswap API quotes and executes through Aqua only when Aqua is better. |
| **Aqua JIT Compound** | Maker ships WBTC; a custom Aqua app temporarily pulls it, executes a Vortex AMM ↔ Uniswap cycle atomically, requires final WBTC > initial WBTC, takes a fee only from realized profit, and pushes principal + profit back. |

## Network

Arbitrum One (`42161`), pair WBTC/USDC. Development runs on a local Arbitrum
mainnet fork (`31337`).

## Monorepo layout

```
apps/web            Next.js App Router + wagmi + viem
apps/api            Fastify + viem + Zod (quote router, Uniswap API client,
                    signers, compound scanner, indexer)
packages/contracts  Foundry (v4 hook, Aqua strategies, compounder)
packages/shared     Schemas, typed data, units, chain + contract metadata
scripts             Fork bootstrap, demo seeding, demo runners
deployments         Per-chain deployed addresses
docs                Architecture, economics, security, demo, API integration
```

## Quickstart

```bash
pnpm install
cp .env.example .env      # fill UNISWAP_API_KEY and signer keys
pnpm build
pnpm test
pnpm dev:api
pnpm dev:web
```

## Docs

See `docs/` for architecture, the economic model, security notes, the demo
script, and Uniswap Trade API integration evidence.
