"use client";

import { Action, StatusMark } from "@/components/ui/primitives";

const SLIPPAGE_OPTIONS = [10, 30, 50] as const;

export function SwapForm({
  amountInput,
  onAmountChange,
  slippageBps,
  onSlippageChange,
  onSubmit,
  disabled,
  busy,
  error,
}: {
  amountInput: string;
  onAmountChange: (value: string) => void;
  slippageBps: number;
  onSlippageChange: (value: number) => void;
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
  error: string | null;
}) {
  return (
    <form
      className="panel p-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <h2 className="text-[15px] text-say-1">Trade</h2>

      {/*
        The amount is the instrument: the largest thing in this column, set in
        the data face, with the token sitting on its baseline rather than in a
        chip beside it.
      */}
      <div className="mt-5">
        <label htmlFor="swap-amount" className="block text-sm text-say-2">
          Sell
        </label>
        <div className="mt-2 flex items-baseline gap-3 rounded-[4px] bg-ink-0 px-4 py-4 focus-within:shadow-[inset_0_0_0_1px_var(--color-cu)]">
          <input
            id="swap-amount"
            name="swap-amount"
            type="text"
            size={1}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00000000"
            value={amountInput}
            onChange={(event) => onAmountChange(event.target.value)}
            aria-describedby="swap-amount-hint"
            aria-invalid={error !== null}
            className="num min-w-0 flex-1 bg-transparent text-[26px] leading-none text-say-1 outline-none placeholder:text-say-3"
          />
          <span className="shrink-0 text-sm font-medium text-say-2">WBTC</span>
        </div>
        <p id="swap-amount-hint" className="mt-2 text-xs leading-relaxed text-say-2">
          Exact input only: you specify what you sell, and each venue quotes
          what you receive.
        </p>
      </div>

      <div className="mt-5">
        <span className="block text-sm text-say-2">Buy</span>
        <div className="mt-2 flex items-baseline justify-between gap-3 rounded-[4px] bg-ink-0 px-4 py-3">
          <span className="min-w-0 truncate text-sm text-say-2">Quoted per venue</span>
          <span className="shrink-0 text-sm font-medium text-say-2">USDC</span>
        </div>
      </div>

      <fieldset className="mt-5">
        <legend className="text-sm text-say-2">Max slippage</legend>
        <div className="mt-2 inline-flex gap-1 rounded-[4px] bg-ink-0 p-1">
          {SLIPPAGE_OPTIONS.map((option) => {
            const active = slippageBps === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => onSlippageChange(option)}
                aria-pressed={active}
                className={`rounded-[3px] px-3 py-1.5 text-sm tabular-nums transition-colors duration-150 ${
                  active
                    ? "bg-ink-3 font-medium text-cu"
                    : "text-say-2 hover:text-say-1"
                }`}
              >
                {(option / 100).toFixed(2)}%
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* The mark carries the tone so the message keeps full-ink legibility. */}
      {error === null ? null : (
        <div role="alert" className="mt-4 flex gap-3">
          <StatusMark tone="loss" className="mt-[7px] shrink-0" />
          <p className="min-w-0 text-sm leading-relaxed text-say-1">{error}</p>
        </div>
      )}

      <div className="mt-6">
        <Action type="submit" disabled={disabled} busy={busy}>
          {busy ? "Comparing venues…" : "Get best execution"}
        </Action>
      </div>
    </form>
  );
}
