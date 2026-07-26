import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  WINDOW_MS,
  allPoints,
  record,
  tightestNow,
} from "@/lib/market/history";
import { SIMULATED, simulatedDepthBps, simulatedSpreadBps } from "@/lib/market/simulated";

const T0 = 1_800_000_000_000;

describe("rolling window", () => {
  it("drops readings older than the window", () => {
    let h = record(EMPTY_HISTORY, "binance", { at: T0, bps: 0.002 }, T0);
    h = record(h, "binance", { at: T0 + WINDOW_MS + 1, bps: 0.003 }, T0 + WINDOW_MS + 1);
    expect(h.binance).toHaveLength(1);
    expect(h.binance[0]?.bps).toBe(0.003);
  });

  // The Vortex pass is far slower than the render loop; re-recording the same
  // sample would build a flat spike out of a single measurement.
  it("replaces a repeated timestamp instead of stacking it", () => {
    let h = record(EMPTY_HISTORY, "aqua", { at: T0, bps: 84 }, T0);
    h = record(h, "aqua", { at: T0, bps: 84 }, T0);
    h = record(h, "aqua", { at: T0, bps: 85 }, T0);
    expect(h.aqua).toHaveLength(1);
    expect(h.aqua[0]?.bps).toBe(85);
  });

  it("keeps each venue's clock separate rather than interpolating", () => {
    let h = record(EMPTY_HISTORY, "binance", { at: T0, bps: 0.002 }, T0);
    h = record(h, "aqua", { at: T0 + 30_000, bps: 84 }, T0 + 30_000);
    expect(h.binance).toHaveLength(1);
    expect(h.aqua).toHaveLength(1);
    expect(allPoints(h)).toHaveLength(2);
  });

  it("marks the tightest by its latest reading", () => {
    let h = record(EMPTY_HISTORY, "binance", { at: T0, bps: 0.002 }, T0);
    h = record(h, "aqua", { at: T0, bps: 84 }, T0);
    h = record(h, "uniswap", { at: T0, bps: 10 }, T0);
    expect(tightestNow(h, T0)).toBe("binance");
  });

  // A venue that stopped answering is absent, not winning.
  it("does not let a stale series win", () => {
    const now = T0 + WINDOW_MS + 1;
    let h = record(EMPTY_HISTORY, "binance", { at: T0, bps: 0.002 }, T0);
    // `record` only prunes the series it touches, so binance's aged-out point
    // is still in the object — tightestNow has to reject it on its own.
    h = record(h, "aqua", { at: now, bps: 84 }, now);
    expect(h.binance).toHaveLength(1);
    expect(tightestNow(h, now)).toBe("aqua");
  });

  it("has no tightest when nothing is in the window", () => {
    expect(tightestNow(EMPTY_HISTORY, T0)).toBeNull();
  });
});

describe("the simulated series is a model, and a deterministic one", () => {
  it("returns the same value for the same moment, every time", () => {
    expect(simulatedSpreadBps(T0)).toBe(simulatedSpreadBps(T0));
    expect(simulatedSpreadBps(T0 + 1)).toBe(simulatedSpreadBps(T0));
  });

  it("steps on its own bucket rather than on every millisecond", () => {
    expect(simulatedSpreadBps(T0)).toBe(simulatedSpreadBps(T0 + SIMULATED.bucketMs - 1));
    expect(simulatedSpreadBps(T0)).not.toBe(simulatedSpreadBps(T0 + SIMULATED.bucketMs * 7));
  });

  it("stays a plausible tight spread and never goes negative", () => {
    for (let i = 0; i < 500; i += 1) {
      const bps = simulatedSpreadBps(T0 + i * SIMULATED.bucketMs);
      expect(bps).toBeGreaterThan(0);
      expect(bps).toBeLessThan(SIMULATED.baseSpreadBps + SIMULATED.swingBps * 2 + 1);
    }
  });

  // Concentrated liquidity: cheap close to the mid, and each further slice
  // costs more, so the cumulative curve rises steeply then flattens.
  it("models concentrated liquidity, steep near the mid and flattening out", () => {
    const max = 25_000_000n;
    const half = 5;
    const at = (s: bigint) => simulatedDepthBps(s, max, half);

    expect(at(0n)).toBeCloseTo(half, 3);
    // Monotonic: more size never costs less.
    const sizes = [0n, 2_500_000n, 5_000_000n, 12_500_000n, 25_000_000n];
    const values = sizes.map(at);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i] as number).toBeGreaterThan(values[i - 1] as number);
    }
    // The first tenth of the book costs far less per unit than the last tenth.
    const firstSlice = at(2_500_000n) - at(0n);
    const lastSlice = at(25_000_000n) - at(22_500_000n);
    expect(lastSlice).toBeGreaterThan(firstSlice * 2);
  });
});
