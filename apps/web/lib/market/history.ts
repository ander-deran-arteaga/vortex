/**
 * The rolling window behind the time-series panel.
 *
 * Each venue keeps its own points because the feeds run on different clocks:
 * Binance answers every few seconds, the Vortex pass every thirty, and the
 * simulated series steps on its own bucket. Interpolating between them to make
 * one tidy grid would invent readings that were never taken, so a sparse series
 * simply draws as a sparse series.
 */

export const WINDOW_MS = 60_000;

export interface SpreadPoint {
  at: number;
  bps: number;
}

export type SeriesKey = "binance" | "uniswap" | "aqua" | "permamm";

export type SpreadHistory = Record<SeriesKey, SpreadPoint[]>;

export const EMPTY_HISTORY: SpreadHistory = {
  binance: [],
  uniswap: [],
  aqua: [],
  permamm: [],
};

/**
 * Appends a reading and drops anything older than the window.
 *
 * A repeated timestamp replaces rather than stacks: the Vortex pass is slower
 * than the render loop, and re-recording the same sample would build a flat
 * spike out of one measurement.
 */
export function record(
  history: SpreadHistory,
  key: SeriesKey,
  point: SpreadPoint,
  now: number,
): SpreadHistory {
  const existing = history[key];
  const last = existing[existing.length - 1];
  const next =
    last !== undefined && last.at === point.at
      ? [...existing.slice(0, -1), point]
      : [...existing, point];
  return { ...history, [key]: next.filter((p) => now - p.at <= WINDOW_MS) };
}

/** Every point in the window, for scaling the axes. */
export function allPoints(history: SpreadHistory): SpreadPoint[] {
  return (Object.keys(history) as SeriesKey[]).flatMap((k) => history[k]);
}

/**
 * The venue quoting tightest right now, by its most recent reading.
 *
 * Only series with a point inside the window can win: a venue that stopped
 * answering thirty seconds ago is not the tightest, it is absent.
 */
export function tightestNow(
  history: SpreadHistory,
  now: number,
  only?: readonly SeriesKey[],
): SeriesKey | null {
  let best: SeriesKey | null = null;
  let bestBps = Number.POSITIVE_INFINITY;
  for (const key of Object.keys(history) as SeriesKey[]) {
    if (only !== undefined && !only.includes(key)) continue;
    const points = history[key];
    const latest = points[points.length - 1];
    if (latest === undefined || now - latest.at > WINDOW_MS) {
      continue;
    }
    if (latest.bps < bestBps) {
      bestBps = latest.bps;
      best = key;
    }
  }
  return best;
}

/**
 * The onchain venues, as their own comparison group.
 *
 * A centralized book quotes inside any onchain venue by construction — it
 * carries no gas, no block time and no settlement risk — so "tightest overall"
 * is almost always Binance and says nothing about the thing Vortex competes on.
 * The question that matters is which venue is tightest *onchain*.
 */
export const ONCHAIN_SERIES: readonly SeriesKey[] = ["uniswap", "aqua", "permamm"];
