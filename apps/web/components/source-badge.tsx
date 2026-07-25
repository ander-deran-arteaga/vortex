import type { DataSource } from "@/lib/api/source";

/**
 * Provenance, stated in type rather than in a tinted chip.
 *
 * Two different questions, two different badges. `variant="data"` (default)
 * labels the numbers beside it - this is the §21 requirement, and it must sit
 * in the same panel as the values it describes, because a single response
 * routinely carries a fixture Aqua leg next to a live Uniswap leg.
 * `variant="response"` labels how the response itself arrived. It is context,
 * never a substitute for per-venue labeling.
 *
 * The wording is load-bearing and asserted by tests: do not reword "Live data"
 * or "Fixture data" without updating them deliberately.
 */
export function SourceBadge({
  source,
  variant = "data",
  className = "",
}: {
  source: DataSource;
  variant?: "data" | "response";
  className?: string;
}) {
  const live = source === "live";
  const label =
    variant === "response"
      ? live
        ? "Live API response"
        : "Fixture fallback response"
      : live
        ? "Live data"
        : "Fixture data";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${live ? "text-say-2" : "text-warn"} ${className}`}
      title={
        variant === "response"
          ? live
            ? "This response came from the Vortex API."
            : "The Vortex API was unreachable, so this whole response came from deterministic fixtures."
          : live
            ? "These values came from a real quote."
            : "Simulated. These values come from deterministic fixtures, not from a real Aqua or Uniswap quote."
      }
    >
      <span
        aria-hidden="true"
        className={`inline-block size-[6px] rotate-45 ${live ? "bg-say-2" : "bg-warn"}`}
      />
      {label}
    </span>
  );
}

/** Page-level notice shown whenever anything on screen is fixture-backed. */
export function FixtureNotice({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      className={`panel-raised flex gap-3 p-4 text-sm leading-relaxed text-say-2 ${className}`}
    >
      <span aria-hidden="true" className="mt-[7px] inline-block size-[6px] shrink-0 rotate-45 bg-warn" />
      <p>
        <span className="text-warn">Simulated.</span> The Vortex API is not
        reachable, so quotes, balances and executions on this page are fixture
        data: deterministic placeholders, not Aqua quotes, not Uniswap API
        quotes, and not onchain state. Start the API to see live values.
      </p>
    </div>
  );
}
