import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ExchangeQuoteRequest } from "@vortex/shared";
import { QuoteComparison } from "@/components/swap/quote-comparison";
import { FIXTURE_STRATEGY_HASH, buildExchangeQuoteFixture } from "@/lib/api/fixtures";
import { formatTokenAmount } from "@/lib/format";

const NOW = 1_800_000_000_000;
const ONE_WBTC = 100_000_000n;

const request: ExchangeQuoteRequest = {
  chainId: 31337,
  strategyHash: FIXTURE_STRATEGY_HASH,
  tokenIn: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  tokenOut: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  amountIn: ONE_WBTC.toString(),
  taker: "0x3333333333333333333333333333333333333333",
  slippageBps: 30,
};

function quoteFor(winner: "AQUA" | "UNISWAP") {
  return buildExchangeQuoteFixture(request, { now: NOW, winner });
}

describe("quote comparison", () => {
  it("renders both venues with USDC formatted to 6 decimals", () => {
    const quote = quoteFor("AQUA");
    render(
      <QuoteComparison quote={quote} source="fixture" amountIn={ONE_WBTC} secondsRemaining={30} />,
    );

    const aquaCard = screen.getByLabelText("Aqua · SwapVM");
    const aquaOut = BigInt(quote.comparison.aqua?.amountOut ?? "0");
    // 100120000000 base units of a 6-decimal token is 100,120.00 — a USDC
    // amount formatted with 8 decimals would be off by a factor of 100.
    expect(
      within(aquaCard).getByText(`${formatTokenAmount(aquaOut, 6, 2)} USDC`),
    ).toBeInTheDocument();

    const uniswapCard = screen.getByLabelText("Uniswap API");
    const uniswapOut = BigInt(quote.comparison.uniswap?.amountOut ?? "0");
    expect(
      within(uniswapCard).getByText(`${formatTokenAmount(uniswapOut, 6, 2)} USDC`),
    ).toBeInTheDocument();
  });

  it("marks Aqua selected when Aqua nets more", () => {
    render(
      <QuoteComparison
        quote={quoteFor("AQUA")}
        source="fixture"
        amountIn={ONE_WBTC}
        secondsRemaining={30}
      />,
    );
    expect(within(screen.getByLabelText("Aqua · SwapVM")).getByText("Selected")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Uniswap API")).queryByText("Selected")).toBeNull();
  });

  it("marks Uniswap selected when Uniswap nets more", () => {
    render(
      <QuoteComparison
        quote={quoteFor("UNISWAP")}
        source="fixture"
        amountIn={ONE_WBTC}
        secondsRemaining={30}
      />,
    );
    expect(within(screen.getByLabelText("Uniswap API")).getByText("Selected")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Aqua · SwapVM")).queryByText("Selected")).toBeNull();
  });

  it("states the net improvement over the losing venue", () => {
    const quote = quoteFor("AQUA");
    const aquaNet = BigInt(quote.comparison.aqua?.netAmountOut ?? "0");
    const uniswapNet = BigInt(quote.comparison.uniswap?.netAmountOut ?? "0");
    const expected = formatTokenAmount(aquaNet - uniswapNet, 6, 2);

    render(
      <QuoteComparison quote={quote} source="fixture" amountIn={ONE_WBTC} secondsRemaining={30} />,
    );
    expect(
      screen.getByText(new RegExp(`improves output by ${expected.replace(".", "\\.")} USDC`)),
    ).toBeInTheDocument();
  });

  it("shows a countdown and flags expiry at zero", () => {
    const quote = quoteFor("AQUA");
    const { rerender } = render(
      <QuoteComparison quote={quote} source="fixture" amountIn={ONE_WBTC} secondsRemaining={30} />,
    );
    expect(screen.getByText("Quote expires in 30s")).toBeInTheDocument();

    rerender(
      <QuoteComparison quote={quote} source="fixture" amountIn={ONE_WBTC} secondsRemaining={0} />,
    );
    expect(screen.getByText("Quote expired")).toBeInTheDocument();
  });

  it("survives a venue returning no quote", () => {
    const quote = quoteFor("AQUA");
    const oneSided = { ...quote, comparison: { ...quote.comparison, uniswap: null } };
    render(
      <QuoteComparison
        quote={oneSided}
        source="fixture"
        amountIn={ONE_WBTC}
        secondsRemaining={30}
      />,
    );
    expect(screen.getByText("No quote returned for this trade.")).toBeInTheDocument();
    expect(screen.getByText(/the only venue quoting this trade/i)).toBeInTheDocument();
  });
});

describe("provenance labeling", () => {
  it("labels fixture-backed numbers as fixture data", () => {
    render(
      <QuoteComparison
        quote={quoteFor("AQUA")}
        source="fixture"
        amountIn={ONE_WBTC}
        secondsRemaining={30}
      />,
    );
    expect(screen.getByText("Fixture data")).toBeInTheDocument();
    expect(screen.queryByText("Live data")).toBeNull();
  });

  it("labels live numbers as live and never claims fixture", () => {
    render(
      <QuoteComparison
        quote={quoteFor("AQUA")}
        source="live"
        amountIn={ONE_WBTC}
        secondsRemaining={30}
      />,
    );
    expect(screen.getByText("Live data")).toBeInTheDocument();
    expect(screen.queryByText("Fixture data")).toBeNull();
  });
});
