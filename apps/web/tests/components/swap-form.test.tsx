import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SwapForm } from "@/components/swap/swap-form";
import {
  FIXTURE_STRATEGY_HASH,
  buildExchangeQuoteFixture,
} from "@/lib/api/fixtures";

function quoteFixture(winner: "AQUA" | "UNISWAP" = "AQUA") {
  return buildExchangeQuoteFixture(
    {
      chainId: 31337,
      strategyHash: FIXTURE_STRATEGY_HASH,
      tokenIn: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
      tokenOut: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      amountIn: "100000000",
      taker: "0x3333333333333333333333333333333333333333",
      slippageBps: 30,
    },
    { now: 1_800_000_000_000, winner },
  );
}

function setup(overrides: Partial<Parameters<typeof SwapForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onAmountChange = vi.fn();
  const onSlippageChange = vi.fn();
  render(
    <SwapForm
      amountInput=""
      onAmountChange={onAmountChange}
      slippageBps={30}
      onSlippageChange={onSlippageChange}
      onSubmit={onSubmit}
      disabled={false}
      busy={false}
      error={null}
      quote={null}
      {...overrides}
    />,
  );
  return { onSubmit, onAmountChange, onSlippageChange };
}

describe("the Buy field", () => {
  it("shows a numeric placeholder before a quote exists, not prose", () => {
    setup();
    expect(screen.getByText("0.00")).toBeInTheDocument();
    // The old literal string was not an estimate and told the reader nothing.
    expect(screen.queryByText(/quoted per venue/i)).toBeNull();
  });

  it("shows the estimated receive amount and names the winning venue", () => {
    setup({ quote: quoteFixture("AQUA") });
    expect(screen.getByText("100,120.00")).toBeInTheDocument();
    expect(screen.getByText("Aqua")).toBeInTheDocument();
    expect(screen.getByText(/at least/i)).toBeInTheDocument();
  });

  it("names Uniswap when Uniswap wins", () => {
    setup({ quote: quoteFixture("UNISWAP") });
    expect(screen.getByText("Uniswap API")).toBeInTheDocument();
  });

  it("marks an expired estimate instead of presenting it as current", () => {
    setup({ quote: quoteFixture("AQUA"), quoteStale: true });
    expect(screen.getByText(/expired estimate/i)).toBeInTheDocument();
  });

  it("stays exact-input: no token switch and no output field", () => {
    setup({ quote: quoteFixture("AQUA") });
    expect(screen.getByText(/exact input only/i)).toBeInTheDocument();
    // Only the Sell amount is editable.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });
});

describe("the Max action", () => {
  it("is absent when no balance is known", () => {
    setup();
    expect(screen.queryByRole("button", { name: /balance/i })).toBeNull();
  });

  it("fills the field with the whole balance", async () => {
    const user = userEvent.setup();
    const { onAmountChange } = setup({ walletBalance: 212_000_000n });
    await user.click(screen.getByRole("button", { name: /balance/i }));
    expect(onAmountChange).toHaveBeenCalledWith("2.12000000");
  });
});

describe("swap form", () => {
  it("states that the trade is exact input", () => {
    setup();
    expect(screen.getByText(/exact input only/i)).toBeInTheDocument();
  });

  it("labels the sell input and reports typing", async () => {
    const user = userEvent.setup();
    const { onAmountChange } = setup();
    await user.type(screen.getByLabelText("Sell"), "1");
    expect(onAmountChange).toHaveBeenCalledWith("1");
  });

  it("submits through the form", async () => {
    const user = userEvent.setup();
    const { onSubmit } = setup({ amountInput: "1.5" });
    await user.click(screen.getByRole("button", { name: /get best execution/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("disables submission while a quote is in flight", () => {
    setup({ disabled: true, busy: true });
    const button = screen.getByRole("button", { name: /comparing venues/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("surfaces a validation error against the input", () => {
    setup({ error: "Enter a valid WBTC amount with at most 8 decimals." });
    expect(screen.getByRole("alert")).toHaveTextContent(/at most 8 decimals/);
    expect(screen.getByLabelText("Sell")).toHaveAttribute("aria-invalid", "true");
  });

  it("marks the active slippage option", async () => {
    const user = userEvent.setup();
    const { onSlippageChange } = setup({ slippageBps: 30 });
    expect(screen.getByRole("button", { name: "0.30%" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "0.50%" }));
    expect(onSlippageChange).toHaveBeenCalledWith(50);
  });
});
