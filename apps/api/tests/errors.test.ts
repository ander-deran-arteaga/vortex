import { zAmount, zApiError, zChainId } from "@vortex/shared";
import { afterEach, describe, expect, it } from "vitest";

import { loadDeployment } from "../src/config/contracts";
import { parseRequest, RequestValidationError } from "../src/lib/errors";
import { buildServer, type BuiltServer } from "../src/server";

let built: BuiltServer | undefined;

afterEach(async () => {
  await built?.app.close();
  built = undefined;
});

const hermetic = () => buildServer({ CHAIN_ID: "42161" }, { envSource: {} });

describe("error handler", () => {
  it("returns the zApiError 500 envelope without leaking internals", async () => {
    built = hermetic();
    built.app.get("/boom", () => {
      throw new Error("secret failure detail");
    });
    const res = await built.app.inject({ method: "GET", url: "/boom" });

    expect(res.statusCode).toBe(500);
    const body = zApiError.parse(res.json());
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("internal error");
    expect(res.body).not.toContain("secret");
  });

  it("maps tagged request-validation failures to 400 with details", async () => {
    built = hermetic();
    built.app.get("/validate", () => {
      parseRequest(zAmount, "not-a-number");
      return {};
    });
    const res = await built.app.inject({ method: "GET", url: "/validate" });

    expect(res.statusCode).toBe(400);
    const body = zApiError.parse(res.json());
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeDefined();
  });
});

describe("parseRequest", () => {
  it("returns parsed data on success and tags failures", () => {
    expect(parseRequest(zChainId, 42161)).toBe(42161);
    expect(() => parseRequest(zChainId, 1)).toThrow(RequestValidationError);
  });
});

describe("loadDeployment", () => {
  it("loads the repo deployment for a chain", () => {
    expect(loadDeployment(42161).chainId).toBe(42161);
  });

  it("rejects a deployment file whose chainId disagrees with its name", () => {
    const fixtures = new URL("./fixtures/deployments/", import.meta.url);
    expect(() => loadDeployment(31337, fixtures)).toThrow(/declares chainId/);
  });
});
