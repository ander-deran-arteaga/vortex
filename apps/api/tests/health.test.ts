import { API_ROUTES, zHealthResponse } from "@vortex/shared";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer, type BuiltServer } from "../src/server";

let built: BuiltServer | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

describe(`GET ${API_ROUTES.health}`, () => {
  it("reports liveness with the configured chain id", async () => {
    built = buildServer({ CHAIN_ID: "42161" });
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.health });

    expect(res.statusCode).toBe(200);
    const body = zHealthResponse.parse(res.json());
    expect(body.ok).toBe(true);
    expect(body.chainId).toBe(42161);
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it("honors CHAIN_ID overrides for the local fork", async () => {
    built = buildServer({ CHAIN_ID: "31337" });
    const res = await built.app.inject({ method: "GET", url: API_ROUTES.health });

    expect(res.statusCode).toBe(200);
    expect(zHealthResponse.parse(res.json()).chainId).toBe(31337);
  });

  it("rejects unsupported chains at boot", () => {
    expect(() => buildServer({ CHAIN_ID: "1" })).toThrow();
  });
});
