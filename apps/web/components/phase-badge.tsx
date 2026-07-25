type PhaseBadgeProps = {
  phase: number;
  label?: string;
  state?: "pending" | "active";
};

export function PhaseBadge({ phase, label, state = "pending" }: PhaseBadgeProps) {
  const text = label ?? `Awaiting Phase ${phase}`;
  const pill =
    state === "active"
      ? "border-teal-500/30 bg-teal-500/10 text-teal-400"
      : "border-zinc-800 bg-zinc-900 text-zinc-400";
  const dot = state === "active" ? "bg-teal-400" : "bg-zinc-600";
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${pill}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}
