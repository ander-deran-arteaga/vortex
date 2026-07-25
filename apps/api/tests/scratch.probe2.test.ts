import { describe, it } from "vitest";

import {
  createUniswapApiClient,
  type UniswapFetch,
} from "../src/clients/uniswapApiClient";

const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const TAKER = "0x1111111111111111111111111111111111111111";

const okBody = JSON.stringify({
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
});

describe("PROBE2", () => {
  it("C2: pacer queue with a realistic clock (time does not jump on sleep)", async () => {
    const slept: number[] = [];
    // Real-ish clock: monotonic, driven by an external tick, NOT by sleep().
    let clock = 1_000_000;
    const fetch: UniswapFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => okBody,
    });
    const client = createUniswapApiClient({
      apiKey: "k",
      fetch,
      now: () => clock,
      // Resolves on the microtask queue without advancing the clock — models
      // a burst that arrives faster than wall-clock time moves.
      sleep: async (ms) => {
        slept.push(ms);
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
    console.log(
      "PROBE-C2 waits:",
      "n=", slept.length,
      "max=", Math.max(...slept), "ms",
      "last3=", slept.slice(-3),
    );
  });
});
