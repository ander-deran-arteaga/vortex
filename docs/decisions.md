# Vortex decision log

Decisions that affect more than one workstream. Newest last. Each decision is
applied consistently and not repeatedly revisited.

## D-001 — Trunk-based development on `main`

All workstreams share one working tree, so agent branches are impractical.
Everyone commits path-scoped slices to `main` (`git add <owned-paths>`, never
`git add -A`). History is never squashed. Only the integration owner pushes.

## D-002 — `@vortex/shared` ships TypeScript source

No build step: `exports` points at `./src/index.ts`. Next.js consumes it via
`transpilePackages`; the API runs through tsx; `build` is a typecheck
(`tsc --noEmit`). Zod v3 for runtime schemas; viem for address/hex types.

## D-003 — Persistence is an append-only JSON event store

`apps/api/data/` (gitignored). Zero native dependencies, deterministic in CI.
No SQLite, no external database.

## D-004 — API surface is versioned under `/api/v1`

Exact endpoint set: health, config, strategies/:strategyHash, executions,
quotes/exchange, transactions/aqua, transactions/uniswap, grow/scan,
grow/prepare, grow/execute, resolver/quote, resolver/build, demo/seed.
Path constants live in `@vortex/shared` (`API_ROUTES`); nothing hardcodes
paths.

## D-005 — EIP-712 domains

| Authorization | Domain name | Version | Verifying contract |
| --- | --- | --- | --- |
| VortexQuoteAuthorization (Swap rebate) | `Vortex Swap` | 1 | Aqua strategy verifier |
| VortexPermFeeAuthorization (per-swap fee) | `Vortex PermAMM` | 1 | VortexHook |
| VortexCompoundRoute (Grow route) | `Vortex Grow` | 1 | VortexCompounder |

Canonical struct definitions live in `packages/shared/src/typedData.ts`;
Solidity matches it field-for-field. The Swap rebate signer can only grant a
bounded commercial rebate — the safety fee floor is immutable onchain.

## D-006 — Target environment

Arbitrum One (42161), WBTC/USDC (8/6 decimals), internal price scale 1e18,
local Arbitrum fork as chain 31337 for development. At most one chain change,
recorded here if it ever happens.

## D-007 — Contract dependencies come through pnpm, pinned

aqua v1.0.0 (81c26e4), swap-vm v1.0.1 (b6e4f97), forge-std v1.11.0,
@openzeppelin/contracts 5.4.0, @1inch/solidity-utils 6.9.10,
@uniswap/v4-core 1.0.2, @uniswap/v4-periphery 1.0.3. No git submodules —
mirrors how the upstream 1inch repositories consume their own dependencies.
Details in `docs/dependencies.md`.

## D-008 — Official Aqua is deployed from source on the 42161 fork

No canonical Aqua deployment address for Arbitrum One ships in the pinned
1inch repositories, so the official bytecode is deployed on the local fork.
If a canonical address is later verified on an explorer, `deployments/42161.json`
switches to it.

## D-009 — Canonical event names

`VortexPermSwap` (hook afterSwap) and `VortexGrowExecuted` (compounder
settlement), with the field lists from the master plan. The indexer binds to
these exact names.
