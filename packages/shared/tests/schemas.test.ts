import { describe, expect, it } from "vitest";

import {
  zAmount,
  zApiError,
  zExchangeQuoteRequest,
  zExchangeQuoteResponse,
  zGrowScanRequest,
  zGrowScanResponse,
  zStrategyHealth,
} from "../src/schemas";

const ADDRESS = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const HASH = `0x${"ab".repeat(32)}`;

describe("zAmount", () => {
  it("accepts base-unit decimal strings only", () => {
    expect(zAmount.safeParse("100000000").success).toBe(true);
    expect(zAmount.safeParse("0").success).toBe(true);
    expect(zAmount.safeParse("1.5").success).toBe(false);
    expect(zAmount.safeParse("-1").success).toBe(false);
    expect(zAmount.safeParse("0x10").success).toBe(false);
  });
});

describe("zExchangeQuoteRequest", () => {
  const base = {
    chainId: 42161,
    strategyHash: HASH,
    tokenIn: ADDRESS,
    tokenOut: USDC,
    amountIn: "100000000",
    taker: ADDRESS,
  };

  it("defaults slippage to 30 bps", () => {
    const parsed = zExchangeQuoteRequest.parse(base);
    expect(parsed.slippageBps).toBe(30);
  });

  it("rejects unsupported chains", () => {
    expect(
      zExchangeQuoteRequest.safeParse({ ...base, chainId: 1 }).success,
    ).toBe(false);
  });

  it("rejects malformed strategy hashes", () => {
    expect(
      zExchangeQuoteRequest.safeParse({ ...base, strategyHash: "0x1234" })
        .success,
    ).toBe(false);
  });
});

describe("zExchangeQuoteResponse", () => {
  it("accepts an Aqua-selected response with fee transparency", () => {
    const parsed = zExchangeQuoteResponse.safeParse({
      quoteSessionId: "quote_1",
      selectedVenue: "AQUA",
      expiresAt: 1_753_000_000,
      comparison: {
        aqua: {
          source: "live",
          amountOut: "99000000",
          minimumAmountOut: "98700000",
          estimatedGasUsd: "0.12",
          netAmountOut: "98650000",
          safetyFeeBps: 3,
          commercialFeeBps: 7,
          inventoryAdjustmentBps: -1.5,
          makerCoverageBps: 10_000,
        },
        uniswap: null,
      },
      execution: {
        kind: "AQUA_SWAPVM",
        order: {},
        amount: "100000000",
        takerTraitsAndData: "0xdeadbeef",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a comparison that does not declare its provenance", () => {
    const parsed = zExchangeQuoteResponse.safeParse({
      quoteSessionId: "quote_1",
      selectedVenue: "AQUA",
      expiresAt: 1_753_000_000_000,
      comparison: {
        aqua: {
          // no `source` — a simulated quote could masquerade as live
          amountOut: "99000000",
          minimumAmountOut: "98700000",
          estimatedGasUsd: "0.12",
          netAmountOut: "98650000",
          safetyFeeBps: 3,
          commercialFeeBps: 7,
          inventoryAdjustmentBps: -1.5,
          makerCoverageBps: 10_000,
        },
        uniswap: null,
      },
      execution: {
        kind: "AQUA_SWAPVM",
        order: {},
        amount: "100000000",
        takerTraitsAndData: "0xdeadbeef",
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an execution kind mismatch", () => {
    const parsed = zExchangeQuoteResponse.safeParse({
      quoteSessionId: "quote_1",
      selectedVenue: "UNISWAP",
      expiresAt: 1,
      comparison: { aqua: null, uniswap: null },
      execution: { kind: "SOMETHING_ELSE" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("grow schemas", () => {
  it("defaults direction to AUTO", () => {
    const parsed = zGrowScanRequest.parse({
      chainId: 42161,
      strategyHash: HASH,
      principalAmount: "100000000",
    });
    expect(parsed.direction).toBe("AUTO");
  });

  it("treats no-opportunity as a valid state", () => {
    const parsed = zGrowScanResponse.safeParse({
      opportunityFound: false,
      reason: "INSUFFICIENT_MINIMUM_PROFIT",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a stale-pool opportunity without a uniswap request id", () => {
    const parsed = zGrowScanResponse.safeParse({
      opportunityFound: true,
      opportunityId: "opp_1",
      direction: "VORTEX_THEN_EXTERNAL",
      principalAmount: "100000000",
      bridgeAmount: "100000000000",
      maxAssetSpent: "99800000",
      minFinalAsset: "100240000",
      minimumProfit: "100000",
      estimatedGrossProfit: "300000",
      performanceFee: "30000",
      expiresAt: 1_753_000_000,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("zStrategyHealth", () => {
  it("carries executable coverage per token", () => {
    const parsed = zStrategyHealth.safeParse({
      strategyHash: HASH,
      maker: ADDRESS,
      active: true,
      solvent: true,
      coverageBps: 10_000,
      tokens: [
        {
          address: ADDRESS,
          symbol: "WBTC",
          virtualBalance: "100000000",
          actualBalance: "100000000",
          aquaAllowance: "100000000",
          executableBalance: "100000000",
        },
      ],
      lastUpdatedBlock: 1,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("zApiError", () => {
  it("uses the nested error envelope", () => {
    expect(
      zApiError.safeParse({ error: { code: "QUOTE_EXPIRED", message: "expired" } })
        .success,
    ).toBe(true);
    expect(zApiError.safeParse({ error: "QUOTE_EXPIRED" }).success).toBe(false);
  });
});
