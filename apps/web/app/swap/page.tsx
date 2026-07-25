import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";

export const metadata: Metadata = {
  title: "Swap — Vortex",
  description:
    "Vortex Swap best execution: Aqua/SwapVM quotes benchmarked against the Uniswap API.",
};

const commonRows = ["Output", "Minimum output", "Gas", "Net output"] as const;
const aquaRows = [
  "Safety fee",
  "Commercial fee",
  "Inventory adjustment",
  "Maker coverage",
] as const;
const uniswapRows = ["API route", "Request ID"] as const;

function QuoteRows({ rows }: { rows: readonly string[] }) {
  return (
    <dl className="divide-y divide-zinc-800/60">
      {rows.map((row) => (
        <div key={row} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-sm text-zinc-400">{row}</dt>
          <dd className="font-mono text-sm tabular-nums text-zinc-500">—</dd>
        </div>
      ))}
    </dl>
  );
}

function VenueCard({
  name,
  note,
  extraLabel,
  extraRows,
}: {
  name: string;
  note: string;
  extraLabel: string;
  extraRows: readonly string[];
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <h3 className="text-lg font-semibold text-zinc-100">{name}</h3>
      <p className="mt-1 text-sm text-zinc-400">{note}</p>
      <div className="mt-4">
        <QuoteRows rows={commonRows} />
      </div>
      <p className="mt-5 text-xs font-medium uppercase tracking-widest text-zinc-500">
        {extraLabel}
      </p>
      <div className="mt-1">
        <QuoteRows rows={extraRows} />
      </div>
    </section>
  );
}

export default function SwapPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Vortex Swap"
        title="Swap"
        description="Every quote request is priced twice: once by the Vortex maker on Aqua/SwapVM, once by the Uniswap Trading API. The venue with the higher net output executes the trade."
        badge={<PhaseBadge phase={4} />}
      />

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Trade
            </h2>
            <PhaseBadge phase={4} />
          </div>

          <div className="mt-4 flex flex-col gap-4">
            <div>
              <label
                htmlFor="sell-amount"
                className="flex items-center justify-between text-sm text-zinc-400"
              >
                <span>Sell</span>
                <span className="font-medium text-zinc-100">WBTC</span>
              </label>
              <input
                id="sell-amount"
                type="text"
                inputMode="decimal"
                disabled
                placeholder="0.00000000"
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-lg tabular-nums text-zinc-100 placeholder:text-zinc-600 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label
                htmlFor="buy-amount"
                className="flex items-center justify-between text-sm text-zinc-400"
              >
                <span>Buy</span>
                <span className="font-medium text-zinc-100">USDC</span>
              </label>
              <input
                id="buy-amount"
                type="text"
                inputMode="decimal"
                disabled
                placeholder="0.00"
                className="mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2.5 font-mono text-lg tabular-nums text-zinc-100 placeholder:text-zinc-600 disabled:cursor-not-allowed"
              />
            </div>
            <p className="text-xs text-zinc-500">
              Exact input only — you specify the amount you sell; the quote
              determines what you receive.
            </p>
            <button
              type="button"
              disabled
              className="w-full rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Get best execution
            </button>
          </div>
        </section>

        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <VenueCard
              name="Aqua · SwapVM"
              note="Inventory-aware quote served by the Vortex maker strategy."
              extraLabel="Aqua details"
              extraRows={aquaRows}
            />
            <VenueCard
              name="Uniswap API"
              note="External benchmark quote with a ready-to-send transaction."
              extraLabel="Uniswap details"
              extraRows={uniswapRows}
            />
          </div>

          <section className="rounded-xl border border-teal-500/30 bg-teal-500/10 p-6">
            <h2 className="text-xs font-medium uppercase tracking-widest text-teal-400">
              Selected venue
            </h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-zinc-300">
              <li>
                The venue with the higher net output — output minus gas and fees
                — wins the comparison.
              </li>
              <li>
                When Aqua wins, the trade settles through SwapVM against the
                maker&rsquo;s inventory.
              </li>
              <li>
                When Uniswap wins, the app submits the exact transaction built by
                the Uniswap API, never a re-derived one.
              </li>
              <li>
                A Permit2 signature returned with a quote is bound to that quote
                and is never reused after a refresh.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
