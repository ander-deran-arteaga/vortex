import { SourceBadge } from "@/components/source-badge";
import { StatusMark } from "@/components/ui/primitives";
import { formatTokenAmount, truncateAddress } from "@/lib/format";
import type { DemoStepState, DemoStepStatus } from "@/lib/demo/demoMachine";

const STATUS_LABEL: Record<DemoStepStatus, string> = {
  not_started: "Not started",
  running: "Running",
  success: "Success",
  failure: "Failed",
  blocked: "Blocked",
  skipped: "Skipped",
};

/**
 * `blocked` and `failure` are deliberately different colours as well as
 * different words: a missing capability must never read as a bug, and a bug
 * must never read as a missing capability.
 */
const STATUS_MARK: Record<DemoStepStatus, "gain" | "loss" | "warn" | "muted" | "accent"> =
  {
    not_started: "muted",
    running: "accent",
    success: "gain",
    failure: "loss",
    blocked: "warn",
    skipped: "muted",
  };

const STATUS_INK: Record<DemoStepStatus, string> = {
  not_started: "text-say-3",
  running: "text-cu",
  success: "text-gain",
  failure: "text-loss",
  blocked: "text-warn",
  skipped: "text-say-3",
};

/** Money moved, shown as the pair it actually is plus the signed change. */
function DeltaRow({
  label,
  symbol,
  decimals,
  before,
  after,
}: {
  label: string;
  symbol: string;
  decimals: number;
  before: bigint;
  after: bigint;
}) {
  const change = after - before;
  const sign = change > 0n ? "+" : change < 0n ? "−" : "";
  const magnitude = change < 0n ? -change : change;
  const tone = change > 0n ? "text-gain" : change < 0n ? "text-loss" : "text-say-3";

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <span className="text-xs text-say-2">{label}</span>
      <span className="num text-[13px]">
        <span className="text-say-3">{formatTokenAmount(before, decimals)}</span>
        <span className="px-1.5 text-say-3">→</span>
        <span className="text-say-1">{formatTokenAmount(after, decimals)}</span>
        <span className={`ml-2.5 ${tone}`}>
          {sign}
          {formatTokenAmount(magnitude, decimals)} {symbol}
        </span>
      </span>
    </div>
  );
}

export function StepRow({
  index,
  title,
  description,
  step,
}: {
  index: number;
  title: string;
  description: string;
  step: DemoStepState;
}) {
  const hasEvidence =
    step.txHash !== undefined || step.uniswapRequestId !== undefined;

  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 py-5 first:pt-0 last:pb-0 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:gap-x-4">
      {/* The ordinal is real data, so it is the only mono thing in the header. */}
      <span aria-hidden="true" className="num pt-px text-sm text-say-3">
        {String(index + 1).padStart(2, "0")}
      </span>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <h3 className="text-[15px] text-say-1">{title}</h3>
          <span className="flex shrink-0 items-center gap-3">
            {step.source === undefined ? null : <SourceBadge source={step.source} />}
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${STATUS_INK[step.status]}`}
            >
              <StatusMark tone={STATUS_MARK[step.status]} />
              {STATUS_LABEL[step.status]}
            </span>
          </span>
        </div>

        {/* Prose is capped so a full-width panel never sets a 900px measure. */}
        <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-say-2">
          {description}
        </p>

        {step.detail === undefined ? null : (
          <p className="mt-2.5 max-w-3xl text-sm leading-relaxed text-say-1">
            {step.detail}
          </p>
        )}

        {/*
          The reason is quoted exactly as the API gave it, error code and all.
          Only the prefix is tinted, so the verbatim text stays legible.
        */}
        {step.reason === undefined ? null : (
          <p
            role={step.status === "failure" ? "alert" : undefined}
            className="panel-raised mt-3 max-w-3xl px-3.5 py-3 text-sm leading-relaxed text-say-1"
          >
            <span
              className={
                step.status === "failure"
                  ? "font-medium text-loss"
                  : "font-medium text-warn"
              }
            >
              {step.status === "failure" ? "Failure: " : "Blocked: "}
            </span>
            {step.reason}
          </p>
        )}

        {step.deltas === undefined || step.deltas.length === 0 ? null : (
          <div className="panel-raised mt-3 max-w-3xl px-3.5 py-2.5">
            <p className="text-xs text-say-3">Balance change</p>
            <div className="mt-0.5 divide-y divide-[rgba(255,238,222,0.05)]">
              {step.deltas.map((delta) => (
                <DeltaRow key={delta.label} {...delta} />
              ))}
            </div>
          </div>
        )}

        {/*
          Only shown once the step actually produced something. An empty pair of
          placeholders on eight untouched steps is noise, not evidence.
        */}
        {hasEvidence ? (
          <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
            <div className="min-w-0">
              <dt className="text-xs text-say-3">Transaction</dt>
              <dd className="mt-1 text-xs">
                {step.txHash === undefined ? (
                  <span className="text-say-3">Not captured</span>
                ) : (
                  <span className="num text-say-1" title={step.txHash}>
                    {truncateAddress(step.txHash)}
                  </span>
                )}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-say-3">Uniswap request ID</dt>
              <dd className="mt-1 text-xs">
                {step.uniswapRequestId === undefined ? (
                  <span className="text-say-3">Not captured</span>
                ) : (
                  <span
                    className="num break-all text-say-1"
                    title={step.uniswapRequestId}
                  >
                    {step.uniswapRequestId}
                  </span>
                )}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </li>
  );
}
