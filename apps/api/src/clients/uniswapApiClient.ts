import type { Address, Hex } from "viem";

import type { QuoteRequestParams } from "../services/types";
import {
  isRateLimitErrorCode,
  readErrorEnvelope,
  zUniswapApprovalResponse,
  zUniswapQuoteResponse,
  zUniswapSwapResponse,
  zUniswapSwapsResponse,
  type UniswapClassicQuote,
  type UniswapSwapStatusEntry,
  type UniswapTradeType,
  type UniswapTransactionRequest,
} from "./uniswapSchemas";

/**
 * Authenticated client for the Uniswap Trade API.
 *
 * Everything here is built on the live verification in docs/uniswap-api.md:
 * the `{errorCode, detail}` envelope, the `TooManyRequests` 429 code, the
 * absence of `Retry-After`, the ~6 RPS/key ceiling, and the requirement to
 * echo the inner `quote` object verbatim into /swap.
 *
 * The API key lives only in this factory's closure — it is never a property of
 * the returned client, never a field on a thrown error, and is scrubbed out of
 * any upstream text we surface.
 */

export const DEFAULT_UNISWAP_BASE_URL =
  "https://trade-api.gateway.uniswap.org/v1";

/**
 * Forcing the AMM protocol set is what guarantees `routing: "CLASSIC"`, hence
 * that /swap (never /order) is the follow-up call. Not caller-tunable.
 */
export const FORCED_CLASSIC_PROTOCOLS = ["V2", "V3", "V4"] as const;

export const UNISWAP_CLIENT_DEFAULTS = {
  /** Below the measured ~6 RPS/key ceiling. */
  requestsPerSecond: 5,
  /** 1 = strict spacing; a burst window can push the sliding rate over 6 RPS. */
  burstCapacity: 1,
  maxAttempts: 3,
  retryBaseMs: 250,
  retryJitterRatio: 0.25,
  quoteCacheTtlMs: 10_000,
  universalRouterVersion: "2.0",
} as const;

// ── Injectable I/O ─────────────────────────────────────────────────

export interface UniswapFetchInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Structural subset of `Response` we rely on, so fakes stay tiny. */
export interface UniswapFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type UniswapFetch = (
  url: string,
  init: UniswapFetchInit,
) => Promise<UniswapFetchResponse>;

// ── Errors ─────────────────────────────────────────────────────────

export interface UniswapApiErrorInit {
  /** 0 for transport failures that never produced a response. */
  httpStatus: number;
  errorCode: string | null;
  detail: string | null;
  requestId: string | null;
  retryable?: boolean;
}

/**
 * No `statusCode` property on purpose: Fastify's error handler would otherwise
 * republish an upstream 404/429 as ours. Callers decide how a venue failure
 * maps onto a Vortex response.
 */
export class UniswapApiError extends Error {
  readonly httpStatus: number;
  readonly errorCode: string | null;
  readonly detail: string | null;
  readonly requestId: string | null;
  readonly retryable: boolean;

  constructor(init: UniswapApiErrorInit) {
    super(formatErrorMessage(init));
    this.name = "UniswapApiError";
    this.httpStatus = init.httpStatus;
    this.errorCode = init.errorCode;
    this.detail = init.detail;
    this.requestId = init.requestId;
    this.retryable = init.retryable ?? isRetryableStatus(init.httpStatus);
  }

  get isRateLimit(): boolean {
    return this.httpStatus === 429 || isRateLimitErrorCode(this.errorCode);
  }
}

function formatErrorMessage(init: UniswapApiErrorInit): string {
  const parts = [`uniswap api ${init.httpStatus || "transport"}`];
  if (init.errorCode) parts.push(init.errorCode);
  const head = parts.join(" ");
  return init.detail ? `${head}: ${init.detail}` : head;
}

/** 429 and every 5xx (incl. 504 Timeout) are retryable; 4xx never is. */
function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}

// ── Request/response shapes ────────────────────────────────────────

