"use client";

import { Action } from "@/components/ui/primitives";
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

/**
 * A sequence, not a checklist. Each state reads through type weight and tone,
 * and the machine-readable status stays in the screen-reader string so the
 * meaning never rests on colour alone.
 */
const STEP_WORD: Record<StepStatus, string> = {
  pending: "Waiting",
  active: "Running",
  done: "Done",
  error: "Failed",
  blocked: "Blocked",
};

/* Read aloud to screen-reader users, so it says words rather than an enum. */
const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: "not started",
  active: "in progress",
  done: "done",
  error: "failed",
  blocked: "blocked",
};

const STEP_STATUS_TONE: Record<StepStatus, string> = {
  pending: "text-say-3",
  active: "text-cu",
  done: "text-gain",
  error: "text-loss",
  blocked: "text-warn",
};

const STEP_LABEL_TONE: Record<StepStatus, string> = {
  pending: "text-say-3",
  active: "font-medium text-say-1",
  done: "text-say-2",
  error: "text-say-1",
  blocked: "text-say-2",
};

const STEP_INDEX_TONE: Record<StepStatus, string> = {
  pending: "text-say-3",
  active: "text-cu",
  done: "text-say-2",
  error: "text-loss",
  blocked: "text-say-3",
};

function unitFor(kind: StrategyFieldKind): string | null {
  if (kind === "bps") {
    return "bps";
  }
  return kind === "duration" ? "seconds" : null;
}

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
  const completed = steps.filter((step) => step.status === "done").length;

  return (
    /*
      Four sections, four rows. On two columns the rows are subgridded from the
      page grid, so both strategies share one set of baselines: headers, field
      stacks, sequences and submit actions line up however many fields each one
      carries.
    */
    <form
      className="panel grid gap-6 p-6 lg:row-span-4 lg:grid-rows-subgrid"
      onSubmit={(event) => {
        event.preventDefault();
        if (!hasError) {
          onSubmit();
        }
      }}
    >
      <header>
        <h2 className="text-xl leading-snug text-say-1">{title}</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-say-2">
          {description}
        </p>
      </header>

      <div className="space-y-4">
        {fields.map((field, index) => {
          const error = errors[index] ?? null;
          const inputId = `field-${field.key}`;
          const unit = unitFor(field.kind);
          const bpsPreview =
            field.kind === "bps" && error === null && /^\d+$/.test(field.value.trim())
              ? basisPointsToPercent(Number(field.value))
              : null;
          return (
            <div key={field.key}>
              <label
                htmlFor={inputId}
                className="flex items-baseline justify-between gap-3 text-sm text-say-2"
              >
                <span>{field.label}</span>
                {unit === null ? null : (
                  <span className="shrink-0 text-xs text-say-3">{unit}</span>
                )}
              </label>
              {/*
                The field is a raised tonal step with its own lip, not a box
                drawn with a contrasting hairline. Focus and invalidity are
                carried by that same edge rather than by an added outline.
              */}
              <div
                className={`panel-raised mt-1.5 flex items-center gap-3 px-3.5 py-2.5 transition-shadow duration-150 ${
                  error === null
                    ? "focus-within:shadow-[inset_0_0_0_2px_var(--color-cu)]"
                    : "shadow-[inset_0_0_0_1px_var(--color-loss)]"
                }`}
              >
                <input
                  id={inputId}
                  name={inputId}
                  type="text"
                  size={1}
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
                  className="num w-full min-w-0 bg-transparent text-[15px] text-say-1 outline-none placeholder:text-say-3"
                />
                {bpsPreview === null ? null : (
                  <span className="num shrink-0 text-xs text-say-3">{bpsPreview}</span>
                )}
              </div>
              {error === null ? (
                field.hint === undefined ? null : (
                  <p className="mt-1.5 text-xs leading-relaxed text-say-3">{field.hint}</p>
                )
              ) : (
                <p
                  id={`${inputId}-error`}
                  role="alert"
                  className="mt-1.5 text-xs leading-relaxed text-loss"
                >
                  {error}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-[15px] text-say-1">Steps</h3>
          <p className="text-xs text-say-3">
            <span className="num">{completed}</span> of{" "}
            <span className="num">{steps.length}</span> done
          </p>
        </div>
        <ol className="panel-raised mt-3 divide-y divide-[rgba(255,238,222,0.05)]">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-baseline gap-3 px-4 py-3">
              <span
                aria-hidden="true"
                className={`num w-4 shrink-0 text-right text-xs ${STEP_INDEX_TONE[step.status]}`}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`text-sm ${STEP_LABEL_TONE[step.status]}`}>
                  {step.label}
                </span>
                <span className="sr-only">, {STEP_STATUS_LABEL[step.status]}</span>
                {step.note === undefined ? null : (
                  <span className="mt-1 block text-xs leading-relaxed text-say-3">
                    {step.note}
                  </span>
                )}
              </span>
              <span
                aria-hidden="true"
                className={`shrink-0 text-xs ${STEP_STATUS_TONE[step.status]}`}
              >
                {STEP_WORD[step.status]}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="self-end">
        {footer === undefined ? null : <div className="mb-4">{footer}</div>}
        <Action
          type="submit"
          disabled={disabled || hasError}
          busy={busy}
          className="w-full"
        >
          {submitLabel}
        </Action>
      </div>
    </form>
  );
}
