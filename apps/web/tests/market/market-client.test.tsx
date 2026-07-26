import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "../render-app";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The comparison surface, and the honesty it has to keep.
 *
 * Two independent feeds: Binance straight from the browser, Vortex through the
 * API. Each has to survive the other being down, and neither may ever be
 * filled in from fixtures — a fixture curve plotted beside a live order book
 * would be the exact failure §21 exists to prevent.
 */

const originalFetch = globalThis.fetch;

const WBTC = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const USDC = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function configBody() {
  return {
    chainId: 31337,
    tokens: [
      { address: WBTC, symbol: "WBTC", decimals: 8 },
      { address: USDC, symbol: "USDC", decimals: 6 },
    ],
    contracts: {},
    features: { growEnabled: true, demoMode: true },
  };
}

/**
 * A quote whose two directions make a coherent book: selling 1 WBTC yields
 * 64,000 USDC, and spending USDC buys back at 64,600 — an 80 bps spread.
 */
function quoteBody(request: { tokenIn: string; amountIn: string }) {
  const amountIn = BigInt(request.amountIn);
  const selling = request.tokenIn.toLowerCase() === WBTC.toLowerCase();
  const amountOut = selling
    ? (amountIn * 64_000n) / 100n // WBTC base (8dp) → USDC base (6dp)
    : (amountIn * 100n) / 64_600n;
  return {
    quoteSessionId: "market-test",
    selectedVenue: "AQUA",
    expiresAt: Date.now() + 45_000,
    comparison: {
      aqua: {
        source: "live",
        amountOut: amountOut.toString(),
        minimumAmountOut: amountOut.toString(),
        estimatedGasUsd: null,
        netAmountOut: amountOut.toString(),
        safetyFeeBps: 5,
        commercialFeeBps: 20,
        inventoryAdjustmentBps: 0,
        makerCoverageBps: 10_000,
      },
      uniswap: null,
    },
    execution: {
      kind: "AQUA_SWAPVM",
      order: { strategyHash: `0x${"a1".repeat(32)}`, minimumAmountOut: amountOut.toString(), source: "live" },
      amount: request.amountIn,
      takerTraitsAndData: "0x",
    },
  };
}

/** A book one cent wide with a top level deep enough for every offered size. */
function depthBody() {
  return {
    lastUpdateId: 1,
    bids: [["64255.11000000", "5.00000000"]],
    asks: [["64255.12000000", "5.00000000"]],
  };
}

interface Script {
  binance?: () => Response | Promise<Response>;
  quote?: () => Response | Promise<Response>;
}

function stubFetch(script: Script) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("binance.com")) {
        return script.binance === undefined ? json(depthBody()) : script.binance();
      }
      if (url.includes("/config")) {
        return json(configBody());
      }
      if (url.includes("/quotes/exchange")) {
        if (script.quote !== undefined) {
          return script.quote();
        }
        const body = JSON.parse(String(init?.body)) as { tokenIn: string; amountIn: string };
        return json(quoteBody(body));
      }
      return new Response("Not Found", { status: 404 });
    }),
  );
}

async function renderMarket() {
  const { MarketClient } = await import("@/components/market/market-client");
  renderApp(<MarketClient />);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
});