export interface CheckApprovalParams {
  chainId: number;
  walletAddress: Address;
  token: Address;
  amount: bigint;
  includeGasInfo?: boolean;
  /** Overrides the client default; spender becomes the proxy, not Permit2. */
  permit2Disabled?: boolean;
}

export interface ApprovalResult {
  requestId: string;
  /** null ⇒ allowance already sufficient. */
  approval: UniswapTransactionRequest | null;
  /** Non-null ⇒ send this reset-to-zero tx before `approval`. */
  cancel: UniswapTransactionRequest | null;
}

export interface UniswapQuoteParams {
  chainId: number;
  tokenIn: Address;
  tokenOut: Address;
  /** Base units of tokenIn for EXACT_INPUT, of tokenOut for EXACT_OUTPUT. */
  amount: bigint;
  swapper: Address;
  slippageBps: number;
  type?: UniswapTradeType;
  recipient?: Address;
  /** Default to `chainId`; only differ for bridge routes. */
  tokenInChainId?: number;
  tokenOutChainId?: number;
  /** Must match the value used on the matching /swap call. */
  permit2Disabled?: boolean;
}

export interface ClassicQuoteResult {
  requestId: string;
  routing: string;
  /** Validated view of the quote. */
  quote: UniswapClassicQuote;
  /** The inner `quote` exactly as received — echo this into /swap, unreshaped. */
  rawQuote: unknown;
  permitData: unknown | null;
  permitTransaction: unknown | null;
  /** Absent `isTokenApprovalApplicable` means "assume applicable". */
  approvalRequired: boolean;
}

export interface CreateSwapParams {
  /** The inner `quote` object from /quote. Never reshape it. */
  quote: unknown;
  /** Include with `signature`, or omit both — the API rejects one alone. */
  permitData?: unknown;
  signature?: Hex | string;
  refreshGasPrice?: boolean;
  simulateTransaction?: boolean;
  safetyMode?: "SAFE";
  /** Unix seconds after which the swap reverts if unfilled. */
  deadline?: number;
  permit2Disabled?: boolean;
}

export interface SwapResult {
  requestId: string;
  swap: UniswapTransactionRequest;
  /** Total estimated gas cost in wei. */
  gasFee: string | null;
}

export interface SwapStatusParams {
  txHashes: readonly string[];
  chainId?: number;
}

export interface SwapStatusResult {
  requestId: string;
  swaps: UniswapSwapStatusEntry[];
}

export interface UniswapApiClient {
  checkApproval(params: CheckApprovalParams): Promise<ApprovalResult>;
  getClassicQuote(params: UniswapQuoteParams): Promise<ClassicQuoteResult>;
  createSwapTransaction(params: CreateSwapParams): Promise<SwapResult>;
  getSwapStatus(params: SwapStatusParams): Promise<SwapStatusResult>;
}

export interface UniswapApiClientOptions {
  /**
   * Required. Env keeps `UNISWAP_API_KEY` optional so the server boots without
   * secrets; a client that cannot authenticate must not exist at all.
   */
  apiKey: string;
  baseUrl?: string;
  fetch?: UniswapFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source; inject a constant for deterministic tests. */
  random?: () => number;
  maxAttempts?: number;
  retryBaseMs?: number;
  retryJitterRatio?: number;
  requestsPerSecond?: number;
  burstCapacity?: number;
  /** 0 disables both the quote cache and in-flight dedup. */
  quoteCacheTtlMs?: number;
  universalRouterVersion?: string;
  permit2Disabled?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * bps → the API's PERCENT number, max 2 decimals: 30 bps ⇒ 0.3 (%).
 * Integer bps can never need more than 2 decimals, so rounding only guards
 * against a fractional caller value.
 */
export function slippageBpsToPercent(slippageBps: number): number {
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new RangeError(`invalid slippage bps: ${slippageBps}`);
  }
  return Math.round(slippageBps) / 100;
}

