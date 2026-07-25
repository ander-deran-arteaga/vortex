import { WBTC } from "@vortex/shared";
import { SourceBadge } from "@/components/source-badge";
import { Panel, Rows } from "@/components/ui/primitives";
import type { DataSource } from "@/lib/api/source";
import { basisPointsToPercent, formatTokenAmount } from "@/lib/format";
import { computeGrowBreakdown } from "@/lib/grow-breakdown";

function wbtc(value: bigint): string {
  return formatTokenAmount(value, WBTC.decimals);
}

type Direction = "flat" | "gain" | "loss";

/**
 * One line of the waterfall. The value never wraps mid-number, so a long label
 * reflows and the money column stays a single readable figure at 375px.
 */
function WaterfallRow({
  label,
  value,
  direction,
}: {
  label: string;
  value: string;
  direction: Direction;
}) {
  const tone =
    direction === "gain"
      ? "text-gain"
      : direction === "loss"
        ? "text-loss"
        : "text-say-1";
  return (
    <div className="flex items-baseline justify-between gap-5 py-2.5">
      <dt className="text-sm leading-snug text-say-2">{label}</dt>
      <dd className={`num shrink-0 whitespace-nowrap text-sm ${tone}`}>{value}</dd>
    </div>
  );
}

/**
 * The cycle has to come back larger than it left, and this is where that is
 * read: principal in, what the round trip made, what the fee took, and the one
 * figure the maker actually receives. The last of those is the hero — it is set
 * several steps above everything around it because it is the answer.
 *
 * §21: this panel is its own surface, so it states its own provenance. A badge
 * on the sibling opportunity card does not cover these numbers.
 */
export function ProfitBreakdown({
  principal,
  grossProfit,
  performanceFee,
  source,
}: {
  principal: bigint;
  grossProfit: bigint;
  performanceFee: bigint;
  source: DataSource;
}) {
  const breakdown = computeGrowBreakdown({ principal, grossProfit, performanceFee });

  return (
    // The one chamfered panel on this page: the figure that signs the product.
    <Panel title="Profit breakdown" aside={<SourceBadge source={source} />} cut>
      <Rows>
        <WaterfallRow
          label="Principal in"
          value={`${wbtc(breakdown.principal)} WBTC`}
          direction="flat"
        />
        <WaterfallRow
          label="Gross profit"
          value={`+ ${wbtc(breakdown.grossProfit)} WBTC`}
          direction="gain"
        />
        <WaterfallRow
          label={`Performance fee (${basisPointsToPercent(breakdown.feeShareBps)} of profit)`}
          value={`− ${wbtc(breakdown.performanceFee)} WBTC`}
          direction="loss"
        />
      </Rows>

      <div className="panel-raised mt-5 px-5 py-5">
        <p className="text-sm text-say-2">Returned to maker</p>
        <p className="num mt-2 text-[1.6rem] leading-none text-say-1 sm:text-[2rem]">
          {`${wbtc(breakdown.makerReturn)} WBTC`}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-say-3">
          Principal plus realized profit, after the fee.
        </p>
      </div>

      <p className="mt-5 text-sm leading-relaxed text-say-2">
        The performance fee applies only to realized profit, never to principal.
        If the cycle does not end with more WBTC than it started with, the whole
        transaction reverts and no fee is taken.
      </p>
    </Panel>
  );
}
