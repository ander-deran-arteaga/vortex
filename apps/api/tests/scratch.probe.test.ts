import { API_ROUTES } from "@vortex/shared";
import { describe, expect, it } from "vitest";

import {
  AQUA_COMPETITIVE_FIXTURE,
  AQUA_UNCOMPETITIVE_FIXTURE,
  createFixtureAquaQuoteSource,
} from "../src/clients/fixtureAquaQuoteSource";
import {
  createUniswapApiClient,
  type UniswapApiClient,
  type UniswapFetch,
} from "../src/clients/uniswapApiClient";
import { createExecutionStore } from "../src/store/executions";
import { buildServer } from "../src/server";
import type { JsonStoreFs } from "../src/store/jsonStore";
import { createJsonStore } from "../src/store/jsonStore";

const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const TAKER = "0x1111111111111111111111111111111111111111";
const STRATEGY = `0x${"ab".repeat(32)}`;

function memoryFs(opts: { failAppend?: boolean } = {}): JsonStoreFs {
  const files = new Map<string, string>();
  return {
    mkdirSync: () => undefined,
    appendFileSync: (path: string, data: string) => {
      if (opts.failAppend) {
        const e = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
        e.code = "ENOSPC";
        throw e;
      }
      files.set(path, (files.get(path) ?? "") + data);
    },
    readFileSync: (path: string) => files.get(path) ?? "",
    existsSync: (path: string) => files.has(path),
  } as unknown as JsonStoreFs;
}

function stubUniswapClient(): UniswapApiClient {
  const quote = {
    chainId: 42161,
    swapper: TAKER,
    tradeType: "EXACT_INPUT",
    route: [],
    input: { amount: "1000000", token: WBTC, maximumAmount: "1000000" },
    output: { amount: "640148143", token: USDC, recipient: TAKER, minimumAmount: "638227698" },
    gasFeeQuote: "3751",
    gasUseEstimate: "100618",
  };
  return {
    getClassicQuote: async () => ({
      requestId: "req-uniswap-1",
      routing: "CLASSIC",
      quote: quote as never,
      rawQuote: quote,
      permitData: null,
      permitTransaction: null,
      approvalRequired: true,
    }),
    createSwapTransaction: async () => ({
      requestId: "req-swap-1",
      swap: {
        to: "0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3",
        from: TAKER,
        data: "0x3593564cdeadbeef",
        value: "0x00",
        gasLimit: "100618",
        chainId: 42161,
      } as never,
      gasFee: "1",
    }),
    checkApproval: async () => ({ requestId: "r", approval: null, cancel: null }),
    getSwapStatus: async () => ({ requestId: "r", swaps: [] }),
  };
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

describe("PROBE", () => {
  it("A: evidence write failure turns a successful build into a 500 and burns the session", async () => {
    const { app } = buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          midPriceE18: 64_500n * 10n ** 18n,
          ...AQUA_UNCOMPETITIVE_FIXTURE,
        }),
        uniswapClient: stubUniswapClient(),
        executions: createExecutionStore({
          dir: "/evidence",
          fs: memoryFs({ failAppend: true }),
        }),
      },
    );
    const q = await app.inject({ method: "POST", url: API_ROUTES.exchangeQuote, payload: quoteBody });
    const sessionId = q.json().quoteSessionId as string;
    expect(q.json().selectedVenue).toBe("UNISWAP");

    const build = await app.inject({
      method: "POST",
      url: API_ROUTES.transactionsUniswap,
      payload: { quoteSessionId: sessionId },
    });
    console.log("PROBE-A build status:", build.statusCode, build.body);

    const retry = await app.inject({
      method: "POST",
      url: API_ROUTES.transactionsUniswap,
      payload: { quoteSessionId: sessionId },
    });
    console.log("PROBE-A retry status:", retry.statusCode, retry.body);
    await app.close();
  });

  it("B: AQUA-selected path has no build endpoint and writes no evidence", async () => {
    const { app } = buildServer(
      { CHAIN_ID: "42161" },
      {
        envSource: {},
        aquaSource: createFixtureAquaQuoteSource({
          midPriceE18: 64_500n * 10n ** 18n,
          ...AQUA_COMPETITIVE_FIXTURE,
        }),
        uniswapClient: stubUniswapClient(),
        executions: createExecutionStore({ dir: "/evidence", fs: memoryFs() }),
      },
    );
    const q = await app.inject({ method: "POST", url: API_ROUTES.exchangeQuote, payload: quoteBody });
    console.log("PROBE-B quote:", JSON.stringify(q.json()));

    const aquaBuild = await app.inject({
      method: "POST",
      url: API_ROUTES.transactionsAqua,
      payload: { quoteSessionId: q.json().quoteSessionId },
    });
    console.log("PROBE-B /transactions/aqua status:", aquaBuild.statusCode, aquaBuild.body);

    const ev = await app.inject({ method: "GET", url: API_ROUTES.executions });
    console.log("PROBE-B executions:", ev.body);

    // and: an AQUA session is still accepted by the uniswap builder
    const cross = await app.inject({
      method: "POST",
      url: API_ROUTES.transactionsUniswap,
      payload: { quoteSessionId: q.json().quoteSessionId },
    });
    console.log("PROBE-B cross-venue build on AQUA session:", cross.statusCode, cross.body);
    await app.close();
  });

  it("C: pacer queue is unbounded", async () => {
    const slept: number[] = [];
    let clock = 0;
    const fetch: UniswapFetch = async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          requestId: "r",
          routing: "CLASSIC",
          permitData: null,
          permitTransaction: null,
          quote: {
            chainId: 42161,
            swapper: TAKER,
            tradeType: "EXACT_INPUT",
            route: [],
            input: { amount: "1", token: WBTC },
            output: { amount: "1", token: USDC, minimumAmount: "1" },
            gasUseEstimate: "1",
          },
        }),
    });
    const client = createUniswapApiClient({
      apiKey: "k",
      fetch,
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      requestsPerSecond: 5,
      quoteCacheTtlMs: 0,
    });
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        client.getClassicQuote({
          chainId: 42161,
          tokenIn: WBTC,
          tokenOut: USDC,
          amount: BigInt(i + 1),
          swapper: TAKER,
          slippageBps: 30,
        }),
      ),
    );
    console.log("PROBE-C max single wait ms:", Math.max(...slept));
    await Promise.resolve();
  });

  it("D: ensureDir latch never recreates a deleted directory", () => {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const fs = {
      existsSync: (p: string) => files.has(p) || dirs.has(p),
      mkdirSync: (p: string) => {
        dirs.add(p);
      },
      appendFileSync: (p: string, d: string) => {
        const dir = p.slice(0, p.lastIndexOf("/"));
        if (!dirs.has(dir)) {
          const e = new Error(`ENOENT: no such file or directory, open '${p}'`);
          throw e;
        }
        files.set(p, (files.get(p) ?? "") + d);
      },
      readFileSync: (p: string) => files.get(p) ?? "",
    } as unknown as JsonStoreFs;

    const store = createJsonStore<{ n: number }>({ dir: "/d/data", name: "executions", fs });
    store.append({ n: 1 });
    dirs.delete("/d/data"); // someone cleans data/
    let msg = "no throw";
    try {
      store.append({ n: 2 });
    } catch (e) {
      msg = (e as Error).message;
    }
    console.log("PROBE-D second append after dir removal:", msg);
  });
});
