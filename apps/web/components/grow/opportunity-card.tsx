import type { GrowOpportunity } from "@vortex/shared";
import { WBTC } from "@vortex/shared";
import { SourceBadge } from "@/components/source-badge";
import { Panel, Rows, StatusMark } from "@/components/ui/primitives";
import type { DataSource } from "@/lib/api/source";
import { formatTokenAmount } from "@/lib/format";

const ROUTE_LABEL: Record<GrowOpportunity["direction"], string> = {
  VORTEX_THEN_EXTERNAL: "Vortex PermAMM → external venue",
  EXTERNAL_THEN_VORTEX: "External venue → Vortex PermAMM",
};

function wbtc(value: bigint): string {
  return formatTokenAmount(value, WBTC.decimals);
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-5 py-2.5">
      <dt className="text-sm leading-snug text-say-2">{label}</dt>
      <dd className="num shrink-0 whitespace-nowrap text-sm text-say-1">{value}</dd>
    </div>
  );
}

/**
 * The priced cycle. Three things decide whether it is worth running, so only
 * those three are here: which way round the legs go, how long the quote is
 * still good for, and the floor the contract will enforce. The rest of what the
 * API returns would be reading material, not a decision.
 */
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
  const urgent = secondsRemaining !== null && secondsRemaining > 0 && secondsRemaining <= 10;

  const expiryTone = expired ? "text-loss" : urgent ? "text-warn" : "text-say-1";

  return (
    <Panel title="Opportunity" aside={<SourceBadge source={source} />}>
      {/*
        Two parallel columns on one grid: the labels share a line and the values
        share a line, whatever the length of the route name.
      */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="text-sm text-say-2">Route</p>
          <p className="mt-2 text-base leading-snug text-say-1">
            {ROUTE_LABEL[opportunity.direction]}
          </p>
        </div>
        <div className="min-w-0 sm:text-right">
          <p className="text-sm text-say-2">Quote expires in</p>
          <p className="mt-2 flex items-center gap-2 sm:justify-end">
            {expired || urgent ? (
              <StatusMark tone={expired ? "loss" : "warn"} />
            ) : null}
            {/*
              The countdown re-renders every second; announcing it would talk
              over everything else on the page.
            */}
            <span aria-live="off" className={`num text-base leading-snug ${expiryTone}`}>
              {secondsRemaining === null
                ? "—"
                : expired
                  ? "Expired"
                  : `${secondsRemaining}s`}
            </span>
          </p>
        </div>
      </div>

      {/* The floor the contract enforces: the number that decides the run. */}
      <div className="panel-raised mt-6 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
          <p className="text-sm text-say-2">Minimum final</p>
          <p className="num whitespace-nowrap text-xl text-say-1 sm:text-2xl">
            {`${wbtc(BigInt(opportunity.minFinalAsset))} WBTC`}
          </p>
        </div>
        <p className="mt-2.5 text-xs leading-relaxed text-say-3">
          The cycle reverts unless the maker ends above this figure.
        </p>
      </div>

      <div className="mt-4">
        <Rows>
          <DetailRow label="Principal" value={`${wbtc(principal)} WBTC`} />
          <DetailRow
            label="Expected final"
            value={`${wbtc(principal + grossProfit)} WBTC`}
          />
        </Rows>
      </div>
    </Panel>
  );
}