describe("market comparison", () => {
  it("normalises every venue to basis points of its own mid", async () => {
    stubFetch({});
    await renderMarket();

    // Binance's real mid and the demo venue's mid are thousands apart; both
    // still land as a readable spread because of the normalisation. Scoped to
    // the table: the venue names also appear in the timeline legend.
    await waitFor(() => {
      expect(within(screen.getByRole("table")).getByText("Vortex Aqua")).toBeInTheDocument();
    });
    await waitFor(
      () => {
        // 64,000 bid against a 64,600 ask is 93.3 bps of the mid.
        expect(screen.getByText("93.3")).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    // Binance's one-cent book, resolved below a hundredth of a basis point.
    expect(screen.getByText("0.0016")).toBeInTheDocument();
  });

  it("says the pool cannot be quoted rather than leaving it blank", async () => {
    stubFetch({});
    await renderMarket();

    const table = within(screen.getByRole("table"));
    expect(table.getByText("Vortex PermAMM")).toBeInTheDocument();
    expect(table.getByText(/signed authorisation/i)).toBeInTheDocument();
  });

  it("keeps Vortex rendering when Binance is unreachable, and never substitutes a number", async () => {
    stubFetch({
      binance: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await renderMarket();

    // Stated on the feed line and again in the venue row: both are the same
    // failure, and neither is a number.
    await waitFor(() => {
      expect(screen.getAllByText(/failed to fetch/i).length).toBeGreaterThan(0);
    });
    // The Vortex side is unaffected.
    await waitFor(
      () => {
        expect(screen.getByText("93.3")).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
    // Nothing invented for the venue that did not answer: its row carries the
    // reason where the mid, bid, ask and spread would have been.
    // "Binance" also names the feed-status line, so scope to the table.
    const binanceRow = screen
      .getByRole("table")
      .querySelector("tbody tr:last-child") as HTMLElement | null;
    expect(binanceRow).not.toBeNull();
    expect((binanceRow as HTMLElement).textContent).toMatch(/Binance/);
    expect((binanceRow as HTMLElement).textContent).toMatch(/failed to fetch/i);
    expect((binanceRow as HTMLElement).textContent).not.toMatch(/\d,\d{3}/);
  });

  it("keeps Binance rendering when the Vortex API is down, with no fixture fallback", async () => {
    stubFetch({
      quote: () => {
        throw new TypeError("fetch failed");
      },
    });
    await renderMarket();

    await waitFor(() => {
      expect(screen.getByText("0.0016")).toBeInTheDocument();
    });
    // The endpoint helper would have served a fixture here; this surface must
    // not, so the row says the API is not answering instead.
    const rows = await screen.findAllByText(/not answering|no venue priced|could not reach/i);
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.queryByText(/fixture/i)).toBeNull();
  });

  // A fabricated series sitting unmarked beside two measured ones is the
  // failure this panel is most able to cause, so the label is asserted by its
  // exact words, visible without hover, in the panel rather than a footnote.
  it("labels the simulated series unmistakably, without hover", async () => {
    stubFetch({});
    await renderMarket();

    const badge = await screen.findByText(
      /Simulated: illustrative model of the designed curve, not measured performance/i,
    );
    expect(badge).toBeInTheDocument();
    // Not a title attribute or a footnote: real text inside the timeline panel.
    const panel = badge.closest("section");
    expect(panel).not.toBeNull();
    expect((panel as HTMLElement).textContent).toMatch(/Spread over the last minute/);
  });

  it("draws the modelled series dashed and the measured ones solid", async () => {
    stubFetch({});
    await renderMarket();

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /last sixty seconds/i })).toBeInTheDocument();
    });
    const chart = screen.getByRole("img", { name: /last sixty seconds/i });
    const dashed = chart.querySelectorAll("path[stroke-dasharray]");
    // Exactly one series is a model, so exactly one line may be dashed.
    expect(dashed.length).toBe(1);
  });

  it("keeps the timeline rendering when both real feeds are down", async () => {
    stubFetch({
      binance: () => {
        throw new TypeError("Failed to fetch");
      },
      quote: () => {
        throw new TypeError("fetch failed");
      },
    });
    await renderMarket();

    // The modelled line runs off the clock, so the panel still draws — and it
    // still says, in words, that this line is a model.
    await waitFor(() => {
      expect(screen.getByRole("img", { name: /last sixty seconds/i })).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Simulated: illustrative model of the designed curve/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/failed to fetch/i).length).toBeGreaterThan(0);
  });

  it("offers only sizes the maker's cap accepts", async () => {
    stubFetch({});
    await renderMarket();

    const group = screen.getByRole("group", { name: /trade size/i });
    const labels = Array.from(group.querySelectorAll("button")).map((b) => b.textContent);
    expect(labels).toEqual(["0.010", "0.050", "0.100", "0.250"]);
    // The cap is about 0.4 WBTC; nothing offered may approach it.
    for (const label of labels) {
      expect(Number(label)).toBeLessThanOrEqual(0.25);
    }
  });
});
