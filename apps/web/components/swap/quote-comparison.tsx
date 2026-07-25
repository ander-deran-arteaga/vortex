import type { ReactNode } from "react";
import type {
  AquaComparison,
  ExchangeQuoteResponse,
  QuoteSource,
  UniswapComparison,
} from "@vortex/shared";
import { USDC } from "@vortex/shared";
import { SourceBadge } from "@/components/source-badge";
import { Panel, StatusMark } from "@/components/ui/primitives";
import type { DataSource } from "@/lib/api/source";
import { basisPointsToPercent, formatTokenAmount, truncateAddress } from "@/lib/format";
import { describeSelection, selectVenue } from "@/lib/swap-selection";

function usdc(value: string): string {
  return formatTokenAmount(BigInt(value), USDC.decimals, 2);
}

/**
 * The four rows both venues answer. They are rendered from ONE component so the
 * two cards cannot drift: identical labels at identical sizes means Output,
 * Minimum output, Est. gas and Net output land on the same baselines in both
 * columns, whatever each venue quoted.
 */
interface SharedLeg {
  amountOut: string;
  minimumAmountOut: string;
  estimatedGasUsd: string;
  netAmountOut: string;
}

/** A supporting row: label left, real data right. Never a mono label. */
function DetailRow({
  label,
  value,
  hint,
  quiet,
}: {
  label: string;
  value: string;
  hint?: string;
  /** The losing venue recedes in ink, but never below readable contrast. */
  quiet: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="min-w-0 text-sm text-say-2">
        {label}
        {hint === undefined ? null : (
          <span className="mt-0.5 block text-xs leading-snug text-say-3">{hint}</span>
        )}
      </dt>
      <dd className={`num shrink-0 text-sm ${quiet ? "text-say-2" : "text-say-1"}`}>
        {value}
      </dd>
    </div>
  );
}

function SharedRows({ leg, selected }: { leg: SharedLeg; selected: boolean }) {
  return (
    <dl className="divide-y divide-[rgba(255,238,222,0.05)]">
      <DetailRow label="Output" value={`${usdc(leg.amountOut)} USDC`} quiet={!selected} />
      <DetailRow
        label="Minimum output"
        value={`${usdc(leg.minimumAmountOut)} USDC`}
        quiet={!selected}
      />
      <DetailRow label="Est. gas" value={`$${leg.estimatedGasUsd}`} quiet={!selected} />

      {/*
        Net output decides the trade, so it is the one number on the card set
        at size. The unit steps down beside it: the amount is what you read.
      */}
      <div className="flex items-baseline justify-between gap-3 py-3">
        <dt className={`shrink-0 text-sm ${selected ? "text-cu" : "text-say-2"}`}>
          Net output
        </dt>
        <dd className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={`num truncate text-xl leading-none ${selected ? "text-say-1" : "text-say-2"}`}
          >
            {usdc(leg.netAmountOut)}
          </span>
          <span className="shrink-0 text-xs text-say-2">USDC</span>
        </dd>
      </div>
    </dl>
  );
}

/**
 * The card head is height-locked: a 24px title line over a 20px subtitle line
 * in every card, present or absent "Selected" marker. That is what keeps the
 * rows underneath on shared baselines instead of relying on matched copy.
 */
function VenueHead({
  title,
  subtitle,
  selected,
  source,
}: {
  title: string;
  subtitle: string;
  selected?: boolean;
  /** This venue's own provenance: the two legs of one response can differ. */
  source?: QuoteSource;
}) {
  return (
    <header className="mb-3">
      <div className="flex h-6 items-center justify-between gap-2">
        <h3
          className={`truncate text-[15px] leading-6 ${selected === true ? "text-say-1" : "text-say-2"}`}
        >
          {title}
        </h3>
        {selected === true ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-cu">
            <StatusMark tone="accent" />
            Selected
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex h-5 items-center justify-between gap-2">
        <p className="truncate text-[13px] leading-5 text-say-2">{subtitle}</p>
        {source === undefined ? null : (
          <span className="shrink-0">
            <SourceBadge source={source} />
          </span>
        )}
      </div>
    </header>
  );
}

function VenueCard({
  title,
  subtitle,
  selected,
  source,
  children,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  source: QuoteSource;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      /*
        The winner steps UP a tone, the loser steps DOWN below the panel it sits
        on. Two tonal moves, no glow, no lift, no bright edge on one side.
      */
      className={
        selected
          ? "panel-raised flex flex-col p-4"
          : "flex flex-col rounded-[4px] bg-ink-0 p-4"
      }
    >
      <VenueHead title={title} subtitle={subtitle} selected={selected} source={source} />
      {children}
    </section>
  );
}

function UnavailableCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col rounded-[4px] bg-ink-0 p-4"
    >
      <VenueHead title={title} subtitle={subtitle} />
      <p className="mt-1 text-sm text-say-2">No quote returned for this trade.</p>
      <p className="mt-2 text-xs leading-relaxed text-say-2">
        Nothing was priced here, so there is nothing to compare on this side.
      </p>
    </section>
  );
}

