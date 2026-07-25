export { parseUnits, formatUnits } from "viem";

/**
 * Vortex unit conventions.
 * WBTC has 8 decimals, USDC has 6 — NEVER assume 18.
 * Reference prices are scaled to 1e18 ("E18").
 * Fees and spreads are basis points (1 bps = 0.01%).
 * Amounts cross the API as decimal strings in base units.
 */
export const WBTC_DECIMALS = 8;
export const USDC_DECIMALS = 6;
export const PRICE_SCALE_DECIMALS = 18;
export const PRICE_SCALE = 10n ** 18n;
export const BPS_DENOMINATOR = 10_000n;

export type Rounding = "floor" | "ceil";

/** a * b / denominator with explicit rounding direction. Callers must round
 * conservatively: DOWN what Vortex pays out, UP what Vortex charges. */
export function mulDiv(
  a: bigint,
  b: bigint,
  denominator: bigint,
  rounding: Rounding = "floor",
): bigint {
  if (denominator <= 0n) throw new RangeError("denominator must be positive");
  if (a < 0n || b < 0n) throw new RangeError("negative values are not supported");
  const product = a * b;
  const quotient = product / denominator;
  return rounding === "ceil" && product % denominator !== 0n
    ? quotient + 1n
    : quotient;
}

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
 * Pure bigint math; callers supply the price and the rounding direction.
 */
export function convertAmount(
  amount: bigint,
  fromDecimals: number,
  priceScaled1e18: bigint,
  rounding: Rounding = "floor",
): bigint {
  return mulDiv(
    amount,
    priceScaled1e18,
    10n ** BigInt(fromDecimals) * PRICE_SCALE,
    rounding,
  );
}

/** Convert an amount between token decimal bases with explicit rounding. */
export function scaleAmount(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
  rounding: Rounding = "floor",
): bigint {
  if (fromDecimals === toDecimals) return amount;
  if (fromDecimals < toDecimals) {
    return amount * 10n ** BigInt(toDecimals - fromDecimals);
  }
  return mulDiv(amount, 1n, 10n ** BigInt(fromDecimals - toDecimals), rounding);
}
