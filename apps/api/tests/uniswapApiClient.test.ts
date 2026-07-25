import { describe, expect, it } from "vitest";

import {
  createUniswapApiClient,
  DEFAULT_UNISWAP_BASE_URL,
  quoteParamsFromRequest,
  slippageBpsToPercent,
  UNISWAP_CLIENT_DEFAULTS,
  UniswapApiError,
  type UniswapFetch,
  type UniswapFetchInit,
} from "../src/clients/uniswapApiClient";

const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f" as const;
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
const TAKER = "0x1111111111111111111111111111111111111111" as const;
const UNIVERSAL_ROUTER = "0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3";
const API_KEY = "test-key-do-not-log";

/**
 * Captured from the live API on 2026-07-25 (see docs/uniswap-api.md), including
 * the undocumented `gasEstimates` field, so a schema that is too strict fails
 * here rather than in production.
 */
const LIVE_QUOTE = {
  requestId: "4e9ab8fad895f5faf57aa797b9a0ec77",
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
    routeString: "[V3] 100.00% WBTC -> USDC",
    blockNumber: "487596461",
    quoteId: "quote-abc",
    maxFeePerGas: "21040000",
    maxPriorityFeePerGas: "0",
    txFailureReasons: [],
    gasEstimates: [{ type: "eip1559", gasLimit: "100618" }],
    aggregatedOutputs: [],
  },
};

const LIVE_SWAP = {
  requestId: "dfcf85a848a118e5d8f7e9ad8473b741",
  gasFee: "2112978000000",
  swap: {
    to: UNIVERSAL_ROUTER,
    from: TAKER,
    data: "0x3593564c000000000000000000000000000000000000000000000000000000000000",
    value: "0x00",
    gasLimit: "100618",
    maxFeePerGas: "21040000",
    maxPriorityFeePerGas: "0",
    chainId: 42161,
  },
  signature: "0xabc",
  publicKeyId: "key-1",
};

interface Call {
  url: string;
  init: UniswapFetchInit;
}

interface Scripted {
  status?: number;
  body?: unknown;
  text?: string;
  throws?: Error;
}

