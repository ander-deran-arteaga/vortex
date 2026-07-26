import { describe, expect, it } from "vitest";
import {
  bpsFromMid,
  impliedPriceE8,
  ladderCurve,
  normalise,
  spreadBps,
  walkLadder,
  type Level,
} from "@/lib/market/model";

/** 64,300.00000000 USDC per WBTC. */
const MID = 6_430_000_000_000n;

describe("implied price", () => {
  it("prices a WBTC/USDC leg across their different decimals", () => {
    // 0.05 WBTC out for 3,210.00 USDC in is 64,200 per WBTC — and the two legs
    // are 8 and 6 decimals, never 18.
    const price = impliedPriceE8(3_210_000_000n, 5_000_000n);
    expect(price).toBe(6_420_000_000_000n);
  });

  it("has no price for a leg that returned nothing", () => {
    expect(impliedPriceE8(0n, 5_000_000n)).toBeNull();
    expect(impliedPriceE8(3_210_000_000n, 0n)).toBeNull();
  });

  it("stays exact where a float would drift", () => {
    // A price with digits past what a double holds cleanly at this magnitude.
    const price = impliedPriceE8(3_203_017_777n, 4_999_999n);
    expect(price).toBe((3_203_017_777n * 10n ** 10n) / 4_999_999n);
  });
});

describe("normalisation against each venue's own mid", () => {
  it("puts venues on different marks onto one scale", () => {
    // The whole point: a demo venue at 64,300 and a real one at 100,000 with
    // the same relative width normalise to the same bps.
    const demo = normalise({ bid: 6_430_000_000_000n - 6_430_000_000n, ask: 6_430_000_000_000n + 6_430_000_000n });
    const real = normalise({ bid: 10_000_000_000_000n - 10_000_000_000n, ask: 10_000_000_000_000n + 10_000_000_000n });
    expect(demo.spreadBps).toBeCloseTo(real.spreadBps, 6);
    expect(demo.spreadBps).toBeCloseTo(20, 6);
  });

  it("reports the bid below the mid and the ask above it", () => {
    const v = normalise({ bid: 6_403_006_000_000n, ask: 6_457_106_000_000n });
    expect(v.bidBps).toBeLessThan(0);
    expect(v.askBps).toBeGreaterThan(0);
    expect(v.spreadBps).toBeCloseTo(v.askBps - v.bidBps, 1);
  });

  it("measures the live Aqua quote at roughly 84 bps", () => {
    // Sampled from the running API: sell 0.05 WBTC → 64,030.06, buy → 64,571.06.
    const v = normalise({ bid: 6_403_006_000_000n, ask: 6_457_106_000_000n });
    expect(v.spreadBps).toBeGreaterThan(83);
    expect(v.spreadBps).toBeLessThan(85);
  });

  // A crossed book is free money and must never be smoothed away.
  it("reports a crossed book as a negative spread", () => {
    expect(spreadBps({ bid: 6_420_358_000_000n, ask: 6_370_821_000_000n })).toBeLessThan(0);
  });

  // Binance's top of book is about two thousandths of a basis point wide. At
  // the original two-decimal scaling this truncated to a flat 0.0, so the
  // tightest venue on the page read as though it had no spread at all.
  it("resolves a spread far below one basis point", () => {
    // 64,315.07 / 64,315.08 — one cent apart, as BTC/USDC really trades.
    const v = normalise({ bid: 6_431_507_000_000n, ask: 6_431_508_000_000n });
    // One cent on a 64,315 mark is 0.01/64315 * 10000 = 0.00155 bps.
    expect(v.spreadBps).toBeGreaterThan(0.0015);
    expect(v.spreadBps).toBeLessThan(0.0016);
    expect(v.bidBps).toBeLessThan(0);
    expect(v.askBps).toBeGreaterThan(0);
  });

  it("is zero-safe rather than dividing by a missing mid", () => {
    expect(bpsFromMid(MID, 0n)).toBe(0);
    expect(spreadBps({ bid: 0n, ask: 0n })).toBe(0);
  });
});

describe("walking a real order book", () => {
  const book: Level[] = [
    { price: 6_425_511_000_000n, size: 10_000_000n }, // 0.1 WBTC
    { price: 6_425_000_000_000n, size: 20_000_000n }, // 0.2
    { price: 6_420_000_000_000n, size: 50_000_000n }, // 0.5
  ];

  it("fills entirely at the top level when the top is deep enough", () => {
    expect(walkLadder(book, 5_000_000n)).toBe(6_425_511_000_000n);
  });

  it("averages across levels once the size walks the book", () => {
    const avg = walkLadder(book, 30_000_000n);
    expect(avg).not.toBeNull();
    // Between the second and first level's prices, nearer the second.
    expect(avg as bigint).toBeLessThan(6_425_511_000_000n);
    expect(avg as bigint).toBeGreaterThan(6_425_000_000_000n);
  });

  it("returns nothing when the book cannot fill the size", () => {
    expect(walkLadder(book, 900_000_000n)).toBeNull();
    expect(walkLadder(book, 0n)).toBeNull();
  });

  it("caps the curve at the size the other venue can quote", () => {
    const points = ladderCurve(book, MID, "bid", 25_000_000n);
    expect(points.length).toBeGreaterThan(0);
    const last = points[points.length - 1];
    expect(last?.size).toBe(25_000_000n);
    expect(points.every((p) => p.size <= 25_000_000n)).toBe(true);
  });
});
