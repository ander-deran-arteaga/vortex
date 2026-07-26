import { readFileSync } from "node:fs";

import { API_ROUTES, zApiError, zConfigResponse } from "@vortex/shared";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer, type BuiltServer } from "../src/server";
import type { AquaQuoteSource } from "../src/services/types";

let built: BuiltServer | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const hermetic = (overrides: Parameters<typeof buildServer>[0]) =>
  buildServer(overrides, { envSource: {} });

/** Stands in for blockend's live strategy source until it is wired. */
const liveLikeAquaSource: AquaQuoteSource = {
  kind: "live",
  quote: async () => {
    throw new Error("not used by config route tests");
  },
  strategyHealth: async () => null,
};

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
    // No Grow deployment on 42161, so the capability is honestly off.
    expect(body.features.growEnabled).toBe(false);
    expect(built.ctx.grow).toBeNull();
  });

  it("passes DEMO_MODE through untouched once the venue is live", async () => {
    built = buildServer(
      { CHAIN_ID: "42161", DEMO_MODE: "false" },
      { envSource: {}, aquaSource: liveLikeAquaSource },
    );
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.config });

    expect(zConfigResponse.parse(res.json()).features.demoMode).toBe(false);
  });

  it("forces demoMode on while any quoted venue is simulated (§21)", async () => {
    // The default Aqua source is the fixture, so the UI must be told to label
    // simulated data even though DEMO_MODE is false.
    built = hermetic({ CHAIN_ID: "42161", DEMO_MODE: "false" });
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.config });

    expect(built.ctx.exchange.aquaSource.kind).toBe("fixture");
    expect(zConfigResponse.parse(res.json()).features.demoMode).toBe(true);
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

/**
 * The UI has no way to know which strategy to quote unless the API says so. A
 * strategy is Aqua *state*, not a contract, so its hash changes on every
 * reseed — a hardcoded constant then quotes a strategy that was never shipped,
 * which renders as "Aqua is broken" rather than "wrong strategy".
 */
describe("config publishes the strategy hashes", () => {
  it("reports the deployed swap and grow hashes on a seeded chain", async () => {
    built = hermetic({ CHAIN_ID: "31337" });
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.config });

    const body = zConfigResponse.parse(res.json());
    expect(body.strategies).toBeDefined();
    // Whatever is deployed, it must match what the server would actually quote.
    expect(body.strategies?.swap).toBe(
      built.ctx.aquaExecution?.strategy.strategyHash ?? null,
    );
    expect(body.strategies?.grow).toBe(
      built.ctx.grow?.deployment.strategyHash ?? null,
    );
  });

  it("reports null rather than a placeholder when nothing is shipped", async () => {
    // 42161 has no seeded strategy; inventing one would be the bug this fixes.
    built = hermetic({ CHAIN_ID: "42161" });
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.config });

    const body = zConfigResponse.parse(res.json());
    expect(body.strategies?.swap).toBeNull();
    expect(body.strategies?.grow).toBeNull();
  });
});
