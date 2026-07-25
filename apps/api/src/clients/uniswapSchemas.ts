import { z } from "zod";

/**
 * Wire schemas for the Uniswap Trade API.
 *
 * Deliberately separate from the master-owned `@vortex/shared` schemas: those
 * describe Vortex's own API surface and must not drift when Uniswap changes
 * theirs.
 *
 * Tolerance policy (live-verified, see docs/uniswap-api.md):
 *  - every object is `.passthrough()`, because the live API returns fields the
 *    OpenAPI spec does not document (`gasEstimates` on ClassicQuote,
 *    `signature` / `publicKeyId` on the /swap response);
 *  - fields we do not consume are optional/nullish;
 *  - fields the venue comparator or the tx builder depends on are required, so
 *    an upstream shape change fails loudly instead of producing a silent 0.
 */

const zUpstreamAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "invalid address");

/** Base-unit integer amount as a decimal string (WBTC 8dp, USDC 6dp). */
const zUpstreamAmount = z
  .string()
  .regex(/^[0-9]+$/, "invalid base-unit amount");

/**
 * Transaction calldata. The docs are explicit that it must never be empty and
 * never be modified, so an empty `0x` is treated as a malformed response.
 */
const zCalldata = z.string().regex(/^0x[0-9a-fA-F]+$/, "invalid calldata");

export const zUniswapTradeType = z.enum(["EXACT_INPUT", "EXACT_OUTPUT"]);
export type UniswapTradeType = z.infer<typeof zUniswapTradeType>;

// ── Shared sub-objects ─────────────────────────────────────────────

/**
 * `value` and `gasLimit` come back as hex quantities ("0x00"), not decimal
 * strings, so they stay untyped strings here; conversion is the caller's job.
 */
export const zUniswapTransactionRequest = z
  .object({
    to: zUpstreamAddress,
    from: zUpstreamAddress,
    data: zCalldata,
    value: z.string(),
    chainId: z.number().int(),
    gasLimit: z.string().nullish(),
    gasPrice: z.string().nullish(),
    maxFeePerGas: z.string().nullish(),
    maxPriorityFeePerGas: z.string().nullish(),
  })
  .passthrough();
export type UniswapTransactionRequest = z.infer<
  typeof zUniswapTransactionRequest
>;

const zClassicQuoteInput = z
  .object({
    amount: zUpstreamAmount,
    token: zUpstreamAddress,
    /** Present on EXACT_OUTPUT quotes — the exact spend cap. */
    maximumAmount: zUpstreamAmount.nullish(),
  })
  .passthrough();

const zClassicQuoteOutput = z
  .object({
    amount: zUpstreamAmount,
    token: zUpstreamAddress,
    /** Worst case after slippage: the number we rank venues on. */
    minimumAmount: zUpstreamAmount,
    recipient: zUpstreamAddress.nullish(),
  })
  .passthrough();

// ── POST /quote ────────────────────────────────────────────────────

export const zUniswapClassicQuote = z
  .object({
    chainId: z.number().int(),
    swapper: zUpstreamAddress,
    tradeType: zUniswapTradeType,
    input: zClassicQuoteInput,
    output: zClassicQuoteOutput,
    /** Gas units; excludes approval gas. */
    gasUseEstimate: zUpstreamAmount,
    /**
     * Gas cost in the OUTPUT token's base units ("3751" = 0.003751 USDC).
     * Nullish so a quote without it degrades to "gas unknown" rather than
     * failing the whole comparison.
     */
    gasFeeQuote: zUpstreamAmount.nullish(),
    /** Total gas cost in wei. */
    gasFee: z.string().nullish(),
    /** Total gas cost in USD, a decimal string — not base units. */
    gasFeeUSD: z.string().nullish(),
    slippage: z.number().nullish(),
    priceImpact: z.number().nullish(),
    route: z.unknown(),
    routeString: z.string().nullish(),
    blockNumber: z.string().nullish(),
    quoteId: z.string().nullish(),
    maxFeePerGas: z.string().nullish(),
    maxPriorityFeePerGas: z.string().nullish(),
    /** Non-empty means the auto-simulation failed. */
    txFailureReasons: z.array(z.string()).nullish(),
    aggregatedOutputs: z.unknown(),
  })
  .passthrough();
export type UniswapClassicQuote = z.infer<typeof zUniswapClassicQuote>;

export const zUniswapQuoteResponse = z
  .object({
    requestId: z.string(),
    /** `CLASSIC` whenever protocols are forced to [V2,V3,V4]. */
    routing: z.string(),
    quote: zUniswapClassicQuote,
    /** EIP-712 PermitSingle payload, or null when nothing needs signing. */
    permitData: z.unknown(),
    permitTransaction: z.unknown(),
    /** Absent ⇒ assume an approval is applicable (per Uniswap's docs). */
    isTokenApprovalApplicable: z.boolean().nullish(),
  })
  .passthrough();
