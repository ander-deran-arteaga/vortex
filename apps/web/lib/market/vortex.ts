/**
 * The Vortex side of the comparison, sampled from the live quote endpoint.
 *
 * This calls `apiRequest` directly rather than going through
 * `fetchExchangeQuote`, and that is deliberate: the endpoint helper falls back
 * to fixtures when the API is unreachable, and a fixture curve plotted beside a
 * live Binance book would be exactly the lie this codebase forbids. Here, no
 * API means no Vortex series and a sentence saying so.
 *
 * Each sample is two calls — sell WBTC for the bid, spend USDC for the ask —
 * because the endpoint prices exact input in one direction at a time. The USDC
 * notional for the ask is derived from the bid we just measured, so both sides
 * land on the same size without a search.
 */

import { API_ROUTES, zExchangeQuoteResponse, type ExchangeQuoteResponse } from "@vortex/shared";
import { apiRequest } from "@/lib/api/client";
import { ApiRequestError } from "@/lib/api/errors";
import { impliedPriceE8, normalise, type PriceE8, type VenueSpread } from "./model";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SLIPPAGE_BPS = 30;

/** Sizes sampled for the curve, in WBTC base units (8 decimals). */
export const SAMPLE_SIZES = [
  500_000n, // 0.005
  1_000_000n, // 0.01
  2_500_000n, // 0.025
  5_000_000n, // 0.05
  10_000_000n, // 0.1
  25_000_000n, // 0.25
] as const;

/**
 * Offered in the selector. Deliberately stops well below the maker's ~0.4 WBTC
 * per-trade cap: a chart full of refusals is a bad first impression, and the
 * cap is a strategy parameter rather than a property of the pricing.
 */
export const SELECTABLE_SIZES = [1_000_000n, 5_000_000n, 10_000_000n, 25_000_000n] as const;

export interface VortexSample {
  size: bigint;
  aqua: VenueSpread | null;
  uniswap: VenueSpread | null;
  /** Why a venue has no quote at this size, in the API's own words. */
  aquaNote: string | null;
  uniswapNote: string | null;
}

export interface VortexSamples {
  samples: VortexSample[];
  sampledAt: number;
}

interface QuoteContext {
  chainId: number;
  strategyHash: string;
  wbtc: string;
  usdc: string;
}

async function quote(
  ctx: QuoteContext,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  signal?: AbortSignal,
): Promise<ExchangeQuoteResponse> {
  return apiRequest(API_ROUTES.exchangeQuote, {
    method: "POST",
    schema: zExchangeQuoteResponse,
    signal,
    body: {
      chainId: ctx.chainId,
      strategyHash: ctx.strategyHash,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      taker: ZERO_ADDRESS,
      slippageBps: SLIPPAGE_BPS,
    },
  });
}

/** The API's own code, so a refusal reads as a reason rather than a blank. */
function reasonOf(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "no quote returned";
}

type Leg = { amountOut: string } | null | undefined;

function priceFromSell(leg: Leg, size: bigint): PriceE8 | null {
  if (leg === null || leg === undefined) {
    return null;
  }
  return impliedPriceE8(BigInt(leg.amountOut), size);
}

function priceFromBuy(leg: Leg, usdcIn: bigint): PriceE8 | null {
  if (leg === null || leg === undefined) {
    return null;
  }
  return impliedPriceE8(usdcIn, BigInt(leg.amountOut));
}

/**
 * One size, both sides, both venues.
 *
 * A venue only produces a spread when BOTH of its legs priced: half a book is
 * not a spread, and pairing one venue's bid with another's ask would invent a
 * market that does not exist.
 */
export async function sampleSize(
  ctx: QuoteContext,
  size: bigint,
  signal?: AbortSignal,
): Promise<VortexSample> {
  let sell: ExchangeQuoteResponse | null = null;
  let sellNote: string | null = null;
  try {
    sell = await quote(ctx, ctx.wbtc, ctx.usdc, size, signal);
  } catch (error) {
    sellNote = reasonOf(error);
  }

  const aquaBid = priceFromSell(sell?.comparison.aqua, size);
  const uniBid = priceFromSell(sell?.comparison.uniswap, size);

  // Spend what the bid says this size is worth, so the ask lands on the same
  // size without bisecting for it. Falls back to whichever side did price.
  const reference = aquaBid ?? uniBid;
  if (reference === null) {
    const note = sellNote ?? "no venue priced this size";
    return { size, aqua: null, uniswap: null, aquaNote: note, uniswapNote: note };
  }
  // usdcBase = wbtcBase * priceE8 / 10^10
  const usdcIn = (size * reference) / 10_000_000_000n;

  let buy: ExchangeQuoteResponse | null = null;
  let buyNote: string | null = null;
  try {
    buy = await quote(ctx, ctx.usdc, ctx.wbtc, usdcIn, signal);
  } catch (error) {
    buyNote = reasonOf(error);
  }

  const aquaAsk = priceFromBuy(buy?.comparison.aqua, usdcIn);
  const uniAsk = priceFromBuy(buy?.comparison.uniswap, usdcIn);

  return {
    size,
    aqua: aquaBid !== null && aquaAsk !== null ? normalise({ bid: aquaBid, ask: aquaAsk }) : null,
    uniswap: uniBid !== null && uniAsk !== null ? normalise({ bid: uniBid, ask: uniAsk }) : null,
    aquaNote:
      aquaBid === null ? (sellNote ?? "Aqua did not price this size") : aquaAsk === null ? (buyNote ?? "Aqua did not price the buy side") : null,
    uniswapNote:
      uniBid === null ? (sellNote ?? "Uniswap did not price this size") : uniAsk === null ? (buyNote ?? "Uniswap did not price the buy side") : null,
  };
}

/**
 * Samples every size in sequence, not in parallel: each quote makes a live
 * Uniswap Trade API call behind the scenes, and that key is rate limited at
 * roughly six a second.
 */
export async function sampleVortex(
  ctx: QuoteContext,
  signal?: AbortSignal,
): Promise<VortexSamples> {
  const samples: VortexSample[] = [];
  for (const size of SAMPLE_SIZES) {
    samples.push(await sampleSize(ctx, size, signal));
  }
  return { samples, sampledAt: Date.now() };
}
