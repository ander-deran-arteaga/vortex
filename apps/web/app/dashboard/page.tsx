import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PhaseBadge } from "@/components/phase-badge";
import { PlaceholderPanel } from "@/components/placeholder-panel";

export const metadata: Metadata = {
  title: "Dashboard — Vortex",
  description:
    "Operational overview of the Vortex maker: strategies, coverage, swaps, and Grow cycles.",
};

type PanelSpec = {
  title: string;
  phase: number;
  metrics: readonly string[];
};

const panels: readonly PanelSpec[] = [
  {
    title: "System status",
    phase: 4,
    metrics: ["API health", "Contracts", "Aqua position", "Uniswap API latency"],
  },
  {
    title: "Active strategies",
    phase: 4,
    metrics: ["Vortex Swap — WBTC/USDC", "Vortex Grow — WBTC"],
  },
  {
    title: "Balance coverage",
    phase: 4,
    metrics: ["WBTC executable", "USDC executable", "Coverage state"],
  },
  {
    title: "Inventory weights",
    phase: 4,
    metrics: ["WBTC weight", "USDC weight", "Target weight"],
  },
  {
    title: "Recent swaps",
    phase: 4,
    metrics: [
      "Aqua volume",
      "Uniswap-routed volume",
      "Aqua win rate",
      "Average user improvement",
    ],
  },
  {
    title: "Recent Grow cycles",
    phase: 6,
    metrics: ["Grow attempts", "Grow success rate", "WBTC compounded"],
  },
  {
    title: "Revenue",
    phase: 6,
    metrics: ["Maker profit", "Solver profit"],
  },
  {
    title: "Blocked transactions",
    phase: 6,
    metrics: ["Revert rate", "Profit-floor reverts"],
  },
];

function MetricList({ metrics }: { metrics: readonly string[] }) {
  return (
    <dl className="divide-y divide-zinc-800/60">
      {metrics.map((metric) => (
        <div key={metric} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-sm text-zinc-400">{metric}</dt>
          <dd className="font-mono text-sm tabular-nums text-zinc-500">—</dd>
        </div>
      ))}
    </dl>
  );
}

export default function DashboardPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Vortex"
        title="Dashboard"
        description="One view of the maker operation: strategy state, balance coverage, best-execution swap flow, and Grow cycle outcomes. Values populate as their phases land."
        badge={<PhaseBadge phase={4} />}
      />

      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {panels.map((panel) => (
          <PlaceholderPanel key={panel.title} title={panel.title} phase={panel.phase}>
            <MetricList metrics={panel.metrics} />
          </PlaceholderPanel>
        ))}
      </div>
    </div>
  );
}
