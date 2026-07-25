import { describe, it } from "vitest";
import { zUniswapQuoteResponse } from "/home/ander/Projects/Hackathon/vortex/apps/api/src/clients/uniswapSchemas";

describe("EO", () => {
  it("EXACT_OUTPUT-shaped response without output.minimumAmount", () => {
    const r = zUniswapQuoteResponse.safeParse({
      requestId: "r",
      routing: "CLASSIC",
      permitData: null,
      permitTransaction: null,
      quote: {
        chainId: 42161,
        swapper: "0x1111111111111111111111111111111111111111",
        tradeType: "EXACT_OUTPUT",
        route: [],
        input: { amount: "1000000", token: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", maximumAmount: "1005000" },
        output: { amount: "640148143", token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
        gasUseEstimate: "100618",
      },
    });
    console.log("EXACT_OUTPUT parse ok?", r.success, r.success ? "" : JSON.stringify(r.error.issues));
  });
});
