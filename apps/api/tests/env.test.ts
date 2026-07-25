import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env";

describe("loadEnv", () => {
  it("applies defaults for the skeleton", () => {
    const env = loadEnv({ CHAIN_ID: "42161", PORT: "3001", DEMO_MODE: "false" });
    expect(env.CHAIN_ID).toBe(42161);
    expect(env.PORT).toBe(3001);
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.UNISWAP_API_BASE).toBe("https://trade-api.gateway.uniswap.org/v1");
    expect(env.DEMO_MODE).toBe(false);
  });

  it("coerces numeric strings from the environment", () => {
    expect(loadEnv({ CHAIN_ID: "31337", PORT: "4000" }).PORT).toBe(4000);
  });

  it("rejects unsupported chain ids", () => {
    expect(() => loadEnv({ CHAIN_ID: "1" })).toThrow();
    expect(() => loadEnv({ CHAIN_ID: "banana" })).toThrow();
  });

  it("keeps the Uniswap API key optional until Phase 3", () => {
    const env = loadEnv({ CHAIN_ID: "42161" });
    expect(env.UNISWAP_API_KEY === undefined || typeof env.UNISWAP_API_KEY === "string").toBe(true);
  });
});
