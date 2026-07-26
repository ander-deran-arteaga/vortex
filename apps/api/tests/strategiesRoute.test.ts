import {
  API_ROUTES,
  zApiError,
  zExchangeQuoteResponse,
  zStrategyHealth,
} from "@vortex/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  AQUA_COMPETITIVE_FIXTURE,
  createFixtureAquaQuoteSource,
  DEMO_STRATEGY_HASH,
} from "../src/clients/fixtureAquaQuoteSource";
import { buildServer, type BuiltServer } from "../src/server";

const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const TAKER = "0x1111111111111111111111111111111111111111";
const KNOWN = `0x${"ab".repeat(32)}` as const;
const UNKNOWN = `0x${"cd".repeat(32)}` as const;

let built: BuiltServer | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const serve = (overrides = {}) =>
  buildServer(
    { CHAIN_ID: "42161" },
    {
      envSource: {},
      uniswapClient: null,
      aquaSource: createFixtureAquaQuoteSource({
        ...AQUA_COMPETITIVE_FIXTURE,
        knownStrategyHash: KNOWN,
        ...overrides,
      }),
    },
  );

describe(`GET ${API_ROUTES.strategies}/:strategyHash`, () => {
  it("returns coverage for a known strategy", async () => {
    built = serve();
    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${KNOWN}`,
    });

    expect(res.statusCode).toBe(200);
    const body = zStrategyHealth.parse(res.json());
    expect(body.strategyHash).toBe(KNOWN);
    expect(body.active).toBe(true);
    expect(body.solvent).toBe(true);
    expect(body.tokens.map((t) => t.symbol)).toEqual(["WBTC", "USDC"]);
    // Executable balance is what can actually settle, never the virtual figure.
    for (const token of body.tokens) {
      expect(BigInt(token.executableBalance)).toBeLessThanOrEqual(
        BigInt(token.virtualBalance),
      );
    }
  });

  it("distinguishes a missing strategy from a missing route", async () => {
    built = serve();

    const missingStrategy = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${UNKNOWN}`,
    });
    const missingRoute = await built.app.inject({
      method: "GET",
      url: "/api/v1/no-such-endpoint",
    });

    expect(missingStrategy.statusCode).toBe(404);
    expect(zApiError.parse(missingStrategy.json()).error.code).toBe(
      "STRATEGY_NOT_FOUND",
    );

    expect(missingRoute.statusCode).toBe(404);
    expect(zApiError.parse(missingRoute.json()).error.code).toBe("NOT_FOUND");
  });

  it("rejects a malformed strategy hash", async () => {
    built = serve();
    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/0x1234`,
    });

    expect(res.statusCode).toBe(400);
    expect(zApiError.parse(res.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("reports an inactive or insolvent maker without pretending it is absent", async () => {
    built = serve({ active: false, solvent: false });
    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${KNOWN}`,
    });

    expect(res.statusCode).toBe(200);
    const body = zStrategyHealth.parse(res.json());
    expect(body.active).toBe(false);
    expect(body.solvent).toBe(false);
  });
});

/**
 * MASTER Addendum 7: Vortex Swap's Aqua route is independent of Vortex
 * PermAMM. Aqua quoting and strategy health must work with every PermAMM
 * address absent from the deployment file.
 */
describe("Vortex Swap works with no PermAMM deployed", () => {
  const PERMAMM_CONTRACTS = [
    "VortexHook",
    "VortexRouter",
    "VortexQuoter",
    "VortexLiquidityManager",
    "VortexFeeAuthorization",
    "PoolManager",
  ];

  it("has no PermAMM address in the deployment the server loads", () => {
    built = serve();
    for (const name of PERMAMM_CONTRACTS) {
      expect(
        built.ctx.deployment.contracts[
          name as keyof typeof built.ctx.deployment.contracts
        ],
      ).toBeUndefined();
    }
  });

  it("quotes and selects the Aqua venue anyway", async () => {
    built = serve();
    const res = await built.app.inject({
      method: "POST",
      url: API_ROUTES.exchangeQuote,
      payload: {
        chainId: 42161,
        strategyHash: KNOWN,
        tokenIn: WBTC,
        tokenOut: USDC,
        amountIn: "1000000",
        taker: TAKER,
        slippageBps: 30,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = zExchangeQuoteResponse.parse(res.json());
    expect(body.selectedVenue).toBe("AQUA");
    expect(body.execution.kind).toBe("AQUA_SWAPVM");
  });

  it("serves strategy health anyway", async () => {
    built = serve();
    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${KNOWN}`,
    });

    expect(res.statusCode).toBe(200);
  });
});

describe("default fixture configuration", () => {
  it("knows only the demo strategy, so unshipped hashes are not invented", async () => {
    // Regression guard: a fixture that answers for every hash would render a
    // strategy nobody shipped as healthy data (§21).
    built = buildServer(
      { CHAIN_ID: "42161" },
      { envSource: {}, uniswapClient: null },
    );

    const known = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${DEMO_STRATEGY_HASH}`,
    });
    const unknown = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${UNKNOWN}`,
    });

    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(404);
    expect(zApiError.parse(unknown.json()).error.code).toBe(
      "STRATEGY_NOT_FOUND",
    );
  });
});

describe("token symbols are derived, never assumed from position", () => {
  it("labels each balance from its address", async () => {
    built = serve();
    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${KNOWN}`,
    });

    const body = zStrategyHealth.parse(res.json());
    const bySymbol = new Map(body.tokens.map((t) => [t.symbol, t.address]));
    expect(bySymbol.get("WBTC")?.toLowerCase()).toBe(WBTC.toLowerCase());
    expect(bySymbol.get("USDC")?.toLowerCase()).toBe(USDC.toLowerCase());
  });

  it("does not mislabel a balance when the pair is configured reversed", async () => {
    // Swapping the base/quote slots must swap the symbols too. Hardcoding the
    // symbol per position would report the maker's USDC balance as WBTC.
    built = buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        uniswapClient: null,
        aquaSource: createFixtureAquaQuoteSource({
          ...AQUA_COMPETITIVE_FIXTURE,
          knownStrategyHash: KNOWN,
          baseToken: { address: USDC as `0x${string}`, decimals: 6 },
          quoteToken: { address: WBTC as `0x${string}`, decimals: 8 },
          baseInventory: 65_000_000_000n,
          quoteInventory: 100_000_000n,
        }),
      },
    );

    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${KNOWN}`,
    });

    const body = zStrategyHealth.parse(res.json());
    // First slot is now USDC, and it must say so.
    expect(body.tokens[0]!.symbol).toBe("USDC");
    expect(body.tokens[0]!.address.toLowerCase()).toBe(USDC.toLowerCase());
    expect(body.tokens[1]!.symbol).toBe("WBTC");
    expect(body.tokens[1]!.address.toLowerCase()).toBe(WBTC.toLowerCase());
  });

  it("reports an unknown token honestly instead of guessing", async () => {
    const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
    built = buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        uniswapClient: null,
        aquaSource: createFixtureAquaQuoteSource({
          ...AQUA_COMPETITIVE_FIXTURE,
          knownStrategyHash: KNOWN,
          quoteToken: { address: WETH as `0x${string}`, decimals: 18 },
        }),
      },
    );

    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${KNOWN}`,
    });

    const body = zStrategyHealth.parse(res.json());
    expect(body.tokens[1]!.symbol).toBe("UNKNOWN");
    expect(body.tokens[1]!.address.toLowerCase()).toBe(WETH.toLowerCase());
  });
});

