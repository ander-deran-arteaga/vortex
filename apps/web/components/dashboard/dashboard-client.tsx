"use client";

import { useEffect, useState } from "react";
import type { ExecutionKind, ExecutionRecord } from "@vortex/shared";
import { WBTC } from "@vortex/shared";
import { decimalsFor as decimalsFrom, resolveTokens, type ResolvedTokens } from "@/lib/tokens";
import { CoveragePanel } from "@/components/maker/coverage-panel";
import { FixtureNotice, SourceBadge } from "@/components/source-badge";
import { Page, PageHead, Panel, Row, Rows, StatusMark } from "@/components/ui/primitives";
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
function decimalsForAddress(
  tokens: ResolvedTokens,
  address: string | null,
): number | undefined {
  return decimalsFrom(tokens, address);
}

function formatAmount(
  tokens: ResolvedTokens,
  value: string | null,
  address: string | null,
): string {
  const decimals = decimalsForAddress(tokens, address);
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

/**
 * A label/value row whose value is prose, not data: reachability and feature
 * flags are words, so they stay in the UI face rather than borrowing the
 * numeric one.
 */
function Fact({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "gain" | "warn" | "loss" | "muted";
}) {
  const toneClass =
    tone === "gain"
      ? "text-gain"
      : tone === "warn"
        ? "text-warn"
        : tone === "loss"
          ? "text-loss"
          : tone === "muted"
            ? "text-say-3"
            : "text-say-1";
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-say-2">{label}</dt>
      <dd className={`text-sm ${toneClass}`}>{value}</dd>
    </div>
  );
}

/** Nothing has arrived yet, so nothing is claimed yet. */
function CoveragePending({ title }: { title: string }) {
  return (
    <Panel title={title} aside={<span className="text-xs text-say-3">Reading…</span>}>
      <p className="max-w-prose text-sm leading-relaxed text-say-2">
        Reading virtual balances, wallet balances and Aqua allowances for this
        strategy. Coverage appears once the API answers, and not before.
      </p>
    </Panel>
  );
}

