import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";

export const metadata: Metadata = {
  title: "Architecture — Vortex",
  description:
    "How one maker inventory powers Vortex Swap, Vortex Grow, and the Vortex PermAMM.",
};

const products = [
  {
    name: "Vortex Swap",
    summary: "Best execution",
    bullets: [
      "1inch Aqua/SwapVM market-making strategy serving inventory-aware quotes.",
      "Every quote competes against a Uniswap Trading API quote for the same exact-input trade.",
      "Routes through Aqua only when Aqua's net output wins; otherwise the app executes the exact Uniswap API-built transaction.",
    ],
  },
  {
    name: "Vortex Grow",
    summary: "Same-asset compounding — Grow WBTC",
    bullets: [
      "Custom Aqua app that temporarily pulls maker WBTC for one atomic cycle.",
      "Cycle runs across the Vortex PermAMM and an external venue (Uniswap API route).",
      "Succeeds only if final WBTC exceeds initial WBTC; the performance fee comes only from realized profit.",
      "Pushes principal plus profit back to the maker in the same transaction.",
    ],
  },
  {
    name: "Vortex PermAMM",
    summary: "Uniswap v4 dynamic-fee pool",
    bullets: [
      "Real Uniswap v4 pool with a dynamic-fee hook and a mock reference oracle.",
      "Immutable safety-fee floor plus signed per-swap commercial fees.",
      "Serves as one leg of the Grow cycle.",
    ],
  },
] as const;

const uniswapRoles = [
  "Benchmarks every Aqua quote against real external liquidity — best execution is a measured claim, not a slogan.",
  "Builds and executes the fallback swap: when Uniswap wins, the exact API-built transaction is submitted unchanged.",
  "Builds the external leg of the Grow cycle (USDC back to WBTC).",
  "Request IDs and transaction hashes are surfaced in the UI so every routed trade is traceable.",
] as const;

const monorepo = [
  { path: "apps/web", role: "Next.js UI" },
  { path: "apps/api", role: "Fastify quote comparator + Uniswap API client" },
  { path: "packages/shared", role: "Zod schemas + EIP-712 typed data" },
  {
    path: "packages/contracts",
    role: "Foundry: Aqua strategies, Vortex Grow app, v4 hook",
  },
] as const;

const phases = [
  {
    phase: 0,
    name: "Repo skeleton",
    exit: "Web and API boot; every route renders a structured placeholder.",
    status: "passed",
  },
  {
    phase: 1,
    name: "Official Aqua token transfer",
    exit: "A real Aqua token transfer settles end to end.",
    status: "passed",
  },
  {
    phase: 2,
    name: "SwapVM best execution",
    exit: "A SwapVM strategy serves inventory-aware quotes and settles an exact-input swap.",
    status: "active",
  },
  {
    phase: 3,
    name: "Backend comparison router",
    exit: "The API prices both venues and selects the higher net output.",
    status: "active",
  },
  {
    phase: 4,
    name: "Best-execution frontend",
    exit: "Maker, Swap, Grow and Dashboard pages drive the real flows; fixture data is labeled until the API is live.",
    status: "active",
  },
  {
    phase: 5,
    name: "Vortex PermAMM v4 mock",
    exit: "The v4 pool quotes with a dynamic fee above the immutable safety floor against the mock oracle.",
    status: "pending",
  },
  {
    phase: 6,
    name: "Grow mock route",
    exit: "A Grow cycle executes atomically against a mock route and reverts unless final WBTC exceeds initial.",
    status: "pending",
  },
  {
    phase: 7,
    name: "Uniswap API external leg",
    exit: "The Grow external leg executes an exact Uniswap API-built route.",
    status: "pending",
  },
  {
    phase: 8,
    name: "Polish and freeze",
    exit: "The demo timeline runs the full judge sequence; copy and interfaces are frozen.",
    status: "pending",
  },
] as const;

const inventoryTree = `One maker inventory — WBTC/USDC on Arbitrum One
├─ Vortex Swap      inventory-aware quotes vs the Uniswap Trading API
├─ Vortex Grow      atomic same-asset compounding of maker WBTC
└─ Vortex PermAMM   Uniswap v4 dynamic-fee pool + hook, one leg of the Grow cycle`;

export default function ArchitecturePage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Vortex"
        title="Architecture"
        description="Programmable market-making on Arbitrum One. One maker inventory of WBTC and USDC powers three products that share custody, pricing, and profit."
        badge={<PhaseBadge phase={4} label="Phase 4 — in progress" state="active" />}
      />

      <section className="mt-10 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          One inventory, three products
        </h2>
        <pre className="mt-4 overflow-x-auto whitespace-pre font-mono text-sm leading-relaxed text-zinc-300">
          {inventoryTree}
        </pre>
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {products.map((product) => (
          <section
            key={product.name}
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
          >
            <h3 className="text-lg font-semibold text-zinc-100">{product.name}</h3>
            <p className="mt-0.5 text-sm text-teal-400">{product.summary}</p>
            <ul className="mt-3 flex list-disc flex-col gap-2 pl-4 text-sm leading-relaxed text-zinc-400">
              {product.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-teal-500/30 bg-teal-500/10 p-6">
        <h2 className="text-xs font-medium uppercase tracking-widest text-teal-400">
          Why the Uniswap API is load-bearing
        </h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-4 text-sm leading-relaxed text-zinc-300">
          {uniswapRoles.map((role) => (
            <li key={role}>{role}</li>
          ))}
        </ul>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Monorepo map
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="py-2 pr-4 text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Package
                </th>
                <th className="py-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Role
                </th>
              </tr>
            </thead>
            <tbody>
              {monorepo.map((entry) => (
                <tr key={entry.path} className="border-b border-zinc-800/60 last:border-b-0">
                  <td className="py-3 pr-4 font-mono text-zinc-100">{entry.path}</td>
                  <td className="py-3 text-zinc-400">{entry.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Build phases
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="py-2 pr-4 text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Phase
                </th>
                <th className="py-2 pr-4 text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Name
                </th>
                <th className="py-2 pr-4 text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Exit criterion
                </th>
                <th className="py-2 text-xs font-medium uppercase tracking-widest text-zinc-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {phases.map((entry) => (
                <tr key={entry.phase} className="border-b border-zinc-800/60 last:border-b-0">
                  <td className="py-3 pr-4 font-mono tabular-nums text-zinc-100">
                    {entry.phase}
                  </td>
                  <td className="py-3 pr-4 text-zinc-100">{entry.name}</td>
                  <td className="py-3 pr-4 leading-relaxed text-zinc-400">{entry.exit}</td>
                  <td className="py-3">
                    {entry.status === "passed" ? (
                      <span className="inline-flex items-center rounded-full border border-teal-500/40 bg-teal-500/20 px-2.5 py-0.5 text-xs font-medium text-teal-200">
                        Passed
                      </span>
                    ) : entry.status === "active" ? (
                      <PhaseBadge phase={entry.phase} label="In progress" state="active" />
                    ) : (
                      <PhaseBadge phase={entry.phase} label="Pending" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