/**
 * MASTER Addendum 24: Vortex Grow is a SINGLE-ASSET strategy. Querying it as
 * a token pair made Aqua revert, which the API reported as STRATEGY_NOT_FOUND
 * for a strategy that was shipped and compounding — and then advised a
 * redeploy, which the bring-up script correctly refused to do. A loop with no
 * exit over a healthy chain.
 */
describe("single-asset Grow strategy health", () => {
  const GROW_HASH = `0x${"cf".repeat(32)}` as `0x${string}`;
  const ASSET = WBTC as `0x${string}`;
  const MAKER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
  const COMPOUNDER = "0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1" as `0x${string}`;

  const growContext = (virtual: bigint, executable = virtual) =>
    ({
      deployment: {
        strategyHash: GROW_HASH,
        compounder: COMPOUNDER,
        strategy: { maker: MAKER, asset: ASSET },
      },
      client: {
        readContract: async ({ functionName }: { functionName: string }) => {
          if (functionName === "rawBalances") return virtual;
          if (functionName === "safeBalances") return [executable, executable];
          if (functionName === "balanceOf") return virtual + 1_000_000n;
          if (functionName === "allowance") return 2n ** 256n - 1n;
          throw new Error(`unexpected ${functionName}`);
        },
      },
    }) as never;

  // 31337, because the Grow branch needs an `Aqua` address in the deployment;
  // 42161 ships an empty contract set.
  const serveGrow = (grow: unknown) =>
    buildServer(
      { CHAIN_ID: "31337" },
      { envSource: {}, uniswapClient: null, grow: grow as never },
    );

  it("returns healthy coverage for a shipped single-asset strategy", async () => {
    built = serveGrow(growContext(508_811_174n));
    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${GROW_HASH}`,
    });

    expect(res.statusCode).toBe(200);
    const body = zStrategyHealth.parse(res.json());
    expect(body.active).toBe(true);
    expect(body.solvent).toBe(true);
    expect(body.coverageBps).toBe(10_000);
    // Exactly ONE token — the strategy's real asset set, not a pair.
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]!.virtualBalance).toBe("508811174");
  });

  it("still reports a genuinely unshipped strategy as not found", async () => {
    // Zero virtual balance is the one honest "absent".
    built = serveGrow(growContext(0n));
    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${GROW_HASH}`,
    });

    expect(res.statusCode).toBe(404);
    expect(zApiError.parse(res.json()).error.code).toBe("STRATEGY_NOT_FOUND");
  });

  it("never advises a redeploy — that guidance is a loop with no exit", async () => {
    built = serveGrow(growContext(0n));
    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${GROW_HASH}`,
    });

    const message = zApiError.parse(res.json()).error.message;
    expect(message).not.toContain("ensure-demo");
    expect(message).not.toContain("re-run");
  });

  it("reports an asset mismatch as its own fact, not as not-found", async () => {
    const reverting = {
      deployment: {
        strategyHash: GROW_HASH,
        compounder: COMPOUNDER,
        strategy: { maker: MAKER, asset: ASSET },
      },
      client: {
        readContract: async () => {
          throw new Error(
            "execution reverted: custom error 0xb63386a6 SafeBalancesForTokenNotInActiveStrategy",
          );
        },
      },
    };
    built = serveGrow(reverting);

    const res = await built.app.inject({
      method: "GET",
      url: `${API_ROUTES.strategies}/${GROW_HASH}`,
    });

    // "active but holds a different token" is NOT "absent".
    expect(res.statusCode).toBe(409);
    expect(zApiError.parse(res.json()).error.code).toBe(
      "STRATEGY_ASSET_MISMATCH",
    );
  });
});
