// Token amounts are bigint base units end to end; floating point is never
// used for money. Formatting is locale-independent so server and client
// render identically.

function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatTokenAmount(
  value: bigint,
  decimals: number,
  displayDecimals?: number,
): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`invalid decimals: ${decimals}`);
  }
  const shown = displayDecimals ?? Math.min(decimals, 8);
  if (!Number.isInteger(shown) || shown < 0) {
    throw new Error(`invalid displayDecimals: ${displayDecimals}`);
  }

  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const integer = groupDigits((abs / base).toString());
  const sign = negative ? "-" : "";

  if (shown === 0) {
    return `${sign}${integer}`;
  }

  // Truncate (never round) so a displayed balance is never overstated.
  const fraction = (abs % base)
    .toString()
    .padStart(decimals, "0")
    .slice(0, shown)
    .padEnd(shown, "0");
  return `${sign}${integer}.${fraction}`;
}

export function parseTokenAmount(input: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error(`invalid decimals: ${decimals}`);
  }
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid amount: "${input}"`);
  }
  const parts = trimmed.split(".");
  const integer = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  if (fraction.length > decimals) {
    throw new Error(
      `too many decimal places in "${input}" (max ${decimals})`,
    );
  }
  const padded = fraction.padEnd(decimals, "0");
  return (
    BigInt(integer) * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded)
  );
}

export function truncateAddress(address: string): string {
  if (address.length <= 12) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Formats basis points as a percentage.
 *
 * The shared schemas type every bps field the UI consumes as plain
 * `z.number()`, not `z.number().int()` — `coverageBps` in particular is a
 * computed executable/virtual ratio and is naturally fractional. Throwing on a
 * non-integer would unmount the page from inside render, so fractional input
 * is truncated toward zero instead. Only a value that cannot be formatted at
 * all (NaN, Infinity) is rejected.
 */
export function basisPointsToPercent(bps: number): string {
  if (!Number.isFinite(bps)) {
    throw new Error(`basis points must be a finite number: ${bps}`);
  }
  const sign = bps < 0 ? "-" : "";
  const abs = Math.trunc(Math.abs(bps));
  const whole = Math.trunc(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${fraction}%`;
}
