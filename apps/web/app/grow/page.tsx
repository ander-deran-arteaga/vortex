import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";

export const metadata: Metadata = {
  title: "Grow — Vortex",
  description:
    "Vortex Grow: same-asset compounding of maker WBTC through one atomic cycle.",
};

const opportunityRows = [
  "Principal",
  "Route",
  "Bridge amount",
  "Expected final",
  "Minimum final",
  "Minimum maker profit",
  "Performance fee",
  "Expiry",
] as const;

const invariants = [
  {
    name: "Atomic all-or-nothing",
    detail:
      "The entire cycle is a single transaction. If any leg fails, every leg unwinds.",
  },
  {
    name: "Profit floor enforced onchain",
    detail:
      "The cycle succeeds only if the final WBTC balance exceeds the initial WBTC balance. Anything less reverts.",
  },
  {
    name: "Fee only from realized profit",
    detail:
      "The performance fee is taken from realized profit, never from principal.",
  },
  {
    name: "Principal stays accounted for",
    detail:
      "Principal never leaves custody mid-cycle unreturned — it is pulled and pushed back within the same transaction.",
  },
] as const;

function FlowBox({
  title,
  detail,
  accent = false,
}: {
  title: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`w-full max-w-md rounded-lg border px-4 py-3 text-center ${
        accent
          ? "border-teal-500/30 bg-teal-500/10"
          : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <p className={`text-sm font-medium ${accent ? "text-teal-400" : "text-zinc-100"}`}>
        {title}
      </p>
      {detail ? <p className="mt-0.5 text-xs text-zinc-400">{detail}</p> : null}
    </div>
  );
}

function FlowEdge({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-1">
      <span className="text-xs font-medium uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <span aria-hidden="true" className="text-zinc-600">
        ↓
      </span>
    </div>
  );
}

export default function GrowPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Vortex Grow"
        title="Grow WBTC"
        description="Only execute when the position ends with more WBTC. A custom Aqua app temporarily pulls maker WBTC, runs one atomic cycle across the Vortex PermAMM and an external venue, and returns principal plus profit."
        badge={<PhaseBadge phase={6} />}
      />

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
              Opportunity
            </h2>
            <PhaseBadge phase={6} />
          </div>
          <dl className="mt-4 divide-y divide-zinc-800/60">
            {opportunityRows.map((row) => (
              <div key={row} className="flex items-center justify-between gap-4 py-2">
                <dt className="text-sm text-zinc-400">{row}</dt>
                <dd className="font-mono text-sm tabular-nums text-zinc-500">—</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            disabled
            className="mt-5 w-full rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Scan for opportunity
          </button>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
            Cycle route
          </h2>
          <div className="mt-4 overflow-x-auto">
            <div className="flex min-w-0 flex-col items-center">
              <FlowBox title="Aqua maker" detail="Custodies the WBTC principal" />
              <FlowEdge label="pull" />
              <FlowBox
                title="Vortex Grow app"
                detail="Orchestrates the atomic cycle"
              />
              <FlowEdge label="leg 1" />
              <FlowBox title="Vortex PermAMM" detail="WBTC → USDC" />
              <FlowEdge label="leg 2" />
              <FlowBox
                title="External venue (Uniswap API route)"
                detail="USDC → WBTC"
              />
              <FlowEdge label="check" />
              <FlowBox
                accent
                title="Profit check"
                detail={`final WBTC ${">"} initial WBTC or the whole transaction reverts`}
              />
              <FlowEdge label="fee" />
              <FlowBox
                title="Performance fee"
                detail="Taken from realized profit only"
              />
              <FlowEdge label="push" />
              <FlowBox
                title="Aqua maker"
                detail="Principal + profit returned"
              />
            </div>
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Invariants
        </h2>
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {invariants.map((invariant) => (
            <li
              key={invariant.name}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            >
              <p className="text-sm font-medium text-zinc-100">{invariant.name}</p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                {invariant.detail}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
