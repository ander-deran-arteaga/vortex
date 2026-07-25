import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWallet, setWallet, wagmiMock } from "../wallet/mock-wagmi";
import { GROW_TRANSITIONS } from "@/lib/machines/growMachine";
import { SWAP_TRANSITIONS } from "@/lib/machines/swapMachine";

vi.mock("wagmi", () => wagmiMock);

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

/**
 * Regressions for the defects found by the Phase 4 adversarial audit. Each
 * test names the failure it prevents.
 */
describe("re-quoting is not a silent no-op", () => {
  it("QUOTE_READY accepts a fresh quote request", () => {
    expect(SWAP_TRANSITIONS.QUOTE_READY.REQUEST_QUOTE).toBe("FETCHING_QUOTE");
  });

  it("OPPORTUNITY_READY accepts a fresh scan", () => {
    expect(GROW_TRANSITIONS.OPPORTUNITY_READY.SCAN).toBe("SCANNING");
  });

  it("re-quoting a different size replaces the quote on screen", async () => {
    const user = userEvent.setup();
    const { SwapClient } = await import("@/components/swap/swap-client");
    render(<SwapClient />);

    await user.type(screen.getByLabelText("Sell"), "1");
    await user.click(screen.getByRole("button", { name: /get best execution/i }));
    await waitFor(() => {
      // 1 WBTC at the fixture's 100k reference, plus the 12 bps Aqua edge.
      expect(screen.getByText("100,120.00 USDC")).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText("Sell"));
    await user.type(screen.getByLabelText("Sell"), "2");
    await user.click(screen.getByRole("button", { name: /get best execution/i }));

    await waitFor(() => {
      expect(screen.getByText("200,240.00 USDC")).toBeInTheDocument();
    });
    // The stale quote for the old size must be gone, not sitting beside it.
    expect(screen.queryByText("100,120.00 USDC")).toBeNull();
  });
});

describe("execution never strands the user", () => {
  it("clicking execute leaves the flow in a state with an exit", async () => {
    const user = userEvent.setup();
    setWallet({
      isConnected: true,
      address: "0x3333333333333333333333333333333333333333",
      chainId: 31337,
      chainName: "Foundry",
    });
    const { SwapClient } = await import("@/components/swap/swap-client");
    render(<SwapClient />);

    await user.type(screen.getByLabelText("Sell"), "1");
    await user.click(screen.getByRole("button", { name: /get best execution/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /execute swap/i })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /execute swap/i }));

    // The machine must not have advanced into BUILDING_TRANSACTION, which has
    // no RESET and nothing to service it — that state needed a page reload.
    expect(
      screen.queryByText(/building the execution transaction/i),
    ).toBeNull();
    expect(screen.queryByText(/approve the token allowance/i)).toBeNull();
    // A fresh quote is still reachable, so the user is never stuck.
    expect(screen.getByRole("button", { name: /get best execution/i })).toBeEnabled();
  });

  it("preparing a Grow route explains instead of parking in SIMULATING", async () => {
    const user = userEvent.setup();
    const { GrowClient } = await import("@/components/grow/grow-client");
    render(<GrowClient />);

    await user.click(screen.getByRole("button", { name: /scan for opportunity/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /prepare route/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /prepare route/i }));

    expect(screen.queryByText(/simulating the cycle/i)).toBeNull();
    expect(screen.getByText(/nothing to sign yet|nothing was signed/i)).toBeInTheDocument();
  });
});

describe("dashboard tells the truth when a read fails", () => {
  it("does not assert an empty history when the request errored", async () => {
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    // An enveloped 500 is a real failure: it must surface, not fall back.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "boom" } }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const { DashboardClient } = await import("@/components/dashboard/dashboard-client");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DashboardClient />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/some reads failed/i);
    });
    expect(screen.queryByText("No executions recorded yet.")).toBeNull();
    expect(screen.getByText(/empty for an unknown reason/i)).toBeInTheDocument();
  });
});

describe("Grow does not blame prices for a timeout", () => {
  it("says the opportunity expired rather than citing market conditions", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { GrowClient } = await import("@/components/grow/grow-client");
      render(<GrowClient />);

      await user.click(screen.getByRole("button", { name: /scan for opportunity/i }));
      await waitFor(() => {
        expect(screen.getByText("Opportunity")).toBeInTheDocument();
      });

      // Fixture opportunities live 30s; run past it.
      await vi.advanceTimersByTimeAsync(31_000);

      await waitFor(() => {
        expect(screen.getByText(/that opportunity expired/i)).toBeInTheDocument();
      });
      expect(
        screen.queryByText(/no profitable cycle at current prices/i),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
