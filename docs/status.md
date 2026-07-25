# Vortex implementation status

## Current gate

Phase 0 (repository and qualification skeleton) and Phase 1 (official Aqua
token transfer) have both passed review. Phase 2 (SwapVM best execution) is
open for contracts; Phase 3 (Uniswap comparison router) is open for backend;
Phase 4 groundwork is open for frontend against fixtures.

Verified at this gate: `pnpm build` green across all four workspaces,
`pnpm test` green (contracts 20, shared 24, web 54, api 17 — 115 total),
`forge test` 20/20, commit policy 29/29 clean, naming sweep clean, no secrets
or coordination files tracked.

## Contracts
- Current task: Phase 2 — VortexAquaPricing through Extruction, order builder,
  inventory-aware fees, MockReferenceOracle, lens, Vortex Swap risk tests
- Last commit: d9e0785 (transitive v4 remappings, documented version skew)
- Tests: 20/20 forge green (AquaBaseline 11, VortexTokenMath 7 incl. fuzz,
  Phase0Deps 2)
- Blocker: none
- Interface changes: SwapVM v1.0.1 emits `Swapped` and uses the 5-argument
  `quote`/`swap` form with explicit tokens; PoolManager is pragma 0.8.26 exact,
  so Phase 5 obtains it from a fork rather than importing source

## Backend
- Current task: Phase 3 — authenticated Uniswap Trade API client, quote
  sessions, venue comparator, transaction construction
- Last commit: 5ee3242 (env isolation, error logging, test rigor)
- Tests: 17/17 vitest green, including a polluted-shell run; typecheck clean
- Blocker: none; venue comparison uses a fixture Aqua quote source until
  Phase 2 lands the real one
- Interface changes: `expiresAt` is epoch milliseconds (D-010); quote sessions
  are 45 s single-use with a 30 s refresh threshold (D-011)

## Frontend
- Current task: Phase 4 groundwork — best-execution and Grow interfaces built
  against shared schemas with fixture data, wired live when Phase 3 exits
- Last commit: cfc6ee7 (web shell and route pages)
- Tests: 54/54 vitest green, typecheck clean, `next build` green with all
  routes prerendered
- Blocker: none
- Interface changes: none; consumes `@vortex/shared` read-only

## Integration
- Latest green commit: d9e0785
- Latest deployment: local Aqua, AquaSwapVMRouter, and mocks recorded in
  deployments/31337.json; ephemeral fork runs write an ignored .fork.json
- Known failures: none
- Next gate: Phase 2 exit (SwapVM best execution), then Phase 3 exit (an
  API-built Uniswap transaction executed onchain with evidence stored)
