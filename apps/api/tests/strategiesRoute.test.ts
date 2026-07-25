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
