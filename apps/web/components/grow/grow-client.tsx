"use client";

import { useMemo, useState } from "react";
import { WBTC } from "@vortex/shared";
import { OpportunityCard } from "@/components/grow/opportunity-card";
import { ProfitBreakdown } from "@/components/grow/profit-breakdown";
import { PageHeader } from "@/components/page-header";
import { FixtureNotice } from "@/components/source-badge";
import { useGrowFlow } from "@/hooks/useGrowFlow";
import { parseTokenAmount } from "@/lib/format";
import type { GrowState } from "@/lib/machines/growMachine";

const DEFAULT_PRINCIPAL = "1.00000000";

const STATUS_COPY: Record<GrowState, string | null> = {
  IDLE: "Enter a principal and scan for a profitable cycle.",
  SCANNING: "Scanning venues for a profitable cycle…",
  NO_OPPORTUNITY: null,
  OPPORTUNITY_READY: "Opportunity found. Review the numbers before preparing the route.",
  REFRESHING: "Re-pricing the opportunity…",
  PREPARING_ROUTE: "Preparing and authorizing the route…",
  SIMULATING: "Route prepared. Simulating the cycle before execution.",
  EXECUTING: "Executing the atomic cycle…",
  CONFIRMED: "Cycle confirmed.",
  FAILED: null,
};

const INVARIANTS = [
  {
    name: "Atomic all-or-nothing",
    detail:
      "The entire cycle is a single transaction. If any leg fails, every leg unwinds.",
  },
  {
    name: "Profit floor enforced onchain",
    detail:
      "The cycle succeeds only if the final WBTC balance exceeds the initial WBTC balance. Anything less reverts.",
  },
  {
    name: "Fee only from realized profit",
    detail:
      "The performance fee is taken from realized profit, never from principal.",
  },
  {
    name: "Principal stays accounted for",
    detail:
      "Principal never leaves custody mid-cycle unreturned — it is pulled and pushed back within the same transaction.",
  },
] as const;

function FlowBox({
  title,
  detail,
  accent = false,
}: {
  title: string;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`w-full max-w-md rounded-lg border px-4 py-3 text-center ${
        accent ? "border-teal-500/30 bg-teal-500/10" : "border-zinc-800 bg-zinc-900"
      }`}
    >
      <p className="text-sm font-medium text-zinc-100">{title}</p>
      {detail === undefined ? null : (
        <p className="mt-0.5 text-xs text-zinc-400">{detail}</p>
      )}
    </div>
  );
}

function FlowEdge({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-1.5">
      <span className="text-[10px] uppercase tracking-widest text-zinc-600">
        {label}
      </span>
      <span aria-hidden="true" className="text-zinc-700">
        ↓
      </span>
    </div>
  );
}

