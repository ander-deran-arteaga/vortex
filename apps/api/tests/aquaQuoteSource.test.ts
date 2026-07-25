import { USDC, WBTC } from "@vortex/shared";
import { encodeErrorResult, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import { vortexErrorsAbi } from "../src/clients/aquaAbis";
import {
  AQUA_COMPETITIVE_FIXTURE,
  AQUA_UNCOMPETITIVE_FIXTURE,
  createFixtureAquaQuoteSource,
  type FixtureAquaConfig,
} from "../src/clients/fixtureAquaQuoteSource";
import {
  AQUA_GENERIC_REVERT_REASON,
  AQUA_SWAP_GAS_UNITS,
  createLiveAquaQuoteSource,
  decodeAquaRevertReason,
  type AquaOrder,
  type AquaReadClient,
  type LiveAquaQuoteSourceConfig,
} from "../src/clients/liveAquaQuoteSource";
import type { QuoteRequestParams } from "../src/services/types";

const MAKER: Address = "0x1111111111111111111111111111111111111111";
const TAKER: Address = "0x2222222222222222222222222222222222222222";
const LENS: Address = "0x3333333333333333333333333333333333333333";
const ROUTER: Address = "0x4444444444444444444444444444444444444444";
const ORACLE: Address = "0x5555555555555555555555555555555555555555";
const STRATEGY_HASH: Hex =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const ORDER: AquaOrder = { maker: MAKER, traits: 7n, data: "0xdeadbeef" };

/** 1 WBTC (8 decimals) — never 1e18. */
const ONE_WBTC = 100_000_000n;
/** 65,000 USDC (6 decimals). */
const MID_USDC = 65_000_000_000n;
/** 65,000 * (1 - 8bps) in USDC base units. */
const AQUA_OUT_8BPS = 64_948_000_000n;

const request = (
  overrides: Partial<QuoteRequestParams & { strategyHash: Hex }> = {},
): QuoteRequestParams & { strategyHash: Hex } => ({
  chainId: 31337,
  tokenIn: WBTC.address,
  tokenOut: USDC.address,
  amountIn: ONE_WBTC,
  taker: TAKER,
  slippageBps: 30,
  strategyHash: STRATEGY_HASH,
  ...overrides,
});

interface HealthOverrides {
  coverageBps?: bigint;
  active?: boolean;
  solvent?: boolean;
}

// Mirrors what viem decodes for VortexAquaLens.StrategyHealth.
const health = (overrides: HealthOverrides = {}) => ({
  base: {
    token: WBTC.address,
    virtualBalance: 500_000_000n,
    actualBalance: 500_000_000n,
    aquaAllowance: 500_000_000n,
    executableBalance: 500_000_000n,
  },
  quote: {
    token: USDC.address,
    virtualBalance: 325_000_000_000n,
    actualBalance: 325_000_000_000n,
    aquaAllowance: 325_000_000_000n,
    executableBalance: 325_000_000_000n,
  },
  baseWeightBps: 5_000n,
  coverageBps: overrides.coverageBps ?? 10_000n,
  active: overrides.active ?? true,
  solvent: overrides.solvent ?? true,
});

// uint16 comes back as a number from viem, int256 as a bigint.
const breakdown = (inventoryAdjustmentBps = 0n) => ({
  safetyFeeBps: 5,
  commercialFeeBps: 3,
  inventoryAdjustmentBps,
  finalFeeBps: 8,
  oracleMidE18: 65_000n * 10n ** 18n,
  amountIn: ONE_WBTC,
  amountOut: AQUA_OUT_8BPS,
});

type ReadHandler = () => unknown;

interface Handlers {
  strategyHealth?: ReadHandler;
  quoteBreakdown?: ReadHandler;
  quote?: ReadHandler;
}

function buildSource(
  handlers: Handlers = {},
  overrides: Partial<LiveAquaQuoteSourceConfig> = {},
) {
  const readContract = vi.fn((args: { functionName: string }) => {
    const handler =
      handlers[args.functionName as keyof Handlers] ??
      (() => {
        throw new Error(`unexpected read ${args.functionName}`);
      });
    return Promise.resolve(handler());
  });
  const client = { readContract } as unknown as AquaReadClient;
  const source = createLiveAquaQuoteSource({
    client,
    lensAddress: LENS,
    routerAddress: ROUTER,
    oracleAddress: ORACLE,
    baseToken: WBTC.address,
    quoteToken: USDC.address,
    resolveOrder: () => ORDER,
    ...overrides,
  });
  return { source, readContract };
}

const happyHandlers = (
  routerQuote: () => unknown = () => [ONE_WBTC, AQUA_OUT_8BPS, STRATEGY_HASH],
): Handlers => ({
  strategyHealth: () => health(),
  quoteBreakdown: () => breakdown(),
  quote: routerQuote,
});

/** Mimics the viem error chain: execution error -> reverted error. */
const revertWith = (data: unknown): never => {
  throw Object.assign(new Error("execution reverted"), {
    name: "ContractFunctionExecutionError",
    cause: Object.assign(new Error("reverted"), {
      name: "ContractFunctionRevertedError",
      ...(typeof data === "string" ? { raw: data } : { data }),
    }),
  });
};

describe("live Aqua quote source", () => {
  it("maps lens + router reads onto an AquaQuote in WBTC/USDC base units", async () => {
    const { source } = buildSource(happyHandlers());

    const quote = await source.quote(request());

    expect(source.kind).toBe("live");
    expect(quote.amountIn).toBe(ONE_WBTC);
    expect(quote.amountOut).toBe(AQUA_OUT_8BPS);
    // 8 bps of 65,000 USDC = 52 USDC held back by the strategy.
    expect(MID_USDC - quote.amountOut).toBe(52_000_000n);
    expect(quote.safetyFeeBps).toBe(5);
    expect(quote.commercialFeeBps).toBe(3);
    expect(quote.inventoryAdjustmentBps).toBe(0);
    expect(quote.makerCoverageBps).toBe(10_000);
    expect(quote.strategyHash).toBe(STRATEGY_HASH);
    expect(quote.executable).toBe(true);
    expect(quote.reason).toBeUndefined();
    expect(quote.gasUnits).toBe(AQUA_SWAP_GAS_UNITS);
    expect(quote.gasCostInOutputToken).toBeNull();
  });

  it("applies slippage downward and never above amountOut", async () => {
    const { source } = buildSource(happyHandlers());

    const thirty = await source.quote(request({ slippageBps: 30 }));
    const zero = await source.quote(request({ slippageBps: 0 }));
    const wide = await source.quote(request({ slippageBps: 500 }));

    // 30 bps of 64,948 USDC = 194.844 USDC.
    expect(thirty.minimumAmountOut).toBe(AQUA_OUT_8BPS - 194_844_000n);
    expect(zero.minimumAmountOut).toBe(zero.amountOut);
    expect(wide.minimumAmountOut).toBeLessThan(thirty.minimumAmountOut);
    for (const q of [thirty, zero, wide]) {
      expect(q.minimumAmountOut).toBeLessThanOrEqual(q.amountOut);
    }
  });

  it("passes the lens and router the exact-in arguments blockend expects", async () => {
    const { source, readContract } = buildSource(happyHandlers(), {
      takerTraitsAndData: "0xc0ffee",
      rebateBps: 25,
    });

    await source.quote(request());

    const calls = readContract.mock.calls.map(
      ([args]) => args as unknown as { functionName: string; args: unknown[] },
    );
    const byName = new Map(calls.map((c) => [c.functionName, c.args]));
    expect(byName.get("strategyHealth")).toEqual([
      MAKER,
      STRATEGY_HASH,
      WBTC.address,
      USDC.address,
      ORACLE,
    ]);
    expect(byName.get("quoteBreakdown")).toEqual([
      { maker: MAKER, traits: 7n, data: "0xdeadbeef" },
      WBTC.address,
      USDC.address,
      true,
      ONE_WBTC,
      25,
    ]);
    expect(byName.get("quote")).toEqual([
      { maker: MAKER, traits: 7n, data: "0xdeadbeef" },
      WBTC.address,
      USDC.address,
      ONE_WBTC,
      "0xc0ffee",
    ]);
  });

  it("returns a decoded reason instead of throwing when the router reverts", async () => {
    const { source } = buildSource(
      happyHandlers(() =>
        revertWith({
          errorName: "VortexStaleOracle",
          args: [1_700_000_000n, 300],
        }),
      ),
    );

    const quote = await source.quote(request());

    expect(quote.executable).toBe(false);
    expect(quote.reason).toBe("VortexStaleOracle");
    expect(quote.amountOut).toBe(0n);
    expect(quote.minimumAmountOut).toBe(0n);
    // Fee/coverage context read before the revert is still reported.
    expect(quote.makerCoverageBps).toBe(10_000);
    expect(quote.safetyFeeBps).toBe(5);
  });

  it("decodes raw revert bytes with the hand-written error ABI", async () => {
    const raw = encodeErrorResult({
      abi: vortexErrorsAbi,
      errorName: "VortexMaxTradeExceeded",
      args: [1_500n, 1_000],
    });
    const { source } = buildSource(happyHandlers(() => revertWith(raw)));

    const quote = await source.quote(request());

    expect(quote.reason).toBe("VortexMaxTradeExceeded");
    expect(quote.executable).toBe(false);
  });

  it("falls back to a generic reason for an undecodable failure", async () => {
    const { source } = buildSource(
      happyHandlers(() => {
        throw new Error("socket hang up");
      }),
    );

    const quote = await source.quote(request());

    expect(quote.reason).toBe(AQUA_GENERIC_REVERT_REASON);
    expect(quote.executable).toBe(false);
  });

  it("surfaces a reverting fee breakdown without throwing", async () => {
    const { source } = buildSource({
      strategyHealth: () => health(),
      quoteBreakdown: () =>
        revertWith({
          errorName: "VortexInventoryBoundBreached",
          args: [8_500n, 3_000, 7_000],
        }),
    });

    const quote = await source.quote(request());

    expect(quote.reason).toBe("VortexInventoryBoundBreached");
    expect(quote.executable).toBe(false);
  });

  it("degrades to unexecutable when strategy health cannot be read", async () => {
    const { source } = buildSource({
      strategyHealth: () => {
        throw new Error("no rpc");
      },
    });

    const quote = await source.quote(request());

    expect(quote.executable).toBe(false);
    expect(quote.reason).toBe("AQUA_STRATEGY_HEALTH_UNAVAILABLE");
    expect(quote.makerCoverageBps).toBe(0);
  });

  it("degrades to unexecutable when the order cannot be resolved", async () => {
    const { source } = buildSource(happyHandlers(), {
      resolveOrder: () => {
        throw new Error("unknown strategy");
      },
    });

    const quote = await source.quote(request());

    expect(quote.executable).toBe(false);
    expect(quote.reason).toBe("AQUA_ORDER_UNAVAILABLE");
  });

  it("gates on active, solvent, and coverage", async () => {
    const inactive = await buildSource({
      ...happyHandlers(),
      strategyHealth: () => health({ active: false }),
    }).source.quote(request());
    const insolvent = await buildSource({
      ...happyHandlers(),
      strategyHealth: () => health({ solvent: false }),
    }).source.quote(request());
    const uncovered = await buildSource({
      ...happyHandlers(),
      strategyHealth: () => health({ coverageBps: 9_000n }),
    }).source.quote(request());

    expect(inactive.executable).toBe(false);
    expect(inactive.reason).toBe("AQUA_STRATEGY_INACTIVE");
    expect(insolvent.executable).toBe(false);
    expect(insolvent.reason).toBe("AQUA_STRATEGY_INSOLVENT");
    expect(uncovered.executable).toBe(false);
    expect(uncovered.reason).toBe("AQUA_MAKER_NOT_COVERED");
    expect(uncovered.makerCoverageBps).toBe(9_000);
  });

  it("accepts partial coverage when the configured minimum allows it", async () => {
    const { source } = buildSource(
      { ...happyHandlers(), strategyHealth: () => health({ coverageBps: 9_000n }) },
      { minimumCoverageBps: 8_000 },
    );

    const quote = await source.quote(request());

    expect(quote.executable).toBe(true);
    expect(quote.makerCoverageBps).toBe(9_000);
  });

  it("refuses to quote when the router's orderHash is not the strategyHash", async () => {
    const other: Hex = `0x${"b".repeat(64)}`;
    const { source } = buildSource(
      happyHandlers(() => [ONE_WBTC, AQUA_OUT_8BPS, other]),
    );

    const quote = await source.quote(request());

    expect(quote.executable).toBe(false);
    expect(quote.reason).toBe("AQUA_ORDER_HASH_MISMATCH");
  });

  it("treats a zero router output as VortexZeroAmountOut", async () => {
    const { source } = buildSource(
      happyHandlers(() => [ONE_WBTC, 0n, STRATEGY_HASH]),
    );

    const quote = await source.quote(request());

    expect(quote.executable).toBe(false);
    expect(quote.reason).toBe("VortexZeroAmountOut");
  });

  it("keeps a negative inventory adjustment negative", async () => {
    const { source } = buildSource({
      ...happyHandlers(),
      quoteBreakdown: () => breakdown(-12n),
    });

    const quote = await source.quote(request());

    expect(quote.inventoryAdjustmentBps).toBe(-12);
    expect(quote.executable).toBe(true);
  });

  it("decodeAquaRevertReason walks nested causes and gives up cleanly", () => {
    const nested = {
      cause: { cause: { data: { errorName: "VortexMakerNotCovered" } } },
    };
    expect(decodeAquaRevertReason(nested)).toBe("VortexMakerNotCovered");
    expect(decodeAquaRevertReason(new Error("reverted: VortexZeroAmountOut"))).toBe(
      "VortexZeroAmountOut",
    );
    expect(decodeAquaRevertReason(undefined, "FALLBACK")).toBe("FALLBACK");
  });
});

const fixtureConfig = (
  ...overrides: Partial<FixtureAquaConfig>[]
): Partial<FixtureAquaConfig> =>
  overrides.reduce((acc, o) => ({ ...acc, ...o }), {
    baseToken: { address: WBTC.address, decimals: WBTC.decimals },
    quoteToken: { address: USDC.address, decimals: USDC.decimals },
  } as Partial<FixtureAquaConfig>);

/** minimumAmountOut minus gas priced in the output token — how venues rank. */
const netOf = (minimumAmountOut: bigint, gasInOutputToken: bigint): bigint =>
  minimumAmountOut - gasInOutputToken > 0n
    ? minimumAmountOut - gasInOutputToken
    : 0n;

describe("fixture Aqua quote source", () => {
  it("labels itself as fixture data and prices WBTC -> USDC at 8 decimals in", async () => {
    const source = createFixtureAquaQuoteSource(
      fixtureConfig(AQUA_COMPETITIVE_FIXTURE),
    );

    const quote = await source.quote(request());

    expect(source.kind).toBe("fixture");
    expect(quote.amountOut).toBe(AQUA_OUT_8BPS);
    expect(quote.minimumAmountOut).toBe(AQUA_OUT_8BPS - 194_844_000n);
    expect(quote.executable).toBe(true);
    expect(quote.safetyFeeBps + quote.commercialFeeBps).toBe(8);
  });

  it("prices the USDC -> WBTC direction with 6-decimal input", async () => {
    const source = createFixtureAquaQuoteSource(
      fixtureConfig(AQUA_COMPETITIVE_FIXTURE),
    );

    const quote = await source.quote(
      request({
        tokenIn: USDC.address,
        tokenOut: WBTC.address,
        amountIn: MID_USDC,
      }),
    );

    // 1 WBTC less the 8 bps fee = 0.9992 WBTC in 8-decimal base units.
    expect(quote.amountOut).toBe(99_920_000n);
    expect(quote.executable).toBe(true);
  });

  it("is deterministic across calls and instances", async () => {
    const a = createFixtureAquaQuoteSource(fixtureConfig(AQUA_COMPETITIVE_FIXTURE));
    const b = createFixtureAquaQuoteSource(fixtureConfig(AQUA_COMPETITIVE_FIXTURE));

    const first = await a.quote(request());
    const second = await a.quote(request());
    const third = await b.quote(request());

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("can be configured to beat or lose to a Uniswap reference on net output", async () => {
    // Reference AMM leg: 30 bps worse than mid, 30 bps slippage, 0.5 USDC gas.
    const uniswapAmountOut = 64_805_000_000n;
    const uniswapMinimum = uniswapAmountOut - (uniswapAmountOut * 30n) / 10_000n;
    const gasInUsdc = 500_000n;
    const uniswapNet = netOf(uniswapMinimum, gasInUsdc);

    const winner = await createFixtureAquaQuoteSource(
      fixtureConfig(AQUA_COMPETITIVE_FIXTURE),
    ).quote(request());
    const loser = await createFixtureAquaQuoteSource(
      fixtureConfig(AQUA_UNCOMPETITIVE_FIXTURE),
    ).quote(request());

    expect(netOf(winner.minimumAmountOut, gasInUsdc)).toBeGreaterThan(uniswapNet);
    expect(netOf(loser.minimumAmountOut, gasInUsdc)).toBeLessThan(uniswapNet);
    expect(winner.executable).toBe(true);
    expect(loser.executable).toBe(true);
  });

  it("pays a premium when the inventory adjustment is negative", async () => {
    const flat = await createFixtureAquaQuoteSource(
      fixtureConfig({ safetyFeeBps: 0, commercialFeeBps: 0, inventoryAdjustmentBps: 0 }),
    ).quote(request());
    const discounted = await createFixtureAquaQuoteSource(
      fixtureConfig({
        safetyFeeBps: 0,
        commercialFeeBps: 0,
        inventoryAdjustmentBps: -20,
      }),
    ).quote(request());

    expect(flat.amountOut).toBe(MID_USDC);
    expect(discounted.amountOut).toBe(MID_USDC + 130_000_000n);
    expect(discounted.inventoryAdjustmentBps).toBe(-20);
  });

  it("honours a forced reason without touching the pricing path", async () => {
    const source = createFixtureAquaQuoteSource(
      fixtureConfig({ forcedReason: "VortexStaleOracle" }),
    );

    const quote = await source.quote(request());

    expect(quote.executable).toBe(false);
    expect(quote.reason).toBe("VortexStaleOracle");
    expect(quote.amountOut).toBe(0n);
    expect(quote.minimumAmountOut).toBe(0n);
  });

  it("gates on coverage, activity, and solvency", async () => {
    const uncovered = await createFixtureAquaQuoteSource(
      fixtureConfig({ makerCoverageBps: 6_000 }),
    ).quote(request());
    const relaxed = await createFixtureAquaQuoteSource(
      fixtureConfig({ makerCoverageBps: 6_000, minimumCoverageBps: 5_000 }),
    ).quote(request());
    const inactive = await createFixtureAquaQuoteSource(
      fixtureConfig({ active: false }),
    ).quote(request());
    const insolvent = await createFixtureAquaQuoteSource(
      fixtureConfig({ solvent: false }),
    ).quote(request());

    expect(uncovered.executable).toBe(false);
    expect(uncovered.reason).toBe("AQUA_MAKER_NOT_COVERED");
    expect(uncovered.makerCoverageBps).toBe(6_000);
    expect(relaxed.executable).toBe(true);
    expect(inactive.reason).toBe("AQUA_STRATEGY_INACTIVE");
    expect(insolvent.reason).toBe("AQUA_STRATEGY_INSOLVENT");
  });

  it("rejects a pair the strategy does not hold", async () => {
    const source = createFixtureAquaQuoteSource(fixtureConfig());

    const quote = await source.quote(
      request({ tokenIn: "0x6666666666666666666666666666666666666666" }),
    );

    expect(quote.executable).toBe(false);
    expect(quote.reason).toBe("VortexUnsupportedTokenPair");
  });

  it("never returns a minimum above the quoted output", async () => {
    const source = createFixtureAquaQuoteSource(fixtureConfig());

    for (const slippageBps of [0, 1, 30, 100, 10_000]) {
      const quote = await source.quote(request({ slippageBps }));
      expect(quote.minimumAmountOut).toBeLessThanOrEqual(quote.amountOut);
      expect(quote.minimumAmountOut).toBeGreaterThanOrEqual(0n);
    }
  });

  it("reports the documented gas estimate and defers gas pricing to the comparator", async () => {
    const quote = await createFixtureAquaQuoteSource(fixtureConfig()).quote(
      request(),
    );

    expect(quote.gasUnits).toBe(AQUA_SWAP_GAS_UNITS);
    expect(quote.gasCostInOutputToken).toBeNull();
  });
});
