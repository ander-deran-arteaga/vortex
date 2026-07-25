# Vortex implementation status

## Current gate

Phases 0, 1, and 2 have passed. Phase 3 (Uniswap comparison router) has met
its exit criteria pending one re-run; Phase 4 (best-execution frontend) is in
review; Phase 5 (Vortex PermAMM) is now open.

Verified green at `80f2873`: **388 tests** — contracts 61, shared 25, api 173
(plus 1 opt-in fork test), web 129. Commit policy clean across 68 commits.

## Contracts
- Current task: Phase 5 — Vortex PermAMM hook, liquidity manager, router,
  quoter, signed fee authorization
- Last commit: Phase 2 complete; ABIs exported under `deployments/abis/`
- Tests: 61/61 forge green, including a 33-test Vortex Swap suite that maps
  one-to-one onto the §18.1 risk list
- Blocker: none
- Interface changes: maker ship flow documented for the frontend — approvals
  go to Aqua rather than the router, and strategies are immutable, so an edit
  is dock-then-ship with a bumped salt

## Backend
- Current task: Phase 3 close-out — repopulate quote provenance end to end and
  introduce specific not-found codes
- Last commit: exchange quote and Uniswap build routes live
- Tests: 173 green plus an opt-in Arbitrum fork integration test
- Blocker: none
- Interface changes: every venue comparison now declares `source`
  (`live` or `fixture`); quote sessions are single-use with a 45 s TTL

## Frontend
- Current task: Phase 4 — wire the simulated-data badge to the new per-venue
  `source` field, then re-verify
- Last commit: synthetic fixture identifiers
- Tests: 129 green, typecheck clean, production build serves all 7 routes
- Blocker: needs backend's specific not-found codes so a genuinely missing
  resource is never mistaken for an unimplemented route
- Interface changes: none

## Integration
- Latest green commit: 80f2873
- Uniswap qualification evidence: an API-built swap executed against a pinned
  Arbitrum One fork (chainId 42161, block 487597751), calldata broadcast
  unmodified through Universal Router 2.0, with quote and swap request IDs and
  the transaction hash stored and surfaced. Labeled as a fork everywhere; it
  does not resolve on a public explorer.
- Known failures: none
- Next gate: Phase 3 formal pass, Phase 4 pass, then Phase 5 exit

## Architecture

Vortex Swap offers two venues — `AQUA_SWAPVM` (direct official Aqua + SwapVM
quote and settlement) and `UNISWAP_API` (external quote, API-built
transaction). Vortex PermAMM is a separate Uniswap v4 liquidity venue, used as
one leg of Vortex Grow and reserved for a future explicit venue comparison; it
is not part of the Aqua settlement path.

The invariant "Vortex Swap's Aqua execution must not depend on Vortex PermAMM
availability" (D-015) is enforced in CI by `scripts/check-architecture.sh`,
which fails the build if the Aqua module or the backend's Vortex Swap path
references the PermAMM module. Verified empirically: the 33-test Vortex Swap
suite passes with no `permamm/` module compiled and no PermAMM address in any
deployment file.

## Data honesty

Every venue quote the UI renders carries its provenance. `source` is required
by the shared schema with no default, so a simulated quote cannot inherit a
"live" label, and the interface badges simulated data per venue rather than
per response.
