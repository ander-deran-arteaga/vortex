import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GrowOpportunity } from "@vortex/shared";
import { OpportunityCard } from "@/components/grow/opportunity-card";
import { ProfitBreakdown } from "@/components/grow/profit-breakdown";
import { FIXTURE_GROW_STRATEGY_HASH, buildGrowScanFixture } from "@/lib/api/fixtures";
import { formatTokenAmount } from "@/lib/format";
import { computeGrowBreakdown } from "@/lib/grow-breakdown";

const NOW = 1_800_000_000_000;

function opportunityFor(principal: string): GrowOpportunity {
  const scan = buildGrowScanFixture(
    {
      chainId: 31337,
      strategyHash: FIXTURE_GROW_STRATEGY_HASH,
      principalAmount: principal,
      direction: "AUTO",
    },
    { now: NOW },
  );
  if (!scan.opportunityFound) {
    throw new Error("expected an opportunity fixture");
  }
  return scan;
}

describe("opportunity card", () => {
  it("renders WBTC amounts at 8 decimals and the bridge amount at 6", () => {
    const opportunity = opportunityFor("100000000");
    render(
      <OpportunityCard opportunity={opportunity} source="fixture" secondsRemaining={30} />,
    );

    expect(screen.getByText("1.00000000 WBTC")).toBeInTheDocument();
    expect(
      screen.getByText(
        `${formatTokenAmount(BigInt(opportunity.minFinalAsset), 8)} WBTC`,
      ),
    ).toBeInTheDocument();
    // The bridge leg is USDC: 1e11 base units is 100,000.00, not 1,000.00000000.
    expect(screen.getByText("100,000.00 USDC")).toBeInTheDocument();
  });

  it("names the cycle direction in Vortex terms", () => {
    render(
      <OpportunityCard
        opportunity={opportunityFor("100000000")}
        source="fixture"
        secondsRemaining={30}
      />,
    );
    expect(screen.getByText("Vortex PermAMM → external venue")).toBeInTheDocument();
  });

  it("requires the minimum final amount to exceed the principal", () => {
    const opportunity = opportunityFor("100000000");
    expect(BigInt(opportunity.minFinalAsset)).toBeGreaterThan(
      BigInt(opportunity.principalAmount),
    );
  });

  it("shows expiry state at zero", () => {
    render(
      <OpportunityCard
        opportunity={opportunityFor("100000000")}
        source="fixture"
        secondsRemaining={0}
      />,
    );
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("labels provenance both ways", () => {
    const opportunity = opportunityFor("100000000");
    const { rerender } = render(
      <OpportunityCard opportunity={opportunity} source="fixture" secondsRemaining={30} />,
    );
    expect(screen.getByText("Fixture data")).toBeInTheDocument();
    expect(screen.queryByText("Live data")).toBeNull();

    rerender(
      <OpportunityCard opportunity={opportunity} source="live" secondsRemaining={30} />,
    );
    expect(screen.getByText("Live data")).toBeInTheDocument();
    expect(screen.queryByText("Fixture data")).toBeNull();
  });
});

describe("profit breakdown", () => {
  it("renders the waterfall and the fee share of profit", () => {
    render(
      <ProfitBreakdown
        principal={100_000_000n}
        grossProfit={300_000n}
        performanceFee={60_000n}
      />,
    );
    expect(screen.getByText("1.00000000 WBTC")).toBeInTheDocument();
    expect(screen.getByText("+ 0.00300000 WBTC")).toBeInTheDocument();
    expect(screen.getByText("− 0.00060000 WBTC")).toBeInTheDocument();
    expect(screen.getByText("1.00240000 WBTC")).toBeInTheDocument();
    expect(screen.getByText(/20\.00% of profit/)).toBeInTheDocument();
  });

  it("says the fee comes only from realized profit", () => {
    render(
      <ProfitBreakdown principal={100_000_000n} grossProfit={300_000n} performanceFee={60_000n} />,
    );
    expect(screen.getByText(/only to realized profit/i)).toBeInTheDocument();
  });
});

describe("computeGrowBreakdown", () => {
  it("is exact across principals including dust", () => {
    const cases = [
      { principal: 100_000_000n, grossProfit: 300_000n, performanceFee: 60_000n },
      { principal: 1n, grossProfit: 0n, performanceFee: 0n },
      { principal: 12_345_678n, grossProfit: 37n, performanceFee: 7n },
      { principal: 500_000_000_000n, grossProfit: 1_500_000n, performanceFee: 300_000n },
    ];
    for (const input of cases) {
      const result = computeGrowBreakdown(input);
      expect(result.makerProfit).toBe(input.grossProfit - input.performanceFee);
      expect(result.makerReturn).toBe(input.principal + result.makerProfit);
      // The maker can never come out behind on a cycle that executed.
      expect(result.makerReturn).toBeGreaterThanOrEqual(input.principal);
    }
  });

  it("clamps a fee that would exceed realized profit", () => {
    const result = computeGrowBreakdown({
      principal: 100_000_000n,
      grossProfit: 1_000n,
      performanceFee: 5_000n,
    });
    expect(result.performanceFee).toBe(1_000n);
    expect(result.makerProfit).toBe(0n);
    expect(result.makerReturn).toBe(100_000_000n);
  });

  it("reports a zero fee share when there is no profit", () => {
    expect(
      computeGrowBreakdown({ principal: 1n, grossProfit: 0n, performanceFee: 0n }).feeShareBps,
    ).toBe(0);
  });
});
