import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";

import {
  derivePoolKey,
  type GrowDeployment,
} from "../src/config/growDeployment";
import { scanGrowOpportunity } from "../src/services/growScanner";
import type { PermFeeSignerConfig } from "../src/signer/growSigners";

const ASSET = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address; // WBTC, 8dp
const BRIDGE = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address; // USDC, 6dp
const HOOK = "0x982Ac4415215c4C8B8afbA2F03A0984D2fbbaac0" as Address;
const COMPOUNDER = "0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1" as Address;
const EXTERNAL = "0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44" as Address;
const QUOTER = "0x0B306BF915C4d645ff596e518fAf3F9669b97016" as Address;
const ORACLE = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707" as Address;
const MAKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;

const E18 = 10n ** 18n;
/** The deployed demo economics: pool marks WBTC at 100k, the venue at 95k. */
const ASSET_TO_BRIDGE_RATE = 100_000n * 10n ** 6n * E18 / 10n ** 8n; // per asset base unit
const BRIDGE_TO_ASSET_RATE = (10n ** 8n * E18) / (95_000n * 10n ** 6n);

const { poolKey, assetIsCurrency0 } = derivePoolKey(ASSET, BRIDGE, HOOK);

const deployment = (
  overrides: Partial<GrowDeployment["strategy"]> = {},
): GrowDeployment => ({
  chainId: 31337,
  compounder: COMPOUNDER,
  strategyHash: `0x${"cf".repeat(32)}` as Hex,
  externalTarget: EXTERNAL,
  externalVenueKind: "SIMULATED",
  shippedAsset: 500_000_000n,
  poolKey,
  assetIsCurrency0,
  hookAddress: HOOK,
  quoterAddress: QUOTER,
  oracleAddress: ORACLE,
  strategy: {
    maker: MAKER,
    asset: ASSET,
    bridgeToken: BRIDGE,
    externalTarget: EXTERNAL,
    routeSigner: MAKER,
    feeRecipient: MAKER,
    maxAmountPerExecution: 200_000_000n,
    minProfitBps: 10,
    performanceFeeBps: 2_000,
    strategyDeadline: 2_000_000_000,
    salt: 1n,
    ...overrides,
  },
});

interface StubOptions {
  assetToBridgeRate?: bigint;
  bridgeToAssetRate?: bigint;
  shortfall?: bigint;
  /** Asset the PermAMM leg costs for the requested bridge amount. */
  quotedIn?: bigint | "revert";
  rateThrows?: boolean;
}

