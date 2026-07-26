import type { Hex } from "viem";

import { parseUnits, USDC_DECIMALS, WBTC_DECIMALS } from "@vortex/shared";
import { describe, expect, it } from "vitest";

import type { AquaQuote, UniswapQuote } from "../src/services/types";
import {
  compareVenues,
  DEFAULT_COMPARATOR_OPTIONS,
  gasCostInOutputToken,
  type ComparatorOptions,
} from "../src/services/venueComparator";

/**
 * Live-verified economics from docs/uniswap-api.md ("Live verification"):
 * 0.01 WBTC -> USDC at 0.3% slippage. WBTC is 8 decimals, USDC is 6 — every
 * literal below is base units at those scales, so a 1e18 assumption anywhere
 * in the comparator would blow these numbers apart.
 */
const AMOUNT_IN = parseUnits("0.01", WBTC_DECIMALS); // 1_000_000n
const UNI_OUT = parseUnits("640.148143", USDC_DECIMALS); // 640_148_143n
const UNI_MIN = parseUnits("638.227698", USDC_DECIMALS); // 638_227_698n
const UNI_GAS_UNITS = 100_618n; // gasUseEstimate
const UNI_GAS_QUOTE = 3_751n; // gasFeeQuote, USDC base units (0.003751 USDC)
const UNI_NET = UNI_MIN - UNI_GAS_QUOTE; // 638_223_947n

const AQUA_GAS_UNITS = DEFAULT_COMPARATOR_OPTIONS.aquaGasUnits; // 260_000n
/** ceil(260_000 * 3_751 / 100_618) = ceil(9692.47…) — the rounded-UP rate. */
const AQUA_GAS_DERIVED = 9_693n;

const STRATEGY_HASH = `0x${"11".repeat(32)}` as Hex;

const uniQuote = (overrides: Partial<UniswapQuote> = {}): UniswapQuote => ({
  txFailureReasons: [],
  quotedOnChainId: 42161,
  executable: true,
  amountIn: AMOUNT_IN,
  amountOut: UNI_OUT,
  minimumAmountOut: UNI_MIN,
  gasUnits: UNI_GAS_UNITS,
  gasCostInOutputToken: UNI_GAS_QUOTE,
  requestId: "b3f0…-live",
  routing: "CLASSIC",
  rawQuote: { quote: "echoed verbatim" },
  permitData: null,
  approvalRequired: false,
  gasFeeUSD: "0.003751",
  priceImpact: 0.05,
  ...overrides,
});

/** Default Aqua leg beats Uniswap comfortably on both headline and net. */
const aqQuote = (overrides: Partial<AquaQuote> = {}): AquaQuote => ({
  amountIn: AMOUNT_IN,
  amountOut: parseUnits("642.000000", USDC_DECIMALS),
  minimumAmountOut: parseUnits("640.074000", USDC_DECIMALS),
  gasUnits: AQUA_GAS_UNITS,
  gasCostInOutputToken: null,
  strategyHash: STRATEGY_HASH,
  safetyFeeBps: 5,
  commercialFeeBps: 10,
  inventoryAdjustmentBps: 0,
  makerCoverageBps: 10_000,
  executable: true,
  ...overrides,
});

const withBps = (minimumImprovementBps: number): ComparatorOptions => ({
  ...DEFAULT_COMPARATOR_OPTIONS,
  minimumImprovementBps,
});

