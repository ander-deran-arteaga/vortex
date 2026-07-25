# Vortex implementation status

## Current gate

Phases 0, 1, 2, and 5 have passed. Phase 3 has met its exit criteria pending a
re-run, Phase 4 is in review, and Phase 6 (Vortex Grow) is now open.

Verified green at `192d45d`: **416 tests** — contracts 82, shared 25, api 180
(plus 1 opt-in fork test), web 129. Both the commit-policy and architecture
guards pass; 80 commits policy-clean.

## Contracts
- Current task: Phase 6 — VortexCompounder, route validation, MockStalePool,
  MockExternalRouter; plus CREATE2 hook-address deployment wiring for PermAMM
- Last commit: PermAMM invariants recorded in the security ledger
- Tests: 82/82 forge green — Vortex Swap 33, Vortex PermAMM 21, Aqua baseline
  11, token math 7, plus supporting suites
- Blocker: none
- Interface changes: PermAMM fee authorization typehash pinned to the shared
  typed-data definition and asserted in a test

## Backend
- Current task: Phase 3 close-out — specific not-found codes, provenance
  re-run, and tests covering absent PermAMM addresses
- Last commit: unroutable venues rejected, internal error codes suppressed
- Tests: 180 green plus an opt-in Arbitrum fork integration test
- Blocker: none
- Interface changes: a Uniswap quote whose simulation reports failure is no
  longer treated as a viable venue

## Frontend
- Current task: Phase 4 — simulated-data badge on per-venue `source`
- Last commit: synthetic fixture identifiers
- Tests: 129 green, typecheck clean, production build serves all routes
- Blocker: waiting on backend's specific not-found codes
- Interface changes: none

## Integration
- Latest green commit: 192d45d
- Uniswap qualification evidence: an API-built swap executed against a pinned
  Arbitrum One fork (chainId 42161, block 487597751), calldata broadcast
  unmodified through Universal Router 2.0, with request IDs and transaction
  hash stored and labeled as fork-local
- Vortex PermAMM: a real Uniswap v4 pool against the genuine PoolManager, with
  signed per-swap dynamic fees, an immutable safety-fee floor the signer
  cannot reach, and real ERC-20 settlement
- Known failures: none
- Next gate: Phase 3 formal pass, Phase 4 pass, Phase 6 exit

## Architecture

Vortex Swap offers two venues — `AQUA_SWAPVM` (direct official Aqua + SwapVM
quote and settlement) and `UNISWAP_API` (external quote, API-built
transaction). Vortex PermAMM is a separate Uniswap v4 liquidity venue, used as
one leg of Vortex Grow and reserved for a future explicit venue comparison; it
is not part of the Aqua settlement path.

The invariant "Vortex Swap's Aqua execution must not depend on Vortex PermAMM
availability" (D-015) is enforced in CI by `scripts/check-architecture.sh`. It
still passes now that the full `permamm/` module exists, which is the case it
was written to catch.

## Data honesty

Every venue quote the UI renders carries its provenance. `source` is required
by the shared schema with no default, so a simulated quote cannot inherit a
"live" label, and the interface badges simulated data per venue rather than
per response.
