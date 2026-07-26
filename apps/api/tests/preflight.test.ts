import { describe, expect, it, vi } from "vitest";

import {
  diagnoseChainConfiguration,
  formatPreflight,
  probeRpcChainId,
} from "../src/config/preflight";

const base = {
  configuredChainId: 31337,
  rpcUrl: "http://127.0.0.1:8545",
  rpcChainId: 31337,
  hasAquaStrategy: true,
  chainsWithStrategies: [31337],
};

describe("diagnoseChainConfiguration", () => {
  it("passes when the RPC agrees and a strategy is deployed", () => {
    const finding = diagnoseChainConfiguration(base);

    expect(finding.severity).toBe("ok");
    expect(finding.code).toBe("OK");
  });

  it("catches the 42161-vs-31337 mismatch that cost a demo run", () => {
    // The exact configuration master hit: API on 42161, anvil on 31337.
    const finding = diagnoseChainConfiguration({
      ...base,
      configuredChainId: 42161,
      rpcChainId: 31337,
      hasAquaStrategy: false,
    });

    expect(finding.severity).toBe("error");
    expect(finding.code).toBe("CHAIN_ID_MISMATCH");
    // The remedy must name the value to set, not merely describe the problem.
    expect(finding.remedy).toContain("31337");
  });

  it("names the chain that does have a strategy when the configured one does not", () => {
    const finding = diagnoseChainConfiguration({
      ...base,
      configuredChainId: 42161,
      rpcChainId: 42161,
      hasAquaStrategy: false,
      chainsWithStrategies: [31337],
    });

    expect(finding.severity).toBe("error");
    expect(finding.code).toBe("NO_AQUA_STRATEGY");
    expect(finding.remedy).toContain("CHAIN_ID=31337");
    // It must explain the symptom operators actually see.
    expect(finding.message).toContain("AQUA_EXECUTION_UNAVAILABLE");
  });

  it("suggests bootstrapping when no chain has a strategy", () => {
    const finding = diagnoseChainConfiguration({
      ...base,
      hasAquaStrategy: false,
      chainsWithStrategies: [],
    });

    expect(finding.code).toBe("NO_AQUA_STRATEGY");
    expect(finding.remedy).toContain("ensure-demo.sh");
  });

  it("warns rather than errors when the RPC is simply not running", () => {
    // A dev with no chain up is not misconfigured, just not started.
    const finding = diagnoseChainConfiguration({ ...base, rpcChainId: null });

    expect(finding.severity).toBe("warn");
    expect(finding.code).toBe("RPC_UNREACHABLE");
  });

  it("reports the mismatch before the missing strategy", () => {
    // Both are wrong; the chain id is the root cause and fixing it fixes both.
    const finding = diagnoseChainConfiguration({
      ...base,
      configuredChainId: 42161,
      rpcChainId: 31337,
      hasAquaStrategy: false,
      chainsWithStrategies: [31337],
    });

    expect(finding.code).toBe("CHAIN_ID_MISMATCH");
  });

  it("always carries a remedy on a non-ok finding", () => {
    const inputs = [
      { ...base, rpcChainId: null },
      { ...base, configuredChainId: 42161, rpcChainId: 31337 },
      { ...base, hasAquaStrategy: false },
    ];

    for (const input of inputs) {
      const finding = diagnoseChainConfiguration(input);
      expect(finding.severity).not.toBe("ok");
      expect(finding.remedy).toBeTruthy();
    }
  });
});

describe("diagnoseChainConfiguration — deployed vs shipped", () => {
  it("distinguishes missing contracts from unshipped strategies", () => {
    const missing = diagnoseChainConfiguration({
      ...base,
      contractsMissing: ["Aqua", "VortexAquaLens"],
    });

    expect(missing.code).toBe("CONTRACTS_MISSING");
    expect(missing.message).toContain("Aqua");
    expect(missing.remedy).toContain("ensure-demo.sh");
  });

  it("names the unshipped strategies and says the system only LOOKS deployed", () => {
    // The dangerous state: every address has bytecode, nothing was shipped.
    const finding = diagnoseChainConfiguration({
      ...base,
      strategiesUnshipped: ["Vortex Grow"],
    });

    expect(finding.severity).toBe("error");
    expect(finding.code).toBe("STRATEGIES_UNSHIPPED");
    expect(finding.message).toContain("Vortex Grow");
    expect(finding.message).toContain("looks deployed");
    // It must name the symptom an operator would otherwise chase.
    expect(finding.message).toContain("STRATEGY_NOT_FOUND");
    expect(finding.remedy).toContain("ensure-demo.sh");
  });

  it("reports missing contracts before unshipped strategies", () => {
    // Nothing can be shipped into a contract that does not exist, so the
    // deeper cause wins.
    const finding = diagnoseChainConfiguration({
      ...base,
      contractsMissing: ["Aqua"],
      strategiesUnshipped: ["Vortex Swap"],
    });

    expect(finding.code).toBe("CONTRACTS_MISSING");
  });

  it("reports a chain mismatch before either — it explains both", () => {
    const finding = diagnoseChainConfiguration({
      ...base,
      configuredChainId: 42161,
      rpcChainId: 31337,
      contractsMissing: ["Aqua"],
      strategiesUnshipped: ["Vortex Swap"],
    });

    expect(finding.code).toBe("CHAIN_ID_MISMATCH");
  });

  it("passes when contracts are present and strategies are shipped", () => {
    expect(
      diagnoseChainConfiguration({
        ...base,
        contractsMissing: [],
        strategiesUnshipped: [],
      }).severity,
    ).toBe("ok");
  });
});

describe("formatPreflight", () => {
  it("renders a scannable block for errors, with the fix", () => {
    const text = formatPreflight(
      diagnoseChainConfiguration({
        ...base,
        configuredChainId: 42161,
        rpcChainId: 31337,
      }),
    );

    expect(text).toContain("CONFIGURATION ERROR");
    expect(text).toContain("FIX:");
    expect(text.split("\n").length).toBeGreaterThan(4);
  });

  it("stays a single quiet line when everything is fine", () => {
    const text = formatPreflight(diagnoseChainConfiguration(base));

    expect(text.split("\n")).toHaveLength(1);
    expect(text).toContain("verified");
  });
});

describe("probeRpcChainId", () => {
  const respond = (body: unknown, ok = true) =>
    vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

  it("parses the hex chain id an RPC returns", async () => {
    expect(await probeRpcChainId("http://x", respond({ result: "0x7a69" }))).toBe(
      31337,
    );
    expect(await probeRpcChainId("http://x", respond({ result: "0xa4b1" }))).toBe(
      42161,
    );
  });

  it("returns null rather than throwing when the RPC is down", async () => {
    const failing = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    expect(await probeRpcChainId("http://x", failing)).toBeNull();
  });

  it("returns null on a non-2xx or malformed response", async () => {
    expect(await probeRpcChainId("http://x", respond({}, false))).toBeNull();
    expect(await probeRpcChainId("http://x", respond({ result: 31337 }))).toBeNull();
    expect(await probeRpcChainId("http://x", respond({ error: "nope" }))).toBeNull();
  });
});