/** Fake fetch that replays a script; no network, no timers. */
function scriptedFetch(script: Scripted[]): {
  fetch: UniswapFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const fetch: UniswapFetch = async (url, init) => {
    calls.push({ url, init });
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (!step) throw new Error("fetch script exhausted");
    if (step.throws) throw step.throws;
    const text = step.text ?? JSON.stringify(step.body ?? {});
    const status = step.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { fetch, calls };
}

interface Harness {
  calls: Call[];
  slept: number[];
  client: ReturnType<typeof createUniswapApiClient>;
  advance(ms: number): void;
}

function harness(
  script: Scripted[],
  options: Parameters<typeof createUniswapApiClient>[0] extends infer O
    ? Partial<O>
    : never = {},
): Harness {
  const { fetch, calls } = scriptedFetch(script);
  const slept: number[] = [];
  let clock = 1_000_000;
  const client = createUniswapApiClient({
    apiKey: API_KEY,
    fetch,
    now: () => clock,
    // Advancing the clock inside sleep keeps the pacer's arithmetic honest
    // without any real waiting.
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
    random: () => 0,
    requestsPerSecond: 0,
    ...options,
  });
  return {
    calls,
    slept,
    client,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const quoteParams = {
  chainId: 42161,
  tokenIn: WBTC,
  tokenOut: USDC,
  amount: 1_000_000n,
  swapper: TAKER,
  slippageBps: 30,
} as const;

const body = (call: Call) => JSON.parse(call.init.body ?? "{}");

describe("slippageBpsToPercent", () => {
  it("converts bps to the API's percent number", () => {
    expect(slippageBpsToPercent(30)).toBe(0.3);
    expect(slippageBpsToPercent(50)).toBe(0.5);
    expect(slippageBpsToPercent(1)).toBe(0.01);
    expect(slippageBpsToPercent(10_000)).toBe(100);
    expect(slippageBpsToPercent(0)).toBe(0);
  });

  it("never exceeds the API's two-decimal limit", () => {
    for (const bps of [1, 7, 13, 99, 250, 9_999]) {
      const decimals = String(slippageBpsToPercent(bps)).split(".")[1] ?? "";
      expect(decimals.length).toBeLessThanOrEqual(2);
    }
  });

  it("rejects out-of-range and non-finite input", () => {
    expect(() => slippageBpsToPercent(-1)).toThrow(RangeError);
    expect(() => slippageBpsToPercent(10_001)).toThrow(RangeError);
    expect(() => slippageBpsToPercent(Number.NaN)).toThrow(RangeError);
  });
});

describe("client construction", () => {
  it("refuses to exist without an api key", () => {
    expect(() => createUniswapApiClient({ apiKey: "" })).toThrow(/api key/i);
    expect(() => createUniswapApiClient({ apiKey: "   " })).toThrow(/api key/i);
  });

  it("defaults to the documented base url and pacing", () => {
    expect(DEFAULT_UNISWAP_BASE_URL).toBe(
      "https://trade-api.gateway.uniswap.org/v1",
    );
    expect(UNISWAP_CLIENT_DEFAULTS.requestsPerSecond).toBeLessThan(6);
    expect(UNISWAP_CLIENT_DEFAULTS.maxAttempts).toBe(3);
  });
});

describe("getClassicQuote", () => {
  it("parses a live-shaped response including undocumented fields", async () => {
    const h = harness([{ body: LIVE_QUOTE }]);
    const result = await h.client.getClassicQuote(quoteParams);

    expect(result.requestId).toBe(LIVE_QUOTE.requestId);
    expect(result.routing).toBe("CLASSIC");
    expect(result.quote.output.minimumAmount).toBe("638227698");
    expect(result.quote.gasFeeQuote).toBe("3751");
    expect(result.approvalRequired).toBe(true);
    expect(result.permitData).toBeNull();
  });

  it("echoes the inner quote object untouched for /swap", async () => {
    const h = harness([{ body: LIVE_QUOTE }]);
    const result = await h.client.getClassicQuote(quoteParams);

    // Byte-for-byte identity matters: the API forbids modifying its payloads.
    expect(result.rawQuote).toEqual(LIVE_QUOTE.quote);
    expect(JSON.stringify(result.rawQuote)).toBe(
      JSON.stringify(LIVE_QUOTE.quote),
    );
  });

  it("forces classic AMM routing so /swap is always the next call", async () => {
    const h = harness([{ body: LIVE_QUOTE }]);
    await h.client.getClassicQuote(quoteParams);

    const sent = body(h.calls[0]!);
    expect(sent.protocols).toEqual(["V2", "V3", "V4"]);
    expect(sent.routingPreference).toBe("BEST_PRICE");
  });

  it("sends amounts as base-unit strings and slippage as percent", async () => {
    const h = harness([{ body: LIVE_QUOTE }]);
    await h.client.getClassicQuote(quoteParams);

    const sent = body(h.calls[0]!);
    expect(sent.amount).toBe("1000000");
    expect(sent.slippageTolerance).toBe(0.3);
    expect(sent.type).toBe("EXACT_INPUT");
    expect(sent.tokenInChainId).toBe(42161);
    expect(sent.tokenOutChainId).toBe(42161);
  });

  it("supports EXACT_OUTPUT for the Grow bridge leg", async () => {
    const h = harness([{ body: LIVE_QUOTE }]);
    await h.client.getClassicQuote({ ...quoteParams, type: "EXACT_OUTPUT" });

    expect(body(h.calls[0]!).type).toBe("EXACT_OUTPUT");
  });

  it("treats a missing isTokenApprovalApplicable as approval required", async () => {
    const quote = { ...LIVE_QUOTE };
    delete (quote as { isTokenApprovalApplicable?: unknown })
      .isTokenApprovalApplicable;
    const h = harness([{ body: quote }]);

    expect((await h.client.getClassicQuote(quoteParams)).approvalRequired).toBe(
      true,
    );
  });

  it("rejects a non-positive amount without spending a request", async () => {
    const h = harness([{ body: LIVE_QUOTE }]);
    await expect(
      h.client.getClassicQuote({ ...quoteParams, amount: 0n }),
    ).rejects.toThrow(RangeError);
    expect(h.calls).toHaveLength(0);
  });

  it("sends the permit2-disabled header only when asked", async () => {
    const h = harness([{ body: { ...LIVE_QUOTE, permitData: null } }]);
    await h.client.getClassicQuote({ ...quoteParams, permit2Disabled: true });
    expect(h.calls[0]!.init.headers["x-permit2-disabled"]).toBe("true");

    const plain = harness([{ body: LIVE_QUOTE }]);
    await plain.client.getClassicQuote(quoteParams);
    expect(plain.calls[0]!.init.headers["x-permit2-disabled"]).toBeUndefined();
  });
});

describe("authentication headers", () => {
  it("sends the documented header set", async () => {
    const h = harness([{ body: LIVE_QUOTE }]);
    await h.client.getClassicQuote(quoteParams);

    const headers = h.calls[0]!.init.headers;
    expect(headers["x-api-key"]).toBe(API_KEY);
    expect(headers.accept).toBe("application/json");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-universal-router-version"]).toBe("2.0");
  });

  it("omits content-type on GET, which upstream answers with 401", async () => {
    const h = harness([
      { body: { requestId: "r", swaps: [{ swapType: "CLASSIC", status: "SUCCESS", txHash: "0xab" }] } },
    ]);
    await h.client.getSwapStatus({ txHashes: ["0xab"] });

    expect(h.calls[0]!.init.method).toBe("GET");
    expect(h.calls[0]!.init.headers["content-type"]).toBeUndefined();
  });
});

describe("error handling", () => {
  it("parses the spec error envelope {errorCode, detail}", async () => {
    const h = harness([
      {
        status: 400,
        body: {
          errorCode: "RequestValidationError",
          detail: '"tokenIn" fails to match the required pattern',
        },
      },
    ]);

    const error = await h.client
      .getClassicQuote(quoteParams)
      .catch((e: unknown) => e as UniswapApiError);

    expect(error).toBeInstanceOf(UniswapApiError);
    expect((error as UniswapApiError).httpStatus).toBe(400);
    expect((error as UniswapApiError).errorCode).toBe("RequestValidationError");
    expect((error as UniswapApiError).detail).toContain("tokenIn");
    expect((error as UniswapApiError).retryable).toBe(false);
  });

  it("recognises the live 429 code, which is TooManyRequests not Ratelimited", async () => {
    const h = harness(
      [
        {
          status: 429,
          body: {
            errorCode: "TooManyRequests",
            detail: "Rate limit exceeded",
            requestId: "4f584ad1",
          },
        },
      ],
      { maxAttempts: 1 },
    );

    const error = (await h.client
      .getClassicQuote(quoteParams)
      .catch((e: unknown) => e)) as UniswapApiError;

    expect(error.httpStatus).toBe(429);
    expect(error.errorCode).toBe("TooManyRequests");
    expect(error.requestId).toBe("4f584ad1");
    expect(error.isRateLimit).toBe(true);
    expect(error.retryable).toBe(true);
  });

  it("never leaks the api key in a thrown error", async () => {
    const h = harness([
      { status: 401, text: `unauthorized for key ${API_KEY}` },
    ]);

    const error = (await h.client
      .getClassicQuote(quoteParams)
      .catch((e: unknown) => e)) as UniswapApiError;

    expect(error.message).not.toContain(API_KEY);
    expect(error.detail).not.toContain(API_KEY);
    expect(error.detail).toContain("[redacted]");
    expect(String(error.stack)).not.toContain(API_KEY);
  });

  it("reports an unparsable 2xx body without retrying it", async () => {
    const h = harness([{ status: 200, text: "<html>gateway</html>" }]);

    const error = (await h.client
      .getClassicQuote(quoteParams)
      .catch((e: unknown) => e)) as UniswapApiError;

    expect(error.errorCode).toBe("InvalidResponseBody");
    expect(error.retryable).toBe(false);
    expect(h.calls).toHaveLength(1);
  });
});

describe("retry policy", () => {
  it("retries a 429 and then succeeds", async () => {
    const h = harness([
      { status: 429, body: { errorCode: "TooManyRequests", detail: "slow" } },
      { body: LIVE_QUOTE },
    ]);

    const result = await h.client.getClassicQuote(quoteParams);

    expect(result.requestId).toBe(LIVE_QUOTE.requestId);
    expect(h.calls).toHaveLength(2);
    expect(h.slept.length).toBeGreaterThanOrEqual(1);
  });

  it("retries 5xx and 504 timeouts", async () => {
    for (const status of [500, 503, 504]) {
      const h = harness([
        { status, body: { errorCode: "InternalServerError", detail: "x" } },
        { body: LIVE_QUOTE },
      ]);
      await expect(h.client.getClassicQuote(quoteParams)).resolves.toBeDefined();
      expect(h.calls).toHaveLength(2);
    }
  });

  it("never retries 4xx validation errors", async () => {
    const h = harness([
      { status: 400, body: { errorCode: "RequestValidationError", detail: "bad" } },
      { body: LIVE_QUOTE },
    ]);

    await expect(h.client.getClassicQuote(quoteParams)).rejects.toBeInstanceOf(
      UniswapApiError,
    );
    expect(h.calls).toHaveLength(1);
  });

  it("gives up after maxAttempts and surfaces the last error", async () => {
    const h = harness(
      [{ status: 429, body: { errorCode: "TooManyRequests", detail: "no" } }],
      { maxAttempts: 3 },
    );

    await expect(h.client.getClassicQuote(quoteParams)).rejects.toThrow(
      /TooManyRequests/,
    );
    expect(h.calls).toHaveLength(3);
  });

  it("backs off exponentially, since no Retry-After header exists", async () => {
    const h = harness(
      [
        { status: 429, body: { errorCode: "TooManyRequests" } },
        { status: 429, body: { errorCode: "TooManyRequests" } },
        { body: LIVE_QUOTE },
      ],
      { maxAttempts: 3, retryBaseMs: 100, retryJitterRatio: 0 },
    );

    await h.client.getClassicQuote(quoteParams);

    expect(h.slept).toEqual([200, 400]);
  });

  it("retries transport failures then reports a transport error", async () => {
    const h = harness([{ throws: new Error("ECONNRESET") }], {
      maxAttempts: 2,
    });

    const error = (await h.client
      .getClassicQuote(quoteParams)
      .catch((e: unknown) => e)) as UniswapApiError;

    expect(error.httpStatus).toBe(0);
    expect(error.errorCode).toBe("NetworkError");
    expect(h.calls).toHaveLength(2);
  });
});

describe("quote caching and dedup", () => {
  it("serves identical concurrent quotes from one upstream request", async () => {
    const h = harness([{ body: LIVE_QUOTE }], { quoteCacheTtlMs: 10_000 });

    const [a, b] = await Promise.all([
      h.client.getClassicQuote(quoteParams),
      h.client.getClassicQuote(quoteParams),
    ]);

    expect(h.calls).toHaveLength(1);
    expect(a.requestId).toBe(b.requestId);
  });

  it("re-requests once the cache entry expires", async () => {
    const h = harness([{ body: LIVE_QUOTE }, { body: LIVE_QUOTE }], {
      quoteCacheTtlMs: 10_000,
    });

    await h.client.getClassicQuote(quoteParams);
    h.advance(10_001);
    await h.client.getClassicQuote(quoteParams);

    expect(h.calls).toHaveLength(2);
  });

  it("does not share cache entries across differing requests", async () => {
    const h = harness([{ body: LIVE_QUOTE }, { body: LIVE_QUOTE }], {
      quoteCacheTtlMs: 10_000,
    });

    await h.client.getClassicQuote(quoteParams);
    await h.client.getClassicQuote({ ...quoteParams, amount: 2_000_000n });

    expect(h.calls).toHaveLength(2);
  });

  it("never caches a failure", async () => {
    const h = harness(
      [
        { status: 400, body: { errorCode: "RequestValidationError" } },
        { body: LIVE_QUOTE },
      ],
      { quoteCacheTtlMs: 10_000 },
    );

    await expect(h.client.getClassicQuote(quoteParams)).rejects.toBeDefined();
    await expect(h.client.getClassicQuote(quoteParams)).resolves.toBeDefined();
    expect(h.calls).toHaveLength(2);
  });
});

describe("rate limiter", () => {
  it("paces bursts instead of letting them 429", async () => {
    const h = harness([{ body: LIVE_QUOTE }], {
      requestsPerSecond: 5,
      quoteCacheTtlMs: 0,
    });

    await Promise.all([
      h.client.getClassicQuote(quoteParams),
      h.client.getClassicQuote({ ...quoteParams, amount: 2n }),
      h.client.getClassicQuote({ ...quoteParams, amount: 3n }),
    ]);

    // Two of the three had to wait ~200ms each at 5 rps.
    const waits = h.slept.filter((ms) => ms > 0);
    expect(waits.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...waits)).toBeLessThanOrEqual(400);
  });
});

describe("createSwapTransaction", () => {
  it("returns a broadcastable transaction from a live-shaped response", async () => {
    const h = harness([{ body: LIVE_SWAP }]);

    const result = await h.client.createSwapTransaction({
      quote: LIVE_QUOTE.quote,
    });

    expect(result.requestId).toBe(LIVE_SWAP.requestId);
    expect(result.swap.to).toBe(UNIVERSAL_ROUTER);
    expect(result.swap.data.startsWith("0x3593564c")).toBe(true);
    expect(result.gasFee).toBe("2112978000000");
  });

  it("sends the inner quote under the `quote` key, unwrapped", async () => {
    const h = harness([{ body: LIVE_SWAP }]);
    await h.client.createSwapTransaction({ quote: LIVE_QUOTE.quote });

    const sent = body(h.calls[0]!);
    expect(sent.quote).toEqual(LIVE_QUOTE.quote);
    // The whole /quote response must never be nested under `quote`.
    expect(sent.quote.requestId).toBeUndefined();
    expect(sent.permitData).toBeUndefined();
    expect(sent.signature).toBeUndefined();
  });

  it("rejects permitData without a signature before spending a request", async () => {
    const h = harness([{ body: LIVE_SWAP }]);

    const error = (await h.client
      .createSwapTransaction({
        quote: LIVE_QUOTE.quote,
        permitData: { domain: {} },
      })
      .catch((e: unknown) => e)) as UniswapApiError;

    expect(error).toBeInstanceOf(UniswapApiError);
    expect(error.errorCode).toBe("RequestValidationError");
    expect(h.calls).toHaveLength(0);
  });

  it("rejects a signature without permitData", async () => {
    const h = harness([{ body: LIVE_SWAP }]);

    await expect(
      h.client.createSwapTransaction({
        quote: LIVE_QUOTE.quote,
        signature: "0xdead",
      }),
    ).rejects.toBeInstanceOf(UniswapApiError);
    expect(h.calls).toHaveLength(0);
  });

  it("sends permitData and signature together when both are given", async () => {
    const h = harness([{ body: LIVE_SWAP }]);
    await h.client.createSwapTransaction({
      quote: LIVE_QUOTE.quote,
      permitData: { domain: { name: "Permit2" } },
      signature: "0xdead",
    });

    const sent = body(h.calls[0]!);
    expect(sent.permitData).toEqual({ domain: { name: "Permit2" } });
    expect(sent.signature).toBe("0xdead");
  });

  it("forwards optional execution controls", async () => {
    const h = harness([{ body: LIVE_SWAP }]);
    await h.client.createSwapTransaction({
      quote: LIVE_QUOTE.quote,
      simulateTransaction: true,
      safetyMode: "SAFE",
      deadline: 1_800_000_000,
      refreshGasPrice: true,
    });

    const sent = body(h.calls[0]!);
    expect(sent.simulateTransaction).toBe(true);
    expect(sent.safetyMode).toBe("SAFE");
    expect(sent.deadline).toBe(1_800_000_000);
    expect(sent.refreshGasPrice).toBe(true);
  });

  it("rejects an empty calldata payload from upstream", async () => {
    const h = harness([
      { body: { ...LIVE_SWAP, swap: { ...LIVE_SWAP.swap, data: "0x" } } },
    ]);

    // "Never Empty" is an explicit API contract; broadcasting 0x would burn gas
    // for nothing.
    await expect(
      h.client.createSwapTransaction({ quote: LIVE_QUOTE.quote }),
    ).rejects.toBeDefined();
  });
});

describe("checkApproval", () => {
  it("maps a null approval to 'already approved'", async () => {
    const h = harness([{ body: { requestId: "r1", approval: null, cancel: null } }]);

    const result = await h.client.checkApproval({
      chainId: 42161,
      walletAddress: TAKER,
      token: WBTC,
      amount: 1_000_000n,
    });

    expect(result.approval).toBeNull();
    expect(result.cancel).toBeNull();
  });

  it("surfaces the USDT-style cancel transaction", async () => {
    const approval = {
      to: WBTC,
      from: TAKER,
      data: "0x095ea7b3",
      value: "0x00",
      chainId: 42161,
    };
    const h = harness([
      { body: { requestId: "r2", approval, cancel: { ...approval, data: "0x095ea7b300" } } },
    ]);

    const result = await h.client.checkApproval({
      chainId: 42161,
      walletAddress: TAKER,
      token: WBTC,
      amount: 1_000_000n,
    });

    expect(result.approval?.data).toBe("0x095ea7b3");
    expect(result.cancel).not.toBeNull();
  });

  it("rejects a non-positive amount", async () => {
    const h = harness([{ body: { requestId: "r", approval: null, cancel: null } }]);
    await expect(
      h.client.checkApproval({
        chainId: 42161,
        walletAddress: TAKER,
        token: WBTC,
        amount: 0n,
      }),
    ).rejects.toThrow(RangeError);
    expect(h.calls).toHaveLength(0);
  });
});

describe("getSwapStatus", () => {
  it("joins tx hashes with literal commas, not percent-encoding", async () => {
    const h = harness([
      {
        body: {
          requestId: "r",
          swaps: [
            { swapType: "CLASSIC", status: "SUCCESS", txHash: "0xaa" },
            { swapType: "CLASSIC", status: "PENDING", txHash: "0xbb" },
          ],
        },
      },
    ]);

    const result = await h.client.getSwapStatus({
      txHashes: ["0xaa", "0xbb"],
      chainId: 42161,
    });

    expect(h.calls[0]!.url).toContain("txHashes=0xaa,0xbb");
    expect(h.calls[0]!.url).not.toContain("%2C");
    expect(h.calls[0]!.url).toContain("chainId=42161");
    expect(result.swaps.map((s) => s.status)).toEqual(["SUCCESS", "PENDING"]);
  });

  it("requires at least one hash", async () => {
    const h = harness([{ body: { requestId: "r", swaps: [] } }]);
    await expect(h.client.getSwapStatus({ txHashes: [] })).rejects.toThrow(
      RangeError,
    );
    expect(h.calls).toHaveLength(0);
  });
});

describe("quoteParamsFromRequest", () => {
  it("adapts the venue-neutral request to exact-input quote params", () => {
    const params = quoteParamsFromRequest({
      chainId: 42161,
      tokenIn: WBTC,
      tokenOut: USDC,
      amountIn: 1_000_000n,
      taker: TAKER,
      slippageBps: 30,
    });

    expect(params).toEqual({
      chainId: 42161,
      tokenIn: WBTC,
      tokenOut: USDC,
      amount: 1_000_000n,
      swapper: TAKER,
      slippageBps: 30,
      type: "EXACT_INPUT",
    });
  });
});
