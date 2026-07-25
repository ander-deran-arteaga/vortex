import { SourceBadge } from "@/components/source-badge";
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

const STATUS_TONE: Record<DemoStepStatus, string> = {
  not_started: "border-zinc-700 bg-zinc-800/40 text-zinc-500",
  running: "border-teal-500/50 bg-teal-500/10 text-teal-300",
  success: "border-teal-500/50 bg-teal-500/20 text-teal-200",
  failure: "border-red-500/50 bg-red-500/10 text-red-300",
  blocked: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  skipped: "border-zinc-700 bg-zinc-800/40 text-zinc-500",
};

const DOT_TONE: Record<DemoStepStatus, string> = {
  not_started: "bg-zinc-700",
  running: "bg-teal-400 animate-pulse",
  success: "bg-teal-400",
  failure: "bg-red-400",
  blocked: "bg-amber-400",
  skipped: "bg-zinc-700",
};

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
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="font-mono text-xs tabular-nums text-zinc-300">
        {formatTokenAmount(before, decimals)} → {formatTokenAmount(after, decimals)}{" "}
        <span
          className={
            change > 0n
              ? "text-teal-400"
              : change < 0n
                ? "text-red-400"
                : "text-zinc-500"
          }
        >
          ({sign}
          {formatTokenAmount(magnitude, decimals)} {symbol})
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
  return (
    <li className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT_TONE[step.status]}`}
        />
        <span aria-hidden="true" className="mt-1 w-px flex-1 bg-zinc-800" />
      </div>

      <div className="flex-1 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-zinc-100">
            <span className="mr-2 font-mono text-xs tabular-nums text-zinc-600">
              {String(index + 1).padStart(2, "0")}
            </span>
            {title}
          </h3>
          <div className="flex items-center gap-2">
            {step.source === undefined ? null : <SourceBadge source={step.source} />}
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[step.status]}`}
            >
              {STATUS_LABEL[step.status]}
            </span>
          </div>
        </div>

        <p className="mt-1 text-sm leading-relaxed text-zinc-400">{description}</p>

        {step.detail === undefined ? null : (
          <p className="mt-2 text-sm text-zinc-300">{step.detail}</p>
        )}

        {step.reason === undefined ? null : (
          <p
            className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
              step.status === "failure"
                ? "border-red-500/40 bg-red-500/10 text-red-200"
                : "border-amber-500/40 bg-amber-500/10 text-amber-200"
            }`}
          >
            <span className="font-medium">
              {step.status === "failure" ? "Failure: " : "Blocked: "}
            </span>
            {step.reason}
          </p>
        )}

        {step.deltas === undefined || step.deltas.length === 0 ? null : (
          <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
            <p className="mb-1 text-xs font-medium uppercase tracking-widest text-zinc-600">
              Balance change
            </p>
            {step.deltas.map((delta) => (
              <DeltaRow key={delta.label} {...delta} />
            ))}
          </div>
        )}

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
          <div className="flex items-baseline gap-2">
            <dt className="text-xs text-zinc-600">Transaction</dt>
            <dd className="font-mono text-xs tabular-nums text-zinc-400">
              {step.txHash === undefined ? (
                "—"
              ) : (
                <span title={step.txHash}>{truncateAddress(step.txHash)}</span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-xs text-zinc-600">Uniswap request ID</dt>
            <dd className="font-mono text-xs tabular-nums text-zinc-400">
              {step.uniswapRequestId === undefined ? (
                "—"
              ) : (
                <span title={step.uniswapRequestId}>{step.uniswapRequestId}</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}
