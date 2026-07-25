import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";

export const metadata: Metadata = {
  title: "Maker — Vortex",
  description:
    "Configure and ship the Vortex Swap and Vortex Grow maker positions.",
};

const swapFields = [
  "WBTC allocated",
  "USDC allocated",
  "Target weight",
  "Maximum trade",
  "Safety fee floor",
  "Commercial fee",
  "Inventory strength",
  "Hard weight bounds",
  "Strategy expiry",
] as const;

const swapSteps = [
  "Approve WBTC",
  "Approve USDC",
  "Build strategy",
  "Ship strategy",
  "Read strategy hash",
  "Active",
] as const;

const growFields = [
  "Maximum WBTC per execution",
  "Minimum profit",
  "Performance fee",
  "Maximum slippage",
  "Strategy expiry",
] as const;

const growSteps = [
  "Approve WBTC",
  "Ship strategy",
  "Strategy hash",
  "Balances",
] as const;

const coverageColumns = [
  "Virtual (Aqua)",
  "Wallet balance",
  "Aqua allowance",
  "Executable",
] as const;

const coverageTokens = ["WBTC", "USDC"] as const;

function FieldList({ fields }: { fields: readonly string[] }) {
  return (
    <dl className="divide-y divide-zinc-800/60">
      {fields.map((field) => (
        <div key={field} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-sm text-zinc-400">{field}</dt>
          <dd className="font-mono text-sm tabular-nums text-zinc-500">—</dd>
        </div>
      ))}
    </dl>
  );
}

function StepList({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2 text-xs text-zinc-400">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center">
          <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1">
            {step}
          </span>
          {index < steps.length - 1 ? (
            <span aria-hidden="true" className="px-1.5 text-zinc-600">
              →
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function StrategyCard({
  title,
  subtitle,
  fields,
  steps,
}: {
  title: string;
  subtitle: string;
  fields: readonly string[];
  steps: readonly string[];
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
        <PhaseBadge phase={4} />
      </div>
      <p className="mt-1 text-sm text-zinc-400">{subtitle}</p>
      <div className="mt-4">
        <FieldList fields={fields} />
      </div>
      <p className="mt-5 text-xs font-medium uppercase tracking-widest text-zinc-500">
        Shipping flow
      </p>
      <div className="mt-2">
        <StepList steps={steps} />
      </div>
    </section>
  );
}

const coverageTones = {
  teal: "border-teal-500/30 bg-teal-500/10 text-teal-400",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  zinc: "border-zinc-800 bg-zinc-900 text-zinc-400",
} as const;

function CoverageBadge({
  tone,
  children,
}: {
  tone: keyof typeof coverageTones;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${coverageTones[tone]}`}
    >
      {children}
    </span>
  );
}

export default function MakerPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Vortex"
        title="Maker"
        description="Ship the two maker positions that power everything else: a Vortex Swap strategy that serves inventory-aware quotes, and a Vortex Grow strategy that lets the compounding cycle borrow maker WBTC atomically."
        badge={<PhaseBadge phase={4} />}
      />

      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
        <StrategyCard
          title="Vortex Swap — WBTC/USDC"
          subtitle="Inventory-aware market-making strategy on Aqua/SwapVM. Parameters below populate once the shipping flow is live."
          fields={swapFields}
          steps={swapSteps}
        />
        <StrategyCard
          title="Vortex Grow — WBTC"
          subtitle="Grants the Vortex Grow app permission to pull WBTC for one atomic compounding cycle at a time."
          fields={growFields}
          steps={growSteps}
        />
      </div>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-zinc-100">Balance coverage</h2>
          <PhaseBadge phase={4} />
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">
          Aqua positions are virtual: shipping a strategy locks nothing. For each
          token, three numbers matter — the virtual balance the Aqua position
          declares, the actual balance sitting in the maker wallet, and the Aqua
          allowance granted on that token. The executable balance is the minimum
          of the three: quotes are only fillable up to that amount.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="py-2 pr-4 text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Token
                </th>
                {coverageColumns.map((column) => (
                  <th
                    key={column}
                    className="py-2 pr-4 text-xs font-medium uppercase tracking-widest text-zinc-500"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverageTokens.map((token) => (
                <tr key={token} className="border-b border-zinc-800/60 last:border-b-0">
                  <td className="py-3 pr-4 font-medium text-zinc-100">{token}</td>
                  {coverageColumns.map((column) => (
                    <td
                      key={column}
                      className="py-3 pr-4 font-mono tabular-nums text-zinc-500"
                    >
                      —
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-6 text-xs font-medium uppercase tracking-widest text-zinc-500">
          Coverage states
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-zinc-400">
          <li className="flex flex-wrap items-center gap-3">
            <CoverageBadge tone="teal">Fully covered</CoverageBadge>
            <span>
              Executable balance covers the entire virtual position — every quote
              is fillable.
            </span>
          </li>
          <li className="flex flex-wrap items-center gap-3">
            <CoverageBadge tone="amber">Partially covered</CoverageBadge>
            <span>
              Executable balance covers only part of the virtual position —
              oversized fills would fail.
            </span>
          </li>
          <li className="flex flex-wrap items-center gap-3">
            <CoverageBadge tone="zinc">Offline</CoverageBadge>
            <span>
              No executable balance — wallet balance or allowance is zero, so no
              quotes are served.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
