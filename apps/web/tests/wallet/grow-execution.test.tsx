import { render, screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "../render-app";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics } from "viem";
import type { Address, Hex } from "viem";
import {
  callSpy,
  readContractSpy,
  resetWallet,
  sendTransactionAsyncSpy,
  setWallet,
  waitForReceiptSpy,
  wagmiMock,
} from "./mock-wagmi";
import { VORTEX_GROW_EXECUTED_ABI } from "@/hooks/useGrowExecution";

vi.mock("wagmi", () => wagmiMock);

/**
 * Vortex Grow, end to end in the browser, with wagmi mocked.
 *
 * Two supported execution modes: the API's solver broadcasts, or it answers
 * 503 SOLVER_UNAVAILABLE and the connected wallet broadcasts the transaction
 * the API prepared — byte for byte, never a rebuilt one. Everything else here
 * is a failure path, and each asserts that no hash, balance or "confirmed"
 * claim is invented on the way out.
 */

const NOW = 1_800_000_000_000;
const OPPORTUNITY_TTL_MS = 300_000;

const TAKER: Address = "0x3333333333333333333333333333333333333333";
const MAKER: Address = "0x1111111111111111111111111111111111111111";
// Digits only: viem checksums every address it decodes out of a log, and a
// digits-only address checksums to itself, so the assertions compare equal.
const WBTC_ASSET: Address = "0x4444444444444444444444444444444444444444";
const COMPOUNDER: Address = "0x5555555555555555555555555555555555555555";

const OPPORTUNITY_ID = "grow-opportunity-31337-1";
const ONCHAIN_OPPORTUNITY_ID: Hex = `0x${"7b".repeat(32)}`;
const GROW_STRATEGY_HASH: Hex = `0x${"a1".repeat(32)}`;
const ROUTE_HASH: Hex = `0x${"1a".repeat(32)}`;
const BLOCK_HASH: Hex = `0x${"2b".repeat(32)}`;

/** The prepared transaction. Anything broadcast must equal exactly this. */
const ROUTE_TO: Address = COMPOUNDER;
const ROUTE_DATA: Hex = "0xfeedface00000001";
const ROUTE_VALUE = "0";

const SOLVER_TX_HASH: Hex = `0x${"ab".repeat(32)}`;
const WALLET_TX_HASH: Hex = `0x${"cd".repeat(32)}`;

const BLOCK = 128n;
/** WBTC is 8 decimals — never 18. 5.00000000 → 5.00240000 across the cycle. */
const MAKER_WBTC_BEFORE = 500_000_000n;
const MAKER_WBTC_AFTER = 500_240_000n;

/** 1.00000000 WBTC principal, matching the form's default. */
const PRINCIPAL = "100000000";
const GROSS_PROFIT = 30_000n;
const PERFORMANCE_FEE = 6_000n;
const MAKER_RETURN = 100_024_000n;

const originalFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function apiError(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

function scanBody() {
  return {
    opportunityFound: true,
    opportunityId: OPPORTUNITY_ID,
    direction: "VORTEX_THEN_EXTERNAL",
    principalAmount: PRINCIPAL,
    bridgeAmount: "100000000000",
    maxAssetSpent: "99800000",
    minFinalAsset: "100024000",
    minimumProfit: "24000",
    estimatedGrossProfit: GROSS_PROFIT.toString(),
    performanceFee: PERFORMANCE_FEE.toString(),
    expiresAt: NOW + OPPORTUNITY_TTL_MS,
  };
}

function prepareBody() {
  return {
    opportunityId: OPPORTUNITY_ID,
    to: ROUTE_TO,
    data: ROUTE_DATA,
    value: ROUTE_VALUE,
    gasEstimate: "480000",
    routeHash: ROUTE_HASH,
    minFinalAsset: "100024000",
    expiresAt: NOW + OPPORTUNITY_TTL_MS,
  };
}

/**
 * A real `VortexGrowExecuted` log, encoded with viem against the same ABI the
 * hook parses. The maker and asset the page reads balances from come out of
 * this log, so the test proves they were taken from the receipt.
 */
function growExecutedLog() {
  const topics = encodeEventTopics({
    abi: VORTEX_GROW_EXECUTED_ABI,
    eventName: "VortexGrowExecuted",
    args: {
      strategyHash: GROW_STRATEGY_HASH,
      opportunityId: ONCHAIN_OPPORTUNITY_ID,
      maker: MAKER,
    },
  });
  const data = encodeAbiParameters(
    [
      { name: "asset", type: "address" },
      { name: "principal", type: "uint256" },
      { name: "makerReturn", type: "uint256" },
      { name: "grossProfit", type: "uint256" },
      { name: "fee", type: "uint256" },
    ] as const,
    [WBTC_ASSET, BigInt(PRINCIPAL), MAKER_RETURN, GROSS_PROFIT, PERFORMANCE_FEE],
  );
  return {
    address: COMPOUNDER,
    topics,
    data,
    blockNumber: BLOCK,
    blockHash: BLOCK_HASH,
    logIndex: 0,
    transactionHash: SOLVER_TX_HASH,
    transactionIndex: 0,
    removed: false,
  };
}

interface ApiScript {
  /** POST /grow/execute — the branch every test varies. */
  execute: () => Response;
  prepare?: () => Response;
}

function apiWith(script: ApiScript) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/grow/scan")) {
      return json(scanBody());
    }
    if (url.includes("/grow/prepare")) {
      return script.prepare === undefined ? json(prepareBody()) : script.prepare();
    }
    if (url.includes("/grow/execute")) {
      return script.execute();
    }
    return new Response("Not Found", { status: 404 });
  });
}

function executeCalls(fetchMock: ReturnType<typeof apiWith>): unknown[] {
  return fetchMock.mock.calls.filter(([input]) => String(input).includes("/grow/execute"));
}

/** Renders Grow, scans, then prepares + runs the cycle. */
async function runCycle() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const { GrowClient } = await import("@/components/grow/grow-client");
  renderApp(<GrowClient />);

  await user.click(screen.getByRole("button", { name: /scan for opportunity/i }));
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /prepare route & run cycle/i }),
    ).toBeInTheDocument();
  });
  await user.click(screen.getByRole("button", { name: /prepare route & run cycle/i }));
  return user;
}

beforeEach(() => {
  resetWallet();
  // A connected wallet is what gives the page an RPC client to simulate and
  // read receipts with; the solver path still must not use it to send.
  setWallet({
    isConnected: true,
    address: TAKER,
    chainId: 31337,
    chainName: "Foundry",
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("Vortex Grow — solver mode", () => {
  it("confirms with the solver's own hash and never touches the wallet", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () =>
          json({ opportunityId: OPPORTUNITY_ID, txHash: SOLVER_TX_HASH }),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });
    waitForReceiptSpy.mockResolvedValue({
      status: "success",
      blockNumber: BLOCK,
      logs: [growExecutedLog()],
    });
    readContractSpy.mockImplementation(
      async (args: { functionName?: string; blockNumber?: bigint }) => {
        if (args.functionName === "decimals") {
          return 8;
        }
        return args.blockNumber === BLOCK - 1n ? MAKER_WBTC_BEFORE : MAKER_WBTC_AFTER;
      },
    );

    await runCycle();

    await waitFor(() => {
      expect(screen.getByText("Cycle confirmed.")).toBeInTheDocument();
    });

    // The exact hash the API returned, not a synthesised one.
    expect(screen.getAllByText(new RegExp(SOLVER_TX_HASH)).length).toBeGreaterThan(0);
    expect(screen.getByText("The Vortex solver (backend key)")).toBeInTheDocument();
    expect(screen.getByText("Confirmed onchain")).toBeInTheDocument();
    // Nothing left the wallet in solver mode.
    expect(sendTransactionAsyncSpy).not.toHaveBeenCalled();
    // What was simulated is what the API prepared.
    expect(callSpy).toHaveBeenCalledWith({
      account: TAKER,
      to: ROUTE_TO,
      data: ROUTE_DATA,
      value: 0n,
    });
  });

  it("reads the maker's balances either side of the cycle's block", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () =>
          json({ opportunityId: OPPORTUNITY_ID, txHash: SOLVER_TX_HASH }),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });
    waitForReceiptSpy.mockResolvedValue({
      status: "success",
      blockNumber: BLOCK,
      logs: [growExecutedLog()],
    });
    readContractSpy.mockImplementation(
      async (args: { functionName?: string; blockNumber?: bigint }) => {
        if (args.functionName === "decimals") {
          return 8;
        }
        return args.blockNumber === BLOCK - 1n ? MAKER_WBTC_BEFORE : MAKER_WBTC_AFTER;
      },
    );

    await runCycle();

    await waitFor(() => {
      expect(screen.getByText("5.00000000 WBTC")).toBeInTheDocument();
    });
    expect(screen.getByText("5.00240000 WBTC")).toBeInTheDocument();
    // 8 decimals, computed in bigint: 500,240,000 − 500,000,000 base units.
    expect(screen.getByText("+ 0.00240000 WBTC")).toBeInTheDocument();
    // The maker came out of the receipt's event, not out of a guess.
    expect(screen.getByText("0x1111…1111")).toBeInTheDocument();
    expect(screen.getByText(BLOCK.toString())).toBeInTheDocument();
    expect(readContractSpy).toHaveBeenCalledWith(
      expect.objectContaining({ address: WBTC_ASSET, blockNumber: BLOCK - 1n }),
    );
  });
});

