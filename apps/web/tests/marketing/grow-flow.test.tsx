import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrowFlowSection } from "@/components/marketing/grow-flow/grow-flow-section";
import {
  currentStep,
  flowReducer,
  initialFlowState,
  lastIndex,
  stepsFor,
} from "@/components/marketing/grow-flow/grow-flow-machine";
import { AMOUNTS, PERFORMANCE_FEE_BPS } from "@/components/marketing/grow-flow/scenario-data";

/** The section reads the media query; default to "no preference". */
function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
  // The section autoplays on intersection; a no-op observer keeps it still.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "";
      thresholds = [];
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ─────────────────────────────── the reducer ─────────────────────────────── */

describe("grow flow machine", () => {
  it("steps success to a terminal 1.00240000 WBTC", () => {
    let state = initialFlowState;
    const end = lastIndex("success");
    expect(stepsFor("success")).toHaveLength(11);
    for (let i = 0; i < end; i += 1) {
      state = flowReducer(state, { type: "ADVANCE" });
    }
    expect(state.stepIndex).toBe(end);
    expect(currentStep(state).makerWbtc).toBe(AMOUNTS.makerFinalOk);
    expect(currentStep(state).status).toBe("verified");
  });

  it("steps the unprofitable cycle back to exactly the principal", () => {
    let state = flowReducer(initialFlowState, {
      type: "SELECT_SCENARIO",
      scenario: "unprofitable",
    });
    const end = lastIndex("unprofitable");
    for (let i = 0; i < end; i += 1) {
      state = flowReducer(state, { type: "ADVANCE" });
    }
    const final = currentStep(state);
    expect(final.makerWbtc).toBe(AMOUNTS.principal);
    expect(final.status).toBe("failed");
    // No fee is taken on a reverted cycle, so no step may show one.
    expect(stepsFor("unprofitable").some((s) => s.active === "fee")).toBe(false);
  });

  it("stops at the end rather than looping", () => {
    let state = { ...initialFlowState, stepIndex: lastIndex("success"), playing: true };
    state = flowReducer(state, { type: "ADVANCE" });
    expect(state.stepIndex).toBe(lastIndex("success"));
    expect(state.playing).toBe(false);
    expect(state.completed).toBe(true);
  });

  it("resets to step one when the scenario changes", () => {
    let state = flowReducer(initialFlowState, { type: "ADVANCE" });
    state = flowReducer(state, { type: "ADVANCE" });
    expect(state.stepIndex).toBe(2);
    state = flowReducer(state, { type: "SELECT_SCENARIO", scenario: "unprofitable" });
    expect(state.stepIndex).toBe(0);
    expect(state.scenario).toBe("unprofitable");
  });

  it("replays from the start once completed", () => {
    const done = { ...initialFlowState, stepIndex: lastIndex("success"), completed: true };
    const replayed = flowReducer(done, { type: "PLAY" });
    expect(replayed.stepIndex).toBe(0);
    expect(replayed.playing).toBe(true);
  });
});

/* ───────────────────────── the arithmetic invariants ─────────────────────── */

describe("grow flow arithmetic", () => {
  const b = (v: string) => BigInt(v);

  it("unused plus returned equals gross", () => {
    expect(b(AMOUNTS.unused) + b(AMOUNTS.returnedOk)).toBe(b(AMOUNTS.grossOk));
    expect(b(AMOUNTS.unused) + b(AMOUNTS.returnedBad)).toBe(b(AMOUNTS.grossBad));
  });

  it("sold plus unused equals the principal", () => {
    expect(b(AMOUNTS.sold) + b(AMOUNTS.unused)).toBe(b(AMOUNTS.principal));
  });

  it("the fee is exactly 20% of realised profit, and never touches principal", () => {
    const grossProfit = b(AMOUNTS.grossOk) - b(AMOUNTS.principal);
    expect(grossProfit).toBe(300_000n); // 0.00300000
    expect(b(AMOUNTS.fee)).toBe((grossProfit * BigInt(PERFORMANCE_FEE_BPS)) / 10_000n);
    // The fee is smaller than the profit, so it cannot reach the principal.
    expect(b(AMOUNTS.fee) < grossProfit).toBe(true);
  });

  it("the maker's final balance is gross minus fee", () => {
    expect(b(AMOUNTS.grossOk) - b(AMOUNTS.fee)).toBe(b(AMOUNTS.makerFinalOk));
    expect(b(AMOUNTS.makerFinalOk) > b(AMOUNTS.principal)).toBe(true);
  });

  it("the unprofitable cycle genuinely misses the floor", () => {
    expect(b(AMOUNTS.grossBad) < b(AMOUNTS.principal) + b(AMOUNTS.minProfit)).toBe(true);
  });
});

