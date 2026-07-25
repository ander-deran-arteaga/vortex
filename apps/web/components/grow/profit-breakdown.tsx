import { WBTC } from "@vortex/shared";
import { SourceBadge } from "@/components/source-badge";
import type { DataSource } from "@/lib/api/source";
import { basisPointsToPercent, formatTokenAmount } from "@/lib/format";
import { computeGrowBreakdown } from "@/lib/grow-breakdown";

function wbtc(value: bigint): string {
  return formatTokenAmount(value, WBTC.decimals);
}

export function ProfitBreakdown({
  principal,
  grossProfit,
  performanceFee,
  source,
}: {
  principal: bigint;
  grossProfit: bigint;
  performanceFee: bigint;
  // This panel is its own bordered section, so it must state its own
  // provenance — a badge on the sibling card does not cover it.
  source: DataSource;
}) {
  const breakdown = computeGrowBreakdown({ principal, grossProfit, performanceFee });

  const rows = [
    { label: "Principal in", value: wbtc(breakdown.principal), tone: "neutral" as const },
    { label: "Gross profit", value: `+ ${wbtc(breakdown.grossProfit)}`, tone: "gain" as const },
    {
      label: `Performance fee (${basisPointsToPercent(breakdown.feeShareBps)} of profit)`,
      value: `− ${wbtc(breakdown.performanceFee)}`,
      tone: "cost" as const,
    },
    { label: "Returned to maker", value: wbtc(breakdown.makerReturn), tone: "total" as const },
  ];

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Profit breakdown
        </h2>
        <SourceBadge source={source} />
      </header>
      <dl className="divide-y divide-zinc-800/60">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 py-2"
          >
            <dt
              className={
                row.tone === "total" ? "text-sm font-medium text-zinc-200" : "text-sm text-zinc-400"
              }
            >
              {row.label}
            </dt>
            <dd
              className={
                row.tone === "gain"
                  ? "font-mono text-sm tabular-nums text-teal-400"
                  : row.tone === "cost"
                    ? "font-mono text-sm tabular-nums text-amber-400"
                    : row.tone === "total"
                      ? "font-mono text-sm font-medium tabular-nums text-zinc-100"
                      : "font-mono text-sm tabular-nums text-zinc-100"
              }
            >
              {row.value} WBTC
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm leading-relaxed text-zinc-400">
        The performance fee applies only to realized profit — never to
        principal. If the cycle does not end with more WBTC than it started
        with, the whole transaction reverts and no fee is taken.
      </p>
    </section>
  );
}
