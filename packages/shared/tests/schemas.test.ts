import { describe, expect, it } from "vitest";

import {
  zAmount,
  zCompoundScanRequest,
  zCompoundScanResponse,
  zExchangeQuoteRequest,
  zExchangeQuoteResponse,
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
  it("accepts an Aqua-selected response", () => {
    const parsed = zExchangeQuoteResponse.safeParse({
      quoteSessionId: "quote_1",
      selectedVenue: "AQUA",
      expiresAt: 1_753_000_000,
      comparison: {
        aqua: {
          amountOut: "99000000",
          minimumAmountOut: "98700000",
          estimatedGasUsd: "0.12",
          netAmountOut: "98650000",
          inventoryFeeBps: 4.2,
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

describe("compound schemas", () => {
  it("defaults direction to AUTO", () => {
    const parsed = zCompoundScanRequest.parse({
      chainId: 42161,
      strategyHash: HASH,
      principalAmount: "100000000",
    });
    expect(parsed.direction).toBe("AUTO");
  });

  it("treats no-opportunity as a valid state", () => {
    const parsed = zCompoundScanResponse.safeParse({
      opportunityFound: false,
      reason: "FINAL_AMOUNT_BELOW_MINIMUM_PROFIT",
    });
    expect(parsed.success).toBe(true);
  });
});
