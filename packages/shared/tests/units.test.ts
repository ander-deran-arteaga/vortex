import { describe, expect, it } from "vitest";

import {
  bpsOf,
  convertAmount,
  maxInAfterSlippage,
  minOutAfterSlippage,
} from "../src/units";

describe("bps math", () => {
  it("computes bps of an amount with floor division", () => {
    expect(bpsOf(10_000n, 30)).toBe(30n);
    expect(bpsOf(1n, 30)).toBe(0n);
    expect(bpsOf(0n, 10_000)).toBe(0n);
  });

  it("applies slippage to outputs", () => {
    expect(minOutAfterSlippage(1_000_000n, 30)).toBe(997_000n);
    expect(minOutAfterSlippage(1_000_000n, 0)).toBe(1_000_000n);
  });

  it("applies slippage to inputs with ceiling", () => {
    expect(maxInAfterSlippage(1_000_000n, 30)).toBe(1_003_000n);
    expect(maxInAfterSlippage(1n, 1)).toBe(2n);
  });
});

describe("convertAmount", () => {
  it("converts WBTC to USDC base units at a given price", () => {
    // 1 WBTC (1e8 base units) at 100_000 USDC per WBTC (1e11 base units,
    // price scaled by 1e18).
    const price = 100_000n * 10n ** 6n * 10n ** 18n;
    expect(convertAmount(10n ** 8n, 8, price)).toBe(100_000n * 10n ** 6n);
  });

  it("converts USDC to WBTC base units at a given price", () => {
    // 100_000 USDC at 1e-5 WBTC per USDC (1000 sats per USDC, scaled 1e18).
    const price = 1_000n * 10n ** 18n;
    expect(convertAmount(100_000n * 10n ** 6n, 6, price)).toBe(10n ** 8n);
  });
});