describe("Vortex Grow — permissionless mode", () => {
  it("broadcasts the prepared transaction unchanged when no solver is configured", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () =>
          apiError("SOLVER_UNAVAILABLE", "no solver key is configured", 503),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });
    sendTransactionAsyncSpy.mockResolvedValue(WALLET_TX_HASH);
    waitForReceiptSpy.mockResolvedValue({
      status: "success",
      blockNumber: BLOCK,
      logs: [],
    });

    await runCycle();

    await waitFor(() => {
      expect(screen.getByText("Cycle confirmed.")).toBeInTheDocument();
    });

    // Byte for byte what /grow/prepare returned — never a rebuilt route.
    expect(sendTransactionAsyncSpy).toHaveBeenCalledTimes(1);
    expect(sendTransactionAsyncSpy).toHaveBeenCalledWith({
      to: ROUTE_TO,
      data: ROUTE_DATA,
      value: 0n,
    });
    expect(screen.getAllByText(new RegExp(WALLET_TX_HASH)).length).toBeGreaterThan(0);
    expect(screen.getByText("Your wallet (no solver configured)")).toBeInTheDocument();
    expect(screen.getByText("Confirmed onchain")).toBeInTheDocument();
  });

  it("says why a balance is missing instead of showing a plausible number", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () =>
          apiError("SOLVER_UNAVAILABLE", "no solver key is configured", 503),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });
    sendTransactionAsyncSpy.mockResolvedValue(WALLET_TX_HASH);
    // A receipt with no cycle event: the maker and asset are unknown, so no
    // balance may be read — or invented.
    waitForReceiptSpy.mockResolvedValue({
      status: "success",
      blockNumber: BLOCK,
      logs: [],
    });

    await runCycle();

    await waitFor(() => {
      expect(
        screen.getByText(/carried no VortexGrowExecuted event/i),
      ).toBeInTheDocument();
    });
    expect(readContractSpy).not.toHaveBeenCalled();
    // Maker, before, after and delta all render as em dashes — never as a
    // zero, and never as a number nobody read.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});

describe("Vortex Grow — simulation stops the flow", () => {
  it("surfaces the revert reason and never reaches the wallet or the solver", async () => {
    const fetchMock = apiWith({
      execute: () => json({ opportunityId: OPPORTUNITY_ID, txHash: SOLVER_TX_HASH }),
    });
    vi.stubGlobal("fetch", fetchMock);
    callSpy.mockRejectedValue(
      Object.assign(new Error("call reverted"), {
        shortMessage: "execution reverted: VortexGrowNotProfitable",
      }),
    );

    await runCycle();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /VortexGrowNotProfitable/,
      );
    });
    expect(sendTransactionAsyncSpy).not.toHaveBeenCalled();
    // The execute endpoint was never asked: a doomed cycle is not broadcast.
    expect(executeCalls(fetchMock)).toHaveLength(0);
    // No settlement, therefore no hash and no balance to fabricate.
    expect(screen.queryByText("Settlement")).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/0x[0-9a-fA-F]{64}/);
    // The user can always leave a failed run.
    expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
  });
});

