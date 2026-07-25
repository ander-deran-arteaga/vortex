import type { ReactNode } from "react";

/**
 * The shared vocabulary. Every page composes from these so structure, spacing
 * and type stay one system rather than seven variations.
 */

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-6 py-14 sm:px-8">{children}</div>;
}

/**
 * A titled surface. The heading is real type at a real size, not the tracked-out
 * micro-caps label that ends up on every panel of every dashboard.
 */
export function Panel({
  title,
  aside,
  children,
  className = "",
  raised = false,
  cut = false,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  raised?: boolean;
  /** The signature chamfer. Reserved for the panel that carries the comparison. */
  cut?: boolean;
}) {
  return (
    <section
      className={`${raised ? "panel-raised" : "panel"} ${cut ? "cut-tr" : ""} ${className}`}
    >
      {title === undefined && aside === undefined ? null : (
        // Extra right padding when chamfered so no content sits inside the cut.
        <header
          className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-5 pt-5 ${cut ? "pr-8" : ""}`}
        >
          {title === undefined ? <span /> : (
            <h2 className="text-[15px] text-say-1">{title}</h2>
          )}
          {aside}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * The primary action. Copper fill, chamfered corner, and it does not move on
 * hover — the surface warms instead.
 */
export function Action({
  children,
  onClick,
  type = "button",
  disabled = false,
  busy = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      className={`cut-tr bg-cu px-5 py-2.5 pr-6 text-sm font-medium text-ink-0 transition-colors duration-150 hover:bg-cu-hi disabled:cursor-not-allowed disabled:bg-ink-2 disabled:text-say-2 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * The secondary action is deliberately NOT an outlined twin of the primary —
 * that pairing is a preset. It is a quiet text action that shifts to copper.
 */
export function QuietAction({
  children,
  onClick,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-sm text-say-2 underline-offset-4 transition-colors duration-150 hover:text-cu disabled:cursor-not-allowed disabled:text-say-3 ${className}`}
    >
      {children}
    </button>
  );
}

/**
 * A label/value row. Values are mono because they are real data; labels are not,
 * because a mono label is costume.
 */
export function Row({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "gain" | "loss" | "muted" | "accent";
}) {
  const toneClass =
    tone === "gain"
      ? "text-gain"
      : tone === "loss"
        ? "text-loss"
        : tone === "muted"
          ? "text-say-3"
          : tone === "accent"
            ? "text-cu"
            : "text-say-1";
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-say-2">
        {label}
        {hint === undefined ? null : (
          <span className="ml-1.5 text-xs text-say-3">{hint}</span>
        )}
      </dt>
      <dd className={`num text-sm ${toneClass}`}>{value}</dd>
    </div>
  );
}

/** Separates rows with tone, not with a drawn hairline on every edge. */
export function Rows({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-[rgba(255,238,222,0.05)]">{children}</dl>;
}

export function PageHead({
  title,
  lead,
  aside,
}: {
  title: string;
  lead?: string;
  aside?: ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
      <div className="max-w-2xl">
        <h1 className="text-4xl leading-[1.08] text-say-1 sm:text-[2.75rem]">{title}</h1>
        {lead === undefined ? null : (
          <p className="mt-3 text-[15px] leading-relaxed text-say-2">{lead}</p>
        )}
      </div>
      {aside}
    </header>
  );
}

/**
 * A status mark: a small square rotated to a diamond, in the system's own
 * geometry rather than a pulsing dot with a glow ring.
 */
export function StatusMark({
  tone,
  className = "",
}: {
  tone: "gain" | "loss" | "warn" | "muted" | "accent";
  className?: string;
}) {
  const fill =
    tone === "gain"
      ? "bg-gain"
      : tone === "loss"
        ? "bg-loss"
        : tone === "warn"
          ? "bg-warn"
          : tone === "accent"
            ? "bg-cu"
            : "bg-say-3";
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-[7px] rotate-45 ${fill} ${className}`}
    />
  );
}
