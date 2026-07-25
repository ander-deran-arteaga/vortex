import type { DataSource } from "@/lib/api/source";

/**
 * Two different questions, two different badges.
 *
 * `variant="data"` (default) labels the numbers beside it — this is the one
 * that satisfies §21, and it must sit in the same panel as the values it
 * describes. Provenance is per-venue: a single quote response routinely
 * carries a fixture Aqua leg next to a live Uniswap leg, so one badge for the
 * whole response would necessarily mislabel one of them.
 *
 * `variant="response"` labels how the response itself arrived (the live API,
 * or the fixture fallback when the API is unreachable). It is context, never a
 * substitute for per-venue labeling.
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

  if (live) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-400 ${className}`}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-400" />
        {label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 ${className}`}
      title={
        variant === "response"
          ? "The Vortex API was unreachable, so this whole response came from deterministic fixtures."
          : "Simulated — these values come from deterministic fixtures, not from a real Aqua or Uniswap quote."
      }
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      {label}
    </span>
  );
}

/** Page-level notice shown whenever anything on screen is fixture-backed. */
export function FixtureNotice({ className = "" }: { className?: string }) {
  return (
    <div
      role="status"
      className={`rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ${className}`}
    >
      <span className="font-medium text-amber-300">Fixture data.</span> The
      Vortex API is not reachable, so quotes, balances and executions on this
      page are deterministic placeholders — not Aqua quotes, not Uniswap API
      quotes, and not onchain state. Start the API to see live values.
    </div>
  );
}
