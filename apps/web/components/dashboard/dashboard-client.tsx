"use client";

import { useEffect, useState } from "react";
import type { ExecutionKind, ExecutionRecord } from "@vortex/shared";
import { TOKENS, WBTC } from "@vortex/shared";
import { CoveragePanel } from "@/components/maker/coverage-panel";
import { PageHeader } from "@/components/page-header";
import { FixtureNotice, SourceBadge } from "@/components/source-badge";
import { useConfig, useExecutions, useStrategyHealth } from "@/hooks/useVortexQueries";
import { ApiRequestError } from "@/lib/api";
import { formatTokenAmount, truncateAddress } from "@/lib/format";
import { STRATEGY_HASHES } from "@/lib/strategy-config";

const KIND_LABEL: Record<ExecutionKind, string> = {
  BEST_EXECUTION_AQUA: "Vortex Swap · Aqua",
  BEST_EXECUTION_UNISWAP: "Vortex Swap · Uniswap",
  GROW: "Vortex Grow",
};

/**
 * Returns undefined for an address we cannot identify. Defaulting to 18 would
 * render a money value wrong by ten orders of magnitude; an em dash is the
 * honest answer.
 */
function decimalsForAddress(address: string | null): number | undefined {
  if (address === null) {
    return undefined;
  }
  return TOKENS.find(
    (token) => token.address.toLowerCase() === address.toLowerCase(),
  )?.decimals;
}

function formatAmount(value: string | null, address: string | null): string {
  const decimals = decimalsForAddress(address);
  if (value === null || decimals === undefined) {
    return "—";
  }
  return formatTokenAmount(BigInt(value), decimals);
}

/**
 * The API's own code in front of its message. `STRATEGY_NOT_FOUND` tells the
 * operator the configured hash is wrong for this chain; a generic sentence
 * would not.
 */
function describeError(error: Error): string {
  return error instanceof ApiRequestError
    ? `${error.code}: ${error.message}`
    : error.message;
}

/** Aggregates are computed from the records themselves, never hardcoded. */
function aggregateGrow(records: ExecutionRecord[]) {
  return records
    .filter((record) => record.kind === "GROW")
    .reduce(
      (totals, record) => ({
        grossProfit: totals.grossProfit + BigInt(record.grossProfit ?? "0"),
        performanceFee: totals.performanceFee + BigInt(record.performanceFee ?? "0"),
        cycles: totals.cycles + 1,
      }),
      { grossProfit: 0n, performanceFee: 0n, cycles: 0 },
    );
}

function RelativeTime({ timestamp }: { timestamp: number }) {
  // Rendered only after mount so the server never emits a clock-derived string.
  const [label, setLabel] = useState("—");
  useEffect(() => {
    const update = () => {
      const deltaSec = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
      if (deltaSec < 60) {
        setLabel(`${deltaSec}s ago`);
      } else if (deltaSec < 3600) {
        setLabel(`${Math.floor(deltaSec / 60)}m ago`);
      } else {
        setLabel(`${Math.floor(deltaSec / 3600)}h ago`);
      }
    };
    update();
    const timer = setInterval(update, 30_000);
    return () => clearInterval(timer);
  }, [timestamp]);
  return <span suppressHydrationWarning>{label}</span>;
}

function Panel({
  title,
  source,
  children,
}: {
  title: string;
  source?: "live" | "fixture";
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          {title}
        </h2>
        {source === undefined ? null : <SourceBadge source={source} />}
      </header>
      {children}
    </section>
  );
}

function Pill({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={
        on
          ? "inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-0.5 text-xs font-medium text-teal-400"
          : "inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/50 px-2.5 py-0.5 text-xs font-medium text-zinc-400"
      }
    >
      {label} {on ? "on" : "off"}
    </span>
  );
}

