import { API_ROUTES, zApiError, zExchangeQuoteResponse } from "@vortex/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  AQUA_COMPETITIVE_FIXTURE,
  AQUA_UNCOMPETITIVE_FIXTURE,
  createFixtureAquaQuoteSource,
} from "../src/clients/fixtureAquaQuoteSource";
import type { UniswapApiClient } from "../src/clients/uniswapApiClient";
import { UniswapApiError } from "../src/clients/uniswapApiClient";
import { createExecutionStore } from "../src/store/executions";
import {
  createQuoteSessionStore,
  type ExchangeSessionPayload,
} from "../src/store/quoteSessions";
import { buildServer, type BuiltServer } from "../src/server";
import type { JsonStoreFs } from "../src/store/jsonStore";

const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const TAKER = "0x1111111111111111111111111111111111111111";
const STRATEGY = `0x${"ab".repeat(32)}`;
const UNIVERSAL_ROUTER = "0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3";

let built: BuiltServer | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

/** In-memory fs so evidence records never touch the real filesystem. */
function memoryFs(): JsonStoreFs {
  const files = new Map<string, string>();
  return {
    mkdirSync: () => undefined,
    appendFileSync: (path: string, data: string) => {
      files.set(path, (files.get(path) ?? "") + data);
    },
    readFileSync: (path: string) => {
      const content = files.get(path);
      if (content === undefined) {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return content;
    },
    existsSync: (path: string) => files.has(path),
  } as unknown as JsonStoreFs;
}

/**
 * The live-verified WBTC/USDC quote (docs/uniswap-api.md): 0.01 WBTC in,
 * 640.148143 USDC out at a ~64_000 mid.
 */
function uniswapQuoteResponse(overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req-uniswap-1",
    routing: "CLASSIC",
    isTokenApprovalApplicable: true,
    permitData: null,
    permitTransaction: null,
    quote: {
      chainId: 42161,
      swapper: TAKER,
      tradeType: "EXACT_INPUT",
      route: [],
      input: { amount: "1000000", token: WBTC, maximumAmount: "1000000" },
      output: {
        amount: "640148143",
        token: USDC,
        recipient: TAKER,
        minimumAmount: "638227698",
      },
      slippage: 0.3,
      priceImpact: 0.05,
      gasFee: "2117203956000",
      gasFeeUSD: "0.00375156520097671",
      gasFeeQuote: "3751",
      gasUseEstimate: "100618",
      routeString: "[V3] WBTC -> USDC",
      blockNumber: "487596461",
      quoteId: "q-1",
      maxFeePerGas: "21040000",
      maxPriorityFeePerGas: "0",
      txFailureReasons: [],
      ...overrides,
    },
  };
}

function stubUniswapClient(
  overrides: Partial<UniswapApiClient> = {},
): UniswapApiClient {
  const quoteResponse = uniswapQuoteResponse();
  return {
    getClassicQuote: async () => ({
      requestId: quoteResponse.requestId,
      routing: quoteResponse.routing,
      quote: quoteResponse.quote as never,
      rawQuote: quoteResponse.quote,
      permitData: null,
      permitTransaction: null,
      approvalRequired: true,
    }),
    createSwapTransaction: async () => ({
      requestId: "req-swap-1",
      swap: {
        to: UNIVERSAL_ROUTER,
        from: TAKER,
        data: "0x3593564cdeadbeef",
        value: "0x00",
        gasLimit: "100618",
        chainId: 42161,
      } as never,
      gasFee: "2112978000000",
    }),
    checkApproval: async () => ({
      requestId: "req-approval-1",
      approval: null,
      cancel: null,
    }),
    getSwapStatus: async () => ({ requestId: "req-status-1", swaps: [] }),
    ...overrides,
  };
}

function serverWith(
  aquaOverrides: Parameters<typeof createFixtureAquaQuoteSource>[0],
  uniswapClient: UniswapApiClient | null = stubUniswapClient(),
): BuiltServer {
  return buildServer(
    { CHAIN_ID: "42161" },
    {
      envSource: {},
      aquaSource: createFixtureAquaQuoteSource({
        // Mid above Uniswap's post-fee execution price, so the maker's own
        // fee bps is what decides the winner.
        midPriceE18: 64_500n * 10n ** 18n,
        ...aquaOverrides,
      }),
      uniswapClient,
      executions: createExecutionStore({
        dir: "/evidence",
        fs: memoryFs(),
        now: () => 1_753_000_000_000,
      }),
    },
  );
}

