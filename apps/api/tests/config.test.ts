import { readFileSync } from "node:fs";

import { API_ROUTES, zApiError, zConfigResponse } from "@vortex/shared";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer, type BuiltServer } from "../src/server";

let built: BuiltServer | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const hermetic = (overrides: Parameters<typeof buildServer>[0]) =>
  buildServer(overrides, { envSource: {} });

const deploymentContracts = (chainId: number): Record<string, string> =>
  JSON.parse(
    readFileSync(
      new URL(`../../../deployments/${chainId}.json`, import.meta.url),
      "utf8",
    ),
  ).contracts;

describe(`GET ${API_ROUTES.config}`, () => {
  it("returns chain, tokens, contracts, and feature flags", async () => {
    built = hermetic({ CHAIN_ID: "42161" });
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.config });

    expect(res.statusCode).toBe(200);
    const body = zConfigResponse.parse(res.json());
    expect(body.chainId).toBe(42161);

    const bySymbol = new Map(body.tokens.map((t) => [t.symbol, t]));
    expect(bySymbol.get("WBTC")?.decimals).toBe(8);
    expect(bySymbol.get("USDC")?.decimals).toBe(6);

    expect(body.contracts).toEqual(deploymentContracts(42161));
    expect(body.features.growEnabled).toBe(false);
    expect(body.features.demoMode).toBe(false);
  });

  it("reflects DEMO_MODE from the environment", async () => {
    built = hermetic({ CHAIN_ID: "42161", DEMO_MODE: "true" });
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.config });

    expect(zConfigResponse.parse(res.json()).features.demoMode).toBe(true);
  });

  it("serves the deployment file matching the configured chain", async () => {
    built = hermetic({ CHAIN_ID: "31337" });
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.config });

    const body = zConfigResponse.parse(res.json());
    expect(body.chainId).toBe(31337);
    // Pinned to the actual file so loading the wrong chain's deployment fails.
    expect(body.contracts).toEqual(deploymentContracts(31337));
  });
});

describe("error envelope", () => {
  it("wraps unknown routes in the canonical zApiError shape", async () => {
    built = hermetic({ CHAIN_ID: "42161" });
    const res = await built.app.inject({ method: "GET", url: "/nope" });

    expect(res.statusCode).toBe(404);
    const body = zApiError.parse(res.json());
    expect(body.error.code).toBe("NOT_FOUND");
    expect(typeof body.error.message).toBe("string");
  });
});
