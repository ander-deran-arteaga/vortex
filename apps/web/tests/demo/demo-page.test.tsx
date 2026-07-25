import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWallet, wagmiMock } from "../wallet/mock-wagmi";
import { DEMO_STEPS } from "@/lib/demo/steps";

vi.mock("wagmi", () => wagmiMock);

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Everything unregistered — the state the project is actually in today. */
function apiWithNoRoutes() {
  return vi.fn(async () => new Response("Not Found", { status: 404 }));
}

beforeEach(() => {
  resetWallet();
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

async function renderDemo() {
  const { DemoClient } = await import("@/components/demo/demo-client");
  render(<DemoClient />);
}

describe("demo page", () => {
  it("lists all ten steps as not started before a run", async () => {
    vi.stubGlobal("fetch", apiWithNoRoutes());
    await renderDemo();

    expect(DEMO_STEPS).toHaveLength(10);
    for (const step of DEMO_STEPS) {
      expect(screen.getByText(step.title)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Not started")).toHaveLength(10);
  });

  it("blocks unavailable steps with a specific reason instead of faking them", async () => {
    vi.stubGlobal("fetch", apiWithNoRoutes());
    const user = userEvent.setup();
    await renderDemo();

    await user.click(screen.getByRole("button", { name: /run the demo/i }));

    await waitFor(
      () => {
        expect(screen.queryByRole("button", { name: /running/i })).toBeNull();
      },
      { timeout: 10_000 },
    );

    // The execution step must name the exact missing route, not shrug.
    expect(
      screen.getByText(/POST \/api\/v1\/transactions\/aqua is not registered/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/POST \/api\/v1\/demo\/seed is not registered/),
    ).toBeInTheDocument();
    // Nothing may claim success it did not achieve.
    expect(screen.queryByText(/Transaction: 0x/)).toBeNull();
  });

  it("summarises blocked steps rather than hiding them", async () => {
    vi.stubGlobal("fetch", apiWithNoRoutes());
    const user = userEvent.setup();
    await renderDemo();

    await user.click(screen.getByRole("button", { name: /run the demo/i }));
    await waitFor(
      () => {
        expect(screen.getByText(/could not run/i)).toBeInTheDocument();
      },
      { timeout: 10_000 },
    );
    expect(
      screen.getByText(/Nothing below was simulated to make the run look complete/i),
    ).toBeInTheDocument();
  });

  it("surfaces a real Uniswap request ID in the evidence panel", async () => {
    // Only the quote route answers, as if Phase 3 is live but the rest is not.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/quotes/exchange")) {
          return jsonResponse({
            quoteSessionId: "session-1",
            selectedVenue: "AQUA",
            expiresAt: Date.now() + 45_000,
            comparison: {
              aqua: {
                source: "fixture",
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
                requestId: "dd9ff18437ed048d4203a8a0b2bf02e4",
              },
            },
            execution: {
              kind: "AQUA_SWAPVM",
              order: null,
              amount: "100000000",
              takerTraitsAndData: "0x",
            },
          });
        }
        return new Response("Not Found", { status: 404 });
      }),
    );

    const user = userEvent.setup();
    await renderDemo();
    await user.click(screen.getByRole("button", { name: /run the demo/i }));

    await waitFor(
      () => {
        expect(
          screen.getAllByText("dd9ff18437ed048d4203a8a0b2bf02e4").length,
        ).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );

    // The evidence carries the Uniswap leg's own provenance, and that leg is
    // live even though the Aqua leg beside it is a fixture.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Live data")).toBeInTheDocument();
  });

  it("shows an empty evidence panel before a run", async () => {
    vi.stubGlobal("fetch", apiWithNoRoutes());
    await renderDemo();
    expect(
      screen.getByText(/No request IDs or transaction hashes captured yet/i),
    ).toBeInTheDocument();
  });
});
