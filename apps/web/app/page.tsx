import Link from "next/link";
import { Page, Panel, Row, Rows, StatusMark } from "@/components/ui/primitives";

/**
 * The overview.
 *
 * The opening is a composition rather than a stack: one statement takes the
 * measure, the readout is placed beside it and pinned to the same bottom line
 * as the actions. The three products then align on a shared grid so titles,
 * bodies and status all sit on the same lines whatever the copy length.
 *
 * Nothing here fetches. Values that are not yet known render as an em dash in
 * `.num`, because an unknown reading is still data.
 */

interface Product {
  name: string;
  role: string;
  body: string;
  /** Null while the product has no page to open. */
  href: string | null;
  status: string;
  tone: "gain" | "muted";
}

const PRODUCTS: readonly Product[] = [
  {
    name: "Vortex Swap",
    role: "Best execution",
    href: "/swap",
    body:
      "Exact-input WBTC/USDC trades. An inventory-aware 1inch Aqua SwapVM strategy quotes against the Uniswap Trading API on every request, and a trade routes through Aqua only when Aqua's net output wins. Otherwise it executes the exact Uniswap API-built transaction.",
    status: "Interface live",
    tone: "gain",
  },
  {
    name: "Vortex Grow",
    role: "Same-asset compounding",
    href: "/grow",
    body:
      "Compounding that never leaves WBTC. A custom Aqua app temporarily pulls maker WBTC and runs one atomic cycle across the Vortex PermAMM and an external Uniswap API route. It settles only if final WBTC exceeds initial WBTC, and the performance fee comes from realized profit alone.",
    status: "Interface live",
    tone: "gain",
  },
  {
    name: "Vortex PermAMM",
    role: "Dynamic-fee v4 pool",
    href: null,
    body:
      "A real Uniswap v4 dynamic-fee pool and hook with a mock reference oracle, an immutable safety-fee floor, and signed per-swap commercial fees. It is one leg of the Grow cycle and the venue where maker-side pricing policy lives onchain.",
    status: "Awaiting Phase 5",
    tone: "muted",
  },
];

const STATUS_ROWS: readonly { label: string; phase: number }[] = [
  { label: "API", phase: 3 },
  { label: "Contracts", phase: 1 },
  { label: "Aqua position", phase: 2 },
  { label: "Uniswap API", phase: 3 },
];

const PHASES: readonly string[] = [
  "Skeleton",
  "Aqua transfer",
  "SwapVM quotes",
  "Comparison router",
  "Swap frontend",
  "v4 pool + hook",
  "Grow cycle",
  "Uniswap API leg",
  "Polish + freeze",
];

const CURRENT_PHASE = 4;

/** The primary action, as a link. Same silhouette and warmth as `Action`. */
function ActionLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="cut-tr inline-flex items-center bg-cu px-5 py-2.5 pr-6 text-sm font-medium text-ink-0 transition-colors duration-150 hover:bg-[#d98a5b]"
    >
      {children}
    </Link>
  );
}

/** The quiet counterpart. A text action, never an outlined twin of the above. */
function QuietLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className="text-sm text-say-2 underline-offset-4 transition-colors duration-150 hover:text-cu"
    >
      {children}
    </Link>
  );
}

export default function HomePage() {
  return (
    <Page>
      {/*
        The opening. The statement owns the full measure of its column; the
        readout sits in the last four columns and is bottom-aligned with the
        actions, so the two blocks share a real line instead of floating.
      */}
      <section className="grid gap-x-8 gap-y-12 sm:pt-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <h1 className="text-[clamp(1.75rem,5.2vw,4.25rem)] leading-[1.05] tracking-[-0.02em] text-say-1">
            <span className="block">One maker inventory.</span>
            <span className="block text-say-2">Three ways to execute.</span>
          </h1>

          <p className="mt-8 max-w-xl text-[17px] leading-relaxed text-say-2">
            Vortex runs one WBTC/USDC maker book on Arbitrum One. Every quote is
            contested: an inventory-aware Aqua SwapVM strategy against the
            Uniswap Trading API, decided on net output after gas.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-4">
            <ActionLink href="/swap">Get best execution</ActionLink>
            <QuietLink href="/architecture">How it works</QuietLink>
          </div>
        </div>

        {/* The one chamfered panel on this page. Its header is padded clear of the cut. */}
        <Panel title="System status" cut className="lg:col-span-4 lg:self-end">
          <Rows>
            <div className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-sm text-say-2">Web</dt>
              <dd className="flex items-center gap-2 text-sm text-gain">
                <StatusMark tone="gain" />
                Online
              </dd>
            </div>
            {STATUS_ROWS.map((row) => (
              <Row
                key={row.label}
                label={row.label}
                hint={`Awaiting Phase ${row.phase}`}
                value="—"
                tone="muted"
              />
            ))}
          </Rows>
        </Panel>
      </section>

      {/*
        Three parallel cards. Grid stretch equalises their heights and the body
        takes the slack, so every title, role line and status sits on the same
        line across all three columns however long the copy runs.
      */}
      <section className="mt-24">
        <h2 className="text-2xl text-say-1">Three products, one inventory</h2>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {PRODUCTS.map((product) => (
            <article key={product.name} className="panel flex flex-col p-6">
              <h3 className="text-xl text-say-1">
                {product.href === null ? (
                  product.name
                ) : (
                  <Link
                    href={product.href}
                    className="transition-colors duration-150 hover:text-cu"
                  >
                    {product.name}
                  </Link>
                )}
              </h3>
              <p className="mt-1.5 text-sm text-cu">{product.role}</p>
              <p className="mt-5 flex-1 text-sm leading-relaxed text-say-2">
                {product.body}
              </p>
              <p className="mt-7 flex items-center gap-2 text-[13px] text-say-2">
                <StatusMark tone={product.tone} />
                {product.status}
              </p>
            </article>
          ))}
        </div>

        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-say-2">
          Live quotes need the Vortex API. When it is not reachable, Vortex Swap
          and Vortex Grow fall back to deterministic fixtures and label every
          value on screen as fixture data.
        </p>
      </section>

      {/* Build progress: a sequence in type. It wraps rather than scrolling sideways. */}
      <section className="mt-24">
        <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2">
          <h2 className="text-2xl text-say-1">Build progress</h2>
          <p className="text-sm text-say-2">
            Now on phase <span className="num text-say-1">{CURRENT_PHASE}</span>
            {": "}
            {PHASES[CURRENT_PHASE]}
          </p>
        </div>

        <ol className="mt-8 grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-9">
          {PHASES.map((label, index) => {
            const current = index === CURRENT_PHASE;
            const done = index < CURRENT_PHASE;
            return (
              <li
                key={label}
                aria-current={current ? "step" : undefined}
                className="min-w-0"
              >
                {/*
                  Progress reads through a mark, not through a contrast drop:
                  shipped phases carry the diamond, the current one is copper
                  and says so, and nothing is dimmed below legibility.
                */}
                <p className="flex h-4 items-center gap-2 text-xs">
                  <span className="sr-only">Phase </span>
                  <span className={`num ${current ? "text-cu" : "text-say-3"}`}>
                    {index}
                  </span>
                  {current ? (
                    <span className="text-cu">Now</span>
                  ) : done ? (
                    <StatusMark tone="gain" />
                  ) : null}
                </p>
                <p
                  className={`mt-2 text-sm leading-snug ${
                    current ? "font-medium text-say-1" : "text-say-2"
                  }`}
                >
                  {label}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    </Page>
  );
}