const quoteBody = {
  chainId: 42161,
  strategyHash: STRATEGY,
  tokenIn: WBTC,
  tokenOut: USDC,
  amountIn: "1000000",
  taker: TAKER,
  slippageBps: 30,
};

const postQuote = (
  server: BuiltServer,
  body: Record<string, unknown> = quoteBody,
) =>
  server.app.inject({
    method: "POST",
    url: API_ROUTES.exchangeQuote,
    payload: body,
  });

describe(`POST ${API_ROUTES.exchangeQuote}`, () => {
  it("selects AQUA when the maker's all-in fee beats the AMM route", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE);
    const res = await postQuote(built);

    expect(res.statusCode).toBe(200);
    const body = zExchangeQuoteResponse.parse(res.json());
    expect(body.selectedVenue).toBe("AQUA");
    expect(body.execution.kind).toBe("AQUA_SWAPVM");
    // Both sides are always reported so the UI can show the comparison.
    expect(body.comparison.aqua).not.toBeNull();
    expect(body.comparison.uniswap).not.toBeNull();
    expect(BigInt(body.comparison.aqua!.netAmountOut)).toBeGreaterThan(
      BigInt(body.comparison.uniswap!.netAmountOut),
    );
  });

  it("labels the Aqua leg as fixture data so the UI cannot present it as live (§21)", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE);
    const body = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    expect(body.comparison.aqua!.source).toBe("fixture");
    // Uniswap quotes only ever come from the authenticated live API.
    expect(body.comparison.uniswap!.source).toBe("live");
  });

  it("selects UNISWAP when the maker is stressed and prices badly", async () => {
    built = serverWith(AQUA_UNCOMPETITIVE_FIXTURE);
    const res = await postQuote(built);

    expect(res.statusCode).toBe(200);
    const body = zExchangeQuoteResponse.parse(res.json());
    expect(body.selectedVenue).toBe("UNISWAP");
    expect(body.execution.kind).toBe("UNISWAP_API");
    expect(BigInt(body.comparison.uniswap!.netAmountOut)).toBeGreaterThan(
      BigInt(body.comparison.aqua!.netAmountOut),
    );
    expect(body.comparison.uniswap!.requestId).toBe("req-uniswap-1");
  });

  it("falls back to UNISWAP when the strategy cannot settle", async () => {
    built = serverWith({
      ...AQUA_COMPETITIVE_FIXTURE,
      forcedReason: "VortexStaleOracle",
    });
    const res = await postQuote(built);

    const body = zExchangeQuoteResponse.parse(res.json());
    // Even with the better headline price, a non-executable maker cannot win.
    expect(body.selectedVenue).toBe("UNISWAP");
  });

  it("still serves an Aqua quote when the Uniswap API is unavailable", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE, null);
    const res = await postQuote(built);

    const body = zExchangeQuoteResponse.parse(res.json());
    expect(body.selectedVenue).toBe("AQUA");
    expect(body.comparison.uniswap).toBeNull();
  });

  it("reports 503 when neither venue can price the trade", async () => {
    built = serverWith(
      { forcedReason: "VortexStaleOracle" },
      stubUniswapClient({
        getClassicQuote: async () => {
          throw new UniswapApiError({
            httpStatus: 404,
            errorCode: "ResourceNotFound",
            detail: "no quotes available",
            requestId: null,
          });
        },
      }),
    );
    const res = await postQuote(built);

    expect(res.statusCode).toBe(503);
    expect(zApiError.parse(res.json()).error.code).toBe("NO_VENUE_AVAILABLE");
  });

  it("uses epoch milliseconds for expiresAt (D-010) with a 45s TTL", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE);
    const before = Date.now();
    const body = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    // Seconds would be ~1e9; milliseconds are ~1e12.
    expect(body.expiresAt).toBeGreaterThan(1e12);
    expect(body.expiresAt - before).toBeGreaterThan(40_000);
    expect(body.expiresAt - before).toBeLessThanOrEqual(46_000);
  });

  it("rejects a chain the server is not configured for", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE);
    const res = await postQuote(built, { ...quoteBody, chainId: 31337 });

    expect(res.statusCode).toBe(400);
    expect(zApiError.parse(res.json()).error.code).toBe("CHAIN_MISMATCH");
  });

  it("rejects a malformed request body with the validation envelope", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE);
    const res = await postQuote(built, { ...quoteBody, amountIn: "-5" });

    expect(res.statusCode).toBe(400);
    expect(zApiError.parse(res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe(`POST ${API_ROUTES.transactionsUniswap}`, () => {
  const buildTx = (server: BuiltServer, quoteSessionId: string) =>
    server.app.inject({
      method: "POST",
      url: API_ROUTES.transactionsUniswap,
      payload: { quoteSessionId },
    });

  it("builds a transaction from the server-side stored quote", async () => {
    built = serverWith(AQUA_UNCOMPETITIVE_FIXTURE);
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    const res = await buildTx(built, quote.quoteSessionId);

    expect(res.statusCode).toBe(200);
    const body = res.json() as { to: string; data: string; requestId: string };
    expect(body.to).toBe(UNIVERSAL_ROUTER);
    expect(body.data).toBe("0x3593564cdeadbeef");
    expect(body.requestId).toBe("req-swap-1");
  });

  it("records evidence linking the Uniswap request id to the execution", async () => {
    built = serverWith(AQUA_UNCOMPETITIVE_FIXTURE);
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());
    await buildTx(built, quote.quoteSessionId);

    const res = await built.app.inject({
      method: "GET",
      url: API_ROUTES.executions,
    });
    const { executions } = res.json() as {
      executions: {
        uniswapRequestId: string | null;
        kind: string;
        txHash: string | null;
        amountOut: string | null;
      }[];
    };

    expect(executions).toHaveLength(1);
    expect(executions[0]!.kind).toBe("BEST_EXECUTION_UNISWAP");
    expect(executions[0]!.uniswapRequestId).toBe("req-uniswap-1");
    // Built, not settled: a quoted amount must never look like a fill.
    expect(executions[0]!.txHash).toBeNull();
    expect(executions[0]!.amountOut).toBeNull();
  });

  it("refuses to reuse a session — quotes are single-use", async () => {
    built = serverWith(AQUA_UNCOMPETITIVE_FIXTURE);
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    expect((await buildTx(built, quote.quoteSessionId)).statusCode).toBe(200);
    const replay = await buildTx(built, quote.quoteSessionId);

    expect(replay.statusCode).toBe(409);
    expect(zApiError.parse(replay.json()).error.code).toBe(
      "SESSION_ALREADY_USED",
    );
  });

  it("rejects an unknown session id", async () => {
    built = serverWith(AQUA_UNCOMPETITIVE_FIXTURE);
    const res = await buildTx(built, "00000000-0000-4000-8000-000000000000");

    expect(res.statusCode).toBe(404);
    expect(zApiError.parse(res.json()).error.code).toBe(
      "SESSION_NOT_FOUND",
    );
  });

  it("surfaces an upstream API failure as 502, not as the caller's fault", async () => {
    built = serverWith(
      AQUA_UNCOMPETITIVE_FIXTURE,
      stubUniswapClient({
        createSwapTransaction: async () => {
          throw new UniswapApiError({
            httpStatus: 429,
            errorCode: "TooManyRequests",
            detail: "Rate limit exceeded",
            requestId: "rl-1",
          });
        },
      }),
    );
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    const res = await buildTx(built, quote.quoteSessionId);

    expect(res.statusCode).toBe(502);
    expect(zApiError.parse(res.json()).error.code).toBe("TooManyRequests");
  });

  it("refuses to build a Uniswap transaction for an Aqua-selected session", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE, null);
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    const res = await buildTx(built, quote.quoteSessionId);

    expect(res.statusCode).toBe(409);
    expect(zApiError.parse(res.json()).error.code).toBe("NOT_A_UNISWAP_SESSION");
  });
});

