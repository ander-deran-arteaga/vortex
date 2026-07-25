import type { DataSource } from "@/lib/api/source";

/**
 * Renders the provenance of the numbers next to it. Master ruling
 * (Addendum 4): fixture values presented as live data are a blocked
 * implementation, so every panel showing `Sourced<T>` data renders this.
 */
export function SourceBadge({
  source,
  className = "",
}: {
  source: DataSource;
  className?: string;
}) {
  if (source === "live") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-400 ${className}`}
      >
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-400" />
        Live data
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-400 ${className}`}
      title="The backend comparison router is not connected yet — these values come from deterministic fixtures, not from Aqua or the Uniswap API."
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      Fixture data
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
