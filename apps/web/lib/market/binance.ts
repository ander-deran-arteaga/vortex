/**
 * Binance BTC/USDC, read straight from the browser.
 *
 * The depth endpoint sends `access-control-allow-origin: *`, so there is no
 * proxy and no key — the page talks to the exchange itself. That matters for
 * honesty as much as for plumbing: what you see is the real book, and when it
 * is unreachable this module says so rather than handing back a number.
 *
 * One endpoint serves both panels: the ladder gives the size-aware bid and ask
 * for the spread table and the cumulative curve for the chart. Top-of-book
 * alone would flatter Binance at any size past its best level.
 */

import { ladderCurve, midOf, normalise, walkLadder, type CurvePoint, type Level, type PriceE8, type VenueSpread } from "./model";

const DEPTH_URL = "https://api.binance.com/api/v3/depth?symbol=BTCUSDC&limit=100";

/** Binance sends fixed-point decimal strings; parse them without a float. */
export function decimalToE8(value: string): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  const padded = (fraction + "00000000").slice(0, 8);
  return BigInt(whole) * 100_000_000n + BigInt(padded);
}

interface RawDepth {
  bids: [string, string][];
  asks: [string, string][];
}

function isRawDepth(value: unknown): value is RawDepth {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { bids, asks } = value as Partial<RawDepth>;
  const level = (l: unknown) =>
    Array.isArray(l) && typeof l[0] === "string" && typeof l[1] === "string";
  return (
    Array.isArray(bids) && Array.isArray(asks) && bids.every(level) && asks.every(level)
  );
}

export interface BinanceBook {
  /** Best bid first, best ask first. Prices in E8, sizes in WBTC base units. */
  bids: Level[];
  asks: Level[];
  /** Top of book, which is the reference the whole surface normalises against. */
  topMid: PriceE8;
  fetchedAt: number;
}

export class BinanceUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BinanceUnavailableError";
  }
}

export async function fetchBinanceBook(signal?: AbortSignal): Promise<BinanceBook> {
  let payload: unknown;
  try {
    const response = await fetch(DEPTH_URL, signal === undefined ? {} : { signal });
    if (!response.ok) {
      throw new BinanceUnavailableError(`Binance answered ${response.status}`);
    }
    payload = await response.json();
  } catch (error) {
    if (error instanceof BinanceUnavailableError) {
      throw error;
    }
    throw new BinanceUnavailableError(
      error instanceof Error ? error.message : "the request failed",
    );
  }

  if (!isRawDepth(payload)) {
    throw new BinanceUnavailableError("the depth payload did not match the expected shape");
  }

  const toLevels = (raw: [string, string][]): Level[] =>
    raw
      .map(([price, size]) => ({ price: decimalToE8(price), size: decimalToE8(size) }))
      .filter((l) => l.price > 0n && l.size > 0n);

  const bids = toLevels(payload.bids);
  const asks = toLevels(payload.asks);
  const bestBid = bids[0];
  const bestAsk = asks[0];
  if (bestBid === undefined || bestAsk === undefined) {
    throw new BinanceUnavailableError("the book came back empty");
  }

  return {
    bids,
    asks,
    topMid: midOf({ bid: bestBid.price, ask: bestAsk.price }),
    fetchedAt: Date.now(),
  };
}

/** The size-aware two-sided quote, or null when the book cannot fill it. */
export function binanceSpreadAt(book: BinanceBook, size: bigint): VenueSpread | null {
  const bid = walkLadder(book.bids, size);
  const ask = walkLadder(book.asks, size);
  if (bid === null || ask === null) {
    return null;
  }
  return normalise({ bid, ask });
}

export function binanceCurve(book: BinanceBook, maxSize: bigint): CurvePoint[] {
  return [
    ...ladderCurve(book.bids, book.topMid, "bid", maxSize),
    ...ladderCurve(book.asks, book.topMid, "ask", maxSize),
  ];
}
