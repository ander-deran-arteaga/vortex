import { StatusMark } from "@/components/ui/primitives";

/**
 * Build-phase state, stated in type rather than in a tinted pill. The mark is
 * the system's own diamond, so a phase badge reads like every other status on
 * the site instead of like a chip borrowed from a different product.
 *
 * The default pending wording ("Awaiting Phase N") is asserted by tests.
 */
type PhaseBadgeProps = {
  phase: number;
  label?: string;
  state?: "pending" | "active" | "passed";
};

export function PhaseBadge({ phase, label, state = "pending" }: PhaseBadgeProps) {
  const text = label ?? `Awaiting Phase ${phase}`;
  const tone = state === "active" ? "accent" : state === "passed" ? "gain" : "muted";
  const ink =
    state === "active" ? "text-cu" : state === "passed" ? "text-gain" : "text-say-3";

  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-xs ${ink}`}>
      <StatusMark tone={tone} />
      <span>{text}</span>
    </span>
  );
}