describe("Vortex Grow — the API's own error codes", () => {
  it("surfaces GROW_EXECUTION_FAILED verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () =>
          apiError(
            "GROW_EXECUTION_FAILED",
            "the compounder reverted: VortexGrowNoProfit",
            500,
          ),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });

    await runCycle();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/GROW_EXECUTION_FAILED/);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/VortexGrowNoProfit/);
    expect(sendTransactionAsyncSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Cycle confirmed.")).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/0x[0-9a-fA-F]{64}/);
  });

  it("surfaces OPPORTUNITY_NOT_PREPARED verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () =>
          apiError(
            "OPPORTUNITY_NOT_PREPARED",
            "prepare the route before executing it",
            409,
          ),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });

    await runCycle();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /OPPORTUNITY_NOT_PREPARED/,
      );
    });
    expect(sendTransactionAsyncSpy).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /scan again/i })).toBeInTheDocument();
  });

  it("does not treat an unreachable API as a fixture-backed success", async () => {
    // /grow/execute answers with a transport failure, not an envelope.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/grow/scan")) return json(scanBody());
        if (url.includes("/grow/prepare")) return json(prepareBody());
        throw new TypeError("fetch failed");
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });

    await runCycle();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /could not be reached/i,
      );
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Nothing was broadcast/i);
    expect(sendTransactionAsyncSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("Cycle confirmed.")).toBeNull();
  });
});

describe("Vortex Grow — after the broadcast", () => {
  it("reports an onchain revert as a failure, not a success", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () => json({ opportunityId: OPPORTUNITY_ID, txHash: SOLVER_TX_HASH }),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });
    waitForReceiptSpy.mockResolvedValue({
      status: "reverted",
      blockNumber: BLOCK,
      logs: [],
    });

    await runCycle();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/reverted onchain/i);
    });
    expect(screen.getByRole("alert")).toHaveTextContent(new RegExp(SOLVER_TX_HASH));
    expect(screen.queryByText("Cycle confirmed.")).toBeNull();
    expect(screen.getByText("Reverted onchain")).toBeInTheDocument();
    // A revert moved no balance, so none is read and none is shown.
    expect(readContractSpy).not.toHaveBeenCalled();
    expect(
      screen.getByText(/reverted, so no cycle event was emitted/i),
    ).toBeInTheDocument();
  });

  it("does not claim settlement when the receipt cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () => json({ opportunityId: OPPORTUNITY_ID, txHash: SOLVER_TX_HASH }),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });
    waitForReceiptSpy.mockRejectedValue(new Error("timed out waiting for receipt"));

    await runCycle();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /receipt could not be read/i,
      );
    });
    expect(screen.getByText("Not verified in this browser")).toBeInTheDocument();
    expect(screen.queryByText("Cycle confirmed.")).toBeNull();
    // No receipt was read, so the settlement panel carries no live badge —
    // the opportunity card's own badge is a different response.
    const settlementSection = screen.getByText("Settlement").closest("section");
    if (settlementSection === null) {
      throw new Error("expected the settlement panel to be on screen");
    }
    expect(within(settlementSection).queryByText("Live data")).toBeNull();
  });

  it("reports a wallet rejection without inventing a transaction", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith({
        execute: () =>
          apiError("SOLVER_UNAVAILABLE", "no solver key is configured", 503),
      }),
    );
    callSpy.mockResolvedValue({ data: "0x" });
    sendTransactionAsyncSpy.mockRejectedValue(
      Object.assign(new Error("rejected"), {
        shortMessage: "User rejected the request.",
      }),
    );

    await runCycle();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/User rejected/);
    });
    expect(screen.queryByText("Cycle confirmed.")).toBeNull();
    expect(screen.queryByText("Settlement")).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/0x[0-9a-fA-F]{64}/);
    expect(screen.getByRole("button", { name: /start over/i })).toBeInTheDocument();
  });
});
