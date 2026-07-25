import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StrategyForm, type StrategyField } from "@/components/maker/strategy-form";

function fieldsFor(value: string, onChange: (v: string) => void): StrategyField[] {
  return [
    { key: "wbtc", label: "WBTC allocated", kind: "amount", decimals: 8, value, onChange },
    { key: "fee", label: "Commercial fee", kind: "bps", value: "30", onChange },
  ];
}

describe("strategy form", () => {
  it("does not submit on Enter — an approval needs an explicit click", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <StrategyForm
        title="Vortex Swap — WBTC/USDC"
        description="test"
        fields={fieldsFor("1.0", vi.fn())}
        steps={[{ label: "Approve WBTC", status: "pending" }]}
        onSubmit={onSubmit}
        disabled={false}
        busy={false}
        submitLabel="Approve WBTC"
      />,
    );

    // Submitting this form sends an onchain transaction; a stray Enter in a
    // numeric field must never open a wallet prompt.
    await user.type(screen.getByLabelText(/WBTC allocated/), "{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /approve wbtc/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("blocks submission while a field is invalid", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <StrategyForm
        title="Vortex Grow — WBTC"
        description="test"
        fields={fieldsFor("0.000000001", vi.fn())}
        steps={[{ label: "Approve WBTC", status: "pending" }]}
        onSubmit={onSubmit}
        disabled={false}
        busy={false}
        submitLabel="Approve WBTC"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/at most 8 decimals/i);
    const button = screen.getByRole("button", { name: /approve wbtc/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the blocked reason on steps that need undeployed contracts", () => {
    render(
      <StrategyForm
        title="Vortex Swap — WBTC/USDC"
        description="test"
        fields={fieldsFor("1.0", vi.fn())}
        steps={[
          { label: "Approve WBTC", status: "pending" },
          {
            label: "Ship strategy",
            status: "blocked",
            note: "Requires the Aqua strategy contracts — Phase 2/6",
          },
        ]}
        onSubmit={vi.fn()}
        disabled={false}
        busy={false}
        submitLabel="Approve WBTC"
      />,
    );
    const shipStep = screen.getByText("Ship strategy").closest("li");
    expect(shipStep).not.toBeNull();
    expect(
      within(shipStep as HTMLElement).getByText(/Requires the Aqua strategy contracts/),
    ).toBeInTheDocument();
    // Status is conveyed to assistive tech, not by colour alone.
    expect(within(shipStep as HTMLElement).getByText(/— blocked/)).toBeInTheDocument();
  });
});