describe("quote session lifecycle", () => {
  it("sweeps expired sessions so abandoned quotes cannot grow unbounded", async () => {
    let clock = 1_785_000_000_000;
    const sessions = createQuoteSessionStore<ExchangeSessionPayload>({
      now: () => clock,
    });
    built = buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource(AQUA_COMPETITIVE_FIXTURE),
        uniswapClient: stubUniswapClient(),
        sessions,
      },
    );

    // Three quotes nobody ever executes.
    await postQuote(built);
    await postQuote(built);
    await postQuote(built);
    expect(sessions.size).toBe(3);

    clock += 46_000;
    expect(sessions.sweep()).toBe(3);
    expect(sessions.size).toBe(0);
  });

  it("rejects a build against an expired session", async () => {
    let clock = 1_785_000_000_000;
    const sessions = createQuoteSessionStore<ExchangeSessionPayload>({
      now: () => clock,
    });
    built = buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource(AQUA_UNCOMPETITIVE_FIXTURE),
        uniswapClient: stubUniswapClient(),
        sessions,
      },
    );

    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());
    clock += 46_000;

    const res = await built.app.inject({
      method: "POST",
      url: API_ROUTES.transactionsUniswap,
      payload: { quoteSessionId: quote.quoteSessionId },
    });

    expect(res.statusCode).toBe(410);
    expect(zApiError.parse(res.json()).error.code).toBe("SESSION_EXPIRED");
  });
});

