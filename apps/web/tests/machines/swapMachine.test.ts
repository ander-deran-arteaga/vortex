import { describe, expect, it } from "vitest";
import {
  SWAP_TRANSITIONS,
  canSend,
  initialSwapSnapshot,
  swapReducer,
  type SwapEvent,
  type SwapEventType,
  type SwapSnapshot,
  type SwapState,
} from "@/lib/machines/swapMachine";

const ALL_EVENT_TYPES: SwapEventType[] = [
  "REQUEST_QUOTE",
  "QUOTE_SUCCESS",
  "QUOTE_FAILURE",
  "QUOTE_EXPIRED",
  "APPROVAL_NEEDED",
  "APPROVAL_GRANTED",
  "PERMIT_REQUIRED",
  "PERMIT_SIGNED",
  "PROCEED",
  "BUILD_SUCCESS",
  "BUILD_FAILURE",
  "SIMULATION_SUCCESS",
  "SIMULATION_FAILURE",
  "WALLET_CONFIRMED",
  "REJECTED",
  "TX_SEEN",
  "TX_CONFIRMED",
  "TX_FAILURE",
  "RESET",
];

const ALL_STATES = Object.keys(SWAP_TRANSITIONS) as SwapState[];

function makeEvent(type: SwapEventType): SwapEvent {
  switch (type) {
    case "QUOTE_SUCCESS":
      return { type, quoteId: "q-1", venue: "AQUA" };
    case "WALLET_CONFIRMED":
      return { type, txHash: "0xhash" };
    case "QUOTE_FAILURE":
    case "BUILD_FAILURE":
    case "SIMULATION_FAILURE":
    case "TX_FAILURE":
    case "REJECTED":
      return { type, reason: "boom" };
    default:
      return { type } as SwapEvent;
  }
}

function snapshotIn(state: SwapState): SwapSnapshot {
  return { ...initialSwapSnapshot, state };
}

describe("swap machine shape", () => {
  it("has exactly the 13 specified states", () => {
    expect(ALL_STATES.sort()).toEqual(
      [
        "IDLE",
        "FETCHING_QUOTE",
        "QUOTE_READY",
        "APPROVAL_REQUIRED",
        "SIGNING_PERMIT",
        "BUILDING_TRANSACTION",
        "SIMULATING",
        "AWAITING_WALLET",
        "SUBMITTED",
        "CONFIRMING",
        "CONFIRMED",
        "EXPIRED",
        "FAILED",
      ].sort(),
    );
  });

  it("starts idle with empty context", () => {
    expect(initialSwapSnapshot).toEqual({
      state: "IDLE",
      venue: null,
      quoteId: null,
      txHash: null,
      error: null,
    });
  });
});

describe("aqua happy path (approval, no permit)", () => {
  it("walks IDLE → CONFIRMED preserving quote context", () => {
    let snap = swapReducer(initialSwapSnapshot, { type: "REQUEST_QUOTE" });
    expect(snap.state).toBe("FETCHING_QUOTE");

    snap = swapReducer(snap, {
      type: "QUOTE_SUCCESS",
      quoteId: "q-aqua",
      venue: "AQUA",
    });
    expect(snap).toMatchObject({
      state: "QUOTE_READY",
      quoteId: "q-aqua",
      venue: "AQUA",
    });

    snap = swapReducer(snap, { type: "APPROVAL_NEEDED" });
    expect(snap.state).toBe("APPROVAL_REQUIRED");

    snap = swapReducer(snap, { type: "APPROVAL_GRANTED" });
    expect(snap.state).toBe("QUOTE_READY");
    expect(snap.quoteId).toBe("q-aqua");

    snap = swapReducer(snap, { type: "PROCEED" });
    expect(snap.state).toBe("BUILDING_TRANSACTION");

    snap = swapReducer(snap, { type: "BUILD_SUCCESS" });
    expect(snap.state).toBe("SIMULATING");

    snap = swapReducer(snap, { type: "SIMULATION_SUCCESS" });
    expect(snap.state).toBe("AWAITING_WALLET");

    snap = swapReducer(snap, { type: "WALLET_CONFIRMED", txHash: "0xaaa" });
    expect(snap).toMatchObject({ state: "SUBMITTED", txHash: "0xaaa" });

    snap = swapReducer(snap, { type: "TX_SEEN" });
    expect(snap.state).toBe("CONFIRMING");

    snap = swapReducer(snap, { type: "TX_CONFIRMED" });
    expect(snap).toMatchObject({
      state: "CONFIRMED",
      venue: "AQUA",
      quoteId: "q-aqua",
      txHash: "0xaaa",
      error: null,
    });
  });
});