describe("gasCostInOutputToken", () => {
  it("prices Aqua gas from the Uniswap rate, rounding UP", () => {
    const priced = gasCostInOutputToken(AQUA_GAS_UNITS, {
      gasUnits: UNI_GAS_UNITS,
      gasCostInOutputToken: UNI_GAS_QUOTE,
    });

    expect(priced).toBe(AQUA_GAS_DERIVED);
    // Flooring would understate the charge by one base unit.
    expect((AQUA_GAS_UNITS * UNI_GAS_QUOTE) / UNI_GAS_UNITS).toBe(9_692n);
  });

  it("does not inflate an exact division", () => {
    const priced = gasCostInOutputToken(UNI_GAS_UNITS * 3n, {
      gasUnits: UNI_GAS_UNITS,
      gasCostInOutputToken: UNI_GAS_QUOTE,
    });

    expect(priced).toBe(UNI_GAS_QUOTE * 3n);
  });

  it("returns 0 when there is no reference quote", () => {
    expect(gasCostInOutputToken(AQUA_GAS_UNITS, null)).toBe(0n);
  });

  it("returns 0 instead of dividing by zero reference gas units", () => {
    expect(
      gasCostInOutputToken(AQUA_GAS_UNITS, {
        gasUnits: 0n,
        gasCostInOutputToken: UNI_GAS_QUOTE,
      }),
    ).toBe(0n);
  });

  it("returns 0 for a negative reference gas count", () => {
    expect(
      gasCostInOutputToken(AQUA_GAS_UNITS, {
        gasUnits: -1n,
        gasCostInOutputToken: UNI_GAS_QUOTE,
      }),
    ).toBe(0n);
  });

  it("returns 0 when there is no gas to price", () => {
    expect(
      gasCostInOutputToken(0n, {
        gasUnits: UNI_GAS_UNITS,
        gasCostInOutputToken: UNI_GAS_QUOTE,
      }),
    ).toBe(0n);
  });

  it("returns 0 when the reference reports a free execution", () => {
    expect(
      gasCostInOutputToken(AQUA_GAS_UNITS, {
        gasUnits: UNI_GAS_UNITS,
        gasCostInOutputToken: 0n,
      }),
    ).toBe(0n);
  });

  it("stays exact well past Number.MAX_SAFE_INTEGER", () => {
    const cost = 10n ** 24n + 1n;
    const priced = gasCostInOutputToken(2n, { gasUnits: 1n, gasCostInOutputToken: cost });

    expect(priced).toBe(2n * cost);
    expect(priced).not.toBe(BigInt(Number(2n * cost)));
  });
});

describe("compareVenues — ranking on net output", () => {
  it("selects AQUA when its net output is higher", () => {
    const result = compareVenues(aqQuote(), uniQuote());

    expect(result.selectedVenue).toBe("AQUA");
    expect(result.reason).toBe("AQUA_NET_BETTER");
    expect(result.aqua?.netAmountOut).toBe(
      parseUnits("640.074000", USDC_DECIMALS) - AQUA_GAS_DERIVED,
    );
    expect(result.uniswap?.netAmountOut).toBe(UNI_NET);
  });

  it("selects UNISWAP when its net output is higher", () => {
    const result = compareVenues(
      aqQuote({
        amountOut: parseUnits("630.000000", USDC_DECIMALS),
        minimumAmountOut: parseUnits("628.110000", USDC_DECIMALS),
      }),
      uniQuote(),
    );

    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("UNISWAP_NET_BETTER");
  });

  it("charges gas so a bigger headline amountOut still loses (net inversion)", () => {
    // Aqua quotes MORE on both amountOut and minimumAmountOut, but burns
    // 260k gas against Uniswap's 100.6k: 9_693 - 3_751 = 5_942 of extra gas
    // against only 3_000 of extra guaranteed output.
    const aqua = aqQuote({
      amountOut: parseUnits("640.200000", USDC_DECIMALS),
      minimumAmountOut: UNI_MIN + 3_000n,
      gasCostInOutputToken: null,
    });
    const uniswap = uniQuote();
    const result = compareVenues(aqua, uniswap);

    expect(aqua.amountOut).toBeGreaterThan(uniswap.amountOut);
    expect(aqua.minimumAmountOut).toBeGreaterThan(uniswap.minimumAmountOut);
    expect(result.aqua?.netAmountOut).toBe(UNI_MIN + 3_000n - AQUA_GAS_DERIVED);
    expect(result.aqua?.netAmountOut).toBeLessThan(UNI_NET);
    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("UNISWAP_NET_BETTER");
  });

  it("lets a smaller headline amountOut win once Uniswap's gas is charged", () => {
    const aqua = aqQuote({
      amountOut: parseUnits("630.000000", USDC_DECIMALS),
      minimumAmountOut: parseUnits("628.000000", USDC_DECIMALS),
      gasCostInOutputToken: AQUA_GAS_DERIVED,
    });
    // 20 USDC of gas — a congested-L1-style outlier.
    const uniswap = uniQuote({ gasCostInOutputToken: parseUnits("20", USDC_DECIMALS) });
    const result = compareVenues(aqua, uniswap);

    expect(aqua.amountOut).toBeLessThan(uniswap.amountOut);
    expect(result.selectedVenue).toBe("AQUA");
    expect(result.reason).toBe("AQUA_NET_BETTER");
  });

  it("ranks on minimumAmountOut, never on amountOut", () => {
    // Identical guaranteed output and identical gas, Aqua's headline 10x.
    const result = compareVenues(
      aqQuote({
        amountOut: UNI_OUT * 10n,
        minimumAmountOut: UNI_MIN,
        gasCostInOutputToken: UNI_GAS_QUOTE,
      }),
      uniQuote(),
    );

    expect(result.aqua?.netAmountOut).toBe(result.uniswap?.netAmountOut);
    expect(result.selectedVenue).toBe("UNISWAP");
  });
});

