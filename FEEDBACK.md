# Uniswap Trade API — Integration Feedback

> Skeleton — filled in during Phase 8 (polish and freeze) with concrete
> evidence gathered while integrating.

## What we built with the API

- Benchmarked Aqua best execution against `/quote` (classic routing, V2/V3/V4).
- Executed fallback swaps through `/check_approval` → `/quote` → `/swap`.
- Built the external leg of an atomic JIT compound cycle from `/swap`
  calldata with `x-permit2-disabled: true` and `V4_NO_HOOKS`.
- Surfaced request IDs and resulting transaction hashes in the UI.

## What worked well

- _TBD_

## Friction points

- _TBD_

## Requests

- _TBD_

## Evidence

| Flow | Request ID | Tx hash |
| --- | --- | --- |
| _TBD_ | | |