describe("uniswap happy path (permit)", () => {
  it("routes through SIGNING_PERMIT with venue UNISWAP", () => {
    let snap = swapReducer(initialSwapSnapshot, { type: "REQUEST_QUOTE" });
    snap = swapReducer(snap, {
      type: "QUOTE_SUCCESS",
      quoteId: "q-uni",
      venue: "UNISWAP",
    });
    snap = swapReducer(snap, { type: "PERMIT_REQUIRED" });
    expect(snap.state).toBe("SIGNING_PERMIT");

    snap = swapReducer(snap, { type: "PERMIT_SIGNED" });
    expect(snap.state).toBe("BUILDING_TRANSACTION");

    snap = swapReducer(snap, { type: "BUILD_SUCCESS" });
    snap = swapReducer(snap, { type: "SIMULATION_SUCCESS" });
    snap = swapReducer(snap, { type: "WALLET_CONFIRMED", txHash: "0xbbb" });
    snap = swapReducer(snap, { type: "TX_SEEN" });
    snap = swapReducer(snap, { type: "TX_CONFIRMED" });

    expect(snap).toMatchObject({
      state: "CONFIRMED",
      venue: "UNISWAP",
      quoteId: "q-uni",
      txHash: "0xbbb",
    });
  });
});

describe("expiry", () => {
  it.each(["QUOTE_READY", "APPROVAL_REQUIRED", "SIGNING_PERMIT"] as const)(
    "expires from %s",
    (state) => {
      const snap = swapReducer(snapshotIn(state), { type: "QUOTE_EXPIRED" });
      expect(snap.state).toBe("EXPIRED");
    },
  );

  it("re-quoting from EXPIRED clears stale context", () => {
    const stale: SwapSnapshot = {
      state: "EXPIRED",
      venue: "AQUA",
      quoteId: "q-stale",
      txHash: null,
      error: null,
    };
    const snap = swapReducer(stale, { type: "REQUEST_QUOTE" });
    expect(snap).toEqual({
      state: "FETCHING_QUOTE",
      venue: null,
      quoteId: null,
      txHash: null,
      error: null,
    });
  });
});

describe("failures", () => {
  const failureCases: Array<[SwapState, SwapEventType]> = [
    ["FETCHING_QUOTE", "QUOTE_FAILURE"],
    ["APPROVAL_REQUIRED", "REJECTED"],
    ["SIGNING_PERMIT", "REJECTED"],
    ["BUILDING_TRANSACTION", "BUILD_FAILURE"],
    ["SIMULATING", "SIMULATION_FAILURE"],
    ["AWAITING_WALLET", "REJECTED"],
    ["SUBMITTED", "TX_FAILURE"],
    ["CONFIRMING", "TX_FAILURE"],
  ];

  it.each(failureCases)("%s fails on %s with the reason", (state, type) => {
    const snap = swapReducer(snapshotIn(state), makeEvent(type));
    expect(snap.state).toBe("FAILED");
    expect(snap.error).toBe("boom");
  });

  it("allows retry from FAILED with clean context", () => {
    const failed: SwapSnapshot = {
      state: "FAILED",
      venue: "UNISWAP",
      quoteId: "q-dead",
      txHash: null,
      error: "boom",
    };
    const snap = swapReducer(failed, { type: "REQUEST_QUOTE" });
    expect(snap).toEqual({
      state: "FETCHING_QUOTE",
      venue: null,
      quoteId: null,
      txHash: null,
      error: null,
    });
  });
});

describe("illegal transitions", () => {
  it("every unlisted state × event pair returns the identical snapshot", () => {
    for (const state of ALL_STATES) {
      const legal = new Set(Object.keys(SWAP_TRANSITIONS[state]));
      const snap = snapshotIn(state);
      for (const type of ALL_EVENT_TYPES) {
        if (legal.has(type)) {
          continue;
        }
        expect(swapReducer(snap, makeEvent(type))).toBe(snap);
        expect(canSend(state, type)).toBe(false);
      }
    }
  });

  it("every listed transition is reported sendable", () => {
    for (const state of ALL_STATES) {
      for (const type of Object.keys(
        SWAP_TRANSITIONS[state],
      ) as SwapEventType[]) {
        expect(canSend(state, type)).toBe(true);
      }
    }
  });
});

describe("reset", () => {
  it.each(["CONFIRMED", "FAILED", "EXPIRED"] as const)(
    "RESET from %s restores the initial snapshot",
    (state) => {
      const dirty: SwapSnapshot = {
        state,
        venue: "AQUA",
        quoteId: "q-x",
        txHash: "0xccc",
        error: state === "FAILED" ? "boom" : null,
      };
      expect(swapReducer(dirty, { type: "RESET" })).toEqual(
        initialSwapSnapshot,
      );
    },
  );
});