describe("compareVenues — improvement margin boundary", () => {
  it("gives an exact net tie to UNISWAP under the default margin", () => {
    const result = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET, gasCostInOutputToken: 0n }),
      uniQuote(),
    );

    expect(result.aqua?.netAmountOut).toBe(UNI_NET);
    expect(result.uniswap?.netAmountOut).toBe(UNI_NET);
    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("UNISWAP_NET_BETTER");
  });

  it("selects AQUA at exactly uniswapNet + requiredMargin (1 bps)", () => {
    const margin = (UNI_NET * 1n) / 10_000n;
    expect(margin).toBe(63_822n); // floor, pinned so the rounding cannot drift

    const result = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET + margin, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(1),
    );

    expect(result.aqua?.netAmountOut).toBe(UNI_NET + margin);
    expect(result.selectedVenue).toBe("AQUA");
  });

  it("selects UNISWAP one base unit below the 1 bps boundary", () => {
    const margin = (UNI_NET * 1n) / 10_000n;
    const result = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET + margin - 1n, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(1),
    );

    expect(result.aqua?.netAmountOut).toBeGreaterThan(UNI_NET);
    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("UNISWAP_NET_BETTER");
  });

  it("honours a wider 25 bps margin at its exact boundary", () => {
    const margin = (UNI_NET * 25n) / 10_000n;
    expect(margin).toBe(1_595_559n);

    const at = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET + margin, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(25),
    );
    const below = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET + margin - 1n, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(25),
    );

    expect(at.selectedVenue).toBe("AQUA");
    expect(below.selectedVenue).toBe("UNISWAP");
  });

  it("requires double the net at 10_000 bps", () => {
    const at = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET * 2n, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(10_000),
    );
    const below = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET * 2n - 1n, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(10_000),
    );

    expect(at.selectedVenue).toBe("AQUA");
    expect(below.selectedVenue).toBe("UNISWAP");
  });

  it("still refuses a net that is one base unit short of a 25 bps improvement on a large trade", () => {
    // 1 WBTC-sized trade: the margin is large enough that dust routing is impossible.
    const uniswap = uniQuote({
      amountIn: parseUnits("1", WBTC_DECIMALS),
      amountOut: parseUnits("64014.814300", USDC_DECIMALS),
      minimumAmountOut: parseUnits("63822.769800", USDC_DECIMALS),
    });
    const uniNet = parseUnits("63822.769800", USDC_DECIMALS) - UNI_GAS_QUOTE;
    const margin = (uniNet * 25n) / 10_000n;

    const result = compareVenues(
      aqQuote({ minimumAmountOut: uniNet + margin - 1n, gasCostInOutputToken: 0n }),
      uniswap,
      withBps(25),
    );

    expect(margin).toBeGreaterThan(0n);
    expect(result.selectedVenue).toBe("UNISWAP");
  });

  it("still gives an exact tie to UNISWAP when the required margin rounds to zero (0 bps)", () => {
    // A zero margin must not silently degrade the threshold into a tie-break:
    // matching the deep venue exactly never earns Aqua the routing.
    const result = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(0),
    );

    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("UNISWAP_NET_BETTER");
  });

  it("wins at 0 bps on a single base unit of genuine improvement", () => {
    const result = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET + 1n, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(0),
    );

    expect(result.selectedVenue).toBe("AQUA");
  });

  it("gives an exact tie to UNISWAP on dust where 1 bps floors to zero", () => {
    // Reachable with the DEFAULT options: a Uniswap net below 10_000 base
    // units (0.01 USDC) makes floor(net * 1 / 10_000) === 0.
    const uniswap = uniQuote({ minimumAmountOut: 9_000n, gasCostInOutputToken: 100n });
    const result = compareVenues(
      aqQuote({ minimumAmountOut: 8_900n, gasCostInOutputToken: 0n }),
      uniswap,
    );

    expect(result.uniswap?.netAmountOut).toBe(8_900n);
    expect(result.aqua?.netAmountOut).toBe(8_900n);
    expect(result.selectedVenue).toBe("UNISWAP");
  });
});

