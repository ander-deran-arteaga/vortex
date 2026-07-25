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

- `POST /check_approval` — approval and USDT-style reset detection.
- `POST /quote` — every Vortex Swap benchmark quote, `EXACT_INPUT` and
  `EXACT_OUTPUT` (the latter for the Grow bridge cap).
- `POST /swap` — transaction construction for the fallback path; calldata is
  broadcast byte-for-byte unmodified.
- `GET /swaps` — status polling.
- Full endpoint and field notes, each tagged with its verification source, are
  in [`docs/uniswap-api.md`](./docs/uniswap-api.md).

## What worked well

- The OpenAPI spec at `/v1/api.json` is complete enough to generate a typed
  client from, and `servers[0].url` matched the documented base URL exactly.
- The `routing` field on `/quote` is a clean dispatch key — one switch
  decides between `/swap`, `/order`, and `/plan` without guessing.
- Quotes are auto-simulated, and `txFailureReasons` surfaced problems before
  we ever broadcast. This caught integration mistakes early.
- `EXACT_OUTPUT` returning `input.maximumAmount` maps exactly onto the spend
  cap our compounder needs to sign over. No extra math, no slippage guesswork.
- A **contract address is accepted as `swapper`** on `/quote` (HTTP 200,
  `CLASSIC` routing, no failure reasons), which is what makes a contract-run
  external leg plausible at all.

## Integration friction

Two findings we would want fixed, both verified against the live API:

1. **The 429 error code does not match the documentation.** The rate-limit
   response carries `errorCode: "TooManyRequests"`, while the documented
   value is `Ratelimited`. Any integrator who follows the docs and matches on
   the documented string silently fails to detect *every* rate-limit error —
   it degrades into a generic failure with no backoff. There is also no
   `Retry-After` header, so backoff timing has to be guessed. We reached the
   limit with 12 concurrent `/quote` calls (5 returned 429).
2. **The `x-permit2-disabled` flow returns a deprecated contract address.**
   With that header set, both the `/swap` `to` target and the
   `/check_approval` spender come back as `0x02E5be68…` — the same proxy the
   documentation elsewhere tells integrators to migrate away from. For a
   contract-as-swapper integration this is the critical path, and being
   pointed at a deprecated address is alarming when you are about to
   allowlist it in a settlement contract.

Smaller notes: the error envelope is `{errorCode, detail}` (the spec shape
wins over the prose docs); `/swap` returns undocumented `signature` and
`publicKeyId` fields; `/quote` returns an undocumented `gasEstimates`.

## Approval and Permit2 observations

- The `approval: null` / `cancel: null` convention on `/check_approval` is
  unambiguous and easy to branch on.
- `x-permit2-disabled: true` is the right escape hatch for a contract that
  cannot produce an EIP-712 Permit2 signature — but see friction item 2 about
  the address it hands back.

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

| Flow | Endpoint | Request ID |
| --- | --- | --- |
| Best-execution fallback (WBTC → USDC) | `POST /quote` | `4e9ab8fad895f5faf57aa797b9a0ec77` |
| Best-execution fallback (WBTC → USDC) | `POST /swap` | `dfcf85a848a118e5d8f7e9ad8473b741` |

## Transaction hashes

| Flow | Chain | Tx hash |
| --- | --- | --- |
| API-built swap, calldata broadcast unmodified | Arbitrum One **fork** (chainId 42161, block 487597751) | `0xaae23e0178e7918d8c68bbc2392058bfa53adb68dbe0e3c7ed67958a31437622` |

The transaction above executed against a pinned Arbitrum One mainnet fork, not
public Arbitrum, so the hash does not resolve on a block explorer. It went
through the real Universal Router 2.0 (`0xA51afAFe…`) using calldata returned
by `POST /swap`, broadcast byte-for-byte unmodified: 0.01 WBTC in, 640.148194
USDC out against a quoted 640.148193 and a 636.947452 minimum.

## Relevant source files

- _TBD (direct links with line ranges at freeze)_
