/**
 * Provenance of every value the UI renders.
 *
 * Master ruling (Addendum 4, Phase 4): fixtures must be visibly labeled as
 * such in the UI — a mock value presented as live data is a blocked
 * implementation. Every read path therefore returns `Sourced<T>` so a
 * component physically cannot render a number without knowing where it came
 * from, and `<SourceBadge>` renders the label.
 */
export type DataSource = "live" | "fixture";

export interface Sourced<T> {
  data: T;
  source: DataSource;
}

export function live<T>(data: T): Sourced<T> {
  return { data, source: "live" };
}

export function fixture<T>(data: T): Sourced<T> {
  return { data, source: "fixture" };
}

export function isFixture(source: DataSource | undefined): boolean {
  return source === "fixture";
}
