import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  zConfigResponse,
  zExchangeQuoteResponse,
  zExecutionRecord,
  zGrowPrepareResponse,
  zGrowScanResponse,
  zStrategyHealth,
} from "@vortex/shared";
import {
  FIXTURE_STRATEGY_HASH,
  buildConfigFixture,
  buildExchangeQuoteFixture,
  buildExecutionsFixture,
  buildGrowPrepareFixture,
  buildGrowScanFixture,
  buildStrategyHealthFixture,
} from "@/lib/api/fixtures";

const NOW = 1_800_000_000_000;
const ONE_WBTC = "100000000";

const quoteRequest = {
  chainId: 31337 as const,
  strategyHash: FIXTURE_STRATEGY_HASH,
  tokenIn: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  tokenOut: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  amountIn: ONE_WBTC,
  taker: "0x3333333333333333333333333333333333333333",
  slippageBps: 30,
};

// Fixtures that drift from the shared schema would render as broken panels the
// moment the real backend lands, so every builder is validated against it.
describe("fixtures satisfy the shared schemas", () => {
  it("exchange quote", () => {
    const quote = buildExchangeQuoteFixture(quoteRequest, { now: NOW });
    expect(zExchangeQuoteResponse.safeParse(quote).success).toBe(true);
  });

  it("grow scan — opportunity and empty result", () => {
    const scan = buildGrowScanFixture(
      { chainId: 31337, strategyHash: FIXTURE_STRATEGY_HASH, principalAmount: ONE_WBTC, direction: "AUTO" },
      { now: NOW },
    );
    expect(zGrowScanResponse.safeParse(scan).success).toBe(true);

    const empty = buildGrowScanFixture(
      { chainId: 31337, strategyHash: FIXTURE_STRATEGY_HASH, principalAmount: ONE_WBTC, direction: "AUTO" },
      { now: NOW, opportunityFound: false },
    );
    expect(zGrowScanResponse.safeParse(empty).success).toBe(true);
  });

  it("grow prepare", () => {
    const prepared = buildGrowPrepareFixture("op-1", { now: NOW, principalAmount: ONE_WBTC });
    expect(zGrowPrepareResponse.safeParse(prepared).success).toBe(true);
  });

  it("strategy health — covered and partial", () => {
    expect(
      zStrategyHealth.safeParse(buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH)).success,
    ).toBe(true);
    expect(
      zStrategyHealth.safeParse(
        buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH, { covered: false }),
      ).success,
    ).toBe(true);
  });

  it("executions", () => {
    expect(
      z.array(zExecutionRecord).safeParse(buildExecutionsFixture({ now: NOW })).success,
    ).toBe(true);
  });

  it("config", () => {
    expect(zConfigResponse.safeParse(buildConfigFixture()).success).toBe(true);
  });
});

describe("exchange quote fixture economics", () => {
  it("selects Aqua when Aqua nets more", () => {
    const quote = buildExchangeQuoteFixture(quoteRequest, { now: NOW, winner: "AQUA" });
    const aqua = BigInt(quote.comparison.aqua?.netAmountOut ?? "0");
    const uniswap = BigInt(quote.comparison.uniswap?.netAmountOut ?? "0");
    expect(quote.selectedVenue).toBe("AQUA");
    expect(aqua > uniswap).toBe(true);
  });

  it("selects Uniswap when Uniswap nets more", () => {
    const quote = buildExchangeQuoteFixture(quoteRequest, { now: NOW, winner: "UNISWAP" });
    const aqua = BigInt(quote.comparison.aqua?.netAmountOut ?? "0");
    const uniswap = BigInt(quote.comparison.uniswap?.netAmountOut ?? "0");
    expect(quote.selectedVenue).toBe("UNISWAP");
    expect(uniswap > aqua).toBe(true);
  });

  it("prices 1 WBTC near the 100,000 USDC reference and nets below gross", () => {
    const quote = buildExchangeQuoteFixture(quoteRequest, { now: NOW });
    const aqua = quote.comparison.aqua;
    expect(aqua).not.toBeNull();
    if (aqua === null) return;
    // 1 WBTC (1e8) at 100k USDC is 1e11 base units, plus the 12 bps edge.
    expect(BigInt(aqua.amountOut)).toBe(100_120_000_000n);
    expect(BigInt(aqua.netAmountOut) < BigInt(aqua.amountOut)).toBe(true);
    expect(BigInt(aqua.minimumAmountOut) < BigInt(aqua.amountOut)).toBe(true);
  });

  it("expires 45 seconds after the supplied clock", () => {
    const quote = buildExchangeQuoteFixture(quoteRequest, { now: NOW });
    expect(quote.expiresAt).toBe(NOW + 45_000);
  });

  it("labels its Uniswap request ID as a fixture rather than faking one", () => {
    const quote = buildExchangeQuoteFixture(quoteRequest, { now: NOW });
    expect(quote.comparison.uniswap?.requestId).toContain("fixture");
  });
});

describe("grow scan fixture economics", () => {
  it("keeps the performance fee at 20% of gross profit", () => {
    const scan = buildGrowScanFixture(
      { chainId: 31337, strategyHash: FIXTURE_STRATEGY_HASH, principalAmount: ONE_WBTC, direction: "AUTO" },
      { now: NOW },
    );
    expect(scan.opportunityFound).toBe(true);
    if (!scan.opportunityFound) return;
    const gross = BigInt(scan.estimatedGrossProfit);
    expect(BigInt(scan.performanceFee)).toBe((gross * 2000n) / 10_000n);
    expect(BigInt(scan.minimumProfit)).toBe(gross - BigInt(scan.performanceFee));
  });

  it("requires the cycle to end above the principal", () => {
    const scan = buildGrowScanFixture(
      { chainId: 31337, strategyHash: FIXTURE_STRATEGY_HASH, principalAmount: ONE_WBTC, direction: "AUTO" },
      { now: NOW },
    );
    if (!scan.opportunityFound) throw new Error("expected an opportunity");
    expect(BigInt(scan.minFinalAsset) > BigInt(scan.principalAmount)).toBe(true);
  });
});

describe("strategy health fixture", () => {
  it("reports executable as the minimum of virtual, actual and allowance", () => {
    for (const covered of [true, false]) {
      const health = buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH, { covered });
      for (const token of health.tokens) {
        const expected = [
          BigInt(token.virtualBalance),
          BigInt(token.actualBalance),
          BigInt(token.aquaAllowance),
        ].reduce((min, value) => (value < min ? value : min));
        expect(BigInt(token.executableBalance)).toBe(expected);
      }
    }
  });

  it("marks a partially covered maker as insolvent", () => {
    const health = buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH, { covered: false });
    expect(health.solvent).toBe(false);
    expect(health.coverageBps).toBeLessThan(10_000);
  });
});
