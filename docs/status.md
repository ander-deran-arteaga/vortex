# Vortex implementation status

## Current gate

Phases 0 through 6 have passed. Vortex Swap now executes end to end through
official Aqua and SwapVM: a quote from the live pricing contracts, a built
transaction, and a settled swap moving real WBTC and USDC on the local fork.
Phase 7 remains deferred behind demo completeness.

Verified green at `4ddefd8`: **555 tests** — contracts 150, shared 25, api 229
(plus 5 skipped), web 151. Both the commit-policy and architecture guards pass;
117 commits policy-clean.

Remaining to a complete submission: browser-side execution wiring, the three
Vortex Grow endpoints that the demo's compounding scene depends on, and the
Phase 8 evidence work. Seven of the fourteen declared API routes are
registered; the resolver endpoints are deliberately last and may be cut.

## Contracts
- Current task: Phase 6 close-out — a reentrancy test against a malicious
  external target; the rest of the Grow suite is complete
- Last commit: Grow suite run in both token orientations
- Tests: 142/142 forge green — Vortex Grow 18 across both directions and both
  token orderings, Vortex PermAMM 21 across both orderings, Vortex Swap 33,
  Aqua baseline 11, token math 7, plus supporting suites
- Blocker: none
- Interface changes: PermAMM fee authorization typehash pinned to the shared
  typed-data definition and asserted in a test

## Backend
- Current task: Phase 3 passed; supporting Phase 4 and preparing the Grow
  scanner
- Last commit: fixture strategy health scoped to the demo strategy
- Tests: 188 green plus an opt-in Arbitrum fork integration test
- Blocker: none
- Interface changes: a Uniswap quote whose simulation reports failure is no
  longer treated as a viable venue

## Frontend
- Current task: Phase 4 passed; Grow and demo surfaces next
- Last commit: quote provenance badged per venue rather than per response
- Tests: 132 green, typecheck clean, production build serves all routes
- Blocker: none
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
