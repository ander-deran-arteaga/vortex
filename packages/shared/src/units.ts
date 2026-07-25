export { parseUnits, formatUnits } from "viem";

export const BPS_DENOMINATOR = 10_000n;

/** amount * bps / 10_000, floor division. */
export function bpsOf(amount: bigint, bps: number | bigint): bigint {
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}

/** Minimum acceptable output after applying slippage tolerance in bps. */
export function minOutAfterSlippage(amountOut: bigint, slippageBps: number): bigint {
  return amountOut - bpsOf(amountOut, slippageBps);
}

/** Maximum acceptable input after applying slippage tolerance in bps (ceil). */
export function maxInAfterSlippage(amountIn: bigint, slippageBps: number): bigint {
  const numerator = amountIn * (BPS_DENOMINATOR + BigInt(slippageBps));
  return (numerator + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
}

/**
 * Convert an amount of `from` token into `to` token units given a price
 * expressed as (to base units per 1 whole `from` token, scaled by 1e18).
 * Pure bigint math; callers supply the price.
 */
export function convertAmount(
  amount: bigint,
  fromDecimals: number,
  priceScaled1e18: bigint,
): bigint {
  return (amount * priceScaled1e18) / (10n ** BigInt(fromDecimals) * 10n ** 18n);
}
