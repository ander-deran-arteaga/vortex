import type { GrowOpportunity } from "@vortex/shared";
import { USDC, WBTC } from "@vortex/shared";
import { SourceBadge } from "@/components/source-badge";
import type { DataSource } from "@/lib/api/source";
import { formatTokenAmount, truncateAddress } from "@/lib/format";

const ROUTE_LABEL: Record<GrowOpportunity["direction"], string> = {
  VORTEX_THEN_EXTERNAL: "Vortex PermAMM → external venue",
  EXTERNAL_THEN_VORTEX: "External venue → Vortex PermAMM",
};

function wbtc(value: bigint): string {
  return formatTokenAmount(value, WBTC.decimals);
}

function Row({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-zinc-400">{label}</dt>
      <dd
        className={
          emphasis
            ? "font-mono text-sm tabular-nums text-teal-300"
            : "font-mono text-sm tabular-nums text-zinc-100"
        }
      >
        {value}
      </dd>
    </div>
  );
}

export function OpportunityCard({
  opportunity,
  source,
  secondsRemaining,
}: {
  opportunity: GrowOpportunity;
  source: DataSource;
  secondsRemaining: number | null;
}) {
  const principal = BigInt(opportunity.principalAmount);
  const grossProfit = BigInt(opportunity.estimatedGrossProfit);
  const expired = secondsRemaining !== null && secondsRemaining === 0;

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Opportunity
        </h2>
        <SourceBadge source={source} />
      </header>

      <dl className="divide-y divide-zinc-800/60">
        <Row label="Principal" value={`${wbtc(principal)} WBTC`} />
        <Row label="Route" value={ROUTE_LABEL[opportunity.direction]} />
        <Row
          label="Bridge amount"
          value={`${formatTokenAmount(BigInt(opportunity.bridgeAmount), USDC.decimals, 2)} USDC`}
        />
        <Row label="Expected final" value={`${wbtc(principal + grossProfit)} WBTC`} />
        <Row
          label="Minimum final"
          value={`${wbtc(BigInt(opportunity.minFinalAsset))} WBTC`}
          emphasis
        />
        <Row
          label="Minimum maker profit"
          value={`${wbtc(BigInt(opportunity.minimumProfit))} WBTC`}
        />
        <Row
          label="Performance fee"
          value={`${wbtc(BigInt(opportunity.performanceFee))} WBTC`}
        />
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-sm text-zinc-400">Expiry</dt>
          <dd
            aria-live="off"
            className={
              expired
                ? "font-mono text-sm tabular-nums text-red-400"
                : secondsRemaining !== null && secondsRemaining <= 10
                  ? "font-mono text-sm tabular-nums text-amber-400"
                  : "font-mono text-sm tabular-nums text-zinc-100"
            }
          >
            {secondsRemaining === null
              ? "—"
              : expired
                ? "Expired"
                : `${secondsRemaining}s`}
          </dd>
        </div>
        {opportunity.uniswap === undefined ? null : (
          <div className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-sm text-zinc-400">Uniswap request ID</dt>
            <dd
              className="font-mono text-sm tabular-nums text-zinc-100"
              title={opportunity.uniswap.requestId}
            >
              {truncateAddress(opportunity.uniswap.requestId)}
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
