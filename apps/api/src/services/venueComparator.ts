import type { AquaQuote, UniswapQuote } from "./types";

export type ComparatorVenue = "AQUA" | "UNISWAP";

export interface ComparedVenue {
  amountOut: bigint;
  minimumAmountOut: bigint;
  gasCostInOutputToken: bigint;
  /** minimumAmountOut - gas, floored at 0. The number venues are ranked on. */
  netAmountOut: bigint;
}

export interface ComparisonResult {
  selectedVenue: ComparatorVenue;
  aqua: ComparedVenue | null;
  uniswap: ComparedVenue | null;
  /** Why the loser lost, or why a venue was unavailable. */
  reason: string;
}

export interface ComparatorOptions {
  /**
   * Aqua must beat Uniswap's net output by at least this many bps of the
   * Uniswap net to win. Prevents routing away from the deep venue for dust.
   */
  minimumImprovementBps: number;
  /** Gas units an Aqua/SwapVM settlement is expected to burn. */
  aquaGasUnits: bigint;
}

export const DEFAULT_COMPARATOR_OPTIONS: ComparatorOptions = {
  minimumImprovementBps: 1,
  aquaGasUnits: 260_000n,
};

/**
 * Price gas in the output token. Uniswap states its own gas cost in the quoted
 * currency (`gasFeeQuote`), which gives a per-gas-unit rate in output-token
 * base units that the Aqua leg can be charged at — no ETH price feed needed.
 * Rounded UP so gas is never understated for the venue being charged.
 */
export function gasCostInOutputToken(
  gasUnits: bigint,
  reference: { gasUnits: bigint; gasCostInOutputToken: bigint } | null,
): bigint {
  if (!reference || reference.gasUnits <= 0n) return 0n;
  const numerator = gasUnits * reference.gasCostInOutputToken;
  return (numerator + reference.gasUnits - 1n) / reference.gasUnits;
}

function net(minimumAmountOut: bigint, gas: bigint): bigint {
  const value = minimumAmountOut - gas;
  return value > 0n ? value : 0n;
}

/**
 * Ranks the two venues on net output — the amount the taker is guaranteed to
 * keep after gas — never on headline output. Uniswap wins ties and wins
 * outright whenever Aqua cannot settle, so a broken maker can never trap a
 * taker on the worse venue.
 */
export function compareVenues(
  aquaQuote: AquaQuote | null,
  uniswapQuote: UniswapQuote | null,
  options: ComparatorOptions = DEFAULT_COMPARATOR_OPTIONS,
): ComparisonResult {
  const uniswapReference =
    uniswapQuote && uniswapQuote.gasCostInOutputToken !== null
      ? {
          gasUnits: uniswapQuote.gasUnits,
          gasCostInOutputToken: uniswapQuote.gasCostInOutputToken,
        }
      : null;

  const uniswap: ComparedVenue | null = uniswapQuote
    ? {
        amountOut: uniswapQuote.amountOut,
        minimumAmountOut: uniswapQuote.minimumAmountOut,
        gasCostInOutputToken: uniswapQuote.gasCostInOutputToken ?? 0n,
        netAmountOut: net(
          uniswapQuote.minimumAmountOut,
          uniswapQuote.gasCostInOutputToken ?? 0n,
        ),
      }
    : null;

  // A quote reporting 0 gas units has not estimated its gas, so fall back to
  // the configured default rather than charging the venue nothing.
  const aquaGasUnits =
    aquaQuote && aquaQuote.gasUnits > 0n ? aquaQuote.gasUnits : options.aquaGasUnits;
  const aquaGas =
    aquaQuote?.gasCostInOutputToken ??
    gasCostInOutputToken(aquaGasUnits, uniswapReference);

  const aqua: ComparedVenue | null = aquaQuote
    ? {
        amountOut: aquaQuote.amountOut,
        minimumAmountOut: aquaQuote.minimumAmountOut,
        gasCostInOutputToken: aquaGas,
        netAmountOut: net(aquaQuote.minimumAmountOut, aquaGas),
      }
    : null;

  if (!aqua || !aquaQuote?.executable) {
    if (!uniswap) {
      return {
        selectedVenue: "UNISWAP",
        aqua,
        uniswap,
        reason: "NO_VENUE_AVAILABLE",
      };
    }
    return {
      selectedVenue: "UNISWAP",
      aqua,
      uniswap,
      reason: aquaQuote?.reason ?? "AQUA_UNAVAILABLE",
    };
  }

  if (!uniswap) {
    return {
      selectedVenue: "AQUA",
      aqua,
      uniswap,
      reason: "UNISWAP_UNAVAILABLE",
    };
  }

  const requiredMargin =
    (uniswap.netAmountOut * BigInt(options.minimumImprovementBps)) / 10_000n;
  // The margin floors to 0 on small trades, which would silently turn the
  // threshold into a tie-break. Uniswap must keep winning ties: a maker that
  // merely matches the deep venue never earns the routing.
  const wins =
    requiredMargin === 0n
      ? aqua.netAmountOut > uniswap.netAmountOut
      : aqua.netAmountOut >= uniswap.netAmountOut + requiredMargin;

  return {
    selectedVenue: wins ? "AQUA" : "UNISWAP",
    aqua,
    uniswap,
    reason: wins ? "AQUA_NET_BETTER" : "UNISWAP_NET_BETTER",
  };
}
