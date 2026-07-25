import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoveragePanel } from "@/components/maker/coverage-panel";
import { FIXTURE_STRATEGY_HASH, buildStrategyHealthFixture } from "@/lib/api/fixtures";

describe("coverage panel", () => {
  it("shows the fully covered badge for a solvent maker", () => {
    render(
      <CoveragePanel
        health={buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH)}
        source="fixture"
      />,
    );
    expect(screen.getByText("Fully covered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("warns and shows the amber badge when the maker cannot cover its quotes", () => {
    render(
      <CoveragePanel
        health={buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH, { covered: false })}
        source="fixture"
      />,
    );
    expect(screen.getByText("Partially covered")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/cannot honour quotes/i);
  });

  it("marks an inactive strategy offline", () => {
    const health = buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH);
    render(<CoveragePanel health={{ ...health, active: false }} source="fixture" />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("renders each token with its own decimals", () => {
    render(
      <CoveragePanel
        health={buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH)}
        source="fixture"
      />,
    );
    // WBTC virtual balance 1e8 at 8 decimals.
    expect(screen.getAllByText("1.00000000").length).toBeGreaterThan(0);
    // USDC virtual balance 1e11 at 6 decimals — 100,000.000000, not 1,000.
    expect(screen.getAllByText("100,000.000000").length).toBeGreaterThan(0);
  });

  it("explains that virtual balances are not collateral", () => {
    render(
      <CoveragePanel
        health={buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH)}
        source="fixture"
      />,
    );
    expect(screen.getByText(/not collateral/i)).toBeInTheDocument();
  });

  it("labels provenance both ways", () => {
    const health = buildStrategyHealthFixture(FIXTURE_STRATEGY_HASH);
    const { rerender } = render(<CoveragePanel health={health} source="fixture" />);
    expect(screen.getByText("Fixture data")).toBeInTheDocument();
    expect(screen.queryByText("Live data")).toBeNull();

    rerender(<CoveragePanel health={health} source="live" />);
    expect(screen.getByText("Live data")).toBeInTheDocument();
    expect(screen.queryByText("Fixture data")).toBeNull();
  });
});
