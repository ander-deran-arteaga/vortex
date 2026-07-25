import { render, screen, waitFor } from "@testing-library/react";
import { renderApp } from "../render-app";
import userEvent from "@testing-library/user-event";
import { createElement, type FunctionComponent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWallet, setWallet, wagmiMock } from "../wallet/mock-wagmi";
import {
  FIXTURE_GROW_STRATEGY_HASH,
  FIXTURE_STRATEGY_HASH,
} from "@/lib/api/fixtures";
import { STRATEGY_HASHES, resolveStrategyHashes } from "@/lib/strategy-config";

vi.mock("wagmi", () => wagmiMock);

/**
 * Which strategy the UI quotes against, and what the swap page says when the
 * answer is still a placeholder.
 *
 * The fixture hashes exist only in this app. Quoting them against the real
 * 31337 deployment returns NO_VENUE_AVAILABLE / AQUA_ORDER_UNAVAILABLE, so the
 * page has to tell the user the comparison is *unavailable*, not unfavourable.
 */

const SWAP_ENV = "NEXT_PUBLIC_DEMO_STRATEGY_HASH";
const GROW_ENV = "NEXT_PUBLIC_DEMO_GROW_STRATEGY_HASH";

/** A hash shaped like one the demo seeding would actually produce. */
const SEEDED_SWAP_HASH = `0x${"1234abcd".repeat(8)}`;
const SEEDED_GROW_HASH = `0x${"9876fedc".repeat(8)}`;
const EXPLICIT_SWAP_HASH = `0x${"0f0f0f0f".repeat(8)}`;
const EXPLICIT_GROW_HASH = `0x${"0e0e0e0e".repeat(8)}`;

/** Deterministic clock: no assertion here may depend on the wall clock. */
const NOW = 1_800_000_000_000;
const QUOTE_TTL_MS = 45_000;

const originalFetch = globalThis.fetch;

/**
 * Sets environment variables for the duration of `run` and restores exactly
 * what was there before — including the absent case, which is what the fixture
 * fallback branch depends on.
 */
