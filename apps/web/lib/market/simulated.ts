/**
 * The simulated PermAMM series.
 *
 * There is no historical quote store, and the PermAMM cannot be quoted from a
 * browser at all — it reverts with `VortexHookDataRequired` because it prices
 * only against a signed authorisation. So this series is a MODEL of the
 * designed curve, not a measurement, and every surface that renders it says so
 * in words next to the line.
 *
 * It is deterministic: the value at a given moment is a pure function of the
 * time bucket, so it is stable across re-renders, identical in every tab, and
 * assertable in a test. Nothing here is random at runtime.
 */

/** Everything the model is built from, in one place so it can be read. */
export const SIMULATED = {
  /** Where the modelled spread sits, in bps of mid. */
  baseSpreadBps: 11,
  /** How far it wanders either side of that. */
  swingBps: 3.5,
  /** One sample per this many ms; the walk steps on the same clock. */
  bucketMs: 4_000,
  /**
   * Concentrated liquidity: the bps cost of reaching a given cumulative size.
   * Smaller means a tighter book that holds its price further out.
   */
  depthK: 6,
  seed: 0x5f0d,
} as const;

/** mulberry32 — small, fast, and good enough for a plausible walk. */
function hash32(value: number): number {
  let t = (value + SIMULATED.seed) >>> 0;
  t = (t + 0x6d2b79f5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}

/**
 * The modelled spread at a moment, in bps.
 *
 * A slow drift carries the level and a small per-bucket jitter roughens it, so
 * the line looks like a quote feed rather than a sine wave — while staying a
 * pure function of the clock.
 */
export function simulatedSpreadBps(atMs: number): number {
  const bucket = Math.floor(atMs / SIMULATED.bucketMs);
  const drift = Math.sin(bucket / 9) * 0.6 + Math.sin(bucket / 23) * 0.4;
  const jitter = (hash32(bucket) - 0.5) * 0.9;
  const bps = SIMULATED.baseSpreadBps + (drift + jitter) * SIMULATED.swingBps;
  // A spread is never negative, and a market maker never quotes zero width.
  return Math.max(1, Number(bps.toFixed(3)));
}

/**
 * The bps from mid at which a given cumulative size is reachable.
 *
 * Concentrated liquidity puts most of the book close to the mid: the first
 * slice costs almost nothing to fill and each further slice costs more, so
 * cumulative size rises steeply near the mid and the curve flattens toward the
 * edges. `1 - exp(-x/k)` inverted gives exactly that shape.
 */
export function simulatedDepthBps(
  size: bigint,
  maxSize: bigint,
  halfSpreadBps: number,
): number {
  if (maxSize <= 0n) {
    return halfSpreadBps;
  }
  const fraction = Math.min(0.98, Number(size) / Number(maxSize));
  const out = halfSpreadBps + SIMULATED.depthK * -Math.log(1 - 0.9 * fraction);
  return Number(out.toFixed(3));
}