function AquaDetailRows({ aqua }: { aqua: AquaComparison }) {
  return (
    <dl className="mt-4 divide-y divide-[rgba(255,238,222,0.05)]">
      <DetailRow label="Safety fee" value={basisPointsToPercent(aqua.safetyFeeBps)} quiet />
      <DetailRow
        label="Commercial fee"
        value={basisPointsToPercent(aqua.commercialFeeBps)}
        quiet
      />
      <DetailRow
        label="Inventory adjustment"
        hint={aqua.inventoryAdjustmentBps < 0 ? "improves your price" : undefined}
        value={
          aqua.inventoryAdjustmentBps > 0
            ? `+${basisPointsToPercent(aqua.inventoryAdjustmentBps)}`
            : basisPointsToPercent(aqua.inventoryAdjustmentBps)
        }
        quiet
      />
      <DetailRow
        label="Maker coverage"
        value={basisPointsToPercent(aqua.makerCoverageBps)}
        quiet
      />
    </dl>
  );
}

function UniswapDetailRows({ uniswap }: { uniswap: UniswapComparison }) {
  return (
    <dl className="mt-4 divide-y divide-[rgba(255,238,222,0.05)]">
      <div className="flex items-baseline justify-between gap-4 py-2">
        <dt className="shrink-0 text-sm text-say-2">Request ID</dt>
        <dd
          className="num min-w-0 truncate text-sm text-say-2"
          title={uniswap.requestId ?? undefined}
        >
          {uniswap.requestId === undefined
            ? "none returned"
            : truncateAddress(uniswap.requestId)}
        </dd>
      </div>
    </dl>
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
    <Panel
      cut
      title="Venue comparison"
      aside={
        <div className="flex items-center gap-4">
          {secondsRemaining === null ? null : (
            <span
              /* Per-second value: never announced, or it interrupts every second. */
              aria-live="off"
              className={`text-sm tabular-nums ${
                expired ? "text-loss" : urgent ? "text-warn" : "text-say-2"
              }`}
            >
              {expired ? "Quote expired" : `Quote expires in ${secondsRemaining}s`}
            </span>
          )}
          <SourceBadge source={source} variant="response" />
        </div>
      }
    >
      {disagreement ? (
        <div
          role="alert"
          className="panel-raised mb-4 flex gap-3 p-4 text-sm leading-relaxed text-say-1"
        >
          <StatusMark tone="warn" className="mt-[7px] shrink-0" />
          <p>
            The venue with the higher net output is not the one the API marked
            for execution ({executingVenue}). Refresh the quote before
            executing.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {quote.comparison.aqua === null ? (
          <UnavailableCard title="Aqua · SwapVM" subtitle="Maker inventory" />
        ) : (
          <VenueCard
            title="Aqua · SwapVM"
            subtitle="Maker inventory"
            selected={selection.winner === "AQUA"}
            source={quote.comparison.aqua.source}
          >
            <SharedRows
              leg={quote.comparison.aqua}
              selected={selection.winner === "AQUA"}
            />
            <AquaDetailRows aqua={quote.comparison.aqua} />
          </VenueCard>
        )}
        {quote.comparison.uniswap === null ? (
          <UnavailableCard title="Uniswap API" subtitle="External liquidity" />
        ) : (
          <VenueCard
            title="Uniswap API"
            subtitle="External liquidity"
            selected={selection.winner === "UNISWAP"}
            source={quote.comparison.uniswap.source}
          >
            <SharedRows
              leg={quote.comparison.uniswap}
              selected={selection.winner === "UNISWAP"}
            />
            <UniswapDetailRows uniswap={quote.comparison.uniswap} />
          </VenueCard>
        )}
      </div>

      {/* The payoff line: the whole comparison resolved into one sentence. */}
      <div className="mt-6 flex items-baseline gap-3">
        <StatusMark tone={expired ? "muted" : "accent"} className="shrink-0" />
        <p className="min-w-0">
          <span className="text-sm text-say-2">Selected venue:</span>{" "}
          <span
            className={`text-lg font-medium ${expired ? "text-say-2" : "text-say-1"}`}
          >
            {describeSelection(selection)}
          </span>
          <span className="sr-only">
            {` Executing venue reported by the API: ${executingVenue}.`}
          </span>
        </p>
      </div>
    </Panel>
  );
}
