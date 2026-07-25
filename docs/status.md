# Vortex implementation status

## Current gate

Phases 0 and 1 have passed. Phase 2 (SwapVM best execution), Phase 3 (Uniswap
comparison router), and Phase 4 (best-execution frontend, fixture-backed) are
all open and progressing in parallel.

Verified at committed HEAD, in an isolated worktree: `forge build` clean,
38 forge tests passing, shared 24, plus green web and api suites.

**Open compliance issue:** three commits (`dd3b841`, `87d7b9f`, `d06ac17`)
use `docs:`/`test:` prefixes, which the commit policy does not allow. The
integration CI job fails until they are reworded. A `commit-msg` hook now
blocks any further violations; install it in a fresh clone with
`bash scripts/install-hooks.sh`.

## Contracts
- Current task: Phase 2 — Vortex Swap pricing, order builder, and strategy
  lens are committed; inventory-aware fees and rebates landed
- Last commit: work in flight on VortexAquaPricing and VortexAquaOrderBuilder
- Tests: 38/38 forge green at committed HEAD (Vortex Swap suite 17,
  AquaBaseline 11, VortexTokenMath 7, Phase0Deps 2, lens 1)
- Blocker: none; a via_ir stack-too-deep exists in the uncommitted edit only
- Interface changes: SwapVM v1.0.1 pinned 5-argument `quote`/`swap` with
  explicit tokens; PoolManager pragma 0.8.26 forces a fork-sourced instance
  in Phase 5

## Backend
- Current task: Phase 3 — Uniswap client with rate limiting, live and fixture
  Aqua quote sources, quote-session and evidence stores, route wiring
- Last commit: d06ac17 (API-built swap executed on an Arbitrum One fork)
- Tests: api suite green; the fork integration test is opt-in via
  `VORTEX_INTEGRATION=1` and never runs in normal CI
- Blocker: none; needs a seeded fork strategy hash from contracts for the
  Aqua-wins demo path
- Interface changes: venues ranked on net output; `expiresAt` epoch ms

## Frontend
- Current task: Phase 4 — maker, swap, and Grow interfaces against shared
  schemas with clearly labeled fixture data
- Last commit: 20ac56b (maker strategy and dashboard interfaces)
- Tests: web suite green, typecheck clean, `next build` green across 7 pages
- Blocker: none; flips to the live API when Phase 3 exits
- Interface changes: none; consumes `@vortex/shared` read-only

## Integration
- Latest green commit: 261ab9d
- Uniswap qualification evidence: API-built swap executed on an Arbitrum One
  fork (chainId 42161, block 487597751) with request IDs and transaction hash
  captured. The hash is fork-local and is labeled as such everywhere it
  appears; it does not resolve on a public explorer.
- Known failures: commit policy (three commits, above)
- Next gate: Phase 2 exit, then Phase 3 exit with deterministic Aqua-wins and
  Uniswap-wins cases
