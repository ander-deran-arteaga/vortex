import { describe, expect, it } from "vitest";

import {
  bpsOf,
  convertAmount,
  maxInAfterSlippage,
  minOutAfterSlippage,
  mulDiv,
  scaleAmount,
  USDC_DECIMALS,
  WBTC_DECIMALS,
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

describe("decimal safety", () => {
  it("pins WBTC to 8 and USDC to 6 decimals", () => {
    expect(WBTC_DECIMALS).toBe(8);
    expect(USDC_DECIMALS).toBe(6);
  });

  it("rounds conservatively in the requested direction", () => {
    expect(mulDiv(10n, 10n, 3n, "floor")).toBe(33n);
    expect(mulDiv(10n, 10n, 3n, "ceil")).toBe(34n);
    // Scaling 1 unit of 8-decimals down to 6 decimals loses precision:
    // floor pays out less, ceil charges more — never the reverse.
    expect(scaleAmount(199n, 8, 6, "floor")).toBe(1n);
    expect(scaleAmount(199n, 8, 6, "ceil")).toBe(2n);
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