/* ─────────────────────────────── the render ──────────────────────────────── */

describe("grow flow section", () => {
  it("labels the second leg as an external venue, never Uniswap", () => {
    mockReducedMotion(false);
    render(<GrowFlowSection />);
    const node = screen.getByText("External venue").closest("div");
    expect(node).not.toBeNull();
    const venue = node as HTMLElement;
    expect(within(venue).getByText(/deterministic simulated venue/i)).toBeInTheDocument();
    // The spec forbids a Uniswap LOGO on this simulated node; it explicitly
    // requires the words "a Uniswap API-built call" in the sub-label, so the
    // check is for branding, not for the string.
    expect(venue.querySelector("img")).toBeNull();
    expect(venue.querySelector("svg")).toBeNull();
    expect(within(venue).getByText(/Uniswap API-built call/i)).toBeInTheDocument();
  });

  it("states that the values are illustrative, without interaction", () => {
    mockReducedMotion(false);
    render(<GrowFlowSection />);
    expect(screen.getByText(/Illustrative values, not a live quote/i)).toBeInTheDocument();
  });

  it("separates the offchain proposer from the onchain enforcer", () => {
    mockReducedMotion(false);
    render(<GrowFlowSection />);
    expect(screen.getByText("Backend")).toBeInTheDocument();
    expect(screen.getByText(/Proposes only/i)).toBeInTheDocument();
    expect(screen.getByText("Contracts")).toBeInTheDocument();
    expect(screen.getByText(/onchain from here/i)).toBeInTheDocument();
  });

  it("shows the fee coming out of the profit, not the principal", () => {
    mockReducedMotion(false);
    render(<GrowFlowSection />);
    expect(screen.getByText(/fee is cut from the profit/i)).toBeInTheDocument();
  });

  it("exposes the captions as an ordered narrative with a single live region", () => {
    mockReducedMotion(false);
    const { container } = render(<GrowFlowSection />);
    // Each caption appears in the narrative list, and the active one also in
    // the live region, so more than one match is correct.
    for (const step of stepsFor("success")) {
      expect(screen.getAllByText(step.caption).length).toBeGreaterThan(0);
    }
    expect(container.querySelectorAll("[aria-live='polite']")).toHaveLength(1);
  });

  it("renders the whole explanation with zero motion when reduced motion is set", () => {
    mockReducedMotion(true);
    render(<GrowFlowSection />);
    // Every caption is present, and the play control is gone entirely.
    for (const step of stepsFor("success")) {
      expect(screen.getAllByText(step.caption).length).toBeGreaterThan(0);
    }
    expect(screen.queryByRole("button", { name: /play the grow flow/i })).toBeNull();
    // The diagram sits at its final frame, so the settled balance is visible.
    expect(screen.getAllByText("1.00240000").length).toBeGreaterThan(0);
  });

  it("switches scenarios through a real tablist", async () => {
    mockReducedMotion(false);
    const user = userEvent.setup();
    render(<GrowFlowSection />);
    const tabs = screen.getByRole("tablist", { name: /grow scenarios/i });
    const unprofitable = within(tabs).getByRole("tab", { name: /unprofitable cycle/i });
    expect(unprofitable).toHaveAttribute("aria-selected", "false");

    await user.click(unprofitable);
    expect(unprofitable).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByText(/Atomic revert. Maker principal unchanged/i),
    ).toBeInTheDocument();
  });

  it("lets a reader jump to any step without waiting for the animation", async () => {
    mockReducedMotion(false);
    const user = userEvent.setup();
    render(<GrowFlowSection />);
    const gross = screen.getByRole("button", { name: /Gross: 1.00300000 WBTC/ });
    await user.click(gross);
    expect(gross).toHaveAttribute("aria-current", "step");
  });
});
