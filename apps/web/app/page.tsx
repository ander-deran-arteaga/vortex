import Link from "next/link";

interface ProductCard {
  name: string;
  badge: string;
  body: string;
}

const PRODUCTS: readonly ProductCard[] = [
  {
    name: "Vortex Swap",
    badge: "Awaiting Phases 2–4",
    body:
      "Best execution for exact-input WBTC/USDC trades. Inventory-aware quotes from a 1inch Aqua SwapVM market-making strategy compete against Uniswap Trading API quotes on every request. A trade routes through Aqua only when Aqua's net output wins; otherwise it executes the exact Uniswap API-built transaction.",
  },
  {
    name: "Vortex Grow",
    badge: "Awaiting Phases 6–7",
    body:
      "Same-asset compounding — Grow WBTC. A custom Aqua app temporarily pulls maker WBTC and runs an atomic cycle across the Vortex PermAMM and an external Uniswap API route. The cycle succeeds only if final WBTC exceeds initial WBTC, takes a performance fee only from realized profit, then pushes principal plus profit back to the maker.",
  },
  {
    name: "Vortex PermAMM",
    badge: "Awaiting Phase 5",
    body:
      "A real Uniswap v4 dynamic-fee pool and hook with a mock reference oracle, an immutable safety-fee floor, and signed per-swap commercial fees. It is one leg of the Grow cycle and the venue where maker-side pricing policy lives on-chain.",
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

const CURRENT_PHASE = 0;

function PhasePill({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-400">
      {children}
    </span>
  );
}

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16">
      {/* Hero */}
      <section className="max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Programmable market-making
        </p>
        <h1 className="mt-3 text-5xl font-semibold tracking-tight text-zinc-100">
          Vortex
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-zinc-400">
          One WBTC/USDC maker inventory on Arbitrum One powers three
          coordinated execution products: best-execution swaps that pit
          Aqua-based quotes against the Uniswap Trading API, same-asset
          compounding that grows maker WBTC through atomic profit-only cycles,
          and a Uniswap v4 dynamic-fee pool that puts maker pricing policy
          on-chain — all drawing from the same programmable liquidity.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/swap"
            className="rounded-lg bg-teal-500 px-5 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-teal-400"
          >
            Get best execution
          </Link>
          <Link
            href="/architecture"
            className="rounded-lg border border-zinc-800 px-5 py-2.5 text-sm font-medium text-zinc-100 transition-colors hover:border-zinc-700"
          >
            How it works
          </Link>
        </div>
      </section>

      {/* Product cards */}
      <section className="mt-16">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Three products, one inventory
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {PRODUCTS.map((product) => (
            <article
              key={product.name}
              className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-lg font-semibold text-teal-400">
                  {product.name}
                </h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                {product.body}
              </p>
              <div className="mt-4">
                <PhasePill>{product.badge}</PhasePill>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* System status */}
      <section className="mt-16">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          System status
        </h2>
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
          <ul className="divide-y divide-zinc-800">
            <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <span className="text-sm text-zinc-100">Web</span>
              <span className="flex items-center gap-2 text-sm text-teal-400">
                <span
                  className="h-1.5 w-1.5 rounded-full bg-teal-400"
                  aria-hidden="true"
                />
                online
              </span>
            </li>
            {STATUS_ROWS.map((row) => (
              <li
                key={row.label}
                className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <span className="text-sm text-zinc-100">{row.label}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono tabular-nums text-sm text-zinc-500">
                    —
                  </span>
                  <PhasePill>{`Awaiting Phase ${row.phase}`}</PhasePill>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Build progress */}
      <section className="mt-16">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Build progress
        </h2>
        <div className="mt-4 overflow-x-auto pb-2">
          <ol className="flex min-w-max gap-2">
            {PHASES.map((label, index) => {
              const current = index === CURRENT_PHASE;
              return (
                <li
                  key={label}
                  aria-current={current ? "step" : undefined}
                  className={
                    current
                      ? "w-32 shrink-0 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-2.5"
                      : "w-32 shrink-0 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2.5"
                  }
                >
                  <p
                    className={
                      current
                        ? "font-mono text-xs tabular-nums text-teal-400"
                        : "font-mono text-xs tabular-nums text-zinc-500"
                    }
                  >
                    Phase {index}
                    {current ? " · now" : ""}
                  </p>
                  <p
                    className={
                      current
                        ? "mt-1 text-xs font-medium text-zinc-100"
                        : "mt-1 text-xs text-zinc-400"
                    }
                  >
                    {label}
                  </p>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}
