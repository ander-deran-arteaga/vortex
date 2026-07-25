import type { AquaComparison, ExchangeQuoteResponse, UniswapComparison } from "@vortex/shared";
import { USDC } from "@vortex/shared";
import { SourceBadge } from "@/components/source-badge";
import type { DataSource } from "@/lib/api/source";
import { basisPointsToPercent, formatTokenAmount, truncateAddress } from "@/lib/format";
import { describeSelection, selectVenue } from "@/lib/swap-selection";

function usdc(value: string): string {
  return formatTokenAmount(BigInt(value), USDC.decimals, 2);
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-zinc-400">
        {label}
        {hint ? <span className="ml-1 text-xs text-zinc-600">{hint}</span> : null}
      </dt>
      <dd className="font-mono text-sm tabular-nums text-zinc-100">{value}</dd>
    </div>
  );
}

function VenueCard({
  title, subtitle, selected, children,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={
        selected
          ? "rounded-xl border border-teal-500/50 bg-teal-500/[0.04] p-5"
          : "rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 opacity-70"
      }
    >
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
          <p className="text-xs text-zinc-500">{subtitle}</p>
        </div>
        {selected ? (
          <span className="rounded-full border border-teal-500/40 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-400">
            Selected
          </span>
        ) : null}
      </header>
      <dl className="divide-y divide-zinc-800/70">{children}</dl>
    </section>
  );
}

function UnavailableCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 p-5"
    >
      <h3 className="text-sm font-medium text-zinc-300">{title}</h3>
      <p className="text-xs text-zinc-500">{subtitle}</p>
      <p className="mt-4 text-sm text-zinc-500">
        No quote returned for this trade.
      </p>
    </section>
  );
}

function AquaRows({ aqua }: { aqua: AquaComparison }) {
  return (
    <>
      <Row label="Output" value={`${usdc(aqua.amountOut)} USDC`} />
      <Row label="Minimum output" value={`${usdc(aqua.minimumAmountOut)} USDC`} />
      <Row label="Est. gas" value={`$${aqua.estimatedGasUsd}`} />
      <Row label="Net output" value={`${usdc(aqua.netAmountOut)} USDC`} />
      <Row label="Safety fee" value={basisPointsToPercent(aqua.safetyFeeBps)} />
      <Row label="Commercial fee" value={basisPointsToPercent(aqua.commercialFeeBps)} />
      <Row
        label="Inventory adjustment"
        hint={aqua.inventoryAdjustmentBps < 0 ? "(improves your price)" : undefined}
        value={
          aqua.inventoryAdjustmentBps > 0
            ? `+${basisPointsToPercent(aqua.inventoryAdjustmentBps)}`
            : basisPointsToPercent(aqua.inventoryAdjustmentBps)
        }
      />
      <Row label="Maker coverage" value={basisPointsToPercent(aqua.makerCoverageBps)} />
    </>
  );
}

function UniswapRows({ uniswap }: { uniswap: UniswapComparison }) {
  return (
    <>
      <Row label="Output" value={`${usdc(uniswap.amountOut)} USDC`} />
      <Row label="Minimum output" value={`${usdc(uniswap.minimumAmountOut)} USDC`} />
      <Row label="Est. gas" value={`$${uniswap.estimatedGasUsd}`} />
      <Row label="Net output" value={`${usdc(uniswap.netAmountOut)} USDC`} />
      <div className="flex items-baseline justify-between gap-4 py-1.5">
        <dt className="text-sm text-zinc-400">Request ID</dt>
        <dd
          className="font-mono text-sm tabular-nums text-zinc-100"
          title={uniswap.requestId ?? undefined}
        >
          {uniswap.requestId === undefined ? "—" : truncateAddress(uniswap.requestId)}
        </dd>
      </div>
    </>
  );
}

export function QuoteComparison({
  quote,
  source,
  secondsRemaining,
}: {
  quote: ExchangeQuoteResponse;
  source: DataSource;
  secondsRemaining: number | null;
}) {
  const selection = selectVenue(quote);
  // quote.selectedVenue is what the backend will actually execute; the locally
  // computed winner is a cross-check. If they disagree, say so rather than
  // silently highlighting one and executing the other.
  const executingVenue = quote.selectedVenue;
  const disagreement =
    !selection.uncontested &&
    selection.winner !== null &&
    selection.winner !== executingVenue;
  const expired = secondsRemaining !== null && secondsRemaining === 0;
  const urgent = secondsRemaining !== null && secondsRemaining > 0 && secondsRemaining <= 10;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Venue comparison
        </h2>
        <div className="flex items-center gap-3">
          {secondsRemaining === null ? null : (
            <span
              aria-live="off"
              className={
                expired
                  ? "text-xs font-medium text-red-400"
                  : urgent
                    ? "text-xs font-medium text-amber-400"
                    : "text-xs text-zinc-400"
              }
            >
              {expired ? "Quote expired" : `Quote expires in ${secondsRemaining}s`}
            </span>
          )}
          <SourceBadge source={source} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {disagreement ? (
          <p
            role="alert"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 md:col-span-2"
          >
            The venue with the higher net output is not the one the API marked
            for execution ({executingVenue}). Refresh the quote before
            executing.
          </p>
        ) : null}
        {quote.comparison.aqua === null ? (
          <UnavailableCard title="Aqua · SwapVM" subtitle="Maker inventory" />
        ) : (
          <VenueCard
            title="Aqua · SwapVM"
            subtitle="Maker inventory"
            selected={selection.winner === "AQUA"}
          >
            <AquaRows aqua={quote.comparison.aqua} />
          </VenueCard>
        )}
        {quote.comparison.uniswap === null ? (
          <UnavailableCard title="Uniswap API" subtitle="External liquidity" />
        ) : (
          <VenueCard
            title="Uniswap API"
            subtitle="External liquidity"
            selected={selection.winner === "UNISWAP"}
          >
            <UniswapRows uniswap={quote.comparison.uniswap} />
          </VenueCard>
        )}
      </div>

      <p
        className={
          expired
            ? "rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-500"
            : "rounded-xl border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300"
        }
      >
        <span className="font-medium">Selected venue: </span>
        {describeSelection(selection)}
        <span className="sr-only">
          {` Executing venue reported by the API: ${executingVenue}.`}
        </span>
      </p>
    </div>
  );
}