/** Adapts the venue-neutral request onto this client's quote params. */
export function quoteParamsFromRequest(
  params: QuoteRequestParams,
): UniswapQuoteParams {
  return {
    chainId: params.chainId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    amount: params.amountIn,
    swapper: params.taker,
    slippageBps: params.slippageBps,
    type: "EXACT_INPUT",
  };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const MAX_DETAIL_CHARS = 500;

/**
 * Paces requests so bursts queue instead of 429ing. Scheduling is purely
 * arithmetic on the injected clock — no polling loop — so a fake clock that
 * only advances inside `sleep` behaves exactly like a real one.
 */
class RequestPacer {
  private nextFreeAt = Number.NEGATIVE_INFINITY;
  private readonly intervalMs: number;

  constructor(
    requestsPerSecond: number,
    private readonly burstCapacity: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {
    this.intervalMs = requestsPerSecond > 0 ? 1000 / requestsPerSecond : 0;
  }

  async acquire(): Promise<void> {
    if (this.intervalMs <= 0) return;
    const t = this.now();
    // Idle time accrues at most `burstCapacity` slots, never unbounded credit.
    const earliest = t - Math.max(0, this.burstCapacity - 1) * this.intervalMs;
    const scheduled = Math.max(this.nextFreeAt, earliest, Number.MIN_SAFE_INTEGER);
    const startAt = Math.max(scheduled, earliest);
    this.nextFreeAt = startAt + this.intervalMs;
    const wait = startAt - t;
    if (wait > 0) await this.sleep(wait);
  }

  /** After a 429, hold every caller back — the guidance is to pause the key. */
  penalize(ms: number): void {
    const until = this.now() + ms;
    if (until > this.nextFreeAt) this.nextFreeAt = until;
  }
}

interface QuoteCacheEntry {
  expiresAt: number;
  promise: Promise<ClassicQuoteResult>;
}

// ── Factory ────────────────────────────────────────────────────────

export function createUniswapApiClient(
  options: UniswapApiClientOptions,
): UniswapApiClient {
  const apiKey =
    typeof options.apiKey === "string" ? options.apiKey.trim() : "";
  if (apiKey === "") {
    throw new Error(
      "uniswap api client requires an api key (set UNISWAP_API_KEY)",
    );
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_UNISWAP_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const doFetch: UniswapFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const maxAttempts = options.maxAttempts ?? UNISWAP_CLIENT_DEFAULTS.maxAttempts;
  const retryBaseMs = options.retryBaseMs ?? UNISWAP_CLIENT_DEFAULTS.retryBaseMs;
  const retryJitterRatio =
    options.retryJitterRatio ?? UNISWAP_CLIENT_DEFAULTS.retryJitterRatio;
  const quoteCacheTtlMs =
    options.quoteCacheTtlMs ?? UNISWAP_CLIENT_DEFAULTS.quoteCacheTtlMs;
  const universalRouterVersion =
    options.universalRouterVersion ??
    UNISWAP_CLIENT_DEFAULTS.universalRouterVersion;
  const defaultPermit2Disabled = options.permit2Disabled ?? false;

  const pacer = new RequestPacer(
    options.requestsPerSecond ?? UNISWAP_CLIENT_DEFAULTS.requestsPerSecond,
    options.burstCapacity ?? UNISWAP_CLIENT_DEFAULTS.burstCapacity,
    now,
    sleep,
  );

  const quoteCache = new Map<string, QuoteCacheEntry>();

  /** Upstream text can echo request headers; never let the key ride along. */
  function scrub(text: string | null): string | null {
    if (text === null) return null;
    return text.split(apiKey).join("[redacted]");
  }

  function buildHeaders(
    hasBody: boolean,
    permit2Disabled: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      accept: "application/json",
      "x-universal-router-version": universalRouterVersion,
    };
    // Header validation is strict upstream: a stray content-type on a GET is
    // answered with 401, not 400.
    if (hasBody) headers["content-type"] = "application/json";
    if (permit2Disabled) headers["x-permit2-disabled"] = "true";
    return headers;
  }

  function backoffDelayMs(attempt: number): number {
    // No Retry-After exists upstream, so pure exponential + jitter.
    const delay = retryBaseMs * 2 ** attempt;
    return Math.round(delay * (1 + retryJitterRatio * random()));
  }

  async function send(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    permit2Disabled: boolean,
  ): Promise<unknown> {
    const url = `${baseUrl}${path}`;
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    let attempt = 0;

    for (;;) {
      attempt += 1;
      await pacer.acquire();

      let response: UniswapFetchResponse;
      try {
        const init: UniswapFetchInit = {
          method,
          headers: buildHeaders(serialized !== undefined, permit2Disabled),
        };
        if (serialized !== undefined) init.body = serialized;
        response = await doFetch(url, init);
      } catch (cause) {
        if (attempt < maxAttempts) {
          await sleep(backoffDelayMs(attempt));
          continue;
        }
        throw new UniswapApiError({
          httpStatus: 0,
          errorCode: "NetworkError",
          detail: scrub(cause instanceof Error ? cause.message : String(cause)),
          requestId: null,
        });
      }

      const text = await response.text();

      if (!response.ok) {
        const envelope = readErrorEnvelope(safeJsonParse(text));
        const error = new UniswapApiError({
          httpStatus: response.status,
          errorCode: envelope.errorCode,
          detail: scrub(envelope.detail ?? text.slice(0, MAX_DETAIL_CHARS)),
          requestId: envelope.requestId,
        });
        if (error.retryable && attempt < maxAttempts) {
          const delay = backoffDelayMs(attempt);
          if (error.isRateLimit) pacer.penalize(delay);
          await sleep(delay);
          continue;
        }
        throw error;
      }

      const json = safeJsonParse(text);
      if (json === undefined) {
        throw new UniswapApiError({
          httpStatus: response.status,
          errorCode: "InvalidResponseBody",
          detail: scrub(text.slice(0, MAX_DETAIL_CHARS)),
          requestId: null,
          retryable: false,
        });
      }
      // Schema failures on a 2xx body stay untagged ZodErrors: per lib/errors,
      // an upstream shape change is a server-side bug (500), not a bad request.
      return json;
    }
  }

  function buildQuoteBody(params: UniswapQuoteParams): Record<string, unknown> {
    if (params.amount <= 0n) {
      throw new RangeError("uniswap quote amount must be positive");
    }
    const body: Record<string, unknown> = {
      type: params.type ?? "EXACT_INPUT",
      amount: params.amount.toString(),
      tokenInChainId: params.tokenInChainId ?? params.chainId,
      tokenOutChainId: params.tokenOutChainId ?? params.chainId,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
      swapper: params.swapper,
      slippageTolerance: slippageBpsToPercent(params.slippageBps),
      protocols: [...FORCED_CLASSIC_PROTOCOLS],
      routingPreference: "BEST_PRICE",
    };
    if (params.recipient) body.recipient = params.recipient;
    return body;
  }

  function pruneQuoteCache(at: number): void {
    for (const [key, entry] of quoteCache) {
      if (entry.expiresAt <= at) quoteCache.delete(key);
    }
  }

  async function fetchClassicQuote(
    body: Record<string, unknown>,
    permit2Disabled: boolean,
  ): Promise<ClassicQuoteResult> {
    const json = await send("POST", "/quote", body, permit2Disabled);
    const parsed = zUniswapQuoteResponse.parse(json);
    return {
      requestId: parsed.requestId,
      routing: parsed.routing,
      quote: parsed.quote,
      // Taken from the untouched JSON so /swap gets byte-for-byte what /quote
      // returned, including fields no schema knows about.
      rawQuote: (json as { quote?: unknown }).quote,
      permitData: parsed.permitData ?? null,
      permitTransaction: parsed.permitTransaction ?? null,
      approvalRequired: parsed.isTokenApprovalApplicable ?? true,
    };
  }

  async function checkApproval(
    params: CheckApprovalParams,
  ): Promise<ApprovalResult> {
    if (params.amount <= 0n) {
      throw new RangeError("uniswap approval amount must be positive");
    }
    const body: Record<string, unknown> = {
      walletAddress: params.walletAddress,
      token: params.token,
      amount: params.amount.toString(),
      chainId: params.chainId,
    };
    if (params.includeGasInfo !== undefined) {
      body.includeGasInfo = params.includeGasInfo;
    }
    const json = await send(
      "POST",
      "/check_approval",
      body,
      params.permit2Disabled ?? defaultPermit2Disabled,
    );
    const parsed = zUniswapApprovalResponse.parse(json);
    return {
      requestId: parsed.requestId,
      approval: parsed.approval ?? null,
      cancel: parsed.cancel ?? null,
    };
  }

  async function getClassicQuote(
    params: UniswapQuoteParams,
  ): Promise<ClassicQuoteResult> {
    const permit2Disabled = params.permit2Disabled ?? defaultPermit2Disabled;
    const body = buildQuoteBody(params);
    if (quoteCacheTtlMs <= 0) return fetchClassicQuote(body, permit2Disabled);

    const at = now();
    pruneQuoteCache(at);
    const key = JSON.stringify([body, permit2Disabled, universalRouterVersion]);
    const hit = quoteCache.get(key);
    // A live entry serves both the in-flight duplicate and the repeat caller.
    if (hit && hit.expiresAt > at) return hit.promise;

    const promise = fetchClassicQuote(body, permit2Disabled);
    const entry: QuoteCacheEntry = { expiresAt: at + quoteCacheTtlMs, promise };
    quoteCache.set(key, entry);
    void promise.catch(() => {
      // Failures must never be served from cache.
      if (quoteCache.get(key) === entry) quoteCache.delete(key);
    });
    return promise;
  }

  async function createSwapTransaction(
    params: CreateSwapParams,
  ): Promise<SwapResult> {
    const hasPermitData =
      params.permitData !== undefined && params.permitData !== null;
    const hasSignature =
      typeof params.signature === "string" && params.signature.length > 0;
    if (hasPermitData !== hasSignature) {
      // Mirrors the server-side rejection ("value contains [permitData]
      // without its required peers [signature]") without spending a request.
      throw new UniswapApiError({
        httpStatus: 400,
        errorCode: "RequestValidationError",
        detail: "permitData and signature must be sent together, or not at all",
        requestId: null,
        retryable: false,
      });
    }

    const body: Record<string, unknown> = { quote: params.quote };
    if (hasPermitData) {
      body.permitData = params.permitData;
      body.signature = params.signature;
    }
    if (params.refreshGasPrice !== undefined) {
      body.refreshGasPrice = params.refreshGasPrice;
    }
    if (params.simulateTransaction !== undefined) {
      body.simulateTransaction = params.simulateTransaction;
    }
    if (params.safetyMode !== undefined) body.safetyMode = params.safetyMode;
    if (params.deadline !== undefined) body.deadline = params.deadline;

    const json = await send(
      "POST",
      "/swap",
      body,
      params.permit2Disabled ?? defaultPermit2Disabled,
    );
    const parsed = zUniswapSwapResponse.parse(json);
    return {
      requestId: parsed.requestId,
      swap: parsed.swap,
      gasFee: parsed.gasFee ?? null,
    };
  }

  async function getSwapStatus(
    params: SwapStatusParams,
  ): Promise<SwapStatusResult> {
    if (params.txHashes.length === 0) {
      throw new RangeError("uniswap swap status requires at least one tx hash");
    }
    // form/explode=false: the separators must stay literal commas, which
    // URLSearchParams would percent-encode.
    const query = [`txHashes=${params.txHashes.join(",")}`];
    if (params.chainId !== undefined) query.push(`chainId=${params.chainId}`);
    const json = await send(
      "GET",
      `/swaps?${query.join("&")}`,
      undefined,
      defaultPermit2Disabled,
    );
    const parsed = zUniswapSwapsResponse.parse(json);
    return { requestId: parsed.requestId, swaps: parsed.swaps };
  }

  return {
    checkApproval,
    getClassicQuote,
    createSwapTransaction,
    getSwapStatus,
  };
}
