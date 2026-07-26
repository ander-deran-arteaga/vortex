# Uniswap Developer Platform Feedback

Feedback from building **Vortex**, a dual-intent Aqua and SwapVM liquidity
system, during the hackathon. Everything below was captured against the
production Trade API and re-verified on 2026-07-26.

## Project context

Vortex is a dual-intent Aqua and SwapVM liquidity system connected to the
Vortex PermAMM (a Uniswap v4 dynamic-fee pool) and the Uniswap Developer
Platform. The Trade API is load-bearing for venue benchmarking, fallback
transaction construction, and the external leg of an atomic same-asset
compound cycle.

## Vortex use cases

- Vortex Swap best-execution comparison — every Aqua quote is benchmarked
  against a Trade API quote; the better net execution wins.
- API-built fallback transaction — when Uniswap wins, the API builds the swap
  the user signs and broadcasts.
- JIT same-asset route — the external leg of Vortex Grow, requested with the
  VortexCompounder contract as swapper and recipient.

## API operations used

`POST /check_approval`, `POST /quote` (both `EXACT_INPUT` and `EXACT_OUTPUT`),
`POST /swap`, `GET /swaps`. Full field-level notes, each tagged with its
verification source, are in [`docs/uniswap-api.md`](./docs/uniswap-api.md).

## What worked well

- **The OpenAPI spec at `/v1/api.json` is complete enough to generate a typed
  client from**, and `servers[0].url` matched the documented base URL exactly.
- **`routing` on `/quote` is a clean dispatch key** — one switch decides
  between `/swap`, `/order`, and `/plan` with no guessing.
- **Quotes are auto-simulated**, and `txFailureReasons` surfaced problems
  before we ever broadcast. This caught integration mistakes early and is the
  single feature that saved us the most time.
- **`gasFeeQuote` is excellent and underused.** Gas denominated in the *output
  token* let us rank venues on net output with **no ETH price feed on the hot
  path**: `gasFeeQuote / gasUseEstimate` gives a per-gas-unit rate in
  output-token units, which we then charge the competing venue's gas estimate
  at. We would highlight this far more prominently in the docs.
- **`EXACT_OUTPUT` returning `input.maximumAmount`** maps exactly onto the
  spend cap our compounder must sign over. No extra math, no slippage guessing.
- **`protocols: ["V2","V3","V4"]` reliably forces `routing: "CLASSIC"`** in
  every probe we ran, including `EXACT_OUTPUT` and contract swappers, so the
  `/swap` vs `/order` dispatch can be made unconditional.
- **A contract address is accepted as `swapper`** (200, CLASSIC, empty
  `txFailureReasons`) — which is what makes a contract-run external leg
  possible at all.

## Integration friction

### 1. The 429 error code does not match the documentation

**Severity: high for integrators.**

Documented (Trading → Swapping API → Common errors): 429 carries
`errorCode: "Ratelimited"`. Actual, captured 2026-07-26:

```json
{"errorCode":"TooManyRequests","detail":"Rate limit exceeded",
 "requestId":"aee736db9d967cce809cf7a989f6d58f"}
```

Any client matching the documented string silently fails to recognise its own
rate limiting and will retry *into* the limit rather than backing off.

**Secondary finding: there is no `Retry-After` header on 429.** We checked
every 429 across two runs; always absent. Combined with the documented advice
to "pause all requests from your API key", integrators have no server signal
to pace against and must guess. We use exponential backoff with jitter for
exactly this reason.

**Reproduction** (~15s): fire 14 concurrent `POST /quote` calls on chain 42161.
We saw 7×429 today and 5×429 on an earlier run. Full script in
`docs/uniswap-api.md`.

**Ask:** correct the docs to `TooManyRequests`, or emit `Ratelimited` as
documented — and please consider sending `Retry-After`.

### 2. `x-permit2-disabled` returns the deprecated proxy

**Severity: medium-high.**

The no-Permit2 concept page names `0x0000000085E102724e78eCd2F45DC9cA239Affad`
as the proxy and explicitly tells integrators to migrate **off**
`0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9`. With `x-permit2-disabled: true`,
the API returns the address we are told to migrate away from:

```
/swap            swap.to         = 0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9  (legacy)
/check_approval  approve spender = 0x02e5be68d46dac0b524905bff209cf47ee6db2a9  (legacy)
docs say proxy is                  0x0000000085E102724e78eCd2F45DC9cA239Affad
```

Request IDs: quote `742cb734294872850770c57b63b292f3`, swap
`2a40832bb9fd57800b83a1fa45a8735c`, approval
`509c0a88dc04882e426048c93374fbbd`.

**This matters specifically for contract integrations.** Vortex Grow's
compounder must allowlist the external target it calls. We allowlist what the
API returns, which pins our contract to an address the documentation calls
deprecated.

**Ask:** confirm which proxy is authoritative. If the legacy one is still
correct, the docs should stop calling it deprecated; if the new one is
correct, the API should return it.

### 3. Smaller inconsistencies

- **The error envelope differs between docs.** Responses use
  `{errorCode, detail}` (the OpenAPI shape). The integration guide's
  `{error, message, details}` never appeared in any response we received.
- **Undocumented response fields:** `signature` and `publicKeyId` on `/swap`,
  `gasEstimates` on `/quote`. None appear in `CreateSwapResponse` or
  `ClassicQuote`. We pass unknown fields through deliberately so an addition
  cannot break us, but a stricter integrator would break.
- **`permitData` without `signature` is a 400** (`"value" contains [permitData]
  without its required peers [signature]`). Correct behaviour, but only
  discoverable by hitting it. Omitting *both* works and returns a broadcastable
  transaction — that is what our fallback path does, and it is not obvious
  from the docs.

## Approval and Permit2 observations

The `approval: null` / `cancel: null` convention on `/check_approval` is
unambiguous and easy to branch on. `x-permit2-disabled: true` is the right
escape hatch for a contract that cannot produce an EIP-712 Permit2 signature —
subject to the proxy-address issue above.

## Contract-as-swapper observations

We ran a dedicated spike because our compounder needs a contract to approve and
swap atomically. Results, all on an Arbitrum One fork:

- **A contract can `approve` the proxy and execute API-built calldata in the
  same transaction.** The allowance granted earlier in the same transaction is
  visible when the proxy pulls. No prior approval transaction and no infinite
  pre-approval is needed. Transaction
  `0xe41adb01d06c9240b99a8cd88a258e957dc372ed2f1f5e5e9ac0eda2d6e4e3b1`.
- **`recipient` is honoured for a contract swapper** — output landed at a third
  address directly from the router, removing a transfer leg.
- **A different EOA may relay a transaction built for a contract `swapper`.**
  `/swap` returns `from = <contract>`, but `from` is advisory; the executing
  sender is what the proxy authorises against.
- EIP-1271 never came into play: `x-permit2-disabled` returns
  `permitData: null`, so no signature is produced.

None of this is documented either way. It would be valuable to state it
explicitly, because it is the difference between a contract integration being
possible and not.

## v4 routing observations

We forced `protocols: ["V2","V3","V4"]` throughout and always received
`CLASSIC` routing, so v4 pools were quoted alongside v2/v3 without special
handling. We did not exercise hook-bearing pools through the API — our own v4
pool with a dynamic-fee hook is driven directly rather than via the Trade API.

## Simulation behavior

Auto-simulation on `/quote` is the standout feature. `txFailureReasons`
surfaced real problems pre-broadcast. One caveat worth documenting: a quote
that simulates cleanly can still revert when mined if the underlying state is
time-sensitive, since simulation runs against the latest block's timestamp
while the mined transaction gets a fresh one. That is inherent rather than an
API defect, but a note would help integrators reason about quote lifetime.

## Error handling

Errors are consistently shaped and the codes are actionable — except for the
429 mismatch above, which is the one case where following the documentation
produces a broken client.

## Missing capabilities

- No `Retry-After` on 429, so backoff is guesswork.
- No documented statement about contract swappers, despite it working.
- No sandbox; we tested against production and had to rate-limit ourselves
  carefully to avoid disrupting our own demo.