describe("venue viability and error hygiene", () => {
  const failingSimulation = () =>
    stubUniswapClient({
      getClassicQuote: async () => {
        const q = uniswapQuoteResponse({
          txFailureReasons: ["SIMULATION_ERROR"],
        });
        return {
          requestId: q.requestId,
          routing: q.routing,
          quote: q.quote as never,
          rawQuote: q.quote,
          permitData: null,
          permitTransaction: null,
          approvalRequired: true,
        };
      },
    });

  it("refuses to route to a Uniswap quote its own simulation failed", async () => {
    // Aqua cannot settle either, so the only 'available' venue is the broken
    // one. Routing there would hand the taker a reverting transaction.
    built = serverWith({ forcedReason: "VortexStaleOracle" }, failingSimulation());
    const res = await postQuote(built);

    expect(res.statusCode).toBe(503);
    const body = zApiError.parse(res.json());
    expect(body.error.code).toBe("NO_VENUE_AVAILABLE");
    expect(body.error.message).toContain("SIMULATION_ERROR");
  });

  it("prefers an executable Aqua quote over a failing Uniswap simulation", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE, failingSimulation());
    const body = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    expect(body.selectedVenue).toBe("AQUA");
  });

  it("refuses to build a Uniswap swap for a session where Aqua won", async () => {
    // Uniswap quoted fine here, so `uniswap` is stored on the session; only
    // selectedVenue distinguishes it.
    built = serverWith(AQUA_COMPETITIVE_FIXTURE);
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());
    expect(quote.selectedVenue).toBe("AQUA");

    const res = await built.app.inject({
      method: "POST",
      url: API_ROUTES.transactionsUniswap,
      payload: { quoteSessionId: quote.quoteSessionId },
    });

    expect(res.statusCode).toBe(409);
    expect(zApiError.parse(res.json()).error.code).toBe("NOT_A_UNISWAP_SESSION");
  });

  it("suppresses internal error codes as well as messages on 5xx", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE);
    built.app.get("/boom", () => {
      const err = new Error("secret detail") as Error & { code: string };
      err.code = "ENOENT_SECRET_PATH";
      throw err;
    });

    const res = await built.app.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(500);
    const body = zApiError.parse(res.json());
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(res.body).not.toContain("ENOENT_SECRET_PATH");
    expect(res.body).not.toContain("secret detail");
  });
});

/**
 * MASTER Addendum 9 standing rule: anything whose behaviour depends on address
 * sort order, chain id, or block time must be tested in BOTH branches.
 *
 * The token direction is this backend's instance of that rule. Every other
 * test here quotes WBTC -> USDC, so the output token is always 6 decimals and
 * `gasFeeQuote` is always denominated in USDC. Reversed, the output token has
 * 8 decimals and the live API returns a gas figure of ~5 satoshis — small
 * enough that a rounding slip is a fifth of the whole number.
 *
 * Live-probed reference (2026-07-25): 640 USDC in -> 995477 sats out,
 * minimum 992490, gasUseEstimate 100676, gasFeeQuote 5.
 */
