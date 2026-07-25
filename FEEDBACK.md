# Uniswap Developer Platform Feedback

> Filled in continuously during integration; finalized at feature freeze
> (Phase 8) with concrete request IDs, transaction hashes, and code links.

## Project context

Vortex is a dual-intent Aqua and SwapVM liquidity system connected to the
Vortex PermAMM (a Uniswap v4 dynamic-fee pool) and the Uniswap Developer
Platform. The Trade API is
load-bearing for venue benchmarking, fallback transaction construction, and
(where feasible) the external leg of an atomic same-asset compound cycle.

## Vortex use cases

- Vortex Swap best-execution comparison — every Aqua quote is benchmarked
  against a Trade API quote; the better net execution wins.
- API-built fallback transaction — when Uniswap wins, the API builds the swap
  the user signs and broadcasts.
- JIT same-asset route — the external leg of Vortex Grow, requested with the
  VortexCompounder contract as swapper and recipient.

## API operations used

- _TBD (documented as integrated; see `docs/uniswap-api.md`)_

## What worked well

- _TBD_

## Integration friction

- _TBD_

## Approval and Permit2 observations

- _TBD_

## Contract-as-swapper observations

- _TBD (results of the mandatory spike land here)_

## v4 routing observations

- _TBD_

## Simulation behavior

- _TBD_

## Error handling

- _TBD_

## Missing capabilities

- _TBD_

## Feature requests

- _TBD_

## Reproduction steps

- _TBD_

## Request identifiers

| Flow | Request ID |
| --- | --- |
| _TBD_ | |

## Transaction hashes

| Flow | Chain | Tx hash |
| --- | --- | --- |
| _TBD_ | | |

## Relevant source files

- _TBD (direct links with line ranges at freeze)_