## Feature requests

1. Send `Retry-After` on 429.
2. Document contract-as-swapper support explicitly, including that `from` is
   advisory and `recipient` is honoured.
3. Publish the OpenAPI spec URL prominently — it is the best artefact you have
   and we found it late.
4. Document `gasFeeQuote` as the recommended way to compare venues without a
   price feed.
5. Reconcile the two error-envelope shapes across the docs.

## Reproduction steps

Each discrepancy above carries its own reproduction. The full annotated API
reference, including a "Live verification" section with every claim tagged
`[VERIFIED <url>]` or `[UNVERIFIED]`, is in
[`docs/uniswap-api.md`](./docs/uniswap-api.md).

## Request identifiers

| Flow | Chain | Request ID |
| --- | --- | --- |
| `/quote` — Aqua wins the comparison | 42161 | `1ccfe698432715a192bd871c0895f57d` |
| `/quote` — Uniswap wins the comparison | 42161 | `e138fcf2e652b16d98041a83cd643441` |
| `/swap` — fallback transaction built | 42161 | `74573f77e2d8ee6ffcc189711005ff7c` |
| `/quote` — provenance re-run, Aqua wins | 42161 | `975a8dd1e6a417a128072afaa918df8e` |
| `/quote` — provenance re-run, Uniswap wins | 42161 | `91e279bc216bcd1897928c51a2c79bb8` |
| `/quote` — Uniswap-wins demo case | 42161 | `54b70d748670f06ab5d3cc26bf02cac5` |
| `/quote` — used by the executed fork transaction | 42161 fork | `4e9ab8fad895f5faf57aa797b9a0ec77` |
| `/swap` — calldata that was broadcast | 42161 fork | `dfcf85a848a118e5d8f7e9ad8473b741` |
| `/quote` — 429 sample (discrepancy 1) | 42161 | `aee736db9d967cce809cf7a989f6d58f` |
| `/quote` — proxy flow (discrepancy 2) | 42161 | `742cb734294872850770c57b63b292f3` |
| `/swap` — proxy flow (discrepancy 2) | 42161 | `2a40832bb9fd57800b83a1fa45a8735c` |
| `/check_approval` — proxy flow (discrepancy 2) | 42161 | `509c0a88dc04882e426048c93374fbbd` |

## Transaction hashes

These executed against an Arbitrum One **fork** at a pinned block, not public
Arbitrum, so they do not resolve on a block explorer. They are real EVM
execution against real Arbitrum state.

| Flow | Chain | Hash |
| --- | --- | --- |
| API-built swap, calldata broadcast unmodified | Arbitrum One fork, block 487597751 | `0xaae23e0178e7918d8c68bbc2392058bfa53adb68dbe0e3c7ed67958a31437622` |
| Contract-as-swapper spike | Arbitrum One fork | `0xe41adb01d06c9240b99a8cd88a258e957dc372ed2f1f5e5e9ac0eda2d6e4e3b1` |

The first spent 0.01 WBTC for 640.148194 USDC through Universal Router 2.0
(`0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3`) against a quoted minimum of
636.947452, using calldata returned by `POST /swap` byte-for-byte unmodified.

## Relevant source files

- [`apps/api/src/clients/uniswapApiClient.ts`](./apps/api/src/clients/uniswapApiClient.ts)
  — authenticated client with pacing and backoff. Both discrepancies are
  encoded as behaviour, not just prose: we match `TooManyRequests`, and we
  never hardcode a proxy address.
- [`apps/api/src/services/venueComparator.ts`](./apps/api/src/services/venueComparator.ts)
  — net-output comparison using `gasFeeQuote`.
- [`apps/api/tests/integration/uniswapFork.integration.test.ts`](./apps/api/tests/integration/uniswapFork.integration.test.ts)
  — the API-built transaction executed onchain.
- [`apps/api/tests/uniswapApiClient.test.ts`](./apps/api/tests/uniswapApiClient.test.ts)
  — 43 tests against payloads captured from the live API.
- [`docs/uniswap-api.md`](./docs/uniswap-api.md) — full annotated reference.