describe("compareVenues — Aqua executability", () => {
  it("loses on executable:false despite a spectacular headline amountOut", () => {
    const aqua = aqQuote({
      executable: false,
      amountOut: UNI_OUT * 100n,
      minimumAmountOut: UNI_MIN * 100n,
      reason: "MAKER_INVENTORY_EXHAUSTED",
    });
    const result = compareVenues(aqua, uniQuote());

    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.aqua?.netAmountOut).toBeGreaterThan(result.uniswap!.netAmountOut);
  });

  it("propagates the AquaQuote reason", () => {
    const result = compareVenues(
      aqQuote({ executable: false, reason: "STALE_ORACLE" }),
      uniQuote(),
    );

    expect(result.reason).toBe("STALE_ORACLE");
  });

  it("falls back to AQUA_UNAVAILABLE when the quote gives no reason", () => {
    const result = compareVenues(aqQuote({ executable: false }), uniQuote());

    expect(result.reason).toBe("AQUA_UNAVAILABLE");
  });

  it("still reports the non-executable Aqua leg's priced numbers", () => {
    const result = compareVenues(
      aqQuote({ executable: false, reason: "BOUND_BREACH" }),
      uniQuote(),
    );

    expect(result.aqua).not.toBeNull();
    expect(result.aqua?.gasCostInOutputToken).toBe(AQUA_GAS_DERIVED);
    expect(result.aqua?.netAmountOut).toBe(
      parseUnits("640.074000", USDC_DECIMALS) - AQUA_GAS_DERIVED,
    );
  });

  it("reports NO_VENUE_AVAILABLE when Aqua cannot settle and Uniswap is missing", () => {
    const result = compareVenues(
      aqQuote({ executable: false, reason: "STALE_ORACLE" }),
      null,
    );

    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("NO_VENUE_AVAILABLE");
    expect(result.uniswap).toBeNull();
    expect(result.aqua).not.toBeNull();
  });
});

describe("compareVenues — missing venues", () => {
  it("selects UNISWAP with AQUA_UNAVAILABLE when the Aqua quote is null", () => {
    const result = compareVenues(null, uniQuote());

    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("AQUA_UNAVAILABLE");
    expect(result.aqua).toBeNull();
    expect(result.uniswap?.netAmountOut).toBe(UNI_NET);
  });

  it("selects AQUA with UNISWAP_UNAVAILABLE when the Uniswap quote is null", () => {
    const result = compareVenues(aqQuote(), null);

    expect(result.selectedVenue).toBe("AQUA");
    expect(result.reason).toBe("UNISWAP_UNAVAILABLE");
    expect(result.uniswap).toBeNull();
  });

  it("returns NO_VENUE_AVAILABLE without throwing when both quotes are null", () => {
    expect(() => compareVenues(null, null)).not.toThrow();
    const result = compareVenues(null, null);

    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("NO_VENUE_AVAILABLE");
    expect(result.aqua).toBeNull();
    expect(result.uniswap).toBeNull();
  });

  it("prices the Aqua leg at zero gas when there is no Uniswap rate to borrow", () => {
    const result = compareVenues(aqQuote(), null);

    expect(result.aqua?.gasCostInOutputToken).toBe(0n);
    expect(result.aqua?.netAmountOut).toBe(parseUnits("640.074000", USDC_DECIMALS));
  });
});

