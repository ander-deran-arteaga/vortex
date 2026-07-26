/**
 * The label a modelled series wears.
 *
 * `SourceBadge` answers "live or fixture" — both of which describe a value that
 * something actually returned. This answers a third question the market panels
 * raise and the API layer never does: a series drawn from a model of the
 * designed curve, standing beside two measured ones.
 *
 * It follows the same pattern deliberately — same mark, same warn tone, same
 * "in type, not in a tinted chip" treatment — so a reader who has learnt what a
 * badge means on any other page reads this one without being taught again.
 *
 * The wording is load-bearing and asserted by tests.
 */
export function SimulatedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-start gap-1.5 text-xs text-warn ${className}`}
      title="This series is generated from a model of the designed curve. It is not a record of quotes the PermAMM returned."
    >
      <span
        aria-hidden="true"
        className="mt-[5px] inline-block size-[6px] shrink-0 rotate-45 bg-warn"
      />
      <span className="leading-snug">
        Simulated: illustrative model of the designed curve, not measured
        performance
      </span>
    </span>
  );
}
