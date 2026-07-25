import { describe, expect, it } from "vitest";
import {
  DEMO_STEP_IDS,
  collectEvidence,
  countByStatus,
  demoReducer,
  initialDemoRun,
  type DemoRunState,
} from "@/lib/demo/demoMachine";
import { DEMO_STEP_LABELS } from "@/lib/demo/steps";

const AT = 1_800_000_000_000;

function started(): DemoRunState {
  return demoReducer(initialDemoRun, { type: "RUN_STARTED", at: AT });
}

describe("demo run state", () => {
  it("covers the ten spec steps", () => {
    expect(DEMO_STEP_IDS).toHaveLength(10);
    expect(Object.keys(initialDemoRun.steps)).toHaveLength(10);
  });

  it("starts with every step not started", () => {
    expect(countByStatus(initialDemoRun).not_started).toBe(10);
    expect(initialDemoRun.running).toBe(false);
  });

  it("clears prior results when a new run starts", () => {
    let state = started();
    state = demoReducer(state, {
      type: "STEP_SUCCEEDED",
      id: "scanGrow",
      outcome: { detail: "found" },
    });
    expect(state.steps.scanGrow.status).toBe("success");

    const rerun = demoReducer(state, { type: "RUN_STARTED", at: AT + 1000 });
    // A second run must not show the first run's results as if they were fresh.
    expect(rerun.steps.scanGrow.status).toBe("not_started");
    expect(rerun.steps.scanGrow.detail).toBeUndefined();
    expect(rerun.startedAt).toBe(AT + 1000);
  });

  it("tracks the running step and clears it when the run finishes", () => {
    let state = demoReducer(started(), { type: "STEP_STARTED", id: "seed" });
    expect(state.currentStep).toBe("seed");
    expect(state.steps.seed.status).toBe("running");

    state = demoReducer(state, { type: "RUN_FINISHED", at: AT + 5000 });
    expect(state.currentStep).toBeNull();
    expect(state.running).toBe(false);
    expect(state.finishedAt).toBe(AT + 5000);
  });

  it("keeps blocked distinct from failure", () => {
    let state = started();
    state = demoReducer(state, {
      type: "STEP_BLOCKED",
      id: "executeSwap",
      reason: "route not registered",
    });
    state = demoReducer(state, {
      type: "STEP_FAILED",
      id: "uniswapEvidence",
      reason: "quote failed",
    });

    // A missing capability must never read as a bug, or vice versa.
    expect(state.steps.executeSwap.status).toBe("blocked");
    expect(state.steps.uniswapEvidence.status).toBe("failure");
    const counts = countByStatus(state);
    expect(counts.blocked).toBe(1);
    expect(counts.failure).toBe(1);
  });

  it("clears a stale reason when a step restarts", () => {
    let state = started();
    state = demoReducer(state, {
      type: "STEP_BLOCKED",
      id: "seed",
      reason: "not registered",
    });
    state = demoReducer(state, { type: "STEP_STARTED", id: "seed" });
    expect(state.steps.seed.reason).toBeUndefined();
  });

  it("resets to a clean slate", () => {
    let state = started();
    state = demoReducer(state, {
      type: "STEP_SUCCEEDED",
      id: "seed",
      outcome: { txHash: "0xabc" },
    });
    expect(demoReducer(state, { type: "RESET" })).toEqual(initialDemoRun);
  });
});

describe("evidence collection", () => {
  it("lists only what a step actually observed", () => {
    let state = started();
    state = demoReducer(state, {
      type: "STEP_SUCCEEDED",
      id: "uniswapEvidence",
      outcome: { uniswapRequestId: "req-123", source: "live" },
    });
    state = demoReducer(state, {
      type: "STEP_BLOCKED",
      id: "executeSwap",
      reason: "no builder",
    });

    const evidence = collectEvidence(state, DEMO_STEP_LABELS);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      stepId: "uniswapEvidence",
      uniswapRequestId: "req-123",
      source: "live",
    });
    // A blocked step contributes nothing — an empty panel is the honest answer.
    expect(evidence.some((entry) => entry.stepId === "executeSwap")).toBe(false);
  });

  it("carries a transaction hash when one exists", () => {
    const state = demoReducer(started(), {
      type: "STEP_SUCCEEDED",
      id: "executeGrow",
      outcome: { txHash: "0xdeadbeef" },
    });
    expect(collectEvidence(state, DEMO_STEP_LABELS)[0]).toMatchObject({
      txHash: "0xdeadbeef",
    });
  });

  it("is empty before anything runs", () => {
    expect(collectEvidence(initialDemoRun, DEMO_STEP_LABELS)).toEqual([]);
  });
});
