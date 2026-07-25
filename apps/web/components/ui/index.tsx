/**
 * Vortex UI primitives.
 *
 * Every page composes from these rather than re-declaring utility strings, so
 * spacing, radii, focus treatment and motion stay consistent by construction.
 * Tokens live in `app/globals.css`.
 */
import Link from "next/link";
import type { ComponentProps, ElementType, ReactNode } from "react";

export function cx(...parts: unknown[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p !== "").join(" ");
}

/* ── Button ─────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 " +
  "ease-[var(--ease-out-soft)] active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-50";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-500 text-surface-sunken hover:bg-brand-400 shadow-[var(--shadow-glow)]",
  secondary:
    "border border-line bg-surface-card text-ink hover:border-line-strong hover:bg-surface-raised",
  ghost: "text-ink-muted hover:bg-surface-card hover:text-ink",
  danger:
    "border border-danger/40 bg-danger/10 text-danger hover:border-danger/70 hover:bg-danger/15",
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <Link
      {...props}
      className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], className)}
    />
  );
}

/* ── Card ───────────────────────────────────────────────────────────── */

export function Card({
  as: Tag = "section",
  interactive = false,
  accent,
  className,
  children,
  ...props
}: {
  as?: ElementType;
  interactive?: boolean;
  /** Left edge tint, used to colour a card by venue or outcome. */
  accent?: "brand" | "aqua" | "uniswap" | "positive" | "warning" | "danger";
  className?: string;
  children?: ReactNode;
} & Record<string, unknown>) {
  const ACCENT: Record<string, string> = {
    brand: "before:bg-brand-500",
    aqua: "before:bg-venue-aqua",
    uniswap: "before:bg-venue-uniswap",
    positive: "before:bg-positive",
    warning: "before:bg-warning",
    danger: "before:bg-danger",
  };
  return (
    <Tag
      {...props}
      className={cx(
        "surface-card rounded-2xl",
        accent &&
          cx(
            "overflow-hidden before:absolute before:inset-y-0 before:left-0 before:top-0 before:h-full before:w-[3px] before:content-['']",
            ACCENT[accent],
          ),
        interactive &&
          "transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--shadow-raised)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </div>
  );
}

/* ── Badge ──────────────────────────────────────────────────────────── */

type BadgeTone =
  | "neutral"
  | "brand"
  | "positive"
  | "warning"
  | "danger"
  | "aqua"
  | "uniswap";

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-raised text-ink-muted",
  brand: "border-brand-500/30 bg-brand-500/10 text-brand-400",
  positive: "border-positive/30 bg-positive/10 text-positive",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-danger/35 bg-danger/10 text-danger",
  aqua: "border-venue-aqua/30 bg-venue-aqua/10 text-venue-aqua",
  uniswap: "border-venue-uniswap/30 bg-venue-uniswap/10 text-venue-uniswap",
};

export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span
      {...props}
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        BADGE_TONE[tone],
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-current"
        />
      ) : null}
      {children}
    </span>
  );
}

/* ── Stat ───────────────────────────────────────────────────────────── */

export function Stat({
  label,
  value,
  hint,
  tone,
  size = "md",
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "positive" | "danger" | "muted";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const VALUE_SIZE = {
    sm: "text-base",
    md: "text-xl",
    lg: "text-3xl",
  } as const;
  const TONE = {
    positive: "text-positive",
    danger: "text-danger",
    muted: "text-ink-subtle",
  } as const;
  return (
    <div className={cx("min-w-0", className)}>
      <dt className="text-xs font-medium uppercase tracking-wider text-ink-faint">
        {label}
      </dt>
      <dd
        data-numeric
        className={cx(
          "mt-1 truncate font-semibold",
          VALUE_SIZE[size],
          tone ? TONE[tone] : "text-ink",
        )}
      >
        {value}
      </dd>
      {hint ? <p className="mt-0.5 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

/* ── Section ────────────────────────────────────────────────────────── */

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
      {children}
    </h2>
  );
}

/* ── Feedback: skeleton, spinner, alert, empty ──────────────────────── */

export function Skeleton({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={cx("shimmer rounded-md", className)}
    />
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cx("h-4 w-4 animate-[var(--animate-spin-slow)]", className)}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Alert({
  tone = "danger",
  title,
  children,
  className,
}: {
  tone?: "danger" | "warning" | "positive" | "brand";
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const TONE = {
    danger: "border-danger/40 bg-danger/10 text-danger",
    warning: "border-warning/40 bg-warning/10 text-warning",
    positive: "border-positive/40 bg-positive/10 text-positive",
    brand: "border-brand-500/40 bg-brand-500/10 text-brand-400",
  } as const;
  return (
    <div
      role="alert"
      className={cx(
        "animate-[var(--animate-fade)] rounded-xl border px-4 py-3 text-sm",
        TONE[tone],
        className,
      )}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? (
        <div className={cx("leading-relaxed", title && "mt-1")}>{children}</div>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-10 text-center",
        className,
      )}
    >
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {children ? (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-faint">
          {children}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ── Data row ───────────────────────────────────────────────────────── */

export function DataRow({
  label,
  value,
  hint,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex items-baseline justify-between gap-4 py-2 text-sm",
        className,
      )}
    >
      <span className="min-w-0 shrink text-ink-subtle">{label}</span>
      <span className="flex min-w-0 items-baseline gap-2">
        <span data-numeric className="truncate font-medium text-ink">
          {value}
        </span>
        {hint ? (
          <span className="shrink-0 text-xs text-ink-faint">{hint}</span>
        ) : null}
      </span>
    </div>
  );
}