describe("compareVenues — gas attribution", () => {
  it("derives the Aqua gas charge from the Uniswap rate when Aqua states none", () => {
    const result = compareVenues(aqQuote({ gasCostInOutputToken: null }), uniQuote());

    expect(result.aqua?.gasCostInOutputToken).toBe(AQUA_GAS_DERIVED);
    expect(result.uniswap?.gasCostInOutputToken).toBe(UNI_GAS_QUOTE);
  });

  it("prefers an explicit non-null Aqua gas cost over the derived one", () => {
    const result = compareVenues(
      aqQuote({ gasCostInOutputToken: 1_234n }),
      uniQuote(),
    );

    expect(result.aqua?.gasCostInOutputToken).toBe(1_234n);
    expect(result.aqua?.netAmountOut).toBe(
      parseUnits("640.074000", USDC_DECIMALS) - 1_234n,
    );
  });

  it("treats an explicit zero Aqua gas cost as stated, not as missing", () => {
    const result = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET + 5_000n, gasCostInOutputToken: 0n }),
      uniQuote(),
      withBps(0),
    );

    expect(result.aqua?.gasCostInOutputToken).toBe(0n);
    // Derived gas (9_693) would have dropped this net below Uniswap's.
    expect(result.aqua?.netAmountOut).toBe(UNI_NET + 5_000n);
    expect(result.selectedVenue).toBe("AQUA");
  });

  it("charges nobody for gas when Uniswap omits its gas cost", () => {
    const result = compareVenues(
      aqQuote({ gasCostInOutputToken: null }),
      uniQuote({ gasCostInOutputToken: null }),
    );

    expect(result.uniswap?.gasCostInOutputToken).toBe(0n);
    expect(result.uniswap?.netAmountOut).toBe(UNI_MIN);
    expect(result.aqua?.gasCostInOutputToken).toBe(0n);
  });

  it("prices the Aqua leg from its own gasUnits, not options.aquaGasUnits", () => {
    const result = compareVenues(
      aqQuote({ gasUnits: 520_000n, gasCostInOutputToken: null }),
      uniQuote(),
      { minimumImprovementBps: 1, aquaGasUnits: 1n },
    );

    // ceil(520_000 * 3_751 / 100_618) = 2 x the 260k charge (exact doubling).
    expect(result.aqua?.gasCostInOutputToken).toBe(19_386n);
  });

  it("falls back to options.aquaGasUnits when the quote reports zero gasUnits", () => {
    // A quote reporting 0 gas units has not estimated its gas; charging it
    // nothing would hand Aqua a free win over a venue that states its cost.
    const result = compareVenues(
      aqQuote({ gasUnits: 0n, gasCostInOutputToken: null }),
      uniQuote(),
    );

    // ceil(260_000 * 3_751 / 100_618) — the configured default charge.
    expect(result.aqua?.gasCostInOutputToken).toBe(9_693n);
  });

  it("scales the derived charge linearly with Uniswap's stated cost", () => {
    const result = compareVenues(
      aqQuote({ gasCostInOutputToken: null }),
      uniQuote({ gasCostInOutputToken: UNI_GAS_QUOTE * 1_000n }),
    );

    // ceil(260_000 * 3_751_000 / 100_618) — 1000x the rate, but NOT 1000x the
    // rounded-up 9_693 charge.
    expect(result.aqua?.gasCostInOutputToken).toBe(9_692_700n);
  });
});

describe("compareVenues — net flooring", () => {
  it("floors the Uniswap net at 0 when gas exceeds the guaranteed output", () => {
    const result = compareVenues(
      aqQuote({ minimumAmountOut: 10_000n, gasCostInOutputToken: 0n }),
      uniQuote({ minimumAmountOut: 2_000n, gasCostInOutputToken: 5_000n }),
    );

    expect(result.uniswap?.netAmountOut).toBe(0n);
    // The raw legs are reported untouched; only the net is clamped.
    expect(result.uniswap?.minimumAmountOut).toBe(2_000n);
    expect(result.uniswap?.gasCostInOutputToken).toBe(5_000n);
    expect(result.selectedVenue).toBe("AQUA");
  });

  it("floors the Aqua net at 0 when derived gas exceeds its guaranteed output", () => {
    const result = compareVenues(
      aqQuote({ minimumAmountOut: 1_000n, gasCostInOutputToken: null }),
      uniQuote(),
    );

    expect(result.aqua?.gasCostInOutputToken).toBe(AQUA_GAS_DERIVED);
    expect(result.aqua?.netAmountOut).toBe(0n);
    expect(result.selectedVenue).toBe("UNISWAP");
  });

  it("never returns a negative net", () => {
    const result = compareVenues(
      aqQuote({ minimumAmountOut: 1n, gasCostInOutputToken: 10n ** 12n }),
      uniQuote({ minimumAmountOut: 1n, gasCostInOutputToken: 10n ** 12n }),
    );

    expect(result.aqua?.netAmountOut).toBeGreaterThanOrEqual(0n);
    expect(result.uniswap?.netAmountOut).toBeGreaterThanOrEqual(0n);
  });

  it("resolves deterministically to UNISWAP when both venues floor at 0", () => {
    // Both nets floor at 0, so neither venue guarantees the taker anything.
    // Aqua must not win that tie.
    const result = compareVenues(
      aqQuote({ minimumAmountOut: 1_000n, gasCostInOutputToken: null }),
      uniQuote({ minimumAmountOut: 1_000n, gasCostInOutputToken: 5_000n }),
    );

    expect(result.aqua?.gasCostInOutputToken).toBe(12_921n); // ceil(260k*5000/100618)
    expect(result.aqua?.netAmountOut).toBe(0n);
    expect(result.uniswap?.netAmountOut).toBe(0n);
    expect(result.selectedVenue).toBe("UNISWAP");
    expect(result.reason).toBe("UNISWAP_NET_BETTER");
    // Stable across repeated calls — no hidden state.
    expect(
      compareVenues(
        aqQuote({ minimumAmountOut: 1_000n, gasCostInOutputToken: null }),
        uniQuote({ minimumAmountOut: 1_000n, gasCostInOutputToken: 5_000n }),
      ).selectedVenue,
    ).toBe("UNISWAP");
  });
});

