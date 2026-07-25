"use client";

import { EvidencePanel } from "@/components/demo/evidence-panel";
import { StepRow } from "@/components/demo/step-row";
import { PageHeader } from "@/components/page-header";
import { useDemoRun } from "@/hooks/useDemoRun";
import { collectEvidence, countByStatus } from "@/lib/demo/demoMachine";
import { DEMO_STEPS, DEMO_STEP_LABELS } from "@/lib/demo/steps";

function Tally({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <p className={`font-mono text-lg tabular-nums ${tone}`}>{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

export function DemoClient() {
  const { state, run, reset } = useDemoRun();
  const counts = countByStatus(state);
  const evidence = collectEvidence(state, DEMO_STEP_LABELS);
  const finished = state.finishedAt !== null && !state.running;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Judge walkthrough"
        title="Deterministic demo"
        description="One click runs the whole Vortex sequence in order. Every step reports what it actually did — including the steps that cannot run yet, and exactly why."
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={state.running}
          aria-busy={state.running}
          className="rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state.running ? "Running…" : "Run the demo"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={state.running || state.startedAt === null}
          className="rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-zinc-200 transition hover:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Reset
        </button>
        <p className="text-xs text-zinc-600">
          Safe to run repeatedly — capability checks are read-only and consume
          nothing.
        </p>
      </div>

      {state.startedAt === null ? null : (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <Tally label="Succeeded" value={counts.success} tone="text-teal-400" />
          <Tally label="Blocked" value={counts.blocked} tone="text-amber-400" />
          <Tally label="Failed" value={counts.failure} tone="text-red-400" />
          <Tally
            label="Not started"
            value={counts.not_started + counts.running}
            tone="text-zinc-400"
          />
        </div>
      )}

      {finished && counts.blocked > 0 ? (
        <p className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span className="font-medium">
            {counts.blocked} step{counts.blocked === 1 ? "" : "s"} could not run.
          </span>{" "}
          Each one states the missing capability rather than being skipped
          silently or faked. Nothing below was simulated to make the run look
          complete.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <h2 className="mb-5 text-xs font-medium uppercase tracking-widest text-zinc-500">
            Sequence
          </h2>
          <ol>
            {DEMO_STEPS.map((step, index) => (
              <StepRow
                key={step.id}
                index={index}
                title={step.title}
                description={step.description}
                step={state.steps[step.id]}
              />
            ))}
          </ol>
        </section>

        <div className="space-y-6">
          <EvidencePanel entries={evidence} />

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
            <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
              CLI backup
            </h2>
            <p className="text-sm leading-relaxed text-zinc-400">
              If the browser fails during judging, the same sequence runs from a
              terminal against the same API and chain, so the walkthrough never
              depends on this page rendering.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-300">
              pnpm demo:run
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