export function DashboardClient() {
  const config = useConfig();
  const executions = useExecutions();
  // The resolved hashes, so this reads the strategy the deployment actually
  // shipped. Only the two known fixture hashes get a fixture fallback, so a
  // real hash surfaces the API's own error below rather than a healthy maker
  // that does not exist.
  const swapHealth = useStrategyHealth(STRATEGY_HASHES.swap);
  const growHealth = useStrategyHealth(STRATEGY_HASHES.grow);

  const records = executions.data?.data ?? [];
  const totals = aggregateGrow(records);
  const anyFixture = [config.data, executions.data, swapHealth.data, growHealth.data].some(
    (result) => result?.source === "fixture",
  );
  // A failed read is not the same as "nothing happened yet". Without this the
  // page would assert an empty history as fact, unbadged.
  const failures: { label: string; message: string }[] = [
    { label: "Config", error: config.error },
    { label: "Executions", error: executions.error },
    { label: "Vortex Swap strategy", error: swapHealth.error },
    { label: "Vortex Grow strategy", error: growHealth.error },
  ].flatMap(({ label, error }) =>
    error instanceof Error ? [{ label, message: describeError(error) }] : [],
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Operations"
        title="Dashboard"
        description="What the system actually did: which venue won, what moved onchain, and what the maker earned."
      />

      {anyFixture ? <FixtureNotice className="mb-6" /> : null}

      {failures.length === 0 ? null : (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <p className="mb-1 font-medium text-red-300">
            Some reads failed — the panels below are incomplete.
          </p>
          <ul className="list-inside list-disc">
            {failures.map((failure) => (
              <li key={failure.label}>
                {failure.label}: {failure.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="System status" source={config.data?.source}>
          <dl className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-400">API</dt>
              <dd className="text-sm text-zinc-100">
                {config.error instanceof Error
                  ? "Error"
                  : config.data === undefined
                    ? "—"
                    : config.data.source === "live"
                      ? failures.length === 0
                        ? "Reachable"
                        : "Reachable, some reads failing"
                      : "Not reachable"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-400">Chain</dt>
              <dd className="font-mono text-sm tabular-nums text-zinc-100">
                {config.data?.data.chainId ?? "—"}
              </dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill label="Grow" on={config.data?.data.features.growEnabled ?? false} />
            <Pill label="Demo mode" on={config.data?.data.features.demoMode ?? false} />
          </div>
        </Panel>

        <Panel title="Grow results" source={executions.data?.source}>
          <dl className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-400">Cycles executed</dt>
              <dd className="font-mono text-sm tabular-nums text-zinc-100">
                {totals.cycles === 0 ? "—" : totals.cycles}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-400">Gross profit</dt>
              <dd className="font-mono text-sm tabular-nums text-zinc-100">
                {totals.cycles === 0
                  ? "—"
                  : `${formatTokenAmount(totals.grossProfit, WBTC.decimals)} WBTC`}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-400">Maker profit</dt>
              <dd className="font-mono text-sm tabular-nums text-zinc-100">
                {totals.cycles === 0
                  ? "—"
                  : `${formatTokenAmount(totals.grossProfit - totals.performanceFee, WBTC.decimals)} WBTC`}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-sm text-zinc-400">Performance fee</dt>
              <dd className="font-mono text-sm tabular-nums text-zinc-100">
                {totals.cycles === 0
                  ? "—"
                  : `${formatTokenAmount(totals.performanceFee, WBTC.decimals)} WBTC`}
              </dd>
            </div>
          </dl>
        </Panel>
      </div>

      <div className="mt-6">
        <Panel title="Recent executions" source={executions.data?.source}>
          {executions.error instanceof Error ? (
            <p className="text-sm text-red-300">
              Execution history could not be loaded, so this panel is empty for
              an unknown reason rather than because nothing happened.
            </p>
          ) : records.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No executions recorded yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs uppercase tracking-widest text-zinc-500">
                    <th scope="col" className="pb-2 pr-4 font-medium">Kind</th>
                    <th scope="col" className="pb-2 pr-4 text-right font-medium">In</th>
                    <th scope="col" className="pb-2 pr-4 text-right font-medium">Out</th>
                    <th scope="col" className="pb-2 pr-4 font-medium">Tx</th>
                    <th scope="col" className="pb-2 pr-4 font-medium">Uniswap request</th>
                    <th scope="col" className="pb-2 text-right font-medium">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td className="py-2 pr-4 text-sm text-zinc-200">
                        {KIND_LABEL[record.kind]}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-sm tabular-nums text-zinc-400">
                        {formatAmount(record.amountIn, record.tokenIn)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-sm tabular-nums text-zinc-400">
                        {formatAmount(record.amountOut, record.tokenOut)}
                      </td>
                      <td className="py-2 pr-4 font-mono text-sm tabular-nums text-zinc-400">
                        {record.txHash === null ? (
                          "—"
                        ) : (
                          <span title={record.txHash}>{truncateAddress(record.txHash)}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 font-mono text-sm tabular-nums text-zinc-400">
                        {record.uniswapRequestId === null ? (
                          "—"
                        ) : (
                          <span title={record.uniswapRequestId}>
                            {truncateAddress(record.uniswapRequestId)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right text-sm text-zinc-500">
                        <RelativeTime timestamp={record.timestamp} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-6 space-y-6">
        {swapHealth.data === undefined ? null : (
          <CoveragePanel
            health={swapHealth.data.data}
            source={swapHealth.data.source}
            title="Vortex Swap — balance coverage"
          />
        )}
        {growHealth.data === undefined ? null : (
          <CoveragePanel
            health={growHealth.data.data}
            source={growHealth.data.source}
            title="Vortex Grow — balance coverage"
          />
        )}
      </div>
    </div>
  );
}