function stubClient(options: StubOptions = {}) {
  return {
    readContract: async ({ functionName, args }: never | any) => {
      if (options.rateThrows) throw new Error("no venue");
      if (functionName === "latestPrice") {
        return [100_000n * E18, 99_950n * E18, 100_050n * E18, 1_785_000_000];
      }
      if (functionName === "shortfall") return options.shortfall ?? 0n;
      if (functionName === "rateE18") {
        const [tokenIn] = args as [Address, Address];
        return tokenIn.toLowerCase() === ASSET.toLowerCase()
          ? options.assetToBridgeRate ?? ASSET_TO_BRIDGE_RATE
          : options.bridgeToAssetRate ?? BRIDGE_TO_ASSET_RATE;
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async () => {
      if (options.quotedIn === "revert") throw new Error("pool reverted");
      // Default: the pool sells the bridge amount for ~1% less asset than the
      // external venue will buy it back for — a genuine arbitrage.
      return { result: [options.quotedIn ?? 85_000_000n, 0n] };
    },
  } as never;
}

const permSigner = {
  account: {
    address: MAKER,
    signTypedData: async () => `0x${"11".repeat(65)}` as Hex,
  },
  chainId: 31337,
  hookAddress: HOOK,
  poolId: `0x${"ab".repeat(32)}` as Hex,
  oracleAddress: ORACLE,
} as unknown as PermFeeSignerConfig;

const scan = (principal: bigint, options: StubOptions = {}, dep = deployment()) =>
  scanGrowOpportunity(principal, {
    client: stubClient(options),
    deployment: dep,
    permSigner: { ...permSigner, client: stubClient(options) },
    now: () => 1_785_000_000_000,
    nonce: () => 7n,
  });

describe("scanGrowOpportunity — profitability on minimums", () => {
  it("finds an opportunity when the cycle clears the maker's floor", async () => {
    const outcome = await scan(100_000_000n);

    expect(outcome.found).toBe(true);
    if (!outcome.found) return;
    const o = outcome.opportunity;

    // Every figure is a worst case: spend capped, return floored.
    expect(o.maxAssetSpent).toBeGreaterThan(o.quote.assetIn);
    expect(o.minFinalAsset).toBe(
      o.principalAmount - o.maxAssetSpent + o.quote.externalOut,
    );
    expect(o.minFinalAsset).toBeGreaterThan(o.principalAmount);
    expect(o.estimatedGrossProfit).toBe(o.minFinalAsset - o.principalAmount);
  });

  it("takes the performance fee from realized profit only", async () => {
    const outcome = await scan(100_000_000n);
    expect(outcome.found).toBe(true);
    if (!outcome.found) return;
    const o = outcome.opportunity;

    // 20% of gross, never of principal.
    expect(o.performanceFee).toBe((o.estimatedGrossProfit * 2_000n) / 10_000n);
    expect(o.minimumProfit).toBe(o.estimatedGrossProfit - o.performanceFee);
    expect(o.performanceFee).toBeLessThan(o.estimatedGrossProfit);
  });

  it("reports no opportunity when the cycle loses money", async () => {
    // The pool charges more asset than the venue returns.
    const outcome = await scan(100_000_000n, { quotedIn: 99_000_000n });

    expect(outcome.found).toBe(false);
    if (outcome.found) return;
    expect(["CYCLE_NOT_PROFITABLE", "PERMAMM_LEG_EXCEEDS_PRINCIPAL"]).toContain(
      outcome.reason,
    );
  });

  it("reports no opportunity when profit misses the maker's minimum", async () => {
    // Barely profitable: clears zero but not the 10 bps floor.
    const outcome = await scan(100_000_000n, { shortfall: 89_000_000n });

    expect(outcome.found).toBe(false);
    if (outcome.found) return;
    expect(["PROFIT_BELOW_MAKER_MINIMUM", "CYCLE_NOT_PROFITABLE"]).toContain(
      outcome.reason,
    );
  });

  it("treats no-opportunity as a normal result, never an exception", async () => {
    await expect(scan(100_000_000n, { quotedIn: 99_999_999n })).resolves.toEqual(
      expect.objectContaining({ found: false }),
    );
  });
});

describe("scanGrowOpportunity — maker envelope", () => {
  it("refuses a principal above maxAmountPerExecution", async () => {
    const outcome = await scan(300_000_000n);

    expect(outcome).toEqual({
      found: false,
      reason: "PRINCIPAL_EXCEEDS_MAX_PER_EXECUTION",
    });
  });

  it("refuses a principal above what the maker actually shipped", async () => {
    const dep = deployment();
    dep.shippedAsset = 50_000_000n;
    const outcome = await scan(100_000_000n, {}, dep);

    expect(outcome).toEqual({
      found: false,
      reason: "PRINCIPAL_EXCEEDS_SHIPPED_ASSET",
    });
  });

  it("refuses a non-positive principal", async () => {
    expect(await scan(0n)).toEqual({
      found: false,
      reason: "PRINCIPAL_MUST_BE_POSITIVE",
    });
  });

  it("never lets the first leg spend more than the principal", async () => {
    const outcome = await scan(100_000_000n, { quotedIn: 100_000_000n });

    expect(outcome).toEqual({
      found: false,
      reason: "PERMAMM_LEG_EXCEEDS_PRINCIPAL",
    });
  });
});

describe("scanGrowOpportunity — venue failures degrade honestly", () => {
  it("reports an unquotable PermAMM leg rather than guessing", async () => {
    const outcome = await scan(100_000_000n, { quotedIn: "revert" });

    expect(outcome).toEqual({ found: false, reason: "PERMAMM_LEG_UNQUOTABLE" });
  });

  it("reports an unreachable external venue", async () => {
    const outcome = await scan(100_000_000n, { rateThrows: true });

    expect(outcome).toEqual({
      found: false,
      reason: "EXTERNAL_VENUE_UNREACHABLE",
    });
  });

  it("reports a venue with no rate", async () => {
    const outcome = await scan(100_000_000n, { assetToBridgeRate: 0n });

    expect(outcome).toEqual({
      found: false,
      reason: "EXTERNAL_VENUE_HAS_NO_RATE",
    });
  });

  it("subtracts the venue's shortfall from the guaranteed return", async () => {
    const full = await scan(100_000_000n);
    const reduced = await scan(100_000_000n, { shortfall: 1_000_000n });

    expect(full.found && reduced.found).toBe(true);
    if (!full.found || !reduced.found) return;
    expect(reduced.opportunity.quote.externalOut).toBe(
      full.opportunity.quote.externalOut - 1_000_000n,
    );
    expect(reduced.opportunity.minFinalAsset).toBeLessThan(
      full.opportunity.minFinalAsset,
    );
  });
});

describe("derivePoolKey — currency ordering", () => {
  it("sorts currencies by address, whichever asset comes first", () => {
    const low = "0x1111111111111111111111111111111111111111" as Address;
    const high = "0x2222222222222222222222222222222222222222" as Address;

    const a = derivePoolKey(low, high, HOOK);
    const b = derivePoolKey(high, low, HOOK);

    expect(a.poolKey.currency0).toBe(low);
    expect(b.poolKey.currency0).toBe(low);
    // Same pool either way round; only the asset's role flips.
    expect(a.poolId).toBe(b.poolId);
    expect(a.assetIsCurrency0).toBe(true);
    expect(b.assetIsCurrency0).toBe(false);
  });

  it("reports the deployed pair's real orientation (USDC sorts first)", () => {
    // Pinned because the swap direction depends on it, and the oracle
    // orientation bug came from exactly this assumption going untested.
    expect(assetIsCurrency0).toBe(false);
    expect(poolKey.currency0.toLowerCase()).toBe(BRIDGE.toLowerCase());
  });
});