describe("both token directions", () => {
  const AMOUNT_USDC_IN = "640000000"; // 640 USDC, 6 decimals
  const UNI_WBTC_OUT = "995477"; // satoshis, 8 decimals
  const UNI_WBTC_MIN = "992490";

  function reverseUniswapClient(): UniswapApiClient {
    const quote = {
      chainId: 42161,
      swapper: TAKER,
      tradeType: "EXACT_INPUT",
      route: [],
      input: { amount: AMOUNT_USDC_IN, token: USDC, maximumAmount: AMOUNT_USDC_IN },
      output: {
        amount: UNI_WBTC_OUT,
        token: WBTC,
        recipient: TAKER,
        minimumAmount: UNI_WBTC_MIN,
      },
      slippage: 0.3,
      priceImpact: 0.02,
      gasFee: "2117203956000",
      gasFeeUSD: "0.0037639702186518247",
      gasFeeQuote: "5", // satoshis — the whole gas cost in the output token
      gasUseEstimate: "100676",
      routeString: "[V3] USDC -> WBTC",
      blockNumber: "487600000",
      quoteId: "q-rev",
      maxFeePerGas: "21040000",
      maxPriorityFeePerGas: "0",
      txFailureReasons: [],
    };
    return stubUniswapClient({
      getClassicQuote: async () => ({
        requestId: "req-uniswap-reverse",
        routing: "CLASSIC",
        quote: quote as never,
        rawQuote: quote,
        permitData: null,
        permitTransaction: null,
        approvalRequired: true,
      }),
    });
  }

  const reverseServer = (midE18: bigint, fixture: Record<string, unknown>) =>
    buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          midPriceE18: midE18,
          ...fixture,
        }),
        uniswapClient: reverseUniswapClient(),
        executions: createExecutionStore({
          dir: "/evidence",
          fs: memoryFs(),
          now: () => 1_753_000_000_000,
        }),
      },
    );

  const reverseQuote = (server: BuiltServer) =>
    server.app.inject({
      method: "POST",
      url: API_ROUTES.exchangeQuote,
      payload: {
        chainId: 42161,
        strategyHash: STRATEGY,
        tokenIn: USDC,
        tokenOut: WBTC,
        amountIn: AMOUNT_USDC_IN,
        taker: TAKER,
        slippageBps: 30,
      },
    });

  it("quotes USDC -> WBTC with 8-decimal output, not 6", async () => {
    // A 6-decimal assumption on the output would be off by 100x.
    built = reverseServer(64_000n * 10n ** 18n, AQUA_COMPETITIVE_FIXTURE);
    const body = zExchangeQuoteResponse.parse((await reverseQuote(built)).json());

    // 640 USDC at a 64_000 mid is 0.01 WBTC = 1_000_000 sats, less 8 bps.
    expect(body.comparison.aqua!.amountOut).toBe("999200");
    expect(BigInt(body.comparison.uniswap!.amountOut)).toBe(BigInt(UNI_WBTC_OUT));
  });

  it("selects AQUA in reverse when the maker prices better", async () => {
    built = reverseServer(64_000n * 10n ** 18n, AQUA_COMPETITIVE_FIXTURE);
    const body = zExchangeQuoteResponse.parse((await reverseQuote(built)).json());

    expect(body.selectedVenue).toBe("AQUA");
    expect(BigInt(body.comparison.aqua!.netAmountOut)).toBeGreaterThan(
      BigInt(body.comparison.uniswap!.netAmountOut),
    );
  });

  it("selects UNISWAP in reverse when the maker is stressed", async () => {
    built = reverseServer(66_000n * 10n ** 18n, AQUA_UNCOMPETITIVE_FIXTURE);
    const body = zExchangeQuoteResponse.parse((await reverseQuote(built)).json());

    expect(body.selectedVenue).toBe("UNISWAP");
    expect(BigInt(body.comparison.uniswap!.netAmountOut)).toBeGreaterThan(
      BigInt(body.comparison.aqua!.netAmountOut),
    );
  });

  it("charges gas in satoshis, rounded up, when the output token is WBTC", async () => {
    built = reverseServer(64_000n * 10n ** 18n, AQUA_COMPETITIVE_FIXTURE);
    const body = zExchangeQuoteResponse.parse((await reverseQuote(built)).json());

    // Uniswap: min 992490 - 5 sats of gas.
    expect(BigInt(body.comparison.uniswap!.netAmountOut)).toBe(
      BigInt(UNI_WBTC_MIN) - 5n,
    );
    // Aqua: ceil(260_000 * 5 / 100_676) = ceil(12.91…) = 13 sats. Flooring
    // would understate it, and at this scale that is 8% of the charge.
    const aquaMin = BigInt(body.comparison.aqua!.minimumAmountOut);
    expect(BigInt(body.comparison.aqua!.netAmountOut)).toBe(aquaMin - 13n);
  });

  it("keeps slippage protection oriented correctly in reverse", async () => {
    built = reverseServer(64_000n * 10n ** 18n, AQUA_COMPETITIVE_FIXTURE);
    const body = zExchangeQuoteResponse.parse((await reverseQuote(built)).json());

    for (const venue of [body.comparison.aqua!, body.comparison.uniswap!]) {
      expect(BigInt(venue.minimumAmountOut)).toBeLessThanOrEqual(
        BigInt(venue.amountOut),
      );
      expect(BigInt(venue.netAmountOut)).toBeLessThanOrEqual(
        BigInt(venue.minimumAmountOut),
      );
    }
  });

  it("rejects a pair the maker does not support, in either direction", async () => {
    const WETH = "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1";
    built = reverseServer(64_000n * 10n ** 18n, AQUA_COMPETITIVE_FIXTURE);

    const res = await built.app.inject({
      method: "POST",
      url: API_ROUTES.exchangeQuote,
      payload: {
        chainId: 42161,
        strategyHash: STRATEGY,
        tokenIn: WETH,
        tokenOut: WBTC,
        amountIn: AMOUNT_USDC_IN,
        taker: TAKER,
        slippageBps: 30,
      },
    });

    // Aqua cannot price it; Uniswap still can, so the trade still routes.
    const body = zExchangeQuoteResponse.parse(res.json());
    expect(body.selectedVenue).toBe("UNISWAP");
  });
});

