"use client";

import { StatusMark } from "@/components/ui/primitives";
import { formatTokenAmount } from "@/lib/format";
import type { VenueSpread } from "@/lib/market/model";

export interface VenueRow {
  name: string;
  detail: string;
  spread: VenueSpread | null;
  /** Why this venue has no numbers. Rendered in place of them, never blank. */
  note: string | null;
  source: "live" | "unavailable";
}

/**
 * Basis points at a precision that suits the magnitude. Binance's top of book
 * is genuinely about two thousandths of a basis point wide; printing that as
 * "0.0" reads as missing data rather than as the tightest number on the page.
 */
function bpsDigits(value: number): number {
  const magnitude = Math.abs(value);
  if (magnitude === 0) {
    return 1;
  }
  if (magnitude < 0.01) {
    return 4;
  }
  if (magnitude < 1) {
    return 2;
  }
  return 1;
}

function bps(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(bpsDigits(value))}`;
}

/** USDC per WBTC, from the E8 fixed point, at two decimals. */
function price(value: bigint): string {
  return formatTokenAmount(value / 100n, 6, 2);
}

/**
 * The comparison, one row per venue.
 *
 * The absolute mid is shown alongside the basis points on purpose: the marks
 * genuinely differ — Vortex prices a demo chain — and seeing 64,300 next to
 * 64,255 is what makes it obvious why the comparison is normalised rather than
 * quoted in dollars.
 */
export function SpreadTable({ rows, size }: { rows: VenueRow[]; size: bigint }) {
  const quoted = rows.filter((r) => r.spread !== null);
  const tightest = quoted.reduce<VenueRow | null>(
    (best, row) =>
      best === null || (row.spread as VenueSpread).spreadBps < (best.spread as VenueSpread).spreadBps
        ? row
        : best,
    null,
  );

  return (
    // Wide on a phone, so it scrolls inside its own box rather than dragging
    // the page sideways.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <caption className="sr-only">
          Spread by venue at {formatTokenAmount(size, 8)} WBTC, in basis points of
          each venue&rsquo;s own mid.
        </caption>
        <thead>
          <tr className="text-xs text-say-3">
            <th scope="col" className="pb-3 font-normal">
              Venue
            </th>
            <th scope="col" className="pb-3 text-right font-normal">
              Mid
            </th>
            <th scope="col" className="pb-3 text-right font-normal">
              Bid
            </th>
            <th scope="col" className="pb-3 text-right font-normal">
              Ask
            </th>
            <th scope="col" className="pb-3 text-right font-normal">
              Spread
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[rgba(255,238,222,0.05)]">
          {rows.map((row) => {
            const isTightest = tightest !== null && tightest.name === row.name;
            return (
              <tr key={row.name} className="align-baseline">
                <th scope="row" className="py-3.5 pr-4 font-normal">
                  <span className="flex items-baseline gap-2 text-sm text-say-1">
                    {isTightest ? <StatusMark tone="accent" /> : null}
                    {row.name}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-say-3">
                    {row.detail}
                  </span>
                </th>
                {row.spread === null ? (
                  <td colSpan={4} className="py-3.5 text-right text-xs leading-snug text-say-2">
                    {row.note ?? "No quote."}
                  </td>
                ) : (
                  <>
                    <td className="num py-3.5 text-right text-sm text-say-2">
                      {price(row.spread.mid)}
                    </td>
                    <td className="num py-3.5 text-right text-sm text-say-2">
                      {bps(row.spread.bidBps)}
                    </td>
                    <td className="num py-3.5 text-right text-sm text-say-2">
                      {bps(row.spread.askBps)}
                    </td>
                    <td
                      className={`num py-3.5 text-right text-sm ${
                        row.spread.spreadBps < 0
                          ? "text-loss"
                          : isTightest
                            ? "text-cu"
                            : "text-say-1"
                      }`}
                    >
                      {row.spread.spreadBps.toFixed(bpsDigits(row.spread.spreadBps))}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-4 text-xs leading-relaxed text-say-3">
        Bid, ask and spread are basis points of each venue&rsquo;s own mid, which
        is what makes venues on different marks comparable. Mid is USDC per WBTC.
      </p>
    </div>
  );
}
