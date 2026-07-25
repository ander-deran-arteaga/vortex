"use client";

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
      className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="space-y-2">
        <label htmlFor="swap-amount" className="block text-sm text-zinc-400">
          Sell
        </label>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
          <input
            id="swap-amount"
            name="swap-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00000000"
            value={amountInput}
            onChange={(event) => onAmountChange(event.target.value)}
            aria-describedby="swap-amount-hint"
            aria-invalid={error !== null}
            className="w-full bg-transparent font-mono text-lg tabular-nums text-zinc-100 outline-none placeholder:text-zinc-700"
          />
          <span className="shrink-0 text-sm font-medium text-zinc-300">WBTC</span>
        </div>
        <p id="swap-amount-hint" className="text-xs text-zinc-500">
          Exact input only — you specify what you sell, and each venue quotes
          what you receive.
        </p>
      </div>

      <div className="space-y-2">
        <span className="block text-sm text-zinc-400">Buy</span>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-zinc-800 px-4 py-3">
          <span className="font-mono text-lg tabular-nums text-zinc-600">
            Quoted per venue
          </span>
          <span className="shrink-0 text-sm font-medium text-zinc-300">USDC</span>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm text-zinc-400">Max slippage</legend>
        <div className="flex gap-2">
          {SLIPPAGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onSlippageChange(option)}
              aria-pressed={slippageBps === option}
              className={
                slippageBps === option
                  ? "rounded-lg border border-teal-500/40 bg-teal-500/10 px-3 py-1.5 text-sm font-medium text-teal-400"
                  : "rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-zinc-400 hover:border-zinc-700"
              }
            >
              {(option / 100).toFixed(2)}%
            </button>
          ))}
        </div>
      </fieldset>

      {error === null ? null : (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled}
        aria-busy={busy}
        className="w-full rounded-lg bg-teal-500 px-4 py-3 text-sm font-medium text-zinc-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Comparing venues…" : "Get best execution"}
      </button>
    </form>
  );
}
