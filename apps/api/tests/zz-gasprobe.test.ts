import { API_ROUTES, zExchangeQuoteResponse } from "@vortex/shared";
import { describe, expect, it } from "vitest";

import {
  AQUA_COMPETITIVE_FIXTURE,
  createFixtureAquaQuoteSource,
} from "../src/clients/fixtureAquaQuoteSource";
import type { UniswapApiClient } from "../src/clients/uniswapApiClient";
import { createExecutionStore } from "../src/store/executions";
import { buildServer } from "../src/server";
import type { JsonStoreFs } from "../src/store/jsonStore";

const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const TAKER = "0x1111111111111111111111111111111111111111";
const STRATEGY = `0x${"ab".repeat(32)}`;

function memoryFs(): JsonStoreFs {
  const files = new Map<string, string>();
  return {
    mkdirSync: () => undefined,
    appendFileSync: (p: string, d: string) => { files.set(p, (files.get(p) ?? "") + d); },
    readFileSync: (p: string) => {
      const c = files.get(p);
      if (c === undefined) { const e = new Error("ENOENT") as NodeJS.ErrnoException; e.code = "ENOENT"; throw e; }
      return c;
    },
    existsSync: (p: string) => files.has(p),
  } as unknown as JsonStoreFs;
}

const quote = {
  requestId: "req-uniswap-1",
  routing: "CLASSIC",
  quote: {
    chainId: 42161, swapper: TAKER, tradeType: "EXACT_INPUT", route: [],
    input: { amount: "1000000", token: WBTC, maximumAmount: "1000000" },
    output: { amount: "640148143", token: USDC, recipient: TAKER, minimumAmount: "638227698" },
    slippage: 0.3, priceImpact: 0.05,
    gasFee: "2117203956000", gasFeeUSD: "0.00375156520097671",
    gasFeeQuote: "3751", gasUseEstimate: "100618",
    routeString: "[V3] WBTC -> USDC", blockNumber: "487596461", quoteId: "q-1",
    maxFeePerGas: "21040000", maxPriorityFeePerGas: "0", txFailureReasons: [],
  },
};

const client: UniswapApiClient = {
  getClassicQuote: async () => ({
    requestId: quote.requestId, routing: quote.routing,
    quote: quote.quote as never, rawQuote: quote.quote,
    permitData: null, permitTransaction: null, approvalRequired: true,
  }),
  createSwapTransaction: async () => ({ requestId: "x", swap: {} as never, gasFee: "0" }),
  checkApproval: async () => ({ requestId: "x", approval: null, cancel: null }),
  getSwapStatus: async () => ({ requestId: "x", swaps: [] }),
};

describe("probe", () => {
  it("prints the aqua comparison payload", async () => {
    const built = buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          midPriceE18: 64_500n * 10n ** 18n,
          ...AQUA_COMPETITIVE_FIXTURE,
        }),
        uniswapClient: client,
        executions: createExecutionStore({ dir: "/evidence", fs: memoryFs(), now: () => 1_753_000_000_000 }),
      },
    );
    const res = await built.app.inject({
      method: "POST", url: API_ROUTES.exchangeQuote,
      payload: { chainId: 42161, strategyHash: STRATEGY, tokenIn: WBTC, tokenOut: USDC, amountIn: "1000000", taker: TAKER, slippageBps: 30 },
    });
    const body = zExchangeQuoteResponse.parse(res.json());
    const a = body.comparison.aqua!;
    const u = body.comparison.uniswap!;
    const aquaGasImplied = BigInt(a.minimumAmountOut) - BigInt(a.netAmountOut);
    const uniGasImplied = BigInt(u.minimumAmountOut) - BigInt(u.netAmountOut);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      selectedVenue: body.selectedVenue,
      aqua: { ...a, impliedGasBaseUnits: aquaGasImplied.toString() },
      uniswap: { ...u, impliedGasBaseUnits: uniGasImplied.toString() },
      aquaGasUsdIfConverted: (Number(aquaGasImplied) * Number(u.estimatedGasUsd) / Number(uniGasImplied)).toString(),
      netEdgeBaseUnits: (BigInt(a.netAmountOut) - BigInt(u.netAmountOut)).toString(),
    }, null, 2));
    expect(a.estimatedGasUsd).toBe("0");
    await built.app.close();
  });
});
