export type GrowState =
  | "IDLE"
  | "SCANNING"
  | "NO_OPPORTUNITY"
  | "OPPORTUNITY_READY"
  | "REFRESHING"
  | "PREPARING_ROUTE"
  | "SIMULATING"
  | "EXECUTING"
  | "CONFIRMED"
  | "FAILED";

export type GrowEvent =
  | { type: "SCAN" }
  | { type: "OPPORTUNITY_FOUND"; opportunityId: string }
  | { type: "NOTHING_FOUND" }
  | { type: "SCAN_FAILURE"; reason: string }
  | { type: "PREPARE" }
  | { type: "REFRESH" }
  | { type: "OPPORTUNITY_EXPIRED" }
  | { type: "ROUTE_READY" }
  | { type: "ROUTE_FAILURE"; reason: string }
  | { type: "SIMULATION_SUCCESS" }
  | { type: "SIMULATION_FAILURE"; reason: string }
  | { type: "EXECUTION_CONFIRMED"; txHash: string }
  | { type: "EXECUTION_FAILURE"; reason: string }
  | { type: "RESET" };

export type GrowEventType = GrowEvent["type"];

export interface GrowSnapshot {
  state: GrowState;
  opportunityId: string | null;
  txHash: string | null;
  error: string | null;
}

export const initialGrowSnapshot: GrowSnapshot = {
  state: "IDLE",
  opportunityId: null,
  txHash: null,
  error: null,
};

export const GROW_TRANSITIONS: Record<
  GrowState,
  Partial<Record<GrowEventType, GrowState>>
> = {
  IDLE: { SCAN: "SCANNING" },
  SCANNING: {
    OPPORTUNITY_FOUND: "OPPORTUNITY_READY",
    NOTHING_FOUND: "NO_OPPORTUNITY",
    SCAN_FAILURE: "FAILED",
  },
  NO_OPPORTUNITY: { SCAN: "SCANNING" },
  OPPORTUNITY_READY: {
    // SCAN re-prices a different principal (and clears context); REFRESH
    // re-prices the one already on screen. Without SCAN here the form silently
    // ignores a changed principal.
    SCAN: "SCANNING",
    PREPARE: "PREPARING_ROUTE",
    REFRESH: "REFRESHING",
    OPPORTUNITY_EXPIRED: "NO_OPPORTUNITY",
  },
  REFRESHING: {
    OPPORTUNITY_FOUND: "OPPORTUNITY_READY",
    NOTHING_FOUND: "NO_OPPORTUNITY",
    SCAN_FAILURE: "FAILED",
  },
  PREPARING_ROUTE: { ROUTE_READY: "SIMULATING", ROUTE_FAILURE: "FAILED" },
  SIMULATING: {
    SIMULATION_SUCCESS: "EXECUTING",
    SIMULATION_FAILURE: "FAILED",
  },
  EXECUTING: {
    EXECUTION_CONFIRMED: "CONFIRMED",
    EXECUTION_FAILURE: "FAILED",
  },
  CONFIRMED: { RESET: "IDLE", SCAN: "SCANNING" },
  FAILED: { RESET: "IDLE", SCAN: "SCANNING" },
};

export function canSendGrow(
  state: GrowState,
  eventType: GrowEventType,
): boolean {
  return GROW_TRANSITIONS[state][eventType] !== undefined;
}

// Pure reducer: illegal events return the same snapshot reference. A fresh
// scan always clears stale context (opportunityId, txHash, error).
export function growReducer(
  snapshot: GrowSnapshot,
  event: GrowEvent,
): GrowSnapshot {
  const next = GROW_TRANSITIONS[snapshot.state][event.type];
  if (next === undefined) {
    return snapshot;
  }

  switch (event.type) {
    case "RESET":
      return { ...initialGrowSnapshot };
    case "SCAN":
      return { ...initialGrowSnapshot, state: next };
    case "OPPORTUNITY_FOUND":
      return {
        ...snapshot,
        state: next,
        opportunityId: event.opportunityId,
        error: null,
      };
    case "NOTHING_FOUND":
    case "OPPORTUNITY_EXPIRED":
      return { ...snapshot, state: next, opportunityId: null };
    case "EXECUTION_CONFIRMED":
      return { ...snapshot, state: next, txHash: event.txHash };
    case "SCAN_FAILURE":
    case "ROUTE_FAILURE":
    case "SIMULATION_FAILURE":
    case "EXECUTION_FAILURE":
      return { ...snapshot, state: next, error: event.reason };
    default:
      return { ...snapshot, state: next };
  }
}
