import type { DataSource } from "@/lib/api/source";

export const DEMO_STEP_IDS = [
  "seed",
  "shipSwap",
  "shipGrow",
  "permammDiscrepancy",
  "executeSwap",
  "aquaTransfers",
  "scanGrow",
  "executeGrow",
  "wbtcIncrease",
  "uniswapEvidence",
] as const;

export type DemoStepId = (typeof DEMO_STEP_IDS)[number];

/**
 * `blocked` is deliberately distinct from `failure`. A blocked step is one whose
 * dependency does not exist yet (an unregistered route, an undeployed
 * contract); a failed step is one that ran and did not work. Collapsing them
 * would let a missing capability read as a bug, or worse, let a judge think a
 * step was attempted when nothing was.
 */
export type DemoStepStatus =
  | "not_started"
  | "running"
  | "success"
  | "failure"
  | "blocked"
  | "skipped";

export interface BalanceDelta {
  label: string;
  symbol: string;
  decimals: number;
  before: bigint;
  after: bigint;
}

export interface DemoStepOutcome {
  /** One line on what actually happened. */
  detail?: string;
  /** Why it could not run (blocked) or why it did not work (failure). */
  reason?: string;
  txHash?: string;
  uniswapRequestId?: string;
  deltas?: BalanceDelta[];
  /** Provenance of whatever this step observed. */
  source?: DataSource;
}

export interface DemoStepState extends DemoStepOutcome {
  id: DemoStepId;
  status: DemoStepStatus;
}

export interface DemoRunState {
  running: boolean;
  currentStep: DemoStepId | null;
  steps: Record<DemoStepId, DemoStepState>;
  startedAt: number | null;
  finishedAt: number | null;
}

export type DemoEvent =
  | { type: "RUN_STARTED"; at: number }
  | { type: "STEP_STARTED"; id: DemoStepId }
  | { type: "STEP_SUCCEEDED"; id: DemoStepId; outcome: DemoStepOutcome }
  | { type: "STEP_BLOCKED"; id: DemoStepId; reason: string }
  | { type: "STEP_FAILED"; id: DemoStepId; reason: string }
  | { type: "STEP_SKIPPED"; id: DemoStepId; reason: string }
  | { type: "RUN_FINISHED"; at: number }
  | { type: "RESET" };

function freshSteps(): Record<DemoStepId, DemoStepState> {
  return DEMO_STEP_IDS.reduce(
    (acc, id) => {
      acc[id] = { id, status: "not_started" };
      return acc;
    },
    {} as Record<DemoStepId, DemoStepState>,
  );
}

export const initialDemoRun: DemoRunState = {
  running: false,
  currentStep: null,
  steps: freshSteps(),
  startedAt: null,
  finishedAt: null,
};

function withStep(
  state: DemoRunState,
  id: DemoStepId,
  patch: Partial<DemoStepState>,
): DemoRunState {
  const previous = state.steps[id];
  return {
    ...state,
    steps: { ...state.steps, [id]: { ...previous, ...patch, id } },
  };
}

/** Pure — timestamps arrive inside events so this stays testable. */
export function demoReducer(state: DemoRunState, event: DemoEvent): DemoRunState {
  switch (event.type) {
    case "RUN_STARTED":
      return {
        ...initialDemoRun,
        steps: freshSteps(),
        running: true,
        startedAt: event.at,
      };
    case "STEP_STARTED":
      return {
        ...withStep(state, event.id, { status: "running", reason: undefined }),
        currentStep: event.id,
      };
    case "STEP_SUCCEEDED":
      return withStep(state, event.id, { status: "success", ...event.outcome });
    case "STEP_BLOCKED":
      return withStep(state, event.id, { status: "blocked", reason: event.reason });
    case "STEP_FAILED":
      return withStep(state, event.id, { status: "failure", reason: event.reason });
    case "STEP_SKIPPED":
      return withStep(state, event.id, { status: "skipped", reason: event.reason });
    case "RUN_FINISHED":
      return { ...state, running: false, currentStep: null, finishedAt: event.at };
    case "RESET":
      return { ...initialDemoRun, steps: freshSteps() };
    default:
      return state;
  }
}

export function countByStatus(
  state: DemoRunState,
): Record<DemoStepStatus, number> {
  const counts: Record<DemoStepStatus, number> = {
    not_started: 0,
    running: 0,
    success: 0,
    failure: 0,
    blocked: 0,
    skipped: 0,
  };
  for (const id of DEMO_STEP_IDS) {
    const step = state.steps[id];
    counts[step.status] += 1;
  }
  return counts;
}

/** Every request ID and transaction hash the run actually observed. */
export interface EvidenceEntry {
  stepId: DemoStepId;
  label: string;
  uniswapRequestId?: string;
  txHash?: string;
  source?: DataSource;
}

export function collectEvidence(
  state: DemoRunState,
  labels: Record<DemoStepId, string>,
): EvidenceEntry[] {
  return DEMO_STEP_IDS.flatMap((id) => {
    const step = state.steps[id];
    if (step.uniswapRequestId === undefined && step.txHash === undefined) {
      return [];
    }
    return [
      {
        stepId: id,
        label: labels[id],
        ...(step.uniswapRequestId === undefined
          ? {}
          : { uniswapRequestId: step.uniswapRequestId }),
        ...(step.txHash === undefined ? {} : { txHash: step.txHash }),
        ...(step.source === undefined ? {} : { source: step.source }),
      },
    ];
  });
}
