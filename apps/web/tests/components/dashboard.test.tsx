import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWallet, wagmiMock } from "../wallet/mock-wagmi";

vi.mock("wagmi", () => wagmiMock);

const originalFetch = globalThis.fetch;

beforeEach(() => {
  resetWallet();
  // API unreachable — the dashboard must fall back to fixtures AND say so.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Not Found", { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

async function renderDashboard() {
  const { DashboardClient } = await import("@/components/dashboard/dashboard-client");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <DashboardClient />
    </QueryClientProvider>,
  );
}

describe("dashboard", () => {
  it("labels every fixture-backed panel once data resolves", async () => {
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getAllByText("Fixture data").length).toBeGreaterThan(0);
    });
    // The page-level notice must be there too, and nothing may claim to be live.
    expect(screen.getByRole("status")).toHaveTextContent(/fixture data/i);
    expect(screen.queryByText("Live data")).toBeNull();
  });

  it("reports the API as unreachable rather than inventing a latency", async () => {
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Not reachable")).toBeInTheDocument();
    });
  });

  it("aggregates Grow profit from the records themselves", async () => {
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Vortex Grow")).toBeInTheDocument();
    });
    // The single Grow fixture record: 0.003 gross, 0.0006 fee, 0.0024 to maker.
    expect(screen.getByText("0.00300000 WBTC")).toBeInTheDocument();
    expect(screen.getByText("0.00240000 WBTC")).toBeInTheDocument();
    expect(screen.getByText("0.00060000 WBTC")).toBeInTheDocument();
  });

  it("renders execution amounts with each token's own decimals", async () => {
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Vortex Swap · Aqua")).toBeInTheDocument();
    });
    // 0.5 WBTC in (8 dp) against 50,060 USDC out (6 dp).
    expect(screen.getByText("0.50000000")).toBeInTheDocument();
    expect(screen.getByText("50,060.000000")).toBeInTheDocument();
  });
});
