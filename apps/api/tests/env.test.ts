import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env";

// Every call passes an explicit empty source so results never depend on the
// ambient shell/CI environment.
const CLEAN = {};

describe("loadEnv", () => {
  it("applies defaults for the skeleton", () => {
    const env = loadEnv({}, CLEAN);
    expect(env.CHAIN_ID).toBe(42161);
    expect(env.PORT).toBe(3001);
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.UNISWAP_API_BASE).toBe("https://trade-api.gateway.uniswap.org/v1");
    expect(env.DEMO_MODE).toBe(false);
  });

  it("coerces numeric strings from the environment", () => {
    expect(loadEnv({ CHAIN_ID: "31337", PORT: "4000" }, CLEAN).PORT).toBe(4000);
  });

  it("rejects unsupported chain ids", () => {
    expect(() => loadEnv({ CHAIN_ID: "1" }, CLEAN)).toThrow();
    expect(() => loadEnv({ CHAIN_ID: "banana" }, CLEAN)).toThrow();
  });

  it("boots without a Uniswap API key until Phase 3", () => {
    expect(loadEnv({}, CLEAN).UNISWAP_API_KEY).toBeUndefined();
    expect(loadEnv({}, { UNISWAP_API_KEY: "k" }).UNISWAP_API_KEY).toBe("k");
  });

  it("reads from the injected source, not the ambient process env", () => {
    const env = loadEnv({}, { HOST: "0.0.0.0", DEMO_MODE: "true" });
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.DEMO_MODE).toBe(true);
  });
});
