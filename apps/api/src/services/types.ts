import type { Address, Hex } from "viem";

/**
 * Venue-neutral quote. Every field is in base units of the relevant token so
 * the comparator never has to know decimals.
 */
export interface VenueQuote {
  amountIn: bigint;
  amountOut: bigint;
  /** Worst-case output the taker is guaranteed after slippage. */
  minimumAmountOut: bigint;
  /** Gas units the execution is expected to consume. */
  gasUnits: bigint;
  /**
   * Gas cost denominated in the OUTPUT token's base units, when the venue can
   * state it. Uniswap returns this directly (`gasFeeQuote`); the Aqua source
   * leaves it null and the comparator prices its gas from the Uniswap rate.
   */
  gasCostInOutputToken: bigint | null;
}

export interface AquaQuote extends VenueQuote {
  strategyHash: Hex;
  safetyFeeBps: number;
  commercialFeeBps: number;
  inventoryAdjustmentBps: number;
  makerCoverageBps: number;
  /** True when the maker can actually settle this size right now. */
  executable: boolean;
  /** Set when the strategy cannot quote (stale oracle, bound breach, …). */
  reason?: string;
}

export interface UniswapQuote extends VenueQuote {
  requestId: string;
  routing: string;
  /** Inner `quote` object, echoed verbatim into /swap. Never reshaped. */
  rawQuote: unknown;
  permitData: unknown | null;
  approvalRequired: boolean;
  gasFeeUSD: string | null;
  priceImpact: number | null;
}

export interface QuoteRequestParams {
  chainId: 42161 | 31337;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  taker: Address;
  slippageBps: number;
}

/**
 * Both venues sit behind this so the comparator, the routes, and the tests are
 * identical whether the Aqua leg is blockend's live contract or a fixture.
 */
export interface AquaQuoteSource {
  readonly kind: "live" | "fixture";
  quote(params: QuoteRequestParams & { strategyHash: Hex }): Promise<AquaQuote>;
}