/** An empty or failed surface still has to say what it is and why it is bare. */
function EmptyState({
  tone,
  headline,
  children,
  detail,
}: {
  tone: "muted" | "loss";
  headline: string;
  children: React.ReactNode;
  detail?: string;
}) {
  return (
    <div className="panel-raised px-6 py-10 text-center">
      <StatusMark tone={tone} className="mb-4" />
      <p className={`text-sm ${tone === "loss" ? "text-loss" : "text-say-1"}`}>
        {headline}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-say-2">
        {children}
      </p>
      {detail === undefined ? null : (
        <p className="num mx-auto mt-3 max-w-md text-xs leading-relaxed text-say-3">
          {detail}
        </p>
      )}
    </div>
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

  // Amounts are formatted with the decimals of the chain actually being
  // served, not the compile-time Arbitrum constants.
  const tokens = resolveTokens(config.data?.data);
  const records = executions.data?.data ?? [];
  const totals = aggregateGrow(records);
  const makerProfit = totals.grossProfit - totals.performanceFee;
  const executionsFailed = executions.error instanceof Error;
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

  const apiStatus =
    config.error instanceof Error
      ? "Error"
      : config.data === undefined
        ? "—"
        : config.data.source === "live"
          ? failures.length === 0
            ? "Reachable"
            : "Reachable, some reads failing"
          : "Not reachable";
  const apiTone =
    apiStatus === "Reachable"
      ? "gain"
      : apiStatus === "Error"
        ? "loss"
        : apiStatus === "—"
          ? "muted"
          : "warn";

  return (
    <Page>
      <PageHead
        title="Dashboard"
        lead="What the system actually did: which venue won, what moved onchain, and what the maker earned."
      />

      {anyFixture ? <FixtureNotice className="mb-6" /> : null}

      {failures.length === 0 ? null : (
        <div role="alert" className="panel-raised mb-6 flex gap-3 p-4">
          <StatusMark tone="loss" className="mt-[7px] shrink-0" />
          <div className="min-w-0 flex-1 text-sm leading-relaxed text-say-2">
            <p className="text-loss">
              Some reads failed. The panels below are incomplete rather than
              empty.
            </p>
            <ul className="mt-2 space-y-1 break-words">
              {failures.map((failure) => (
                <li key={failure.label}>
                  <span className="text-say-1">{failure.label}</span>:{" "}
                  {failure.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 1. What the inventory earned. The money leads the page. */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          cut
          title="Grow results"
          aside={
            executions.data === undefined ? null : (
              <SourceBadge source={executions.data.source} />
            )
          }
        >
          {executionsFailed ? (
            <EmptyState
              tone="loss"
              headline="Totals are unavailable."
              detail={
                executions.error instanceof Error
                  ? describeError(executions.error)
                  : undefined
              }
            >
              The execution history could not be read, so there is nothing to
              total. These figures are only ever summed from real records.
            </EmptyState>
          ) : executions.data === undefined ? (
            <EmptyState tone="muted" headline="Reading execution history…">
              Every figure here is summed from the records themselves, so none
              of them appear until the history arrives.
            </EmptyState>
          ) : totals.cycles === 0 ? (
            <EmptyState tone="muted" headline="No Grow cycles have settled yet.">
              Each atomic cycle returns more WBTC than it borrowed. When one
              lands, its realized profit, the maker&apos;s share and the
              performance fee are summed here.
            </EmptyState>
          ) : (
            <div>
              <p className="text-sm text-say-2">Maker profit</p>
              <p
                className={`num mt-2 text-2xl leading-none sm:text-3xl ${
                  makerProfit > 0n ? "text-gain" : "text-say-1"
                }`}
              >
                {`${formatTokenAmount(makerProfit, WBTC.decimals)} WBTC`}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-say-2">
                Realized across {totals.cycles}{" "}
                {totals.cycles === 1 ? "cycle" : "cycles"}, after the performance
                fee.
              </p>

              <div className="mt-6">
                <Rows>
                  <Row label="Cycles executed" value={totals.cycles} />
                  <Row
                    label="Gross profit"
                    value={`${formatTokenAmount(totals.grossProfit, WBTC.decimals)} WBTC`}
                  />
                  <Row
                    label="Performance fee"
                    value={`${formatTokenAmount(totals.performanceFee, WBTC.decimals)} WBTC`}
                  />
                </Rows>
              </div>
            </div>
          )}
        </Panel>

        <Panel
          title="System status"
          aside={
            config.data === undefined ? null : <SourceBadge source={config.data.source} />
          }
        >
          <Rows>
            <Fact label="API" value={apiStatus} tone={apiTone} />
            <Row
              label="Chain"
              value={config.data?.data.chainId ?? "—"}
              tone={config.data === undefined ? "muted" : "default"}
            />
            <Fact
              label="Grow"
              value={config.data?.data.features.growEnabled === true ? "Enabled" : "Disabled"}
              tone={config.data?.data.features.growEnabled === true ? "gain" : "muted"}
            />
            <Fact
              label="Demo mode"
              value={config.data?.data.features.demoMode === true ? "On" : "Off"}
              tone={config.data?.data.features.demoMode === true ? "warn" : "muted"}
            />
          </Rows>
        </Panel>
      </div>

      {/* 2. What backs it: coverage is the solvency read behind those totals. */}
      <div className="mt-6 space-y-6">
        {swapHealth.data === undefined ? (
          swapHealth.error instanceof Error ? null : (
            <CoveragePending title="Vortex Swap balance coverage" />
          )
        ) : (
          <CoveragePanel
            tokens={tokens}
            health={swapHealth.data.data}
            source={swapHealth.data.source}
            title="Vortex Swap balance coverage"
          />
        )}
        {growHealth.data === undefined ? (
          growHealth.error instanceof Error ? null : (
            <CoveragePending title="Vortex Grow balance coverage" />
          )
        ) : (
          <CoveragePanel
            tokens={tokens}
            health={growHealth.data.data}
            source={growHealth.data.source}
            title="Vortex Grow balance coverage"
          />
        )}
      </div>

      {/* 3. The ledger itself, last: detail for anyone who wants the receipts. */}
      <div className="mt-6">
        <Panel
          title="Recent executions"
          aside={
            executions.data === undefined ? null : (
              <SourceBadge source={executions.data.source} />
            )
          }
        >
          {executionsFailed ? (
            <EmptyState
              tone="loss"
              headline="History unavailable."
              detail={
                executions.error instanceof Error
                  ? describeError(executions.error)
                  : undefined
              }
            >
              Execution history could not be loaded, so this panel is empty for
              an unknown reason rather than because nothing happened.
            </EmptyState>
          ) : executions.data === undefined ? (
            <EmptyState tone="muted" headline="Reading execution history…">
              The ledger is being read. An empty table is only shown once the
              API has actually answered with no records.
            </EmptyState>
          ) : records.length === 0 ? (
            <EmptyState tone="muted" headline="No executions recorded yet.">
              Every swap routed through Aqua or Uniswap, and every Grow cycle,
              lands here with its amounts and its transaction hash the moment it
              settles.
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[52rem] text-left">
                <thead>
                  <tr>
                    <th scope="col" className="pb-3 pr-4 text-xs font-normal text-say-3">Kind</th>
                    <th scope="col" className="pb-3 pr-4 text-right text-xs font-normal text-say-3">In</th>
                    <th scope="col" className="pb-3 pr-6 text-right text-xs font-normal text-say-3">Out</th>
                    <th scope="col" className="pb-3 pr-4 text-xs font-normal text-say-3">Tx</th>
                    <th scope="col" className="pb-3 pr-4 text-xs font-normal text-say-3">Uniswap request</th>
                    <th scope="col" className="pb-3 text-right text-xs font-normal text-say-3">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(255,238,222,0.05)]">
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td className="py-3 pr-4 text-sm text-say-1">
                        {KIND_LABEL[record.kind]}
                      </td>
                      <td className="num py-3 pr-4 text-right text-sm text-say-2">
                        {formatAmount(tokens, record.amountIn, record.tokenIn)}
                      </td>
                      <td className="num py-3 pr-6 text-right text-sm text-say-1">
                        {formatAmount(tokens, record.amountOut, record.tokenOut)}
                      </td>
                      <td className="num py-3 pr-4 text-xs text-say-3">
                        {record.txHash === null ? (
                          "—"
                        ) : (
                          <span title={record.txHash}>{truncateAddress(record.txHash)}</span>
                        )}
                      </td>
                      <td className="num py-3 pr-4 text-xs text-say-3">
                        {record.uniswapRequestId === null ? (
                          "—"
                        ) : (
                          <span title={record.uniswapRequestId}>
                            {truncateAddress(record.uniswapRequestId)}
                          </span>
                        )}
                      </td>
                      <td className="py-3 text-right text-xs text-say-3">
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
    </Page>
  );
}
