import type { Metadata } from "next";
import { PhaseBadge } from "@/components/phase-badge";
import { Page, PageHead, Panel, StatusMark } from "@/components/ui/primitives";

export const metadata: Metadata = {
  title: "Architecture · Vortex",
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
    summary: "Same-asset compounding: Grow WBTC",
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
  "Benchmarks every Aqua quote against real external liquidity, so best execution is a measured claim rather than a slogan.",
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

/**
 * The tree is a real ASCII diagram, so it is set in mono and padded to a fixed
 * column. Product names carry the accent; the branch glyphs recede.
 */
const TREE_ROOT = "One maker inventory: WBTC/USDC on Arbitrum One";

const TREE_BRANCHES = [
  {
    glyph: "├─ ",
    name: "Vortex Swap",
    pad: "      ",
    note: "inventory-aware quotes vs the Uniswap Trading API",
  },
  {
    glyph: "├─ ",
    name: "Vortex Grow",
    pad: "      ",
    note: "atomic same-asset compounding of maker WBTC",
  },
  {
    glyph: "└─ ",
    name: "Vortex PermAMM",
    pad: "   ",
    note: "Uniswap v4 dynamic-fee pool + hook, one leg of the Grow cycle",
  },
] as const;

export default function ArchitecturePage() {
  return (
    <Page>
      <PageHead
        title="Architecture"
        lead="Programmable market-making on Arbitrum One. One maker inventory of WBTC and USDC powers three products that share custody, pricing, and profit."
        aside={<PhaseBadge phase={4} label="Phase 4, in progress" state="active" />}
      />

      <div className="space-y-6">
        {/*
          The signature panel: the one chamfered silhouette on this page, and the
          single idea everything below elaborates. Padded clear of the cut.
        */}
        <section className="panel cut-tr p-6 pr-9 sm:p-8 sm:pr-11">
          <h2 className="text-2xl leading-tight text-say-1 sm:text-[1.75rem]">
            One inventory, three products
          </h2>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-say-2">
            Custody, pricing and profit all resolve to a single WBTC/USDC book.
            Every product below is a different way of putting that one book to
            work, which is why a fill in one of them changes the quotes in the
            others.
          </p>
          <div className="mt-7 overflow-x-auto">
            <pre className="num min-w-max text-[13px] leading-[2] text-say-2">
              <span className="text-say-1">{TREE_ROOT}</span>
              {TREE_BRANCHES.map((branch) => (
                <span key={branch.name}>
                  {"\n"}
                  <span className="text-say-3">{branch.glyph}</span>
                  <span className="text-cu">{branch.name}</span>
                  {branch.pad}
                  {branch.note}
                </span>
              ))}
            </pre>
          </div>
        </section>

        {/*
          Subgrid so the three names sit on one line, the three summaries on the
          next, and the bullet lists all start at the same y, whatever the copy
          length does at a given width.
        */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:grid-rows-[auto_auto_1fr] lg:gap-y-2">
          {products.map((product) => (
            <section
              key={product.name}
              className="panel p-6 lg:row-span-3 lg:grid lg:grid-rows-subgrid"
            >
              <h3 className="text-xl text-say-1">{product.name}</h3>
              <p className="mt-1 text-sm text-cu lg:mt-0">{product.summary}</p>
              <ul className="mt-4 space-y-2.5 lg:mt-2">
                {product.bullets.map((bullet) => (
                  <li
                    key={bullet}
                    className="flex gap-2.5 text-sm leading-relaxed text-say-2"
                  >
                    <StatusMark tone="muted" className="mt-[7px] shrink-0" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section className="panel-raised p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] lg:gap-10">
            <div>
              <h2 className="text-2xl leading-tight text-say-1">
                Why the Uniswap API is load-bearing
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-say-2">
                It is not a fallback bolted on at the end. It is the benchmark
                every best-execution claim on this site is measured against, and
                the builder that settles the trade whenever it wins.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2 lg:gap-x-8">
              {uniswapRoles.map((role) => (
                <li
                  key={role}
                  className="flex gap-2.5 text-sm leading-relaxed text-say-1"
                >
                  <StatusMark tone="accent" className="mt-[7px] shrink-0" />
                  <span>{role}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Panel title="Monorepo map">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left">
              <thead>
                <tr className="text-xs text-say-3">
                  <th scope="col" className="pb-2.5 pr-6 font-normal">
                    Package
                  </th>
                  <th scope="col" className="pb-3.5 font-normal">
                    Role
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(255,238,222,0.05)]">
                {monorepo.map((entry) => (
                  <tr key={entry.path}>
                    <td className="py-3 pr-6 align-top">
                      <span className="num text-sm text-say-1">{entry.path}</span>
                    </td>
                    <td className="py-3 align-top text-sm text-say-2">
                      {entry.role}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          title="Build phases"
          aside={
            <span className="text-xs text-say-3">
              Exit criteria, not aspirations
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-left">
              <thead>
                <tr className="text-xs text-say-3">
                  <th scope="col" className="pb-3.5 pr-5 font-normal">
                    Phase
                  </th>
                  <th scope="col" className="pb-3.5 pr-5 font-normal">
                    Name
                  </th>
                  <th scope="col" className="pb-3.5 pr-5 font-normal">
                    Exit criterion
                  </th>
                  <th scope="col" className="pb-3.5 font-normal">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(255,238,222,0.05)]">
                {phases.map((entry) => (
                  <tr key={entry.phase}>
                    <td className="py-3.5 pr-5 align-top">
                      <span className="num text-sm text-say-3">{entry.phase}</span>
                    </td>
                    <td className="py-3.5 pr-5 align-top text-sm text-say-1">
                      {entry.name}
                    </td>
                    <td className="py-3.5 pr-5 align-top text-sm leading-relaxed text-say-2">
                      {entry.exit}
                    </td>
                    <td className="py-3.5 align-top">
                      {entry.status === "passed" ? (
                        <PhaseBadge
                          phase={entry.phase}
                          label="Passed"
                          state="passed"
                        />
                      ) : entry.status === "active" ? (
                        <PhaseBadge
                          phase={entry.phase}
                          label="In progress"
                          state="active"
                        />
                      ) : (
                        <PhaseBadge phase={entry.phase} label="Pending" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </Page>
  );
}
