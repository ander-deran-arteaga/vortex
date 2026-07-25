import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SwapForm } from "@/components/swap/swap-form";

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
      {...overrides}
    />,
  );
  return { onSubmit, onAmountChange, onSlippageChange };
}

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
