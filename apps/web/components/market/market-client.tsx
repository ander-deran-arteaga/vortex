"use client";

import { useMemo, useState } from "react";
import { DepthCurve, type Series } from "@/components/market/depth-curve";
import { SimulatedBadge } from "@/components/market/simulated-badge";
import { SpreadTable, type VenueRow } from "@/components/market/spread-table";
import { SpreadTimeline, type TimelineSeries } from "@/components/market/spread-timeline";
import { Page, PageHead, Panel, StatusMark } from "@/components/ui/primitives";
import { useMarketComparison } from "@/hooks/useMarketComparison";
import { binanceCurve, binanceSpreadAt } from "@/lib/market/binance";
import type { CurvePoint } from "@/lib/market/model";
import { tightestNow } from "@/lib/market/history";
import { simulatedDepthBps } from "@/lib/market/simulated";
import { SAMPLE_SIZES, SELECTABLE_SIZES } from "@/lib/market/vortex";
import { formatTokenAmount } from "@/lib/format";

const MAX_SIZE = SAMPLE_SIZES[SAMPLE_SIZES.length - 1] as bigint;

/** Two measured venues, one measured slowly, and one openly modelled. */
const TIMELINE_SERIES: TimelineSeries[] = [
  { key: "binance", name: "Binance", stroke: "var(--color-say-2)" },
  { key: "uniswap", name: "Uniswap", stroke: "var(--color-say-3)" },
  { key: "aqua", name: "Vortex Aqua", stroke: "var(--color-cu)" },
  {
    key: "permamm",
    name: "Vortex PermAMM",
    stroke: "var(--color-warn)",
    simulated: true,
  },
];

function ago(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  return seconds < 2 ? "just now" : `${seconds}s ago`;
}

/** A feed's own line: what it is, when it last answered, or why it did not. */
function FeedStatus({
  name,
  at,
  error,
  now,
}: {
  name: string;
  at: number | null;
  error: string | null;
  now: number;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
      <StatusMark tone={error !== null ? "loss" : at === null ? "muted" : "gain"} />
      <span className="text-say-2">{name}</span>
      {error !== null ? (
        <span className="text-loss">{error}</span>
      ) : at === null ? (
        <span className="text-say-3">waiting</span>
      ) : (
        <span className="num text-say-3">{ago(at, now)}</span>
      )}
    </p>
  );
}