describe("compareVenues — options, precision, and purity", () => {
  it("exposes the documented defaults", () => {
    expect(DEFAULT_COMPARATOR_OPTIONS.minimumImprovementBps).toBe(1);
    expect(DEFAULT_COMPARATOR_OPTIONS.aquaGasUnits).toBe(260_000n);
  });

  it("applies the default margin when no options are passed", () => {
    const margin = (UNI_NET * 1n) / 10_000n;
    const withDefaults = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET + margin - 1n, gasCostInOutputToken: 0n }),
      uniQuote(),
    );
    const explicit = compareVenues(
      aqQuote({ minimumAmountOut: UNI_NET + margin - 1n, gasCostInOutputToken: 0n }),
      uniQuote(),
      DEFAULT_COMPARATOR_OPTIONS,
    );

    expect(withDefaults).toEqual(explicit);
    expect(withDefaults.selectedVenue).toBe("UNISWAP");
  });

  it("decides on a single base unit at magnitudes Number cannot represent", () => {
    const huge = 10n ** 30n;
    const uniswap = uniQuote({
      minimumAmountOut: huge,
      gasCostInOutputToken: 0n,
    });

    const above = compareVenues(
      aqQuote({ minimumAmountOut: huge + 1n, gasCostInOutputToken: 0n }),
      uniswap,
      withBps(0),
    );
    const below = compareVenues(
      aqQuote({ minimumAmountOut: huge - 1n, gasCostInOutputToken: 0n }),
      uniswap,
      withBps(0),
    );

    // Proof the distinction is impossible in float space.
    expect(Number(huge + 1n)).toBe(Number(huge - 1n));
    expect(above.selectedVenue).toBe("AQUA");
    expect(below.selectedVenue).toBe("UNISWAP");
  });

  it("returns bigints for every amount", () => {
    const result = compareVenues(aqQuote(), uniQuote());

    for (const venue of [result.aqua, result.uniswap]) {
      expect(typeof venue?.amountOut).toBe("bigint");
      expect(typeof venue?.minimumAmountOut).toBe("bigint");
      expect(typeof venue?.gasCostInOutputToken).toBe("bigint");
      expect(typeof venue?.netAmountOut).toBe("bigint");
    }
  });

  it("does not mutate the input quotes", () => {
    const aqua = aqQuote();
    const uniswap = uniQuote();
    const aquaBefore = { ...aqua };
    const uniswapBefore = { ...uniswap };

    compareVenues(aqua, uniswap);

    expect(aqua).toEqual(aquaBefore);
    expect(uniswap).toEqual(uniswapBefore);
  });

  it("echoes 8-decimal input against 6-decimal output without rescaling", () => {
    const aqua = aqQuote();
    const uniswap = uniQuote();
    const result = compareVenues(aqua, uniswap);

    expect(AMOUNT_IN).toBe(1_000_000n); // 0.01 WBTC at 8 decimals
    expect(UNI_OUT).toBe(640_148_143n); // ~640 USDC at 6 decimals
    expect(result.uniswap?.amountOut).toBe(uniswap.amountOut);
    expect(result.uniswap?.minimumAmountOut).toBe(uniswap.minimumAmountOut);
    expect(result.aqua?.amountOut).toBe(aqua.amountOut);
    expect(result.aqua?.minimumAmountOut).toBe(aqua.minimumAmountOut);
    // A 1e18 assumption anywhere would have produced a net near zero here.
    expect(result.aqua?.netAmountOut).toBeGreaterThan(600_000_000n);
  });
});
