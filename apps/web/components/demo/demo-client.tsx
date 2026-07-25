"use client";

import { EvidencePanel } from "@/components/demo/evidence-panel";
import { StepRow } from "@/components/demo/step-row";
import {
  Action,
  Page,
  PageHead,
  Panel,
  QuietAction,
  StatusMark,
} from "@/components/ui/primitives";
import { useDemoRun } from "@/hooks/useDemoRun";
import { collectEvidence, countByStatus } from "@/lib/demo/demoMachine";
import { DEMO_STEPS, DEMO_STEP_LABELS } from "@/lib/demo/steps";

/** A count is real data, so it is set in mono and it is the loudest thing here. */
function Tally({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="panel px-5 py-4">
      <p className={`num text-[2rem] leading-none ${tone}`}>{value}</p>
      <p className="mt-2.5 text-sm text-say-2">{label}</p>
    </div>
  );
}

export function DemoClient() {
  const { state, run, reset } = useDemoRun();
  const counts = countByStatus(state);
  const evidence = collectEvidence(state, DEMO_STEP_LABELS);
  const finished = state.finishedAt !== null && !state.running;

  return (
    <Page>
      <PageHead
        title="Deterministic demo"
        lead="One click runs the whole Vortex sequence in order. Every step reports what it actually did, including the steps that cannot run yet and exactly why."
        aside={
          <div className="flex w-full flex-col items-start gap-3 sm:w-auto sm:items-end">
            <div className="flex flex-wrap items-center gap-5">
              <Action
                onClick={() => void run()}
                disabled={state.running}
                busy={state.running}
              >
                {state.running ? "Running…" : "Run the demo"}
              </Action>
              <QuietAction
                onClick={reset}
                disabled={state.running || state.startedAt === null}
              >
                Reset
              </QuietAction>
            </div>
            <p className="max-w-[20rem] text-xs leading-relaxed text-say-3 sm:text-right">
              Safe to run repeatedly: capability checks are read-only and consume
              nothing.
            </p>
          </div>
        }
      />

      {state.startedAt === null ? null : (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <Tally label="Succeeded" value={counts.success} tone="text-gain" />
          <Tally label="Blocked" value={counts.blocked} tone="text-warn" />
          <Tally label="Failed" value={counts.failure} tone="text-loss" />
          <Tally
            label="Not started"
            value={counts.not_started + counts.running}
            tone="text-say-3"
          />
        </div>
      )}

      {finished && counts.blocked > 0 ? (
        <div className="panel-raised mb-6 flex gap-3 p-4 text-sm leading-relaxed text-say-2">
          <StatusMark tone="warn" className="mt-[7px] shrink-0" />
          <p>
            <span className="text-warn">
              {counts.blocked} step{counts.blocked === 1 ? "" : "s"} could not run.
            </span>{" "}
            Each one states the missing capability rather than being skipped
            silently or faked. Nothing below was simulated to make the run look
            complete.
          </p>
        </div>
      ) : null}

      {finished && counts.failure > 0 ? (
        <div
          role="alert"
          className="panel-raised mb-6 flex gap-3 p-4 text-sm leading-relaxed text-say-2"
        >
          <StatusMark tone="loss" className="mt-[7px] shrink-0" />
          <p>
            <span className="text-loss">
              {counts.failure} step{counts.failure === 1 ? "" : "s"} ran and did
              not work.
            </span>{" "}
            The line under each one is the API&rsquo;s own error code and message,
            quoted verbatim.
          </p>
        </div>
      ) : null}

      <Panel
        title="Sequence"
        aside={<span className="text-xs text-say-3">Runs in order, top to bottom</span>}
      >
        <ol className="divide-y divide-[rgba(255,238,222,0.05)]">
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
      </Panel>

      {/*
        Evidence takes two of the three columns: the request IDs and hashes are
        the artifact a sponsor came to see, and they need room to sit unwrapped.
      */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="lg:col-span-2">
          <EvidencePanel entries={evidence} />
        </div>

        <Panel title="CLI backup">
          <p className="text-sm leading-relaxed text-say-2">
            If the browser fails during judging, the same sequence runs from a
            terminal against the same API and the same chain, so the walkthrough
            never depends on this page rendering.
          </p>
          <div className="panel-raised mt-4 overflow-x-auto px-3.5 py-3">
            <pre className="num text-xs text-say-1">pnpm demo:run</pre>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
