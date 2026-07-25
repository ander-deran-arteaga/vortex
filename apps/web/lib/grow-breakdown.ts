/**
 * Vortex Grow profit arithmetic. Every value is WBTC base units (8 decimals)
 * as a bigint — the maker's principal must come back whole, so nothing here
 * may go through floating point.
 */
export interface GrowBreakdown {
  principal: bigint;
  grossProfit: bigint;
  performanceFee: bigint;
  /** What the maker receives back: principal + profit - fee. */
  makerReturn: bigint;
  /** Profit the maker keeps, after the performance fee. */
  makerProfit: bigint;
  /** Performance fee as a share of gross profit, in basis points. */
  feeShareBps: number;
}

export function computeGrowBreakdown(input: {
  principal: bigint;
  grossProfit: bigint;
  performanceFee: bigint;
}): GrowBreakdown {
  const { principal, grossProfit, performanceFee } = input;
  // The fee can never exceed realized profit — that is the invariant the
  // contract enforces, and the UI must not display a number that violates it.
  const fee = performanceFee > grossProfit ? grossProfit : performanceFee;
  const makerProfit = grossProfit - fee;
  return {
    principal,
    grossProfit,
    performanceFee: fee,
    makerReturn: principal + makerProfit,
    makerProfit,
    feeShareBps: grossProfit === 0n ? 0 : Number((fee * 10_000n) / grossProfit),
  };
}
