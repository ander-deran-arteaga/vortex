import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetWallet,
  setWallet,
  switchChainSpy,
  wagmiMock,
} from "./mock-wagmi";

vi.mock("wagmi", () => wagmiMock);

// The API is unreachable in tests, so every quote resolves through the labeled
// fixture path — which is exactly the state a judge sees before Phase 3 lands.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetWallet();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Not Found", { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

async function renderSwap() {
  const { SwapClient } = await import("@/components/swap/swap-client");
  render(<SwapClient />);
}

describe("swap page wallet handling", () => {
  it("quotes without a wallet but refuses to execute", async () => {
    const user = userEvent.setup();
    await renderSwap();

    expect(
      screen.getByText(/quotes work without a wallet/i),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Sell"), "1");
    await user.click(screen.getByRole("button", { name: /get best execution/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Aqua · SwapVM")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /execute swap/i })).toBeDisabled();
  });

  it("labels a fixture-backed quote so no number reads as live", async () => {
    const user = userEvent.setup();
    await renderSwap();

    await user.type(screen.getByLabelText("Sell"), "1");
    await user.click(screen.getByRole("button", { name: /get best execution/i }));

    await waitFor(() => {
      expect(screen.getByText("Fixture data")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/fixture/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Live data")).toBeNull();
  });

  it("prompts to switch when the wallet is on an unsupported chain", async () => {
    const user = userEvent.setup();
    setWallet({
      isConnected: true,
      address: "0x3333333333333333333333333333333333333333",
      chainId: 1,
      chainName: "Ethereum",
    });
    await renderSwap();

    expect(screen.getByText(/unsupported network/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /switch to arbitrum one/i }));
    expect(switchChainSpy).toHaveBeenCalledWith({ chainId: 42161 });
  });

  it("blocks execution on the wrong chain even with a quote on screen", async () => {
    const user = userEvent.setup();
    setWallet({
      isConnected: true,
      address: "0x3333333333333333333333333333333333333333",
      chainId: 1,
      chainName: "Ethereum",
    });
    await renderSwap();

    await user.type(screen.getByLabelText("Sell"), "1");
    await user.click(screen.getByRole("button", { name: /get best execution/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Aqua · SwapVM")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /execute swap/i })).toBeDisabled();
  });

  it("explains rather than fabricating a transaction when data is fixture-backed", async () => {
    const user = userEvent.setup();
    setWallet({
      isConnected: true,
      address: "0x3333333333333333333333333333333333333333",
      chainId: 31337,
      chainName: "Foundry",
    });
    await renderSwap();

    await user.type(screen.getByLabelText("Sell"), "1");
    await user.click(screen.getByRole("button", { name: /get best execution/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /execute swap/i })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /execute swap/i }));

    // No tx hash, no success state — just the truth about why nothing happened.
    expect(
      screen.getByText(/execution needs the live vortex api/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Transaction:/)).toBeNull();
    expect(screen.queryByText(/swap confirmed/i)).toBeNull();
  });

  it("rejects an invalid amount before requesting a quote", async () => {
    const user = userEvent.setup();
    await renderSwap();

    await user.type(screen.getByLabelText("Sell"), "0.000000001");
    await user.click(screen.getByRole("button", { name: /get best execution/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(/at most 8 decimals/i);
    expect(screen.queryByLabelText("Aqua · SwapVM")).toBeNull();
  });
});