describe(`POST ${API_ROUTES.transactionsAqua}`, () => {
  const STRATEGY_ORDER = {
    maker: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`,
    traits: 1n,
    data: "0xdeadbeef" as `0x${string}`,
  };
  const ROUTER = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as `0x${string}`;

  const aquaExecution = {
    routerAddress: ROUTER,
    strategy: {
      chainId: 42161,
      maker: STRATEGY_ORDER.maker,
      strategyHash: STRATEGY as `0x${string}`,
      baseToken: WBTC as `0x${string}`,
      quoteToken: USDC as `0x${string}`,
      rebateSigner: STRATEGY_ORDER.maker,
      order: STRATEGY_ORDER,
      sampleQuote: {
        tokenIn: WBTC as `0x${string}`,
        tokenOut: USDC as `0x${string}`,
        amountIn: 1_000_000n,
        amountOut: 640_000_000n,
        isExactIn: true,
      },
    },
  };

  const serverWithExecution = (
    execution: typeof aquaExecution | null = aquaExecution,
  ) =>
    buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          ...AQUA_COMPETITIVE_FIXTURE,
          midPriceE18: 64_500n * 10n ** 18n,
          knownStrategyHash: STRATEGY as `0x${string}`,
        }),
        uniswapClient: stubUniswapClient(),
        aquaExecution: execution,
        executions: createExecutionStore({
          dir: "/evidence",
          fs: memoryFs(),
          now: () => 1_753_000_000_000,
        }),
      },
    );

  const buildAqua = (server: BuiltServer, quoteSessionId: string) =>
    server.app.inject({
      method: "POST",
      url: API_ROUTES.transactionsAqua,
      payload: { quoteSessionId },
    });

  it("builds router calldata that binds the quoted minimum", async () => {
    built = serverWithExecution();
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());
    expect(quote.selectedVenue).toBe("AQUA");

    const res = await buildAqua(built, quote.quoteSessionId);

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      to: string;
      data: string;
      value: string;
      minimumAmountOut: string;
      spender: string;
    };
    expect(body.to).toBe(ROUTER);
    // The taker approves the router itself, not a Permit2-style spender.
    expect(body.spender).toBe(ROUTER);
    expect(body.value).toBe("0");
    expect(body.data.startsWith("0x")).toBe(true);
    expect(body.data.length).toBeGreaterThan(10);
    // The floor shown in the comparison is the floor encoded in the calldata.
    expect(body.minimumAmountOut).toBe(quote.comparison.aqua!.minimumAmountOut);
    // …and it is physically present in the taker-traits tail.
    const threshold = BigInt(body.minimumAmountOut)
      .toString(16)
      .padStart(64, "0");
    expect(body.data.toLowerCase()).toContain(threshold);
  });

  it("is single-use, exactly like the Uniswap builder", async () => {
    built = serverWithExecution();
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    expect((await buildAqua(built, quote.quoteSessionId)).statusCode).toBe(200);
    const replay = await buildAqua(built, quote.quoteSessionId);

    expect(replay.statusCode).toBe(409);
    expect(zApiError.parse(replay.json()).error.code).toBe(
      "SESSION_ALREADY_USED",
    );
  });

  it("refuses a session where Uniswap won", async () => {
    built = buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          ...AQUA_UNCOMPETITIVE_FIXTURE,
          midPriceE18: 64_500n * 10n ** 18n,
          knownStrategyHash: STRATEGY as `0x${string}`,
        }),
        uniswapClient: stubUniswapClient(),
        aquaExecution,
      },
    );
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());
    expect(quote.selectedVenue).toBe("UNISWAP");

    const res = await buildAqua(built, quote.quoteSessionId);

    expect(res.statusCode).toBe(409);
    expect(zApiError.parse(res.json()).error.code).toBe("NOT_AN_AQUA_SESSION");
  });

  it("refuses to fabricate a transaction when no strategy is deployed", async () => {
    // Fixture-only mode: quotes are simulated, so there is no real order to
    // build against. Saying so beats inventing one (§21).
    built = serverWithExecution(null);
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    const res = await buildAqua(built, quote.quoteSessionId);

    expect(res.statusCode).toBe(503);
    expect(zApiError.parse(res.json()).error.code).toBe(
      "AQUA_EXECUTION_UNAVAILABLE",
    );
  });

  it("rejects an unknown session id", async () => {
    built = serverWithExecution();
    const res = await buildAqua(built, "00000000-0000-4000-8000-000000000000");

    expect(res.statusCode).toBe(404);
    expect(zApiError.parse(res.json()).error.code).toBe("SESSION_NOT_FOUND");
  });

  it("records evidence without claiming settlement", async () => {
    built = serverWithExecution();
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());
    await buildAqua(built, quote.quoteSessionId);

    const res = await built.app.inject({
      method: "GET",
      url: API_ROUTES.executions,
    });
    const { executions } = res.json() as {
      executions: {
        kind: string;
        strategyHash: string | null;
        txHash: string | null;
        amountOut: string | null;
      }[];
    };

    expect(executions[0]!.kind).toBe("BEST_EXECUTION_AQUA");
    expect(executions[0]!.strategyHash).toBe(STRATEGY);
    // Built, not broadcast.
    expect(executions[0]!.txHash).toBeNull();
    expect(executions[0]!.amountOut).toBeNull();
  });
});

describe("gas is priced honestly, never fabricated", () => {
  it("prices the Aqua leg from Uniswap's rate when a reference exists", async () => {
    built = serverWith(AQUA_COMPETITIVE_FIXTURE);
    const body = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    const aqua = body.comparison.aqua!;
    expect(aqua.estimatedGasUsd).not.toBeNull();
    expect(Number(aqua.estimatedGasUsd)).toBeGreaterThan(0);
    // Aqua burns more gas than the AMM route, so it must cost more.
    expect(Number(aqua.estimatedGasUsd)).toBeGreaterThan(
      Number(body.comparison.uniswap!.estimatedGasUsd),
    );
    // And the charge is actually deducted, so net is below the minimum.
    expect(BigInt(aqua.netAmountOut)).toBeLessThan(BigInt(aqua.minimumAmountOut));
  });

  it("reports null rather than 0 when gas cannot be priced", async () => {
    // No Uniswap quote means no rate to derive from, and Vortex has no ETH
    // price feed. "0" would claim the venue is free to execute.
    built = serverWith(AQUA_COMPETITIVE_FIXTURE, null);
    const body = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    expect(body.comparison.uniswap).toBeNull();
    expect(body.comparison.aqua!.estimatedGasUsd).toBeNull();
  });

  it("never emits the string '0' as a gas estimate", async () => {
    for (const client of [stubUniswapClient(), null]) {
      built = serverWith(AQUA_COMPETITIVE_FIXTURE, client);
      const body = zExchangeQuoteResponse.parse((await postQuote(built)).json());
      expect(body.comparison.aqua!.estimatedGasUsd).not.toBe("0");
      await built.app.close();
      built = undefined;
    }
  });
});

/**
 * MASTER Addendum 25 §B. The Trade API cannot quote a local dev chain — its
 * tokens are mocks at addresses Uniswap has never seen — which removed best
 * execution from the demo entirely. The comparison leg is now a REAL live
 * quote for the same size on the real pair on Arbitrum One, labelled as such
 * and never offered as executable locally.
 */
describe("reference-priced Uniswap leg on a local chain", () => {
  const LOCAL_WBTC = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
  const LOCAL_USDC = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

  const localQuoteBody = {
    chainId: 31337,
    strategyHash: STRATEGY,
    tokenIn: LOCAL_WBTC,
    tokenOut: LOCAL_USDC,
    // Matches the canned stub quote, which is a captured 0.01 WBTC response.
    amountIn: "1000000",
    taker: TAKER,
    slippageBps: 30,
  };

  /** Records what the client was actually asked to quote. */
  function spyingClient() {
    const seen: { chainId: number; tokenIn: string; tokenOut: string; amount: bigint }[] =
      [];
    const base = stubUniswapClient();
    return {
      seen,
      client: {
        ...base,
        getClassicQuote: async (params: {
          chainId: number;
          tokenIn: string;
          tokenOut: string;
          amount: bigint;
        }) => {
          seen.push({
            chainId: params.chainId,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            amount: params.amount,
          });
          return base.getClassicQuote(params as never);
        },
      } as never,
    };
  }

  const localServer = (uniswapClient: unknown) =>
    buildServer(
      { CHAIN_ID: "31337" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          ...AQUA_COMPETITIVE_FIXTURE,
          midPriceE18: 64_300n * 10n ** 18n,
          knownStrategyHash: STRATEGY as `0x${string}`,
          baseToken: { address: LOCAL_WBTC as `0x${string}`, decimals: 8 },
          quoteToken: { address: LOCAL_USDC as `0x${string}`, decimals: 6 },
        }),
        uniswapClient: uniswapClient as never,
        executions: createExecutionStore({
          dir: "/evidence",
          fs: memoryFs(),
          now: () => 1_753_000_000_000,
        }),
      },
    );

  const postLocal = (server: BuiltServer) =>
    server.app.inject({
      method: "POST",
      url: API_ROUTES.exchangeQuote,
      payload: localQuoteBody,
    });

  it("prices the real pair on Arbitrum One at the same size", async () => {
    const { seen, client } = spyingClient();
    built = localServer(client);
    await postLocal(built);

    expect(seen).toHaveLength(1);
    // Same size, real chain, real token addresses — not the local mocks.
    expect(seen[0]!.chainId).toBe(42161);
    expect(seen[0]!.amount).toBe(1_000_000n);
    expect(seen[0]!.tokenIn.toLowerCase()).toBe(WBTC.toLowerCase());
    expect(seen[0]!.tokenOut.toLowerCase()).toBe(USDC.toLowerCase());
  });

  it("labels the leg with the chain it was priced on", async () => {
    built = localServer(stubUniswapClient());
    const body = zExchangeQuoteResponse.parse((await postLocal(built)).json());

    const uniswap = body.comparison.uniswap!;
    // A real live quote, so `source` stays "live" — the chain is the extra fact.
    expect(uniswap.source).toBe("live");
    expect(uniswap.quotedOnChainId).toBe(42161);
    expect(uniswap.requestId).toBeTruthy();
  });

  it("marks the Uniswap execution as not executable on the local chain", async () => {
    // Aqua priced far worse, so Uniswap wins and the execution payload is the
    // one a UI would act on.
    built = buildServer(
      { CHAIN_ID: "31337" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          ...AQUA_UNCOMPETITIVE_FIXTURE,
          midPriceE18: 60_000n * 10n ** 18n,
          knownStrategyHash: STRATEGY as `0x${string}`,
          baseToken: { address: LOCAL_WBTC as `0x${string}`, decimals: 8 },
          quoteToken: { address: LOCAL_USDC as `0x${string}`, decimals: 6 },
        }),
        uniswapClient: stubUniswapClient(),
      },
    );
    const body = zExchangeQuoteResponse.parse((await postLocal(built)).json());

    expect(body.selectedVenue).toBe("UNISWAP");
    expect(body.execution.kind).toBe("UNISWAP_API");
    if (body.execution.kind !== "UNISWAP_API") return;
    expect(body.execution.executable).toBe(false);
  });

  it("refuses to build a transaction from a quote priced elsewhere", async () => {
    built = buildServer(
      { CHAIN_ID: "31337" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          ...AQUA_UNCOMPETITIVE_FIXTURE,
          midPriceE18: 60_000n * 10n ** 18n,
          knownStrategyHash: STRATEGY as `0x${string}`,
          baseToken: { address: LOCAL_WBTC as `0x${string}`, decimals: 8 },
          quoteToken: { address: LOCAL_USDC as `0x${string}`, decimals: 6 },
        }),
        uniswapClient: stubUniswapClient(),
      },
    );
    const quote = zExchangeQuoteResponse.parse((await postLocal(built)).json());

    const res = await built.app.inject({
      method: "POST",
      url: API_ROUTES.transactionsUniswap,
      payload: { quoteSessionId: quote.quoteSessionId },
    });

    expect(res.statusCode).toBe(409);
    const error = zApiError.parse(res.json()).error;
    expect(error.code).toBe("UNISWAP_QUOTE_NOT_EXECUTABLE_HERE");
    // The message must carry the requestId — it is what the UI shows instead.
    expect(error.message).toContain("requestId");
  });

  it("still quotes the trade directly when the chain IS quotable", async () => {
    const { seen, client } = spyingClient();
    built = serverWith(AQUA_COMPETITIVE_FIXTURE, client as never);
    await postQuote(built);

    expect(seen[0]!.chainId).toBe(42161);
    // On 42161 the request is the trade itself, so the tokens are unchanged.
    expect(seen[0]!.tokenIn.toLowerCase()).toBe(WBTC.toLowerCase());
    const body = zExchangeQuoteResponse.parse((await postQuote(built)).json());
    expect(body.comparison.uniswap!.quotedOnChainId).toBe(42161);
  });

  it("degrades to the honest empty state with no API key", async () => {
    built = localServer(null);
    const body = zExchangeQuoteResponse.parse((await postLocal(built)).json());

    // No fabricated leg, no reference quote — nothing was priced.
    expect(body.comparison.uniswap).toBeNull();
    expect(body.selectedVenue).toBe("AQUA");
  });
});
