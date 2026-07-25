# Uniswap Trade API — Research Notes (Phase 1 spike)

> Draft for `docs/uniswap-api.md`. Compiled 2026-07-25 from three research passes over the official OpenAPI spec (`https://trade-api.gateway.uniswap.org/v1/api.json`), developers.uniswap.org docs, and Uniswap's official `uniswap-ai` repo. No authenticated trading endpoints were called. Every fact carries a `[VERIFIED <url>]` or `[UNVERIFIED]` tag — treat `[UNVERIFIED]` as prior knowledge/inference to confirm before building on it. Contradictions between passes are kept and tagged `[CONFLICT]`.

## Base + auth

- Base URL: `https://trade-api.gateway.uniswap.org/v1` (spec `servers[0].url` matches exactly). [VERIFIED https://trade-api.gateway.uniswap.org/v1/api.json]
- Auth: single security scheme `apiKey`, `in: header`, `name: x-api-key` — applied to every endpoint. [VERIFIED https://trade-api.gateway.uniswap.org/v1/api.json]
- Headers must be **exactly** `Content-Type: application/json` and `Accept: application/json`; malformed headers return **401 (not 400)** due to strict header validation. [VERIFIED https://developers.uniswap.org/docs/trading/swapping-api/integration-guide + https://developers.uniswap.org/docs/trading/swapping-api/common-errors]
- API keys are self-serve and free via the Uniswap Developer Platform dashboard (`https://developers.uniswap.org/dashboard`). API usage is free; no sandbox, but production endpoints serve testnets (Sepolia 11155111, Base Sepolia 84532, Unichain Sepolia 1301). [VERIFIED https://developers.uniswap.org/docs/trading/swapping-api/faqs + common-errors]
- The API rejects direct browser requests (CORS) — a server-side proxy is required. Fits Vortex's backend-integration plan. [VERIFIED https://raw.githubusercontent.com/Uniswap/uniswap-ai/main/packages/plugins/uniswap-trading/skills/swap-integration/SKILL.md]
- Optional headers:
  - `x-universal-router-version`: enum `"2.0" | "2.1.1" | "2.2.0"`, default `"2.0"`; accepted on `/quote`, `/swap`, `/swap_5792`, `/swap_7702`. Spec: "MUST be consistent throughout the API calls." Selects which Universal Router deployment `/swap`'s `to` targets and the command encoding in `data`. [VERIFIED https://trade-api.gateway.uniswap.org/v1/api.json + https://developers.uniswap.org/docs/api-reference/aggregator_quote]
    - Per-chain defaults: `2.0` on most chains; some chains (Robinhood Chain, Ink) default to `2.1.1`; requesting an unsupported version on a chain errors; zkSync supports `2.0` only; "the default can change over time, so set the header explicitly when you need a stable target." [VERIFIED https://developers.uniswap.org/docs/trading/swapping-api/supported-chains — one pass flagged its paraphrase of this page's exact wording as UNVERIFIED]
    - UR version `1.2` no longer appears in current docs. [VERIFIED absence] [UNVERIFIED prior knowledge: older API iterations accepted `1.2` (pre-v4); do not build against it]
    - SDK decode compat (only if we decode calldata): UR 2.0 → `@uniswap/universal-router-sdk` >= 3.1.0; UR 2.1.1/2.2.0 → >= 5.9.0. [VERIFIED https://developers.uniswap.org/docs/trading/swapping-api/supported-chains]
  - `x-permit2-disabled: true`: skips Permit2 (see Contract-as-swapper section). Accepted on `/check_approval`, `/quote`, `/swap`. [VERIFIED https://trade-api.gateway.uniswap.org/v1/api.json]
  - `x-erc20eth-enabled: true`: native-ETH input for UniswapX, on `/quote` and `/order`. [VERIFIED https://trade-api.gateway.uniswap.org/v1/api.json]
- Chains: `ChainId` enum includes **Arbitrum One 42161** (plus 1, 10, 56, 130, 137, 8453, and others, + testnets). Arbitrum has UR 2.0 `0xa51afafe0263b40edaef0df8781ea9aa03e381a3`, UR 2.1.1 `0x8b844f885672f333bc0042cb669255f93a4c1e6b`, and UniswapX support (UNISWAPX_V2 limited to Mainnet/Arbitrum/Base; UNISWAPX_V3 includes Arbitrum). [VERIFIED https://trade-api.gateway.uniswap.org/v1/api.json + https://developers.uniswap.org/docs/trading/swapping-api/supported-chains]
- Machine-readable OpenAPI 3.0.0 spec published at `https://trade-api.gateway.uniswap.org/v1/api.json` (title "Token Trading", 26 paths). [VERIFIED — downloaded by two passes] [CONFLICT note: the third pass could not locate a published spec URL and flagged its existence UNVERIFIED; the URL above was fetched successfully by the other two passes, so treat as resolved but re-confirm the URL is stable.]

## Core flow (check_approval → quote → swap → status)

Canonical 3-step flow for classic swaps [VERIFIED https://developers.uniswap.org/docs/trading/swapping-api/integration-guide]:

1. `POST /check_approval` — is Permit2 (or, with `x-permit2-disabled`, the proxy) approved to spend the input token? If not, sign & broadcast the returned approval tx (and, for USDT-style tokens, the `cancel` reset tx first).
2. `POST /quote` — get a quote; response `routing` field decides the next endpoint. If `permitData` is non-null, sign it (EIP-712 typed data, `signer._signTypedData(...)`).
3. `POST /swap` — exchange the quote (+ permit signature) for a ready-to-broadcast `TransactionRequest`; the client signs and broadcasts via its own RPC.
4. `GET /swaps?txHashes=...` — poll status until terminal.

Dispatch rule on `/quote`'s `routing` [VERIFIED integration-guide + faqs + swap-routing page]:

| `routing` value | Next endpoint |
|---|---|
| `CLASSIC`, `WRAP`, `UNWRAP`, `BRIDGE` | `POST /swap` → poll `GET /swaps` |
| `DUTCH_V2`, `DUTCH_V3`, `PRIORITY` (gasless UniswapX) | `POST /order` → poll `GET /orders` |
| `CHAINED` | `/plan` endpoints |

- Quotes are auto-simulated; failures surface via `txFailureReasons` / an error message. [VERIFIED https://developers.uniswap.org/docs/api-reference/aggregator_quote]
- Refresh quotes older than ~30 s before broadcasting. [VERIFIED integration-guide + faqs]
- Other endpoints in the spec (later phases): `/order`, `/orders`, `/swappable_tokens`, `/supported_chains`, `/limit_order_quote`, `/permissions`, `/lp/*`, `/swap_5792`, `/swap_7702`, `/swap_4337`, `/check_approval_4337`, `/plan`, `/plan/{planId}`, `/wallet/encode_7702`, `/wallet/check_delegation`, `/wallet/encode_4337`. [VERIFIED https://trade-api.gateway.uniswap.org/v1/api.json]

## Request/response field reference

### POST /check_approval

- Purpose: checks whether `walletAddress` has approved **Permit2** to spend `token` up to `amount`. [VERIFIED api.json]
- Request (`ApprovalRequest`): required `walletAddress`, `token` (address, `^(0x)?[0-9a-fA-F]{40}$`), `amount` (base-units decimal string, `^[0-9]+$`), `chainId`; optional `urgency` (`normal|fast|urgent`, or `{level, overrides}` with maxFeePerGas/maxPriorityFeePerGas/gasLimit caps), `includeGasInfo` (default false), `tokenOut`, `tokenOutChainId`. [VERIFIED api.json]
- Response (`ApprovalResponse`): `requestId`, `approval` (TransactionRequest), `cancel` (TransactionRequest), `gasFee`, `cancelGasFee`.
  - `"approval": null` ⇒ approval already sufficient, nothing to do. [VERIFIED api.json]
  - `cancel` non-null ⇒ token requires allowance reset to 0 first (USDT-style); send `cancel` before `approval`. Otherwise `cancel: null`. [VERIFIED api.json + https://developers.uniswap.org/docs/api-reference/check_approval]
  - `approval` example shape: `{to: <token>, from, value: "0x00", data: "0x095ea7b3...", maxFeePerGas, maxPriorityFeePerGas, gasLimit, chainId}` — an ERC-20 `approve` of Permit2. `gasFee` only with `includeGasInfo: true`. [VERIFIED api.json]

### POST /quote (`aggregator_quote`)

Request (`QuoteRequest`) — required: `type`, `amount`, `tokenInChainId`, `tokenOutChainId`, `tokenIn`, `tokenOut`, `swapper`. [VERIFIED api.json]

- `type` (`TradeType`): `EXACT_INPUT` | `EXACT_OUTPUT`, default `EXACT_INPUT`; `amount` is in token base units, interpreted per this field. [VERIFIED api.json]
- `swapper` (required): "The wallet address which will be used to send the token." [VERIFIED api.json]
- Slippage: `slippageTolerance` (percentage number, max 2 decimals; applies to output token for EXACT_INPUT, input token for EXACT_OUTPUT) XOR `autoSlippage: "DEFAULT"` (v2/v3/v4 only, not UniswapX). Exactly one must be set. [VERIFIED api.json]
- `routingPreference`: `BEST_PRICE` (default) | `FASTEST` only. [VERIFIED api.json]
- `protocols`: array of `V2 | V3 | V4 | UNISWAPX (deprecated) | UNISWAPX_V2 | UNISWAPX_V3 | UNISWAPX_LATEST`. If set, `routingPreference` may only be `BEST_PRICE`. [VERIFIED api.json]
- Other optionals: `permitAmount` (`FULL` default | `EXACT`), `generatePermitAsTransaction` (default false; true returns Permit2 as an on-chain tx — needed for 7702 wallets), `spreadOptimization` (`EXECUTION` default | `PRICE`, UniswapX only), `urgency`, `recipient` ("the wallet address which will receive the output of the swap. If not provided, the output is returned to the `swapper`"), `integratorFees` (max 1 entry), `hooksOptions`, `includeRouteCandidates`. [VERIFIED api.json + https://developers.uniswap.org/docs/api-reference/aggregator_quote]

Response (`QuoteResponse`) — required: `requestId`, `routing`, `quote`, `permitData`. Optional: `isTokenApprovalApplicable`, `permitTransaction`, `permitGasFee`. [VERIFIED api.json]

- `quote` is a `oneOf` discriminated by `routing`: `ClassicQuote | DutchQuote | DutchQuoteV2 | DutchQuoteV3 | PriorityQuote | WrapUnwrapQuote | BridgeQuote | ChainedQuote`. [VERIFIED api.json]
- `ClassicQuote` fields: `input {amount, token, maximumAmount}`, `output {amount, token, recipient, minimumAmount}`, `swapper`, `chainId`, `slippage`, `tradeType`, `gasFee`, `gasFeeUSD`, `gasFeeQuote`, `route` (array-of-arrays of `V2PoolInRoute|V3PoolInRoute|V4PoolInRoute`), `routeString`, `quoteId`, `gasUseEstimate`, `blockNumber`, `gasPrice`, `maxFeePerGas`, `maxPriorityFeePerGas`, `txFailureReasons`, `priceImpact` (0–100), `aggregatedOutputs` (where integrator/portion fees appear). [VERIFIED api.json]
- Gas field units (all strings) [VERIFIED api.json]:
  - `gasFee` — total estimated cost (`gasLimit × maxFeePerGas`) in the chain's base unit (wei).
  - `gasFeeUSD` — same, denominated in USDC (e.g. `"0.002335228716641861"`).
  - `gasFeeQuote` — same, in base units of the quoted currency.
  - `gasUseEstimate` — gas units; **excludes approval gas**.
  - `gasPrice` (legacy per-gas cost), `maxFeePerGas` (wei/gas), `maxPriorityFeePerGas` (wei/gas, scaled by request `urgency`).
  - UniswapX quotes instead carry `classicGasUseEstimateUSD` (the gas you would have paid on a CLASSIC swap; orders are gasless for the swapper).
- `permitData`: nullable `{domain, types, values}` — EIP-712 `PermitSingle` payload (Permit2 verifyingContract `0x000000000022D473030F116dDEE9F6B43aC78BA3`; values: `details {token, amount, expiration, nonce}, spender, sigDeadline`). `null` ⇒ nothing to sign. Some libraries require adding `EIP712Domain` fields manually. [VERIFIED api.json + integration-guide]
- `isTokenApprovalApplicable`: `false` ⇒ no approval ever needed for this route (native input, wrap/unwrap). "Reflects the routing mechanism, not the swapper's current on-chain allowance. If absent, assume an approval is applicable." [VERIFIED https://developers.uniswap.org/docs/api-reference/aggregator_quote]
- UniswapX quotes carry their own timing: `deadlineBufferSecs` and `orderInfo.deadline`. [VERIFIED api.json]

### POST /swap (`create_swap_transaction`)

Request (`CreateSwapRequest`): required `quote` — **the inner `quote` object echoed verbatim from the /quote response** (oneOf `ClassicQuote | WrapUnwrapQuote | BridgeQuote`). Optional: `signature` (signed permit), `permitData` (echoed from /quote), `refreshGasPrice` (re-fetches gas price; `includeGasInfo` is deprecated in its favor), `simulateTransaction` (default false; if true, endpoint returns an **error** when on-chain simulation reverts), `safetyMode: "SAFE"` (auto-sweeps native token back to sender to prevent value/calldata mistakes), `deadline` (unix timestamp — "the unix timestamp at which the order will be reverted if not filled"), `urgency`. [VERIFIED api.json + https://developers.uniswap.org/docs/api-reference/create_swap_transaction]

- Pairing rule: `signature` and `permitData` "should only be included if `permitData` was returned from `/quote`" — include both or omit both; one without the other fails validation. [VERIFIED api.json + integration-guide]
- Gotcha from Uniswap's own AI skill: don't send `{quote: <entire /quote response>}` — the body's `quote` key must be the inner quote object (their example spreads the /quote response so `quote` + `permitData` land at top level). [VERIFIED https://raw.githubusercontent.com/Uniswap/uniswap-ai/main/packages/plugins/uniswap-trading/skills/swap-integration/SKILL.md]

Response (`CreateSwapResponse`): `requestId`, `swap` (TransactionRequest), optional `gasFee` (total estimated cost in chain base units, e.g. `"859698802733460"` wei). Example `swap`: `{data: "0x3593564c...", value: "0x00", to: <Universal Router>, from, maxFeePerGas, maxPriorityFeePerGas, gasLimit, chainId}`. Client signs & broadcasts via its own RPC. [VERIFIED api.json]

- `TransactionRequest` required fields: `to, from, data, value, chainId`; optional `gasLimit, maxFeePerGas, maxPriorityFeePerGas, gasPrice`. [VERIFIED api.json]
- Calldata rules (verbatim from docs): "**Never Empty**: The `data` field must be a non-empty hex string (not `\"\"` or `\"0x\"`). **Never Modify**: The API endpoints return pre-validated and correct data. Modifying its value may cause funds to be lost or onchain transaction reverts. **Always Validate**: Check `data` exists before broadcasting." [VERIFIED integration-guide]

### GET /swaps (`get_swaps`)

- Query: `txHashes` (comma-separated, `style: form, explode: false`), `userOpHashes` (ERC-4337), optional `chainId`; at least one of `txHashes`/`userOpHashes` must be non-empty. [VERIFIED api.json]
- Response: `requestId` + `swaps[]` of `{swapType: <Routing enum>, status, txHash, swapId?, userOpHash?, hashType? (TX|USER_OP), paymaster?}`. [VERIFIED api.json]
- `SwapStatus` enum: `PENDING | SUCCESS | NOT_FOUND | FAILED | EXPIRED`. [VERIFIED api.json]
- UniswapX orders are polled via `GET /orders` instead. [VERIFIED integration-guide]

## Routing control (classic vs UniswapX, protocols, hooks options)

- Full `routing` enum: `CLASSIC, DUTCH_LIMIT, DUTCH_V2, DUTCH_V3, BRIDGE, LIMIT_ORDER, PRIORITY, WRAP, UNWRAP, CHAINED`. [VERIFIED api.json]
- **Force classic AMM routing (guarantee next step is `/swap`): `protocols: ["V2","V3","V4"]`** (any subset). "If `protocols` contains only `V2`, `V3`, or `V4`, routing is restricted to Uniswap AMM routes." [VERIFIED https://developers.uniswap.org/docs/trading/swapping-api/amm-vs-uniswapx-routing]
- Alternative: `routingPreference: "FASTEST"` also excludes UniswapX ("When `routingPreference` is `FASTEST`, UniswapX routes are not considered") but optimizes quote-return latency, not price, and excludes private UniswapX liquidity. [VERIFIED amm-vs-uniswapx-routing + api-reference]
- `routingPreference` accepts only `BEST_PRICE` (default) and `FASTEST`. Legacy values (`CLASSIC`, `BEST_PRICE_V2`, `UNISWAPX_V2`, `V3_ONLY`, `V2_ONLY`) were **sunset effective Feb 11, 2026** — sending them errors. Legacy `CLASSIC` ≡ `protocols: [V2,V3,V4]` today. [VERIFIED https://developers.uniswap.org/docs/changelog/completed-notifications/sunset-of-legacy-routing-preference-options]
- Interplay: if `protocols` is defined, `routingPreference` may only be `BEST_PRICE`. Only one UniswapX protocol value per request. For wrap/unwrap or bridge ops, "do not specify values for `protocols` or `routingPreference`." [VERIFIED api.json + swap-routing page]
- When UniswapX is returned anyway (protocols omitted + `BEST_PRICE`): trade > ~300 USDC equivalent, or UniswapX beats AMM by ≥0.2%; API falls back to AMM if solvers can't fill or gas ≥20% of trade value. Wrap/unwrap and native-ETH input never route via UniswapX (unless `x-erc20eth-enabled: true`). Below the ~300 USDC minimum, UniswapX yields "No quotes available". [VERIFIED amm-vs-uniswapx-routing + faqs + integration-guide]
- Current UniswapX auction types: Mainnet = DutchV2; other supported chains = DutchV3; `PRIORITY` is not currently returned. [VERIFIED faqs]
- `hooksOptions` (v4): `V4_HOOKS_INCLUSIVE` (default when `V4` is in `protocols`) quotes v4 pools with or without hooks; `V4_HOOKS_ONLY` only hooked pools; `V4_NO_HOOKS` only hookless pools. Ignored if `V4` is not in `protocols`. To exclude hooked v4 pools: `protocols` includes `V4` + `hooksOptions: "V4_NO_HOOKS"`. [VERIFIED https://developers.uniswap.org/docs/api-reference/aggregator_quote]

## Contract-as-swapper notes (Phase 7 spike input)

### x-permit2-disabled / "Proxy Approval" flow

- Header on `/check_approval`, `/quote`, `/swap`; boolean, default false. Verbatim: "Disables the Permit2 approval flow. When set to `true`, `permitData` is returned as `null` and the header is forwarded to the routing layer for correct gas simulation against the Proxy Universal Router contract. … This header is intended for integrators whose infrastructure uses a direct approval-then-swap pattern without Permit2." [VERIFIED https://developers.uniswap.org/docs/api-reference/aggregator_quote + create_swap_transaction + check_approval]
- Per-endpoint effect: `/check_approval` returns ERC-20 approve calldata targeting the **proxy** contract; `/quote` never includes `permitData`; `/swap` tx targets the proxy instead of the Permit2 path. [VERIFIED https://developers.uniswap.org/docs/trading/swapping-api/concepts/no-permit2-workflow]
- The direct-approval spender is neither Permit2 nor the Universal Router — it is a dedicated "Proxy Universal Router", "a thin wrapper around the Universal Router" that "does not change routing or pricing behavior". Flow: approve proxy → send swap tx to proxy → proxy forwards to UR. [VERIFIED no-permit2-workflow]
- Proxy address (deterministic CREATE2, same on every chain, **including Arbitrum 42161**): `0x0000000085E102724e78eCd2F45DC9cA239Affad`. Legacy deprecated proxy `0x02E5be68D46DAc0B524905bfF209cf47EE6dB2a9` (migrate away). [VERIFIED no-permit2-workflow]
- Documented when-to-use includes "your wallet or signing system does not support EIP-712 signing" — exactly the smart-contract-swapper situation, though docs frame it as an infra constraint, not explicitly "for contracts". [VERIFIED no-permit2-workflow]
- Hard limitation: **UniswapX is unavailable in this flow** — only AMM quotes via the Universal Router are returned when the header is set. Convenient side effect: it also forces classic routing. [VERIFIED no-permit2-workflow]
- Fee-on-transfer caveat: proxy flow moves tokens wallet → proxy → UR (two transfers), so FoT fees apply twice; Permit2 flow is a single transfer. [VERIFIED no-permit2-workflow]
- Simulation adapts automatically: Permit2 flow simulates 3 calls (approve token→Permit2, Permit2 approve→UR, swap); proxy flow simulates 2 (approve token→proxy, swap via proxy). No config beyond the header. [VERIFIED no-permit2-workflow]

### Swapper as a smart contract

- `swapper` has no documented EOA restriction — but also no explicit statement that contracts are supported. [VERIFIED definition at https://developers.uniswap.org/docs/api-reference/aggregator_quote; absence-of-statement confirmed across FAQ and concept pages]
- [UNVERIFIED] No doc mentions EIP-1271 signature validation for contract swappers in the Permit2 flow. Treat Permit2-flow-with-contract-swapper as untested/undocumented; the proxy flow is the documented escape hatch for non-EIP-712 signers.
- `/swap` response `from` equals the swapper — the API assumes the swapper is the tx sender (`msg.sender`). [VERIFIED https://developers.uniswap.org/docs/api-reference/create_swap_transaction]
- [UNVERIFIED — protocol-level inference, not in Trade API docs] If a different contract is `msg.sender` than the quoted `swapper`, token sourcing will fail unless that contract itself holds the tokens and approvals. Proposed safe pattern for **VortexCompounder as swapper**: quote with `swapper = VortexCompounder address`, set `x-permit2-disabled: true`, VortexCompounder does plain ERC-20 `approve(0x0000000085E102724e78eCd2F45DC9cA239Affad, amount)`, optionally set `recipient` to the end target, then low-level-call the returned `to`/`data`/`value` from the contract. Atomicity of approve+swap inside one wrapper tx is not addressed anywhere in the docs.
- Embedding returned calldata inside a larger contract call is not documented; the only calldata guidance is prohibitive ("Never Modify", non-empty `data`). `deadline` on `/swap` is the knob for bounding delayed/atomic execution. [VERIFIED faqs + integration-guide + create_swap_transaction]
- UniswapX (order-based, filler-executed, gasless) is structurally incompatible with contract-wrapper execution and is excluded automatically under `x-permit2-disabled`. [VERIFIED aggregator_quote + no-permit2-workflow]
- Account-abstraction adjacent endpoints exist: `/swap_5792` (EIP-5792 batched calls), `/swap_7702` (delegated EOA), `/swap_4337` + `/check_approval_4337`. Existence [VERIFIED supported-chains page + api.json]; contents of the 5792/7702 reference pages [UNVERIFIED — not fetched; highest-value follow-up for this angle].

**Open questions for the Phase 7 spike** (see also Phase 3 list below):

1. Does `/quote` accept a contract address as `swapper` without error, and does simulation pass when the swapper is a contract holding the tokens? (Live test on Arbitrum.)
2. In the proxy flow, can VortexCompounder do approve + swap in the **same transaction** (allowance visible to the proxy mid-tx), or must approval be a prior tx / infinite pre-approval?
3. Is EIP-1271 supported anywhere in the Permit2 flow for contract signers, or is the proxy flow the only path?
4. Behavior of `recipient` when swapper is a contract — does output land at `recipient` directly from the UR?
5. Whether `/swap`'s `from` field being the contract address causes any API-side validation issues when our relayer/EOA actually submits the wrapping tx.
6. FoT double-fee impact for any Vortex reward tokens with transfer fees under the proxy flow.

## Rate limits and error handling

### Rate limits / 429

- Default limit: **6 requests per second per API key** ("Most API keys have a default rate limit of 6 requests per second (RPS)"). [VERIFIED https://developers.uniswap.org/docs/trading/swapping-api/common-errors + faqs] [CONFLICT] The `uniswap-ai` skill's advanced-patterns doc says **~10 req/s per endpoint**. [VERIFIED https://raw.githubusercontent.com/Uniswap/uniswap-ai/main/packages/plugins/uniswap-trading/skills/swap-integration/references/advanced-patterns.md] Design to the stricter 6 RPS/key figure; confirm live.
- Older 3 req/s figure in stale search snippets: [UNVERIFIED historical value; current docs consistently say 6 RPS].
- On 429 (`errorCode: "Ratelimited"`): official guidance is "pausing all requests from your API key and then retrying" — a full stop, not per-request retry. Integration guide's sample handler: exponential backoff `sleep(2^attempt * 1000 ms)`, max ~3 retries, plus ~30 s client-side response caching to cut volume. [VERIFIED common-errors + integration-guide]
- No documented `Retry-After` header behavior. [UNVERIFIED — not mentioned in docs or spec]
- Higher limits: request via the Developer Platform help button / support.uniswap.org; no self-serve tier bump. [VERIFIED faqs]

### Error envelope

- [CONFLICT] Two shapes documented:
  - OpenAPI spec (all error codes): `{ "errorCode": string, "detail": string }`. [VERIFIED api.json]
  - Integration guide's `ErrorResponse` interface: `{ error, message, details? }`. [VERIFIED integration-guide]
  - The Angle-2 pass recommends trusting the spec and parsing both defensively — adopt that.
- Status codes + spec `errorCode` values (from `/quote`; `/swap` and `/order` reuse the schemas) [VERIFIED api.json]:
  - `400` → `RequestValidationError` ("Bad Input"; `detail` names the offending field — e.g. missing `autoSlippage`, 39-char address). Note: the string is `RequestValidationError`, **not** `VALIDATION_ERROR`.
  - `401` → `UnauthorizedError` (bad key, "Account is blocked", malformed accept/content-type headers; on `/swap` also "Fee is not enabled").
  - `404` → enum `ResourceNotFound | QuoteAmountTooLowError | TokenBalanceNotAvailable | InsufficientBalance` ("No quotes available or Gas fee/price not available").
  - `429` → `Ratelimited`.
  - `500` → `InternalServerError`; `503` (`POST /order` only) → `ServiceUnavailable`; `504` → `Timeout` ("Request duration limit reached"). Retry 5xx. [VERIFIED api.json; retry guidance VERIFIED integration-guide]
  - Success codes: `/order` → **201**; `/quote`, `/swap` → 200.
- **403 and 419 do not exist in the current spec or docs.** No HTTP "quote expired" status — staleness surfaces as an on-chain revert (deadline exceeded) or a failed `/swap` simulation. [VERIFIED absence in api.json + common-errors] (Legacy Uniswap APIs reportedly used 419 for rate limiting — [UNVERIFIED], treat as obsolete.)
- Common 404 "No quotes available" causes: amount below the ~300 USDC UniswapX minimum, chain unsupported by UniswapX, token/chain mismatch, combined bridge+swap request, insufficient liquidity, unsupported-token list hit. [VERIFIED common-errors + faqs]

### Quote expiry

- No explicit expiry/TTL field on CLASSIC quotes (no `expiresAt`). [VERIFIED api.json]
- Official guidance: refresh quotes older than **30 seconds** before broadcasting (sample code `QUOTE_EXPIRY_MS = 30000`) and use the `/swap` `deadline` parameter to enforce staleness on-chain. [VERIFIED integration-guide + faqs]
- Permit2 signatures are **single-use and quote-specific** — a new quote requires a new signature; never reuse one. Expiries live in `permitData.values.details.expiration` and `values.sigDeadline`. [VERIFIED integration-guide + faqs + concepts/permit2]
- UniswapX quotes: `deadlineBufferSecs` + `orderInfo.deadline`; orders stay open until filled, cancelled, or expired past `decayEndTime`. [VERIFIED api.json]
- Simulation caveat: passing `/swap` simulation "is not a guarantee that a swap will be successful onchain as factors including gas and slippage may change." [VERIFIED faqs]

## Open questions to verify live in Phase 3

1. **Rate limit reality**: is the effective limit 6 RPS/key (docs) or ~10 req/s/endpoint (uniswap-ai skill)? Probe with our key; check whether 429 responses carry a `Retry-After` header. [CONFLICT above]
2. **Error envelope reality**: does the live API return `{errorCode, detail}` (spec) or `{error, message, details}` (guide)? Capture real 400/404/429 bodies; parse both defensively until confirmed. [CONFLICT above]
3. **Contract as `swapper`**: does `/quote` accept the VortexCompounder address as `swapper` (with and without `x-permit2-disabled`), and what do simulation/`txFailureReasons` report? (Feeds Phase 7.)
4. **Proxy-flow atomicity**: approve-then-swap in a single contract tx against proxy `0x0000000085E102724e78eCd2F45DC9cA239Affad` on Arbitrum — works or requires prior approval tx?
5. **`/swap_5792` and `/swap_7702` reference pages**: fetch and evaluate as alternative contract/AA execution paths (contents currently [UNVERIFIED]).
6. **UR version on Arbitrum**: confirm the effective default (`2.0` vs newer) and that pinning `x-universal-router-version` consistently across `/quote` + `/swap` returns the expected UR `to` address (`0xa51afafe...` for 2.0, `0x8b844f88...` for 2.1.1); the supported-chains per-chain default wording was flagged partially [UNVERIFIED].
7. **`check_approval` null semantics**: confirm live that `"approval": null` (sufficient allowance) and `cancel` (USDT-style reset) behave as spec'd for our actual reward tokens, including under `x-permit2-disabled` (spender = proxy).
8. **Forced-classic guarantee**: with `protocols: ["V2","V3","V4"]` (or `x-permit2-disabled`), confirm `routing` is always `CLASSIC`/`WRAP`/`UNWRAP` and never a UniswapX/`CHAINED` variant, so our dispatch can be simplified.
9. **Quote freshness in practice**: measure how long a quote+permit remains executable on Arbitrum (spec has no TTL; 30 s is guidance only) and pick our `deadline` policy.
10. **OpenAPI spec URL stability**: re-confirm `https://trade-api.gateway.uniswap.org/v1/api.json` remains published (one research pass could not locate it). [CONFLICT above]
11. **`x-erc20eth-enabled`** relevance: only if we ever route native ETH via UniswapX — likely N/A given we force classic; confirm and drop.