"use client";

import { basisPointsToPercent, parseTokenAmount } from "@/lib/format";

export type StrategyFieldKind = "amount" | "bps" | "duration";

export interface StrategyField {
  key: string;
  label: string;
  kind: StrategyFieldKind;
  value: string;
  onChange: (value: string) => void;
  decimals?: number;
  hint?: string;
}

export type StepStatus = "pending" | "active" | "done" | "error" | "blocked";

export interface StrategyStep {
  label: string;
  status: StepStatus;
  note?: string;
}

function validate(field: StrategyField): string | null {
  if (field.value.trim() === "") {
    return null;
  }
  if (field.kind === "amount") {
    try {
      parseTokenAmount(field.value, field.decimals ?? 8);
      return null;
    } catch {
      return `Enter a valid amount with at most ${field.decimals ?? 8} decimals.`;
    }
  }
  if (field.kind === "bps") {
    if (!/^\d+$/.test(field.value.trim())) {
      return "Enter a whole number of basis points.";
    }
    const bps = Number(field.value);
    return bps > 10_000 ? "Basis points cannot exceed 10000 (100%)." : null;
  }
  return /^\d+$/.test(field.value.trim()) ? null : "Enter a whole number of seconds.";
}

const STEP_TONE: Record<StepStatus, string> = {
  pending: "border-zinc-700 text-zinc-500",
  active: "border-teal-500/50 bg-teal-500/10 text-teal-300",
  done: "border-teal-500/50 bg-teal-500/20 text-teal-200",
  error: "border-red-500/50 bg-red-500/10 text-red-300",
  blocked: "border-amber-500/40 bg-amber-500/10 text-amber-300",
};

export function StrategyForm({
  title,
  description,
  fields,
  steps,
  onSubmit,
  disabled,
  busy,
  submitLabel,
  footer,
}: {
  title: string;
  description: string;
  fields: StrategyField[];
  steps: StrategyStep[];
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
  submitLabel: string;
  footer?: React.ReactNode;
}) {
  const errors = fields.map((field) => validate(field));
  const hasError = errors.some((error) => error !== null);

  return (
    <form
      className="space-y-5 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!hasError) {
          onSubmit();
        }
      }}
    >
      <header>
        <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
        <p className="mt-1 text-sm leading-relaxed text-zinc-400">{description}</p>
      </header>

      <div className="space-y-3">
        {fields.map((field, index) => {
          const error = errors[index] ?? null;
          const inputId = `field-${field.key}`;
          const bpsPreview =
            field.kind === "bps" && error === null && /^\d+$/.test(field.value.trim())
              ? basisPointsToPercent(Number(field.value))
              : null;
          return (
            <div key={field.key} className="space-y-1">
              <label htmlFor={inputId} className="block text-sm text-zinc-400">
                {field.label}
                {field.kind === "bps" ? (
                  <span className="ml-1 text-xs text-zinc-600">(bps)</span>
                ) : null}
                {field.kind === "duration" ? (
                  <span className="ml-1 text-xs text-zinc-600">(seconds)</span>
                ) : null}
              </label>
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
                <input
                  id={inputId}
                  name={inputId}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={field.value}
                  onChange={(event) => field.onChange(event.target.value)}
                  onKeyDown={(event) => {
                    // Submitting this form sends an onchain approval. A stray
                    // Enter in any of ten fields must not open a wallet
                    // signature prompt — require an explicit click.
                    if (event.key === "Enter") {
                      event.preventDefault();
                    }
                  }}
                  aria-invalid={error !== null}
                  aria-describedby={error === null ? undefined : `${inputId}-error`}
                  className="w-full bg-transparent font-mono text-sm tabular-nums text-zinc-100 outline-none placeholder:text-zinc-700"
                />
                {bpsPreview === null ? null : (
                  <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-500">
                    {bpsPreview}
                  </span>
                )}
              </div>
              {error === null ? (
                field.hint === undefined ? null : (
                  <p className="text-xs text-zinc-600">{field.hint}</p>
                )
              ) : (
                <p id={`${inputId}-error`} role="alert" className="text-xs text-red-400">
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
          Steps
        </h3>
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${STEP_TONE[step.status]}`}
              >
                {index + 1}
              </span>
              <span className="text-sm">
                <span className="text-zinc-200">{step.label}</span>
                <span className="sr-only"> — {step.status}</span>
                {step.note === undefined ? null : (
                  <span className="block text-xs text-zinc-500">{step.note}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {footer}

      <button
        type="submit"
        disabled={disabled || hasError}
        aria-busy={busy}
        className="w-full rounded-lg bg-teal-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitLabel}
      </button>
    </form>
  );
}
