/**
 * The market comparison, as arithmetic.
 *
 * Everything here is pure and integer-only. Prices are USDC per WBTC scaled to
 * 1e8 (`PriceE8`), because the two legs have different decimals — USDC 6, WBTC
 * 8, never 18 — and a float would quietly lose the last basis point of a
 * 64,000-dollar mark.
 *
 * The one idea the whole surface rests on: **every venue is normalised against
 * its own mid**. Vortex prices a demo chain around one reference mark and
 * Binance prices the real market around another; comparing absolute dollars
 * would compare the marks, not the market making. Comparing basis points from
 * each venue's own mid compares the only thing that transfers — the shape and
 * width of the quote.
 */

/** USDC per WBTC, scaled by 1e8. */
export type PriceE8 = bigint;

const USDC_DECIMALS = 6n;
const WBTC_DECIMALS = 8n;
/** priceE8 = usdcBase * 10^(8 + 8 - 6) / wbtcBase. */
const PRICE_SCALE = 10n ** (8n + WBTC_DECIMALS - USDC_DECIMALS);

/**
 * The price a leg actually executed at, from the two base-unit amounts.
 * Returns null for a zero leg rather than dividing — a venue that could not
 * price this size has no price, and inventing one is the failure this file
 * exists to avoid.
 */
export function impliedPriceE8(usdcBase: bigint, wbtcBase: bigint): PriceE8 | null {
  if (usdcBase <= 0n || wbtcBase <= 0n) {
    return null;
  }
  return (usdcBase * PRICE_SCALE) / wbtcBase;
}

/**
 * Basis points of `price` away from `mid`. Negative is below the mid.
 *
 * The intermediate is scaled by 1e4 for bps and 1e6 further before the integer
 * division, so the result keeps six decimal places. Two was not enough: the top
 * of Binance's book is about two thousandths of a basis point wide, and at two
 * decimals the tightest venue on the page truncated to a flat zero.
 */
const BPS_SCALE = 10n ** 10n;
const BPS_DIVISOR = 1_000_000;

export function bpsFromMid(price: PriceE8, mid: PriceE8): number {
  if (mid <= 0n) {
    return 0;
  }
  return Number(((price - mid) * BPS_SCALE) / mid) / BPS_DIVISOR;
}

export interface TwoSided {
  /** What a taker receives per WBTC when selling. */
  bid: PriceE8;
  /** What a taker pays per WBTC when buying. */
  ask: PriceE8;
}

export function midOf({ bid, ask }: TwoSided): PriceE8 {
  return (bid + ask) / 2n;
}

/**
 * The width of the quote, in basis points of its own mid. A crossed book (ask
 * below bid) returns a negative number on purpose: that is a real state a venue
 * can be in, and hiding it behind an absolute value would hide free money.
 */
export function spreadBps(sides: TwoSided): number {
  const mid = midOf(sides);
  if (mid <= 0n) {
    return 0;
  }
  return Number(((sides.ask - sides.bid) * BPS_SCALE) / mid) / BPS_DIVISOR;
}

/** A venue's quote at one size, normalised. */
export interface VenueSpread {
  bid: PriceE8;
  ask: PriceE8;
  mid: PriceE8;
  /** Distance from the venue's own mid. Bid is negative, ask positive. */
  bidBps: number;
  askBps: number;
  spreadBps: number;
}

export function normalise(sides: TwoSided): VenueSpread {
  const mid = midOf(sides);
  return {
    bid: sides.bid,
    ask: sides.ask,
    mid,
    bidBps: bpsFromMid(sides.bid, mid),
    askBps: bpsFromMid(sides.ask, mid),
    spreadBps: spreadBps(sides),
  };
}

/* ─────────────────────────── the depth curve ─────────────────────────── */

/**
 * One point on a venue's curve: how far from mid you land, in bps, once you
 * have taken `size` base units of WBTC. Bids sit at negative bps, asks at
 * positive, so the two sides fall either side of zero on one axis.
 */
export interface CurvePoint {
  /** WBTC base units, cumulative. */
  size: bigint;
  bps: number;
  side: "bid" | "ask";
}

/** A single order-book level, in base units. */
export interface Level {
  price: PriceE8;
  /** WBTC base units available at this price. */
  size: bigint;
}

/**
 * Walks a real order book and returns the average price paid for `target`.
 *
 * Returns null when the book is too thin to fill — the honest answer for a
 * venue that cannot take the size, and never a partial fill dressed up as a
 * full one.
 */
export function walkLadder(levels: readonly Level[], target: bigint): PriceE8 | null {
  if (target <= 0n) {
    return null;
  }
  let remaining = target;
  let usdcBase = 0n;
  for (const level of levels) {
    const take = level.size < remaining ? level.size : remaining;
    // usdcBase = wbtcBase * priceE8 / 10^(8 + 8 - 6)
    usdcBase += (take * level.price) / PRICE_SCALE;
    remaining -= take;
    if (remaining === 0n) {
      return impliedPriceE8(usdcBase, target);
    }
  }
  return null;
}

/**
 * The cumulative curve for one side of a book, capped at `maxSize` so the
 * chart's y-axis stays in the range the other venue can actually quote.
 */
export function ladderCurve(
  levels: readonly Level[],
  mid: PriceE8,
  side: "bid" | "ask",
  maxSize: bigint,
): CurvePoint[] {
  const best = levels[0];
  if (best === undefined) {
    return [];
  }
  // The curve starts at the best price with nothing taken yet. Without this a
  // book whose top level already covers the whole range would be a single
  // point and draw no line at all — which reads as missing data when it is in
  // fact the deepest possible answer.
  const points: CurvePoint[] = [{ size: 0n, bps: bpsFromMid(best.price, mid), side }];
  let cumulative = 0n;
  for (const level of levels) {
    cumulative += level.size;
    const capped = cumulative > maxSize ? maxSize : cumulative;
    points.push({ size: capped, bps: bpsFromMid(level.price, mid), side });
    if (cumulative >= maxSize) {
      break;
    }
  }
  return points;
}
