import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { apiRequest } from "@/lib/api/client";
import {
  ApiContractError,
  ApiRequestError,
  ApiUnavailableError,
} from "@/lib/api/errors";
import { fetchConfig } from "@/lib/api/endpoints";

const schema = z.object({ ok: z.boolean() });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest error mapping", () => {
  it("returns validated data on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: true })));
    await expect(apiRequest("/api/v1/health", { schema })).resolves.toEqual({
      ok: true,
    });
  });

  it("maps an error envelope to ApiRequestError carrying its code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "MAKER_INSOLVENT", message: "maker cannot cover" } },
          409,
        ),
      ),
    );
    await expect(apiRequest("/api/v1/quotes/exchange", { schema })).rejects.toMatchObject({
      name: "ApiRequestError",
      code: "MAKER_INSOLVENT",
      status: 409,
    });
  });

  it("maps a bare 404 to ApiUnavailableError (route not registered yet)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not Found", { status: 404 })));
    await expect(apiRequest("/api/v1/grow/scan", { schema })).rejects.toBeInstanceOf(
      ApiUnavailableError,
    );
  });

  it("treats the API's enveloped NOT_FOUND as an unregistered route", async () => {
    // apps/api answers unregistered routes with the shared envelope and code
    // NOT_FOUND, so this is the shape the fixture fallback must recognise
    // while the Phase 3 routes are still landing.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "NOT_FOUND", message: "route POST /api/v1/quotes/exchange not found" } },
          404,
        ),
      ),
    );
    await expect(
      apiRequest("/api/v1/quotes/exchange", { schema }),
    ).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it("keeps a resource-specific 404 as a real request error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "STRATEGY_NOT_FOUND", message: "no such strategy" } },
          404,
        ),
      ),
    );
    await expect(
      apiRequest("/api/v1/strategies/0xabc", { schema }),
    ).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("maps a network failure to ApiUnavailableError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    await expect(apiRequest("/api/v1/config", { schema })).rejects.toBeInstanceOf(
      ApiUnavailableError,
    );
  });

  it("maps a schema mismatch to ApiContractError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: "yes" })));
    await expect(apiRequest("/api/v1/health", { schema })).rejects.toBeInstanceOf(
      ApiContractError,
    );
  });
});

describe("fixture fallback honesty invariant", () => {
  it("falls back to labeled fixture data when the API is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not Found", { status: 404 })));
    const result = await fetchConfig();
    expect(result.source).toBe("fixture");
    expect(result.data.chainId).toBe(31337);
  });

  it("marks a real API answer as live", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          chainId: 42161,
          tokens: [],
          contracts: {},
          features: { growEnabled: true, demoMode: false },
        }),
      ),
    );
    const result = await fetchConfig();
    expect(result.source).toBe("live");
    expect(result.data.chainId).toBe(42161);
  });

  it("RETHROWS a real API failure instead of masking it as fixture data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500),
      ),
    );
    // This is the invariant that keeps the UI honest: a backend that is up but
    // broken must surface as an error, never as plausible-looking mock data.
    await expect(fetchConfig()).rejects.toBeInstanceOf(ApiRequestError);
  });
});
