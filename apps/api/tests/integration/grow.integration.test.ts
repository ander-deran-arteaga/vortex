/**
 * Demo scene 4: a full Vortex Grow cycle through the API, against the deployed
 * compounder — scan, prepare, execute, and a maker who ends with more WBTC.
 *
 * Opt-in — needs the local 31337 stack from `scripts/bootstrap-fork.sh`:
 *   VORTEX_INTEGRATION=1 npx vitest run tests/integration/grow
 */
import { readFileSync } from "node:fs";

import { API_ROUTES, zGrowScanResponse } from "@vortex/shared";
import {
  createPublicClient,
  decodeEventLog,
  defineChain,
  http,
  type Address,
  type Hex,
} from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { vortexCompounderAbi } from "../../src/clients/growAbis";
import { buildServer, type BuiltServer } from "../../src/server";

const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
const ROOT = new URL("../../../../", import.meta.url).pathname;

const readJson = (name: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(`${ROOT}deployments/${name}`, "utf8"));
  } catch {
    return null;
  }
};

const grow = readJson("31337.grow.json") as {
  growStrategyHash: Hex;
  compounder: Address;
  strategy: { maker: Address; performanceFeeBps: number };
} | null;

const enabled = process.env.VORTEX_INTEGRATION === "1" && grow !== null;

const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

describe.skipIf(!enabled)("Vortex Grow cycle through the API", () => {
  const g = grow!;
  const pub = createPublicClient({ chain: anvil, transport: http(RPC) });
  let built: BuiltServer;

  beforeAll(() => {
    built = buildServer(
      { CHAIN_ID: "31337" },
      { envSource: { CHAIN_ID: "31337" } },
    );
  });

  afterAll(async () => {
    await built?.app.close();
  });

  it("scans, prepares, executes, and leaves the maker with more asset", async () => {
    const principal = 100_000_000n; // 1 WBTC

    const scanRes = await built.app.inject({
      method: "POST",
      url: API_ROUTES.growScan,
      payload: {
        chainId: 31337,
        strategyHash: g.growStrategyHash,
        principalAmount: principal.toString(),
        direction: "AUTO",
      },
    });
    expect(scanRes.statusCode).toBe(200);
    const scan = zGrowScanResponse.parse(scanRes.json());
    expect(scan.opportunityFound).toBe(true);
    if (!scan.opportunityFound) return;

    // The scan promises a floor, not a hope.
    expect(BigInt(scan.minFinalAsset)).toBeGreaterThan(principal);
    expect(BigInt(scan.performanceFee)).toBe(
      (BigInt(scan.estimatedGrossProfit) *
        BigInt(g.strategy.performanceFeeBps)) /
        10_000n,
    );

    const prepRes = await built.app.inject({
      method: "POST",
      url: API_ROUTES.growPrepare,
      payload: { opportunityId: scan.opportunityId },
    });
    expect(prepRes.statusCode).toBe(200);
    const prepared = prepRes.json() as { to: string; data: string };
    expect(prepared.to.toLowerCase()).toBe(g.compounder.toLowerCase());

    const execRes = await built.app.inject({
      method: "POST",
      url: API_ROUTES.growExecute,
      payload: { opportunityId: scan.opportunityId },
    });
    expect(execRes.statusCode).toBe(200);
    const { txHash } = execRes.json() as { txHash: Hex };

    const receipt = await pub.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).toBe("success");

    // The event is the maker-facing truth: principal in, more asset out.
    const events = receipt.logs.flatMap((log) => {
      try {
        const decoded = decodeEventLog({
          abi: vortexCompounderAbi,
          data: log.data,
          topics: log.topics,
        });
        return decoded.eventName === "VortexGrowExecuted" ? [decoded.args] : [];
      } catch {
        return [];
      }
    });
    expect(events).toHaveLength(1);

    const e = events[0] as unknown as {
      principal: bigint;
      makerReturn: bigint;
      grossProfit: bigint;
      fee: bigint;
    };

    expect(e.principal).toBe(principal);
    // The whole product promise: the maker ends with more than they started.
    expect(e.makerReturn).toBeGreaterThan(e.principal);
    // Fee comes from realized profit only, never from principal.
    expect(e.fee).toBe(
      (e.grossProfit * BigInt(g.strategy.performanceFeeBps)) / 10_000n,
    );
    expect(e.makerReturn - e.principal + e.fee).toBe(e.grossProfit);
    // The cycle beat the floor the scan committed to.
    expect(e.principal + e.grossProfit).toBeGreaterThanOrEqual(
      BigInt(scan.minFinalAsset),
    );

    console.log(
      JSON.stringify({
        evidence: "VORTEX_GROW_CYCLE",
        txHash,
        blockNumber: receipt.blockNumber.toString(),
        opportunityId: scan.opportunityId,
        principal: e.principal.toString(),
        makerReturn: e.makerReturn.toString(),
        makerNetGain: (e.makerReturn - e.principal).toString(),
        grossProfit: e.grossProfit.toString(),
        performanceFee: e.fee.toString(),
        scannedFloor: scan.minFinalAsset,
      }),
    );
  }, 180_000);

  it("reports no opportunity rather than erroring when none exists", async () => {
    // Far more than the maker shipped: a legitimate "no", not a failure.
    const res = await built.app.inject({
      method: "POST",
      url: API_ROUTES.growScan,
      payload: {
        chainId: 31337,
        strategyHash: g.growStrategyHash,
        principalAmount: "100000000000",
        direction: "AUTO",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = zGrowScanResponse.parse(res.json());
    expect(body.opportunityFound).toBe(false);
  });
});
