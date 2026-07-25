export type SwapState =
  | "IDLE"
  | "FETCHING_QUOTE"
  | "QUOTE_READY"
  | "APPROVAL_REQUIRED"
  | "SIGNING_PERMIT"
  | "BUILDING_TRANSACTION"
  | "SIMULATING"
  | "AWAITING_WALLET"
  | "SUBMITTED"
  | "CONFIRMING"
  | "CONFIRMED"
  | "EXPIRED"
  | "FAILED";

export type SwapVenue = "AQUA" | "UNISWAP";

export type SwapEvent =
  | { type: "REQUEST_QUOTE" }
  | { type: "QUOTE_SUCCESS"; quoteId: string; venue: SwapVenue }
  | { type: "QUOTE_FAILURE"; reason: string }
  | { type: "QUOTE_EXPIRED" }
  | { type: "APPROVAL_NEEDED" }
  | { type: "APPROVAL_GRANTED" }
  | { type: "PERMIT_REQUIRED" }
  | { type: "PERMIT_SIGNED" }
  | { type: "PROCEED" }
  | { type: "BUILD_SUCCESS" }
  | { type: "BUILD_FAILURE"; reason: string }
  | { type: "SIMULATION_SUCCESS" }
  | { type: "SIMULATION_FAILURE"; reason: string }
  | { type: "WALLET_CONFIRMED"; txHash: string }
  | { type: "REJECTED"; reason: string }
  | { type: "TX_SEEN" }
  | { type: "TX_CONFIRMED" }
  | { type: "TX_FAILURE"; reason: string }
  | { type: "RESET" };

export type SwapEventType = SwapEvent["type"];

export interface SwapSnapshot {
  state: SwapState;
  venue: SwapVenue | null;
  quoteId: string | null;
  txHash: string | null;
  error: string | null;
}

export const initialSwapSnapshot: SwapSnapshot = {
  state: "IDLE",
  venue: null,
  quoteId: null,
  txHash: null,
  error: null,
};

export const SWAP_TRANSITIONS: Record<
  SwapState,
  Partial<Record<SwapEventType, SwapState>>
> = {
  IDLE: { REQUEST_QUOTE: "FETCHING_QUOTE" },
  FETCHING_QUOTE: { QUOTE_SUCCESS: "QUOTE_READY", QUOTE_FAILURE: "FAILED" },
  QUOTE_READY: {
    // Re-quoting a different size is a normal user action, so a live quote
    // must not trap the form. The reducer's REQUEST_QUOTE branch clears the
    // stale quote context on the way out.
    REQUEST_QUOTE: "FETCHING_QUOTE",
    APPROVAL_NEEDED: "APPROVAL_REQUIRED",
    PERMIT_REQUIRED: "SIGNING_PERMIT",
    PROCEED: "BUILDING_TRANSACTION",
    QUOTE_EXPIRED: "EXPIRED",
  },
  APPROVAL_REQUIRED: {
    APPROVAL_GRANTED: "QUOTE_READY",
    REJECTED: "FAILED",
    QUOTE_EXPIRED: "EXPIRED",
  },
  SIGNING_PERMIT: {
    PERMIT_SIGNED: "BUILDING_TRANSACTION",
    REJECTED: "FAILED",
    QUOTE_EXPIRED: "EXPIRED",
  },
  BUILDING_TRANSACTION: { BUILD_SUCCESS: "SIMULATING", BUILD_FAILURE: "FAILED" },
  SIMULATING: {
    SIMULATION_SUCCESS: "AWAITING_WALLET",
    SIMULATION_FAILURE: "FAILED",
  },
  AWAITING_WALLET: { WALLET_CONFIRMED: "SUBMITTED", REJECTED: "FAILED" },
  SUBMITTED: { TX_SEEN: "CONFIRMING", TX_FAILURE: "FAILED" },
  CONFIRMING: { TX_CONFIRMED: "CONFIRMED", TX_FAILURE: "FAILED" },
  CONFIRMED: { RESET: "IDLE" },
  EXPIRED: { REQUEST_QUOTE: "FETCHING_QUOTE", RESET: "IDLE" },
  FAILED: { REQUEST_QUOTE: "FETCHING_QUOTE", RESET: "IDLE" },
};

export function canSend(state: SwapState, eventType: SwapEventType): boolean {
  return SWAP_TRANSITIONS[state][eventType] !== undefined;
}

// Pure reducer: illegal events return the same snapshot reference so callers
// can detect no-ops with identity checks. A fresh quote request always clears
// stale financial context (quoteId, venue, txHash, error).
export function swapReducer(snapshot: SwapSnapshot, event: SwapEvent): SwapSnapshot {
  const next = SWAP_TRANSITIONS[snapshot.state][event.type];
  if (next === undefined) {
    return snapshot;
  }

  switch (event.type) {
    case "RESET":
      return { ...initialSwapSnapshot };
    case "REQUEST_QUOTE":
      return { ...initialSwapSnapshot, state: next };
    case "QUOTE_SUCCESS":
      return {
        ...snapshot,
        state: next,
        quoteId: event.quoteId,
        venue: event.venue,
        error: null,
      };
    case "WALLET_CONFIRMED":
      return { ...snapshot, state: next, txHash: event.txHash };
    case "QUOTE_FAILURE":
    case "BUILD_FAILURE":
    case "SIMULATION_FAILURE":
    case "TX_FAILURE":
    case "REJECTED":
      return { ...snapshot, state: next, error: event.reason };
    default:
      return { ...snapshot, state: next };
  }
}
