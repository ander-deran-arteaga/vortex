import { describe, expect, it } from "vitest";
import {
  GROW_TRANSITIONS,
  canSendGrow,
  growReducer,
  initialGrowSnapshot,
  type GrowEvent,
  type GrowEventType,
  type GrowSnapshot,
  type GrowState,
} from "@/lib/machines/growMachine";

const ALL_EVENT_TYPES: GrowEventType[] = [
  "SCAN",
  "OPPORTUNITY_FOUND",
  "NOTHING_FOUND",
  "SCAN_FAILURE",
  "PREPARE",
  "REFRESH",
  "OPPORTUNITY_EXPIRED",
  "ROUTE_READY",
  "ROUTE_FAILURE",
  "SIMULATION_SUCCESS",
  "SIMULATION_FAILURE",
  "EXECUTION_CONFIRMED",
  "EXECUTION_FAILURE",
  "RESET",
];

const ALL_STATES = Object.keys(GROW_TRANSITIONS) as GrowState[];

function makeEvent(type: GrowEventType): GrowEvent {
  switch (type) {
    case "OPPORTUNITY_FOUND":
      return { type, opportunityId: "op-1" };
    case "EXECUTION_CONFIRMED":
      return { type, txHash: "0xhash" };
    case "SCAN_FAILURE":
    case "ROUTE_FAILURE":
    case "SIMULATION_FAILURE":
    case "EXECUTION_FAILURE":
      return { type, reason: "boom" };
    default:
      return { type } as GrowEvent;
  }
}

function snapshotIn(state: GrowState): GrowSnapshot {
  return { ...initialGrowSnapshot, state };
}

describe("grow machine shape", () => {
  it("has exactly the 10 specified states", () => {
    expect(ALL_STATES.sort()).toEqual(
      [
        "IDLE",
        "SCANNING",
        "NO_OPPORTUNITY",
        "OPPORTUNITY_READY",
        "REFRESHING",
        "PREPARING_ROUTE",
        "SIMULATING",
        "EXECUTING",
        "CONFIRMED",
        "FAILED",
      ].sort(),
    );
  });

  it("starts idle with empty context", () => {
    expect(initialGrowSnapshot).toEqual({
      state: "IDLE",
      opportunityId: null,
      txHash: null,
      error: null,
    });
  });
});

describe("scan loop", () => {
  it("cycles SCANNING → NO_OPPORTUNITY → SCANNING", () => {
    let snap = growReducer(initialGrowSnapshot, { type: "SCAN" });
    expect(snap.state).toBe("SCANNING");

    snap = growReducer(snap, { type: "NOTHING_FOUND" });
    expect(snap.state).toBe("NO_OPPORTUNITY");
    expect(snap.opportunityId).toBeNull();

    snap = growReducer(snap, { type: "SCAN" });
    expect(snap.state).toBe("SCANNING");
  });
});

describe("happy path", () => {
  it("walks IDLE → CONFIRMED capturing opportunity and tx hash", () => {
    let snap = growReducer(initialGrowSnapshot, { type: "SCAN" });
    snap = growReducer(snap, {
      type: "OPPORTUNITY_FOUND",
      opportunityId: "op-42",
    });
    expect(snap).toMatchObject({
      state: "OPPORTUNITY_READY",
      opportunityId: "op-42",
    });

    snap = growReducer(snap, { type: "PREPARE" });
    expect(snap.state).toBe("PREPARING_ROUTE");

    snap = growReducer(snap, { type: "ROUTE_READY" });
    expect(snap.state).toBe("SIMULATING");

    snap = growReducer(snap, { type: "SIMULATION_SUCCESS" });
    expect(snap.state).toBe("EXECUTING");

    snap = growReducer(snap, {
      type: "EXECUTION_CONFIRMED",
      txHash: "0xddd",
    });
    expect(snap).toMatchObject({
      state: "CONFIRMED",
      opportunityId: "op-42",
      txHash: "0xddd",
      error: null,
    });
  });
});

describe("refresh cycle", () => {
  it("re-validates an opportunity and can lose it", () => {
    let snap = snapshotIn("OPPORTUNITY_READY");
    snap = { ...snap, opportunityId: "op-old" };

    snap = growReducer(snap, { type: "REFRESH" });
    expect(snap.state).toBe("REFRESHING");

    const found = growReducer(snap, {
      type: "OPPORTUNITY_FOUND",
      opportunityId: "op-new",
    });
    expect(found).toMatchObject({
      state: "OPPORTUNITY_READY",
      opportunityId: "op-new",
    });

    const gone = growReducer(snap, { type: "NOTHING_FOUND" });
    expect(gone).toMatchObject({
      state: "NO_OPPORTUNITY",
      opportunityId: null,
    });
  });

  it("expires an opportunity back to NO_OPPORTUNITY and clears it", () => {
    const ready: GrowSnapshot = {
      state: "OPPORTUNITY_READY",
      opportunityId: "op-stale",
      txHash: null,
      error: null,
    };
    const snap = growReducer(ready, { type: "OPPORTUNITY_EXPIRED" });
    expect(snap).toMatchObject({
      state: "NO_OPPORTUNITY",
      opportunityId: null,
    });
  });
});

describe("failures", () => {
  const failureCases: Array<[GrowState, GrowEventType]> = [
    ["SCANNING", "SCAN_FAILURE"],
    ["REFRESHING", "SCAN_FAILURE"],
    ["PREPARING_ROUTE", "ROUTE_FAILURE"],
    ["SIMULATING", "SIMULATION_FAILURE"],
    ["EXECUTING", "EXECUTION_FAILURE"],
  ];

  it.each(failureCases)("%s fails on %s with the reason", (state, type) => {
    const snap = growReducer(snapshotIn(state), makeEvent(type));
    expect(snap.state).toBe("FAILED");
    expect(snap.error).toBe("boom");
  });

  it("re-scanning after failure clears context", () => {
    const failed: GrowSnapshot = {
      state: "FAILED",
      opportunityId: "op-dead",
      txHash: null,
      error: "boom",
    };
    const snap = growReducer(failed, { type: "SCAN" });
    expect(snap).toEqual({
      state: "SCANNING",
      opportunityId: null,
      txHash: null,
      error: null,
    });
  });
});

describe("illegal transitions", () => {
  it("every unlisted state × event pair returns the identical snapshot", () => {
    for (const state of ALL_STATES) {
      const legal = new Set(Object.keys(GROW_TRANSITIONS[state]));
      const snap = snapshotIn(state);
      for (const type of ALL_EVENT_TYPES) {
        if (legal.has(type)) {
          continue;
        }
        expect(growReducer(snap, makeEvent(type))).toBe(snap);
        expect(canSendGrow(state, type)).toBe(false);
      }
    }
  });

  it("every listed transition is reported sendable", () => {
    for (const state of ALL_STATES) {
      for (const type of Object.keys(
        GROW_TRANSITIONS[state],
      ) as GrowEventType[]) {
        expect(canSendGrow(state, type)).toBe(true);
      }
    }
  });
});

describe("reset", () => {
  it.each(["CONFIRMED", "FAILED"] as const)(
    "RESET from %s restores the initial snapshot",
    (state) => {
      const dirty: GrowSnapshot = {
        state,
        opportunityId: "op-x",
        txHash: "0xeee",
        error: state === "FAILED" ? "boom" : null,
      };
      expect(growReducer(dirty, { type: "RESET" })).toEqual(
        initialGrowSnapshot,
      );
    },
  );
});