function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(vars)) {
    previous.set(key, process.env[key]);
    const value = vars[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("resolveStrategyHashes", () => {
  it("falls back to the fixture placeholders when nothing is configured", () => {
    const resolved = withEnv({ [SWAP_ENV]: undefined, [GROW_ENV]: undefined }, () =>
      resolveStrategyHashes(),
    );

    expect(resolved.swap).toBe(FIXTURE_STRATEGY_HASH);
    expect(resolved.grow).toBe(FIXTURE_GROW_STRATEGY_HASH);
    expect(resolved.isPlaceholder).toBe(true);
  });

  it("prefers the environment over the fixture placeholders", () => {
    const resolved = withEnv(
      { [SWAP_ENV]: SEEDED_SWAP_HASH, [GROW_ENV]: SEEDED_GROW_HASH },
      () => resolveStrategyHashes(),
    );

    expect(resolved.swap).toBe(SEEDED_SWAP_HASH);
    expect(resolved.grow).toBe(SEEDED_GROW_HASH);
    expect(resolved.isPlaceholder).toBe(false);
  });

  it("prefers explicitly configured hashes over the environment", () => {
    const resolved = withEnv(
      { [SWAP_ENV]: SEEDED_SWAP_HASH, [GROW_ENV]: SEEDED_GROW_HASH },
      () =>
        resolveStrategyHashes({
          swap: EXPLICIT_SWAP_HASH,
          grow: EXPLICIT_GROW_HASH,
        }),
    );

    expect(resolved.swap).toBe(EXPLICIT_SWAP_HASH);
    expect(resolved.grow).toBe(EXPLICIT_GROW_HASH);
    expect(resolved.isPlaceholder).toBe(false);
  });

  it("falls back per key: a configured swap hash does not rescue grow", () => {
    const resolved = withEnv({ [SWAP_ENV]: undefined, [GROW_ENV]: undefined }, () =>
      resolveStrategyHashes({ swap: EXPLICIT_SWAP_HASH }),
    );

    expect(resolved.swap).toBe(EXPLICIT_SWAP_HASH);
    expect(resolved.grow).toBe(FIXTURE_GROW_STRATEGY_HASH);
    // Still placeholder: Grow would quote a strategy nobody ever shipped.
    expect(resolved.isPlaceholder).toBe(true);
  });

  it("reports isPlaceholder while either hash is still a fixture", () => {
    const growOnly = withEnv({ [SWAP_ENV]: undefined, [GROW_ENV]: SEEDED_GROW_HASH }, () =>
      resolveStrategyHashes(),
    );
    expect(growOnly.isPlaceholder).toBe(true);

    const swapOnly = withEnv({ [SWAP_ENV]: SEEDED_SWAP_HASH, [GROW_ENV]: undefined }, () =>
      resolveStrategyHashes(),
    );
    expect(swapOnly.isPlaceholder).toBe(true);
  });

  it("clears isPlaceholder only when both hashes are real", () => {
    const resolved = withEnv({ [SWAP_ENV]: undefined, [GROW_ENV]: undefined }, () =>
      resolveStrategyHashes({ swap: SEEDED_SWAP_HASH, grow: SEEDED_GROW_HASH }),
    );
    expect(resolved.isPlaceholder).toBe(false);
  });
});

// ── The swap page's placeholder notice ─────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A schema-valid live quote: 1 WBTC in, Aqua winning on net output. */
function liveQuoteBody() {
  return {
    quoteSessionId: "session-live-strategy",
    selectedVenue: "AQUA",
    expiresAt: NOW + QUOTE_TTL_MS,
    comparison: {
      aqua: {
        source: "live",
        amountOut: "100120000000",
        minimumAmountOut: "99819640000",
        estimatedGasUsd: "0.42",
        netAmountOut: "100119580000",
        safetyFeeBps: 5,
        commercialFeeBps: 10,
        inventoryAdjustmentBps: -27,
        makerCoverageBps: 10000,
      },
      uniswap: {
        source: "live",
        amountOut: "99960000000",
        minimumAmountOut: "99660120000",
        estimatedGasUsd: "1.87",
        netAmountOut: "99958130000",
        requestId: "req-live-strategy",
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

async function quoteOnce() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const { SwapClient } = await import("@/components/swap/swap-client");
  // This file is .ts, so the page is constructed rather than written as JSX.
  const Page: FunctionComponent = SwapClient;
  renderApp(createElement(Page));

  await user.type(screen.getByLabelText("Sell"), "1");
  await user.click(screen.getByRole("button", { name: /get best execution/i }));
  return user;
}

describe("swap page placeholder notice", () => {
  beforeEach(() => {
    resetWallet();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  /**
   * The tests below describe the page as it ships. `STRATEGY_HASHES` is
   * resolved once at module load, so a shell that exports a real hash would
   * invalidate them — this states that precondition instead of quietly
   * passing.
   */
  it("ships pointed at the fixture placeholder", () => {
    expect(STRATEGY_HASHES.swap).toBe(FIXTURE_STRATEGY_HASH);
    expect(STRATEGY_HASHES.isPlaceholder).toBe(true);
  });

  it("explains the placeholder when the live API rejects the quote", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(
          {
            error: {
              code: "AQUA_ORDER_UNAVAILABLE",
              message: "no Aqua order could be built for this strategy",
            },
          },
          422,
        ),
      ),
    );

    await quoteOnce();

    // The API's own code, verbatim — that is what identifies the gap.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /AQUA_ORDER_UNAVAILABLE/,
      );
    });
    expect(screen.getByText(/Placeholder strategy hash\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/NEXT_PUBLIC_DEMO_STRATEGY_HASH/),
    ).toBeInTheDocument();
    // A live rejection is never laundered into fixture data.
    expect(screen.queryByText(/The Vortex API is not reachable/i)).toBeNull();
  });

  it("does not show the placeholder notice on a fixture-backed response", async () => {
    // A transport failure is the only condition that permits fixtures.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await quoteOnce();

    await waitFor(() => {
      expect(
        screen.getByText(/The Vortex API is not reachable/i),
      ).toBeInTheDocument();
    });
    // FixtureNotice already owns this situation; a second amber box that
    // blames the strategy hash would misdescribe an unreachable API.
    expect(screen.queryByText(/Placeholder strategy hash\./i)).toBeNull();
  });

  it("does not show the placeholder notice while quotes are succeeding", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(liveQuoteBody())));

    await quoteOnce();

    await waitFor(() => {
      expect(screen.getByText("Live API response")).toBeInTheDocument();
    });
    expect(screen.queryByText(/Placeholder strategy hash\./i)).toBeNull();
    expect(screen.queryByText(/The Vortex API is not reachable/i)).toBeNull();
    // 1 WBTC at the live body's numbers, formatted at USDC's 6 decimals.
    expect(screen.getByText("100,120.00 USDC")).toBeInTheDocument();
  });

  it("keeps the notice off a failure that happened after a successful quote", async () => {
    // The quote itself succeeded, so the placeholder hash is demonstrably not
    // what broke the build; only a rejected QUOTE may raise the notice.
    setWallet({
      isConnected: true,
      address: "0x3333333333333333333333333333333333333333",
      chainId: 31337,
      chainName: "Foundry",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes("/quotes/exchange")) {
          return json(liveQuoteBody());
        }
        return json(
          {
            error: {
              code: "AQUA_EXECUTION_UNAVAILABLE",
              message: "no Aqua strategy is deployed on this chain",
            },
          },
          503,
        );
      }),
    );

    const user = await quoteOnce();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /execute swap/i })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /execute swap/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /AQUA_EXECUTION_UNAVAILABLE/,
      );
    });
    expect(screen.queryByText(/Placeholder strategy hash\./i)).toBeNull();
    // The quote it failed on is still on screen, still labeled live.
    expect(screen.getByText("Live API response")).toBeInTheDocument();
  });
});