export function MarketClient() {
  const [size, setSize] = useState<bigint>(SELECTABLE_SIZES[1] as bigint);
  const { history, book, binanceError, vortex, vortexError, loading } =
    useMarketComparison(size);

  // One clock for both "x seconds ago" labels, ticking with the faster feed.
  const now = book?.fetchedAt ?? Date.now();

  const modelledLatest = history.permamm[history.permamm.length - 1] ?? null;
  const simulatedHalfSpread = modelledLatest?.bps ?? 11;
  const selected = vortex?.samples.find((s) => s.size === size) ?? null;
  const binance = book === null ? null : binanceSpreadAt(book, size);
  const tightest = tightestNow(history, now);

  const rows: VenueRow[] = [
    {
      name: "Vortex Aqua",
      detail: "SwapVM against maker inventory",
      spread: selected?.aqua ?? null,
      note:
        selected?.aquaNote ??
        (vortexError !== null ? "The Vortex API is not answering." : "Sampling…"),
      source: selected?.aqua ? "live" : "unavailable",
    },
    {
      name: "Vortex PermAMM",
      detail: "Uniswap v4 pool behind the Vortex hook",
      spread: null,
      // Not a gap: the pool refuses to price for anyone without a signed
      // authorisation, which is the whole point of it. Quoting it from a
      // browser reverts with VortexHookDataRequired.
      note: "Prices only against a signed authorisation, so it cannot be quoted from a browser.",
      source: "unavailable",
    },
    {
      name: "Uniswap",
      detail: "Trade API, real WBTC/USDC",
      spread: selected?.uniswap ?? null,
      note:
        selected?.uniswapNote ??
        (vortexError !== null ? "The Vortex API is not answering." : "Sampling…"),
      source: selected?.uniswap ? "live" : "unavailable",
    },
    {
      name: "Binance",
      detail: "BTC/USDC order book, read in this browser",
      spread: binance,
      note:
        binanceError ??
        (book === null ? "Loading the book…" : "The book cannot fill this size."),
      source: binance === null ? "unavailable" : "live",
    },
  ];

  const series: Series[] = useMemo(() => {
    const out: Series[] = [];
    const toPoints = (
      pick: (s: NonNullable<typeof selected>) => { bidBps: number; askBps: number } | null,
    ): CurvePoint[] =>
      (vortex?.samples ?? []).flatMap((sample) => {
        const spread = pick(sample);
        return spread === null
          ? []
          : [
              { size: sample.size, bps: spread.bidBps, side: "bid" as const },
              { size: sample.size, bps: spread.askBps, side: "ask" as const },
            ];
      });

    const aqua = toPoints((s) => s.aqua);
    if (aqua.length > 0) {
      out.push({ name: "Vortex Aqua", points: aqua, stroke: "var(--color-cu)" });
    }
    const uniswap = toPoints((s) => s.uniswap);
    if (uniswap.length > 0) {
      out.push({
        name: "Uniswap",
        points: uniswap,
        stroke: "var(--color-say-3)",
        dashed: true,
      });
    }
    if (book !== null) {
      out.push({
        name: "Binance",
        points: binanceCurve(book, MAX_SIZE),
        stroke: "var(--color-say-2)",
      });
    }

    // The PermAMM cannot be quoted from a browser, so this is the designed
    // curve drawn from the model: concentrated liquidity is cheap to touch near
    // the mid and costs progressively more toward the edges. Dashed, badged,
    // and never mistakable for the measured lines beside it.
    const half = simulatedHalfSpread / 2;
    const modelled: CurvePoint[] = SAMPLE_SIZES.flatMap((sampleSize) => {
      const bps = simulatedDepthBps(sampleSize, MAX_SIZE, half);
      return [
        { size: sampleSize, bps: -bps, side: "bid" as const },
        { size: sampleSize, bps, side: "ask" as const },
      ];
    });
    out.push({
      name: "Vortex PermAMM (simulated)",
      points: modelled,
      stroke: "var(--color-warn)",
      dashed: true,
    });
    return out;
  }, [vortex, book, simulatedHalfSpread]);

  return (
    <Page>
      <PageHead
        title="Market comparison"
        lead="The same trade, priced at every venue, normalised to basis points of each venue's own mid."
      />

      {/*
        One line, not a paragraph. The full explanation lives in the tooltip and
        in each simulated series' own badge — but the fact that Vortex here is a
        model standing beside two measured books is stated before any number is
        read, because that is what makes the chart honest rather than a claim.
      */}
      <p
        className="mb-8 flex items-start gap-2 text-xs text-say-2"
        title="Binance and Uniswap are measured live. The Vortex series is generated from a model of the designed curve — it is not a record of quotes the PermAMM returned. Every figure is in basis points from each venue's own mid, so venues at different absolute prices stay comparable."
      >
        <StatusMark tone="warn" className="mt-[5px] shrink-0" />
        <span className="min-w-0">
          Binance and Uniswap are live. Vortex is a{" "}
          <span className="text-warn">model of the designed curve</span>, in bps
          from each venue&rsquo;s own mid.
        </span>
      </p>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-say-2">Size</span>
          <div role="group" aria-label="Trade size in WBTC" className="flex gap-1 rounded-[4px] bg-ink-1 p-1">
            {SELECTABLE_SIZES.map((option) => {
              const active = option === size;
              return (
                <button
                  key={String(option)}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSize(option)}
                  className={`num min-h-[44px] rounded-[3px] px-3.5 text-sm transition-colors duration-150 ${
                    active ? "bg-ink-3 text-cu" : "text-say-2 hover:text-say-1"
                  }`}
                >
                  {formatTokenAmount(option, 8, 3)}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-say-3">WBTC</span>
        </div>

        <div className="space-y-1.5">
          <FeedStatus
            name="Binance"
            at={book?.fetchedAt ?? null}
            error={binanceError}
            now={now}
          />
          <FeedStatus
            name="Vortex API"
            at={vortex?.sampledAt ?? null}
            error={vortexError}
            now={now}
          />
        </div>
      </div>

      <div className="space-y-6">
        <Panel
          title="Spread over the last minute"
          aside={<SimulatedBadge className="max-w-[22rem]" />}
        >
          <SpreadTimeline
            history={history}
            series={TIMELINE_SERIES}
            tightest={tightest}
            now={now}
          />
          <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
            {TIMELINE_SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-2 text-say-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-0.5 w-5 rounded-full"
                  style={{ background: s.stroke, opacity: s.simulated === true ? 0.75 : 1 }}
                />
                {s.name}
                {tightest === s.key ? <span className="text-cu">tightest</span> : null}
              </span>
            ))}
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-say-2">
            Binance and Uniswap are the real readings already on this page, kept
            for a minute. The PermAMM line is modelled: it prices only against a
            signed authorisation, so no browser can measure it, and there is no
            historical quote store to read it from.
          </p>
        </Panel>

        <Panel cut title="Spread by venue">
          <SpreadTable rows={rows} size={size} />
        </Panel>

        <Panel title="Where size costs you">
          {loading && series.length === 0 ? (
            <p className="px-1 py-10 text-center text-sm text-say-2">
              Sampling both books…
            </p>
          ) : (
            <>
              <DepthCurve series={series} maxSize={MAX_SIZE} />
              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                {series.map((s) => (
                  <span key={s.name} className="flex items-center gap-2 text-say-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-0.5 w-5 rounded-full"
                      style={{
                        background: s.stroke,
                        opacity: s.dashed === true ? 0.7 : 1,
                      }}
                    />
                    {s.name}
                  </span>
                ))}
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-say-2">
                A line that rises straight up is a venue holding its price as the
                size grows; one that leans outward is charging more for size.
                Binance is vertical here — its top of book absorbs every size on
                this chart without moving — and Uniswap barely leans. Vortex
                leans the most: the inventory adjustment widens the quote as the
                size grows, which is a maker with a two-WBTC book protecting it.
                That is the honest shape, and it is the number the comparison on
                the swap page has to beat.
              </p>
            </>
          )}
        </Panel>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-say-3">
        Sizes stop at {formatTokenAmount(MAX_SIZE, 8, 2)} WBTC because the
        maker&rsquo;s per-trade cap refuses more, and a chart of refusals teaches
        nothing. Binance is read directly from this browser; nothing here is
        proxied, cached or substituted, and a feed that cannot answer says so.
      </p>
    </Page>
  );
}