export function GrowClient() {
  const [principalInput, setPrincipalInput] = useState(DEFAULT_PRINCIPAL);
  const [inputError, setInputError] = useState<string | null>(null);
  const [executionNote, setExecutionNote] = useState<string | null>(null);

  const {
    snapshot,
    opportunity,
    source,
    noOpportunityReason,
    expiredByTimeout,
    secondsRemaining,
    scan,
    refresh,
    prepare,
    reset,
  } = useGrowFlow();

  const parsedPrincipal = useMemo(() => {
    try {
      return parseTokenAmount(principalInput, WBTC.decimals);
    } catch {
      return null;
    }
  }, [principalInput]);

  const scanning = snapshot.state === "SCANNING" || snapshot.state === "REFRESHING";
  const statusMessage = STATUS_COPY[snapshot.state];

  const handleScan = () => {
    setExecutionNote(null);
    if (parsedPrincipal === null) {
      setInputError(`Enter a valid WBTC amount with at most ${WBTC.decimals} decimals.`);
      return;
    }
    if (parsedPrincipal === 0n) {
      setInputError("Enter a principal greater than zero.");
      return;
    }
    setInputError(null);
    void scan(parsedPrincipal);
  };

  const handlePrepare = () => {
    // Preparing would move the machine to SIMULATING, and nothing dispatches
    // SIMULATION_SUCCESS/FAILURE until the Grow contracts and the backend
    // route builder exist — leaving the user with no exit. Explain instead.
    setExecutionNote(
      source === "fixture"
        ? "Preparing a route needs the live Vortex API and the Grow contracts (Phases 6–7). This opportunity came from fixtures, so there is nothing to sign yet."
        : "This opportunity is live, but route preparation and the atomic cycle land with the Grow contracts (Phases 6–7). Nothing was signed or sent.",
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Same-asset compounding"
        title="Grow WBTC"
        description="Only execute when the position ends with more WBTC. A custom Aqua app temporarily pulls maker WBTC, runs one atomic cycle across the Vortex PermAMM and an external venue, and returns principal plus profit."
      />

      {source === "fixture" ? <FixtureNotice className="mb-6" /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <form
            className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
            onSubmit={(event) => {
              event.preventDefault();
              handleScan();
            }}
          >
            <div className="space-y-2">
              <label htmlFor="grow-principal" className="block text-sm text-zinc-400">
                Principal
              </label>
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3">
                <input
                  id="grow-principal"
                  name="grow-principal"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={principalInput}
                  onChange={(event) => {
                    setPrincipalInput(event.target.value);
                    setInputError(null);
                  }}
                  aria-invalid={inputError !== null}
                  className="w-full bg-transparent font-mono text-lg tabular-nums text-zinc-100 outline-none placeholder:text-zinc-700"
                />
                <span className="shrink-0 text-sm font-medium text-zinc-300">
                  WBTC
                </span>
              </div>
            </div>

            {inputError === null ? null : (
              <p role="alert" className="text-sm text-red-400">
                {inputError}
              </p>
            )}

            <button
              type="submit"
              disabled={scanning}
              aria-busy={scanning}
              className="w-full rounded-lg bg-teal-500 px-4 py-3 text-sm font-medium text-zinc-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scanning ? "Scanning…" : "Scan for opportunity"}
            </button>
          </form>

          <section
            aria-live="polite"
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
          >
            <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
              Status
            </h2>
            {snapshot.state === "FAILED" ? (
              <p role="alert" className="text-sm text-red-400">
                {snapshot.error ?? "The cycle failed."}
              </p>
            ) : snapshot.state === "NO_OPPORTUNITY" ? (
              <p className="text-sm text-zinc-300">
                {noOpportunityReason ??
                  (expiredByTimeout
                    ? "That opportunity expired before it was executed. Scan again to re-price it."
                    : "The scan returned no opportunity.")}
              </p>
            ) : (
              <p className="text-sm text-zinc-300">{statusMessage}</p>
            )}

            {executionNote === null ? null : (
              <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {executionNote}
              </p>
            )}

            {snapshot.txHash === null ? null : (
              <p className="mt-3 font-mono text-xs tabular-nums text-zinc-400">
                Transaction: {snapshot.txHash}
              </p>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              {snapshot.state === "OPPORTUNITY_READY" ? (
                <>
                  <button
                    type="button"
                    onClick={handlePrepare}
                    className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-400"
                  >
                    Prepare route
                  </button>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-600"
                  >
                    Refresh
                  </button>
                </>
              ) : null}
              {snapshot.state === "NO_OPPORTUNITY" ||
              snapshot.state === "FAILED" ||
              snapshot.state === "CONFIRMED" ? (
                <button
                  type="button"
                  onClick={handleScan}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-600"
                >
                  Scan again
                </button>
              ) : null}
              {snapshot.state === "CONFIRMED" || snapshot.state === "FAILED" ? (
                <button
                  type="button"
                  onClick={() => {
                    setExecutionNote(null);
                    reset();
                  }}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-600"
                >
                  Start over
                </button>
              ) : null}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {opportunity === null || source === null ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-6 py-12 text-center text-sm text-zinc-500">
              No opportunity on screen. Scan to price a cycle against current
              venue liquidity.
            </div>
          ) : (
            <>
              <OpportunityCard
                opportunity={opportunity}
                source={source}
                secondsRemaining={secondsRemaining}
              />
              <ProfitBreakdown
                principal={BigInt(opportunity.principalAmount)}
                grossProfit={BigInt(opportunity.estimatedGrossProfit)}
                performanceFee={BigInt(opportunity.performanceFee)}
                source={source}
              />
            </>
          )}
        </div>
      </div>

      <details className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-widest text-zinc-500">
          How the cycle works
        </summary>
        <div className="mt-6 overflow-x-auto">
          <div className="flex min-w-0 flex-col items-center">
            <FlowBox title="Aqua maker" detail="Custodies the WBTC principal" />
            <FlowEdge label="pull" />
            <FlowBox title="Vortex Grow app" detail="Orchestrates the atomic cycle" />
            <FlowEdge label="leg 1" />
            <FlowBox title="Vortex PermAMM" detail="WBTC → USDC" />
            <FlowEdge label="leg 2" />
            <FlowBox
              title="External venue (Uniswap API route)"
              detail="USDC → WBTC"
            />
            <FlowEdge label="check" />
            <FlowBox
              accent
              title="Profit check"
              detail={`final WBTC ${">"} initial WBTC or the whole transaction reverts`}
            />
            <FlowEdge label="fee" />
            <FlowBox title="Performance fee" detail="Taken from realized profit only" />
            <FlowEdge label="push" />
            <FlowBox title="Aqua maker" detail="Principal + profit returned" />
          </div>
        </div>

        <h3 className="mt-8 text-xs font-medium uppercase tracking-widest text-zinc-500">
          Invariants
        </h3>
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {INVARIANTS.map((invariant) => (
            <li
              key={invariant.name}
              className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            >
              <p className="text-sm font-medium text-zinc-100">{invariant.name}</p>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">
                {invariant.detail}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
