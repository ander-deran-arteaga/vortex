import type { ExchangeQuoteResponse } from "@vortex/shared";
import { USDC } from "@vortex/shared";
import { formatTokenAmount } from "@/lib/format";
import { selectVenue } from "@/lib/swap-selection";

/**
 * What the taker actually receives.
 *
 * Exact-input only: this field is never an input, and there is no token switch
 * and no exact-output mode. It reports the winning venue's estimate and names
 * that venue, because "you receive X, from Y" is the whole point of comparing
 * two of them.
 *
 * The figure shown is the venue's `amountOut`. Net output is deliberately not
 * recomputed here: the API owns that number while the gas estimate settles.
 */
export function BuyEstimate({
  quote,
  stale,
}: {
  quote: ExchangeQuoteResponse | null;
  /** A quote that has expired still shows its numbers, marked as stale. */
  stale: boolean;
}) {
  if (quote === null) {
    return (
      <div className="mt-2 flex items-baseline justify-between gap-3 rounded-[4px] bg-ink-0 px-4 py-4">
        <span className="num min-w-0 truncate text-[22px] leading-none text-say-3">
          0.00
        </span>
        <span className="shrink-0 text-sm font-medium text-say-2">USDC</span>
      </div>
    );
  }

  const selection = selectVenue(quote);
  const leg =
    selection.winner === "UNISWAP" ? quote.comparison.uniswap : quote.comparison.aqua;

  if (leg === null || leg === undefined) {
    return (
      <div className="mt-2 rounded-[4px] bg-ink-0 px-4 py-4">
        <p className="text-sm text-say-2">No venue quoted this trade.</p>
      </div>
    );
  }

  const venueName = selection.winner === "UNISWAP" ? "Uniswap API" : "Aqua";

  return (
    <div className="mt-2 rounded-[4px] bg-ink-0 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span
          className={`num min-w-0 truncate text-[22px] leading-none ${
            stale ? "text-say-3" : "text-say-1"
          }`}
        >
          {formatTokenAmount(BigInt(leg.amountOut), USDC.decimals, 2)}
        </span>
        <span className="shrink-0 text-sm font-medium text-say-2">USDC</span>
      </div>
      <p className="mt-2 text-xs text-say-2">
        {stale ? (
          <span className="text-warn">Expired estimate</span>
        ) : (
          <>
            Estimated, via <span className="text-cu">{venueName}</span>
          </>
        )}
        <span className="mx-1.5 text-say-3">·</span>
        at least {formatTokenAmount(BigInt(leg.minimumAmountOut), USDC.decimals, 2)} after
        slippage
      </p>
    </div>
  );
}