export type UniswapQuoteResponse = z.infer<typeof zUniswapQuoteResponse>;

// ── POST /check_approval ───────────────────────────────────────────

export const zUniswapApprovalResponse = z
  .object({
    requestId: z.string(),
    /** null ⇒ the allowance is already sufficient. */
    approval: zUniswapTransactionRequest.nullish(),
    /** Non-null ⇒ USDT-style reset-to-zero required before `approval`. */
    cancel: zUniswapTransactionRequest.nullish(),
    gasFee: z.string().nullish(),
    cancelGasFee: z.string().nullish(),
  })
  .passthrough();
export type UniswapApprovalResponse = z.infer<typeof zUniswapApprovalResponse>;

// ── POST /swap ─────────────────────────────────────────────────────

export const zUniswapSwapResponse = z
  .object({
    requestId: z.string(),
    swap: zUniswapTransactionRequest,
    gasFee: z.string().nullish(),
    /** Undocumented but returned live; never used by Vortex. */
    signature: z.string().nullish(),
    publicKeyId: z.string().nullish(),
  })
  .passthrough();
export type UniswapSwapResponse = z.infer<typeof zUniswapSwapResponse>;

// ── GET /swaps ─────────────────────────────────────────────────────

export const zUniswapSwapStatus = z.enum([
  "PENDING",
  "SUCCESS",
  "NOT_FOUND",
  "FAILED",
  "EXPIRED",
]);
export type UniswapSwapStatus = z.infer<typeof zUniswapSwapStatus>;

export const zUniswapSwapStatusEntry = z
  .object({
    status: zUniswapSwapStatus,
    swapType: z.string().nullish(),
    txHash: z.string().nullish(),
    swapId: z.union([z.string(), z.number()]).nullish(),
    userOpHash: z.string().nullish(),
    hashType: z.string().nullish(),
  })
  .passthrough();
export type UniswapSwapStatusEntry = z.infer<typeof zUniswapSwapStatusEntry>;

export const zUniswapSwapsResponse = z
  .object({
    requestId: z.string(),
    swaps: z.array(zUniswapSwapStatusEntry),
  })
  .passthrough();
export type UniswapSwapsResponse = z.infer<typeof zUniswapSwapsResponse>;

// ── Error envelope ─────────────────────────────────────────────────

/**
 * Live 4xx/5xx bodies are `{errorCode, detail}` (+ `requestId` on 429). The
 * integration guide's `{error, message, details}` shape never appeared live but
 * is parsed anyway so a gateway change cannot blind our error handling.
 */
export const zUniswapErrorBody = z
  .object({
    errorCode: z.string().nullish(),
    detail: z.string().nullish(),
    requestId: z.string().nullish(),
    error: z.unknown(),
    message: z.string().nullish(),
    details: z.unknown(),
  })
  .passthrough();
export type UniswapErrorBody = z.infer<typeof zUniswapErrorBody>;

export interface UniswapErrorEnvelope {
  errorCode: string | null;
  detail: string | null;
  requestId: string | null;
}

const EMPTY_ENVELOPE: UniswapErrorEnvelope = {
  errorCode: null,
  detail: null,
  requestId: null,
};

/** Reads either envelope shape, preferring the live `{errorCode, detail}`. */
export function readErrorEnvelope(body: unknown): UniswapErrorEnvelope {
  const parsed = zUniswapErrorBody.safeParse(body);
  if (!parsed.success) return EMPTY_ENVELOPE;
  const b = parsed.data;

  const nested =
    b.error !== null && typeof b.error === "object"
      ? (b.error as { code?: unknown; message?: unknown })
      : null;

  const errorCode =
    b.errorCode ??
    (typeof b.error === "string" ? b.error : null) ??
    (typeof nested?.code === "string" ? nested.code : null) ??
    null;

  const detail =
    b.detail ??
    b.message ??
    (typeof nested?.message === "string" ? nested.message : null) ??
    (typeof b.details === "string" ? b.details : null) ??
    null;

  return { errorCode, detail, requestId: b.requestId ?? null };
}

/**
 * The live 429 code is `TooManyRequests`; the common-errors page documents
 * `Ratelimited`, which never appeared. Match both so a doc-to-live flip in
 * either direction still registers as a rate limit.
 */
export const RATE_LIMIT_ERROR_CODES: ReadonlySet<string> = new Set([
  "TooManyRequests",
  "Ratelimited",
]);

export function isRateLimitErrorCode(code: string | null | undefined): boolean {
  return typeof code === "string" && RATE_LIMIT_ERROR_CODES.has(code);
}
