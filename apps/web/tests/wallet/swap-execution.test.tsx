import { render, screen, waitFor } from "@testing-library/react";
import { renderApp } from "../render-app";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callSpy,
  readContractSpy,
  resetWallet,
  sendTransactionAsyncSpy,
  setWallet,
  waitForReceiptSpy,
  wagmiMock,
} from "./mock-wagmi";

vi.mock("wagmi", () => wagmiMock);

const originalFetch = globalThis.fetch;
const TAKER = "0x3333333333333333333333333333333333333333";
const ROUTER = "0x4444444444444444444444444444444444444444";
const TX_HASH = "0xabc0000000000000000000000000000000000000000000000000000000000001";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function liveQuote() {
  return {
    quoteSessionId: "session-live",
    selectedVenue: "AQUA",
    expiresAt: Date.now() + 45_000,
    comparison: {
      aqua: {
        source: "live",
        amountOut: "64948000000",
        minimumAmountOut: "64753156000",
        estimatedGasUsd: "0.01",
        netAmountOut: "64753146273",
        safetyFeeBps: 5,
        commercialFeeBps: 3,
        inventoryAdjustmentBps: 0,
        makerCoverageBps: 10000,
      },
      uniswap: {
        source: "live",
        amountOut: "64200142482",
        minimumAmountOut: "64007542054",
        estimatedGasUsd: "0.02",
        netAmountOut: "64007520821",
        requestId: "req-live",
      },
    },
    execution: {
      kind: "AQUA_SWAPVM",
      order: null,
      amount: "100000000",
      takerTraitsAndData: "0x",
    },
  };
}

/** @param aquaBuild what POST /transactions/aqua returns */
function apiWith(aquaBuild: () => Response) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/quotes/exchange")) return json(liveQuote());
    if (url.includes("/transactions/aqua")) return aquaBuild();
    return new Response("Not Found", { status: 404 });
  });
}

const BUILD_OK = () =>
  json({
    to: ROUTER,
    data: "0xdeadbeef",
    value: "0",
    gasLimit: null,
    minimumAmountOut: "64753156000",
    strategyHash: `0x${"f1".repeat(32)}`,
    spender: ROUTER,
  });

beforeEach(() => {
  resetWallet();
  setWallet({
    isConnected: true,
    address: TAKER,
    chainId: 31337,
    chainName: "Foundry",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

async function quoteThenExecute() {
  const user = userEvent.setup();
  const { SwapClient } = await import("@/components/swap/swap-client");
  renderApp(<SwapClient />);

  await user.type(screen.getByLabelText("Sell"), "1");
  await user.click(screen.getByRole("button", { name: /get best execution/i }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /execute swap/i })).toBeEnabled();
  });
  await user.click(screen.getByRole("button", { name: /execute swap/i }));
  return user;
}

describe("swap execution against a live builder", () => {
  it("broadcasts the API-built transaction unchanged and confirms it", async () => {
    vi.stubGlobal("fetch", apiWith(BUILD_OK));
    readContractSpy.mockResolvedValue(10n ** 18n); // allowance is ample
    callSpy.mockResolvedValue({ data: "0x" });
    sendTransactionAsyncSpy.mockResolvedValue(TX_HASH);
    waitForReceiptSpy.mockResolvedValue({ status: "success" });

    await quoteThenExecute();

    await waitFor(() => {
      expect(screen.getByText("Swap confirmed.")).toBeInTheDocument();
    });

    // The browser must send exactly what the API built — never a reconstruction.
    expect(sendTransactionAsyncSpy).toHaveBeenCalledWith({
      to: ROUTER,
      data: "0xdeadbeef",
      value: 0n,
    });
    expect(screen.getByText(new RegExp(TX_HASH))).toBeInTheDocument();
  });

  it("surfaces the builder's own error code rather than a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      apiWith(() =>
        json(
          {
            error: {
              code: "AQUA_EXECUTION_UNAVAILABLE",
              message: "no Aqua strategy is deployed on this chain; quotes are simulated",
            },
          },
          503,
        ),
      ),
    );

    await quoteThenExecute();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /AQUA_EXECUTION_UNAVAILABLE/,
      );
    });
    // Nothing was sent to the wallet on a failed build.
    expect(sendTransactionAsyncSpy).not.toHaveBeenCalled();
  });

  it("asks for an approval instead of sending a doomed transaction", async () => {
    vi.stubGlobal("fetch", apiWith(BUILD_OK));
    readContractSpy.mockResolvedValue(0n); // router not approved
    sendTransactionAsyncSpy.mockResolvedValue(TX_HASH);

    await quoteThenExecute();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /approve wbtc/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/not approved/i);
    expect(sendTransactionAsyncSpy).not.toHaveBeenCalled();
  });

  it("does not ask for a signature when the simulation reverts", async () => {
    vi.stubGlobal("fetch", apiWith(BUILD_OK));
    readContractSpy.mockResolvedValue(10n ** 18n);
    callSpy.mockRejectedValue(new Error("execution reverted: VortexStaleQuote"));

    await quoteThenExecute();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/VortexStaleQuote/);
    });
    expect(sendTransactionAsyncSpy).not.toHaveBeenCalled();
  });

  it("reports a user rejection without claiming the swap failed onchain", async () => {
    vi.stubGlobal("fetch", apiWith(BUILD_OK));
    readContractSpy.mockResolvedValue(10n ** 18n);
    callSpy.mockResolvedValue({ data: "0x" });
    sendTransactionAsyncSpy.mockRejectedValue(new Error("User rejected the request"));

    await quoteThenExecute();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/User rejected/);
    });
    expect(screen.queryByText("Swap confirmed.")).toBeNull();
  });

  it("reports an onchain revert after broadcast", async () => {
    vi.stubGlobal("fetch", apiWith(BUILD_OK));
    readContractSpy.mockResolvedValue(10n ** 18n);
    callSpy.mockResolvedValue({ data: "0x" });
    sendTransactionAsyncSpy.mockResolvedValue(TX_HASH);
    waitForReceiptSpy.mockResolvedValue({ status: "reverted" });

    await quoteThenExecute();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/reverted onchain/i);
    });
    expect(screen.queryByText("Swap confirmed.")).toBeNull();
  });
});
