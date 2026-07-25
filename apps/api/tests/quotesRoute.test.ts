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
      executions: { uniswapRequestId: string | null; kind: string }[];
    };

    expect(executions).toHaveLength(1);
    expect(executions[0]!.kind).toBe("BEST_EXECUTION_UNISWAP");
    expect(executions[0]!.uniswapRequestId).toBe("req-uniswap-1");
  });

  it("refuses to reuse a session — quotes are single-use", async () => {
    built = serverWith(AQUA_UNCOMPETITIVE_FIXTURE);
    const quote = zExchangeQuoteResponse.parse((await postQuote(built)).json());

    expect((await buildTx(built, quote.quoteSessionId)).statusCode).toBe(200);
    const replay = await buildTx(built, quote.quoteSessionId);

    expect(replay.statusCode).toBe(409);
    expect(zApiError.parse(replay.json()).error.code).toBe(
      "QUOTE_SESSION_ALREADY_USED",
    );
  });

  it("rejects an unknown session id", async () => {
    built = serverWith(AQUA_UNCOMPETITIVE_FIXTURE);
    const res = await buildTx(built, "00000000-0000-4000-8000-000000000000");

    expect(res.statusCode).toBe(404);
    expect(zApiError.parse(res.json()).error.code).toBe(
      "QUOTE_SESSION_NOT_FOUND",
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
