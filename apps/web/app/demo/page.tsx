import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";

export const metadata: Metadata = {
  title: "Demo — Vortex",
  description: "The scripted judge demo: ten steps from seeded accounts to onchain proof.",
};

const steps = [
  "Seed accounts",
  "Ship Vortex Swap position",
  "Ship Vortex Grow position",
  "Show Vortex PermAMM price discrepancy",
  "Execute Aqua best-execution swap",
  "Show real Aqua token transfers",
  "Scan Grow opportunity",
  "Execute Grow cycle",
  "Show WBTC balance increase",
  "Show Uniswap request ID and transaction",
] as const;

export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Vortex"
        title="Demo"
        description="The judge demo runs these ten steps in order. Each step records the transaction hash and balance change it produces, so the whole story is verifiable onchain as it happens."
        badge={<PhaseBadge phase={8} />}
      />

      <ol className="mt-10 flex flex-col">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-4">
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className="mt-1.5 h-3 w-3 shrink-0 rounded-full border-2 border-zinc-600 bg-zinc-900"
              />
              {index < steps.length - 1 ? (
                <span aria-hidden="true" className="mt-1 w-px flex-1 bg-zinc-800" />
              ) : null}
            </div>
            <div className={index < steps.length - 1 ? "flex-1 pb-8" : "flex-1"}>
              <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
                Step {index + 1} · Pending
              </p>
              <h2 className="mt-1 text-base font-semibold text-zinc-100">{step}</h2>
              <dl className="mt-2 grid max-w-md grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs text-zinc-500">Tx hash</dt>
                  <dd className="font-mono text-xs tabular-nums text-zinc-500">—</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-xs text-zinc-500">Balance diff</dt>
                  <dd className="font-mono text-xs tabular-nums text-zinc-500">—</dd>
                </div>
              </dl>
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Backup plan
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
          A CLI backup runs the identical ten-step sequence. If the UI has a bad
          moment on stage, the same transactions execute from the terminal and
          the hashes tell the same story.
        </p>
      </section>
    </div>
  );
}
