import type { ExchangeQuoteResponse, Venue } from "@vortex/shared";
import { USDC } from "@vortex/shared";
import { formatTokenAmount } from "./format";

/**
 * Venue selection is decided on NET output — the amount the taker actually
 * keeps after gas — not on headline output. A venue quoting more tokens but
 * costing more gas can still lose, which is the whole point of comparing.
 */
export interface VenueSelection {
  winner: Venue | null;
  /** Net output difference between winner and loser, in output-token base units. */
  improvement: bigint;
  /** True when only one venue returned a quote, so there is nothing to compare. */
  uncontested: boolean;
}

export function selectVenue(quote: ExchangeQuoteResponse): VenueSelection {
  const aqua = quote.comparison.aqua;
  const uniswap = quote.comparison.uniswap;

  if (aqua === null && uniswap === null) {
    return { winner: null, improvement: 0n, uncontested: true };
  }
  if (aqua === null) {
    return { winner: "UNISWAP", improvement: 0n, uncontested: true };
  }
  if (uniswap === null) {
    return { winner: "AQUA", improvement: 0n, uncontested: true };
  }

  const aquaNet = BigInt(aqua.netAmountOut);
  const uniswapNet = BigInt(uniswap.netAmountOut);
  const winner: Venue = aquaNet >= uniswapNet ? "AQUA" : "UNISWAP";
  const improvement = aquaNet >= uniswapNet ? aquaNet - uniswapNet : uniswapNet - aquaNet;
  return { winner, improvement, uncontested: false };
}

export function formatUsdc(value: bigint): string {
  return formatTokenAmount(value, USDC.decimals, 2);
}

/** "AQUA — improves output by 163.20 USDC" */
export function describeSelection(selection: VenueSelection): string {
  if (selection.winner === null) {
    return "No venue returned a quote";
  }
  const label = selection.winner === "AQUA" ? "Aqua" : "Uniswap";
  if (selection.uncontested) {
    return `${label} — the only venue quoting this trade`;
  }
  if (selection.improvement === 0n) {
    return `${label} — both venues net the same output`;
  }
  return `${label} — improves output by ${formatUsdc(selection.improvement)} USDC`;
}

/**
 * Seconds left on a quote. `expiresAt` is epoch milliseconds (master D-010);
 * `now` is passed in so this stays pure and testable.
 */
export function secondsUntil(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}
