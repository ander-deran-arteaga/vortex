import { describe, expect, it } from "vitest";
import {
  basisPointsToPercent,
  formatTokenAmount,
  parseTokenAmount,
  truncateAddress,
} from "@/lib/format";

const WBTC_DECIMALS = 8;
const USDC_DECIMALS = 6;

describe("formatTokenAmount", () => {
  it("formats WBTC base units", () => {
    expect(formatTokenAmount(123456789n, WBTC_DECIMALS)).toBe("1.23456789");
    expect(formatTokenAmount(100000000n, WBTC_DECIMALS)).toBe("1.00000000");
    expect(formatTokenAmount(0n, WBTC_DECIMALS)).toBe("0.00000000");
    expect(formatTokenAmount(1n, WBTC_DECIMALS)).toBe("0.00000001");
  });

  it("formats USDC base units with grouping", () => {
    expect(formatTokenAmount(1234567890n, USDC_DECIMALS)).toBe("1,234.567890");
    expect(formatTokenAmount(100000000000000n, USDC_DECIMALS)).toBe(
      "100,000,000.000000",
    );
  });

  it("truncates instead of rounding", () => {
    expect(formatTokenAmount(199999999n, WBTC_DECIMALS, 2)).toBe("1.99");
    expect(formatTokenAmount(999999n, USDC_DECIMALS, 3)).toBe("0.999");
  });

  it("honours displayDecimals of zero", () => {
    expect(formatTokenAmount(199999999n, WBTC_DECIMALS, 0)).toBe("1");
  });

  it("pads when displayDecimals exceeds decimals", () => {
    expect(formatTokenAmount(1500000n, USDC_DECIMALS, 8)).toBe("1.50000000");
  });

  it("handles negatives", () => {
    expect(formatTokenAmount(-123456789n, WBTC_DECIMALS)).toBe("-1.23456789");
  });

  it("rejects invalid decimals", () => {
    expect(() => formatTokenAmount(1n, -1)).toThrow();
    expect(() => formatTokenAmount(1n, 1.5)).toThrow();
  });
});

describe("parseTokenAmount", () => {
  it("parses WBTC and USDC amounts", () => {
    expect(parseTokenAmount("1.23456789", WBTC_DECIMALS)).toBe(123456789n);
    expect(parseTokenAmount("1", USDC_DECIMALS)).toBe(1000000n);
    expect(parseTokenAmount("0.000001", USDC_DECIMALS)).toBe(1n);
    expect(parseTokenAmount("0", WBTC_DECIMALS)).toBe(0n);
  });

  it("round-trips with formatTokenAmount", () => {
    const value = 987654321n;
    expect(
      parseTokenAmount(
        formatTokenAmount(value, WBTC_DECIMALS).replace(/,/g, ""),
        WBTC_DECIMALS,
      ),
    ).toBe(value);
  });

  it("rejects malformed input", () => {
    expect(() => parseTokenAmount("", WBTC_DECIMALS)).toThrow();
    expect(() => parseTokenAmount("abc", WBTC_DECIMALS)).toThrow();
    expect(() => parseTokenAmount("-1", WBTC_DECIMALS)).toThrow();
    expect(() => parseTokenAmount("1.2.3", WBTC_DECIMALS)).toThrow();
    expect(() => parseTokenAmount("1.", WBTC_DECIMALS)).toThrow();
    expect(() => parseTokenAmount(".5", WBTC_DECIMALS)).toThrow();
  });

  it("rejects excess precision", () => {
    expect(() => parseTokenAmount("1.234", 2)).toThrow();
    expect(() => parseTokenAmount("0.0000001", USDC_DECIMALS)).toThrow();
  });
});

describe("truncateAddress", () => {
  it("truncates a full address", () => {
    expect(
      truncateAddress("0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f"),
    ).toBe("0x2f2a…5B0f");
  });

  it("leaves short strings untouched", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234");
  });
});

describe("basisPointsToPercent", () => {
  it("formats common fee tiers", () => {
    expect(basisPointsToPercent(1)).toBe("0.01%");
    expect(basisPointsToPercent(30)).toBe("0.30%");
    expect(basisPointsToPercent(500)).toBe("5.00%");
    expect(basisPointsToPercent(10000)).toBe("100.00%");
  });

  it("handles zero and negatives", () => {
    expect(basisPointsToPercent(0)).toBe("0.00%");
    expect(basisPointsToPercent(-50)).toBe("-0.50%");
  });

  it("rejects non-integers", () => {
    expect(() => basisPointsToPercent(1.5)).toThrow();
  });
});
