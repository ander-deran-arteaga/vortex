/**
 * The two Grow scenarios, as data.
 *
 * Amounts are WBTC base units (8 decimals) so the arithmetic is exact and the
 * invariants are assertable: unused + returned === gross, fee is 20% of
 * realised profit, and the maker's final balance is gross minus fee. Nothing
 * here is a live quote — the landing states that persistently — because profit
 * scales with the size of the bridge leg and any "real" figure printed beside
 * these would drift between now and judging.
 */

export type ScenarioId = "success" | "unprofitable";

export type NodeId =
  | "maker"
  | "compounder"
  | "legA"
  | "legB"
  | "gate"
  | "fee"
  | "return";

export interface FlowStep {
  id: string;
  /** One short line. This is what a reader takes away. */
  caption: string;
  /** The node lit at this step. */
  active: NodeId;
  /** Balances as they stand after this step, in WBTC base units. */
  makerWbtc: string;
  compounderWbtc?: string;
  /** USDC base units (6 decimals) held mid-cycle. */
  compounderUsdc?: string;
  status?: "pending" | "verified" | "failed";
  /**
   * How long this step holds, in ms. Steps that carry the argument — the gate
   * verifying and the fee separating from profit — dwell longer than the
   * mechanical ones, because those are the two a viewer must actually read.
   */
  holdMs?: number;
  /** The reversal steps replay the earlier paths backwards. */
  reversing?: boolean;
}

export interface Scenario {
  id: ScenarioId;
  label: string;
  steps: readonly FlowStep[];
}

/* WBTC, 8 decimals. */
export const PRINCIPAL = "100000000"; // 1.00000000
const UNUSED = "200000"; //   0.00200000 left untouched by leg A
const SOLD = "99800000"; //  0.99800000 sold on leg A
const RETURNED_OK = "100100000"; // 1.00100000 bought back on leg B
const RETURNED_BAD = "99950000"; //  0.99950000 bought back, short
const GROSS_OK = "100300000"; // 1.00300000 = unused + returned
const GROSS_BAD = "100150000"; // 1.00150000
const FEE = "60000"; //      0.00060000 = 20% of 0.00300000
const MAKER_FINAL_OK = "100240000"; // 1.00240000 = gross - fee
const MIN_PROFIT = "200000"; //      0.00200000 required
const BRIDGE_USDC = "100000000000"; // 100,000.000000

export const PERFORMANCE_FEE_BPS = 2000;

/** Exposed so tests can assert the arithmetic rather than re-deriving it. */
export const AMOUNTS = {
  principal: PRINCIPAL,
  unused: UNUSED,
  sold: SOLD,
  returnedOk: RETURNED_OK,
  returnedBad: RETURNED_BAD,
  grossOk: GROSS_OK,
  grossBad: GROSS_BAD,
  fee: FEE,
  makerFinalOk: MAKER_FINAL_OK,
  minProfit: MIN_PROFIT,
  bridgeUsdc: BRIDGE_USDC,
} as const;

/* Steps 1 to 5 are identical in both scenarios. */
const OPENING: readonly FlowStep[] = [
  {
    id: "authorise",
    caption: "Maker authorises WBTC. Assets stay in the maker's wallet.",
    active: "maker",
    makerWbtc: PRINCIPAL,
  },
  {
    id: "pull",
    caption: "The Compounder borrows the principal for one transaction.",
    active: "compounder",
    makerWbtc: "0",
    compounderWbtc: PRINCIPAL,
  },
  {
    id: "leg-a-open",
    caption: "First leg: Vortex PermAMM.",
    active: "legA",
    makerWbtc: "0",
    compounderWbtc: PRINCIPAL,
  },
  {
    id: "leg-a-fill",
    caption: "Sells 0.99800000 WBTC for 100,000 USDC. 0.00200000 WBTC is untouched.",
    active: "legA",
    makerWbtc: "0",
    compounderWbtc: UNUSED,
    compounderUsdc: BRIDGE_USDC,
  },
  {
    id: "leg-b-open",
    caption: "Second leg: an external venue.",
    active: "legB",
    makerWbtc: "0",
    compounderWbtc: UNUSED,
    compounderUsdc: BRIDGE_USDC,
  },
];

const SUCCESS_STEPS: readonly FlowStep[] = [
  ...OPENING,
  {
    id: "leg-b-fill",
    caption: "Buys back 1.00100000 WBTC.",
    active: "legB",
    makerWbtc: "0",
    compounderWbtc: GROSS_OK,
  },
  {
    id: "gross",
    caption: "Gross: 1.00300000 WBTC.",
    active: "gate",
    makerWbtc: "0",
    compounderWbtc: GROSS_OK,
  },
  {
    id: "gate",
    holdMs: 3000,
    caption: "final ≥ principal + minimum profit. Verified onchain.",
    active: "gate",
    makerWbtc: "0",
    compounderWbtc: GROSS_OK,
    status: "verified",
  },
  {
    id: "fee",
    holdMs: 3000,
    caption: "20% of the profit, and only the profit.",
    active: "fee",
    makerWbtc: "0",
    compounderWbtc: MAKER_FINAL_OK,
    status: "verified",
  },
  {
    id: "push",
    caption: "Principal plus profit returns to the maker.",
    active: "return",
    makerWbtc: MAKER_FINAL_OK,
    status: "verified",
  },
  {
    id: "settled",
    caption: "The maker finishes with more of the same asset.",
    active: "maker",
    makerWbtc: MAKER_FINAL_OK,
    status: "verified",
  },
];

const UNPROFITABLE_STEPS: readonly FlowStep[] = [
  ...OPENING,
  {
    id: "leg-b-short",
    caption: "The external venue returns less than expected.",
    active: "legB",
    makerWbtc: "0",
    compounderWbtc: GROSS_BAD,
  },
  {
    id: "gross-short",
    caption: "Gross: 1.00150000 WBTC.",
    active: "gate",
    makerWbtc: "0",
    compounderWbtc: GROSS_BAD,
  },
  {
    id: "gate-failed",
    holdMs: 3000,
    caption: "1.00150000 < 1.00000000 + 0.00200000. The floor is not met.",
    active: "gate",
    makerWbtc: "0",
    compounderWbtc: GROSS_BAD,
    status: "failed",
  },
  {
    id: "revert",
    caption: "The transaction reverts. Every leg unwinds along the same path.",
    active: "compounder",
    makerWbtc: "0",
    compounderWbtc: PRINCIPAL,
    status: "failed",
    reversing: true,
  },
  {
    id: "untouched",
    caption: "Atomic revert. Maker principal unchanged, and no fee is taken.",
    active: "maker",
    makerWbtc: PRINCIPAL,
    status: "failed",
    reversing: true,
  },
];

export const SCENARIOS: Readonly<Record<ScenarioId, Scenario>> = {
  success: { id: "success", label: "Successful cycle", steps: SUCCESS_STEPS },
  unprofitable: {
    id: "unprofitable",
    label: "Unprofitable cycle",
    steps: UNPROFITABLE_STEPS,
  },
};

export const SCENARIO_ORDER: readonly ScenarioId[] = ["success", "unprofitable"];
