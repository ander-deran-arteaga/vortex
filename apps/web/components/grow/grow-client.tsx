"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { WBTC } from "@vortex/shared";
import { OpportunityCard } from "@/components/grow/opportunity-card";
import { ProfitBreakdown } from "@/components/grow/profit-breakdown";
import { PageHeader } from "@/components/page-header";
import { FixtureNotice, SourceBadge } from "@/components/source-badge";
import { useGrowExecution, type GrowSettlement } from "@/hooks/useGrowExecution";
import { useGrowFlow } from "@/hooks/useGrowFlow";
import { formatTokenAmount, parseTokenAmount, truncateAddress } from "@/lib/format";
import type { GrowState } from "@/lib/machines/growMachine";

const DEFAULT_PRINCIPAL = "1.00000000";

const STATUS_COPY: Record<GrowState, string | null> = {
  IDLE: "Enter a principal and scan for a profitable cycle.",
  SCANNING: "Scanning venues for a profitable cycle…",
  NO_OPPORTUNITY: null,
  OPPORTUNITY_READY: "Opportunity found. Review the numbers before preparing the route.",
  REFRESHING: "Re-pricing the opportunity…",
  PREPARING_ROUTE: "Preparing and authorizing the route…",
  SIMULATING: "Simulating the prepared transaction before anything is broadcast…",
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

function SettlementRow({
  label,
  value,
  mono = true,
  emphasis = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-sm text-zinc-400">{label}</dt>
      <dd
        className={`${mono ? "font-mono tabular-nums" : ""} break-all text-right text-sm ${
          emphasis ? "text-teal-300" : "text-zinc-100"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * What actually happened onchain. Every number here was read back from the
 * receipt or from an ERC-20 `balanceOf` at an explicit block; anything that
 * could not be read renders as an em dash with the reason underneath, never as
 * a plausible-looking placeholder.
 */
function SettlementPanel({ settlement }: { settlement: GrowSettlement }) {
  const { makerAssetBefore: before, makerAssetAfter: after, assetDecimals } = settlement;
  const amount = (value: bigint) => `${formatTokenAmount(value, assetDecimals)} WBTC`;
  const delta = before === null || after === null ? null : after - before;

  return (
    <section
      aria-live="polite"
      className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
    >
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-medium uppercase tracking-widest text-zinc-500">
          Settlement
        </h2>
        {/* A real receipt is what makes these numbers onchain facts; without
            one there is nothing to label as live. */}
        {settlement.receipt === "unverified" ? null : <SourceBadge source="live" />}
      </header>

      <dl className="divide-y divide-zinc-800/60">
        <SettlementRow label="Transaction" value={settlement.txHash} />
        <SettlementRow
          label="Broadcast by"
          mono={false}
          value={
            settlement.mode === "SOLVER"
              ? "The Vortex solver (backend key)"
              : "Your wallet (no solver configured)"
          }
        />
        <SettlementRow
          label="Receipt"
          mono={false}
          value={
            settlement.receipt === "confirmed"
              ? "Confirmed onchain"
              : settlement.receipt === "reverted"
                ? "Reverted onchain"
                : "Not verified in this browser"
          }
        />
        <SettlementRow
          label="Block"
          value={settlement.blockNumber === null ? "—" : settlement.blockNumber.toString()}
        />
        <SettlementRow
          label="Maker"
          value={settlement.maker === null ? "—" : truncateAddress(settlement.maker)}
        />
        <SettlementRow
          label="Maker WBTC before"
          value={before === null ? "—" : amount(before)}
        />
        <SettlementRow
          label="Maker WBTC after"
          value={after === null ? "—" : amount(after)}
        />
        <SettlementRow
          label="Delta"
          emphasis
          value={
            delta === null
              ? "—"
              : delta > 0n
                ? `+ ${amount(delta)}`
                : delta === 0n
                  ? amount(0n)
                  : `− ${amount(-delta)}`
          }
        />
      </dl>

      {settlement.balanceNote === null ? (
        <p className="mt-3 text-xs text-zinc-500">
          Balances read with <code>balanceOf</code> at blocks{" "}
          {settlement.blockNumber === null
            ? "—"
            : `${(settlement.blockNumber - 1n).toString()} and ${settlement.blockNumber.toString()}`}
          .
        </p>
      ) : (
        <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {settlement.balanceNote}
        </p>
      )}
    </section>
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
    prepared,
    noOpportunityReason,
    expiredByTimeout,
    secondsRemaining,
    chainId,
    strategyHash,
    strategyIsPlaceholder,
    scan,
    refresh,
    prepare,
    reset,
    dispatch,
  } = useGrowFlow();

  const { execute, resetExecution, settlement, mode, simulationNote } =
    useGrowExecution(dispatch);
  const { isConnected } = useAccount();

  const parsedPrincipal = useMemo(() => {
    try {
      return parseTokenAmount(principalInput, WBTC.decimals);
    } catch {
      return null;
    }
  }, [principalInput]);

  const scanning = snapshot.state === "SCANNING" || snapshot.state === "REFRESHING";
  const running =
    snapshot.state === "PREPARING_ROUTE" ||
    snapshot.state === "SIMULATING" ||
    snapshot.state === "EXECUTING";

  // The generic copy, then the parts only the live run knows: who is
  // broadcasting, and whether a receipt was actually read.
  const statusMessage =
    snapshot.state === "EXECUTING" && mode === "WALLET"
      ? "No solver is configured, so confirm the prepared transaction in your wallet."
      : snapshot.state === "CONFIRMED" && settlement?.receipt === "unverified"
        ? "The cycle was broadcast, but no receipt could be read in this browser — treat it as submitted, not settled."
        : STATUS_COPY[snapshot.state];

  const handleScan = () => {
    setExecutionNote(null);
    resetExecution();
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

  /**
   * Prepares the route on the API and then runs it: simulate the prepared
   * transaction, ask the solver to broadcast it, and fall back to broadcasting
   * it from the connected wallet when the API answers SOLVER_UNAVAILABLE.
   *
   * A fixture opportunity is the one case that cannot run: there is no session
   * the route builder would recognise, so it says so instead of sending a
   * doomed request.
   */
  const handlePrepare = async () => {
    setExecutionNote(null);
    resetExecution();
    if (source === "fixture") {
      setExecutionNote(
        "This opportunity came from fixtures because the Vortex API is unreachable, so there is nothing to sign yet. Start the API against a chain where Vortex Grow is deployed to run the cycle for real.",
      );
      return;
    }
    const route = await prepare();
    if (route === null) {
      // Nothing executable came back. prepare() has already put the reason on
      // screen (FAILED, with the API's own code) or the run was superseded, so
      // adding a second explanation here would only contradict it.
      return;
    }
    await execute(route);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Same-asset compounding"
        title="Grow WBTC"
        description="Only execute when the position ends with more WBTC. A custom Aqua app temporarily pulls maker WBTC, runs one atomic cycle across the Vortex PermAMM and an external venue, and returns principal plus profit."
      />

      {source === "fixture" ? <FixtureNotice className="mb-6" /> : null}

      {strategyIsPlaceholder ? (
        <div
          role="status"
          className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
        >
          <span className="font-medium text-amber-300">
            Placeholder strategy hash.
          </span>{" "}
          Scans are sent for{" "}
          <span className="font-mono text-xs">{truncateAddress(strategyHash)}</span>,
          which exists only in this app — a live API answers{" "}
          <span className="font-mono text-xs">STRATEGY_NOT_FOUND</span> for it. Set{" "}
          <span className="font-mono text-xs">
            NEXT_PUBLIC_DEMO_GROW_STRATEGY_HASH
          </span>{" "}
          to the seeded Grow strategy hash for this deployment to scan the real
          one.
        </div>
      ) : null}

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
              disabled={scanning || running}
              aria-busy={scanning}
              className="w-full rounded-lg bg-teal-500 px-4 py-3 text-sm font-medium text-zinc-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scanning ? "Scanning…" : "Scan for opportunity"}
            </button>
          </form>

          {isConnected ? null : (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
              Scanning works without a wallet. Connect one on chain {chainId} to
              broadcast the cycle yourself when the API has no solver key.
            </p>
          )}

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

            {simulationNote === null ? null : (
              <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {simulationNote}
              </p>
            )}

            {executionNote === null ? null : (
              <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {executionNote}
              </p>
            )}

            {snapshot.txHash === null ? null : (
              <p className="mt-3 break-all font-mono text-xs tabular-nums text-zinc-400">
                Transaction: {snapshot.txHash}
              </p>
            )}

            {prepared === null ? null : (
              <div className="mt-4">
                {/* Only a live prepare ever reaches this state — the fixture
                    fallback stops the flow — so the badge says so. */}
                <div className="mb-1 flex items-center justify-between gap-3">
                  <h3 className="text-[10px] font-medium uppercase tracking-widest text-zinc-500">
                    Prepared route
                  </h3>
                  <SourceBadge source="live" variant="response" />
                </div>
                <dl className="space-y-1 text-xs text-zinc-500">
                  <div className="flex justify-between gap-3">
                    <dt>Route hash</dt>
                    <dd
                      className="font-mono tabular-nums text-zinc-400"
                      title={prepared.routeHash}
                    >
                      {truncateAddress(prepared.routeHash)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Gas estimate</dt>
                    <dd className="font-mono tabular-nums text-zinc-400">
                      {prepared.gasEstimate ?? "—"}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Minimum final</dt>
                    <dd className="font-mono tabular-nums text-zinc-400">
                      {formatTokenAmount(BigInt(prepared.minFinalAsset), WBTC.decimals)} WBTC
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-3">
              {snapshot.state === "OPPORTUNITY_READY" || running ? (
                <>
                  <button
                    type="button"
                    onClick={() => void handlePrepare()}
                    disabled={running}
                    aria-busy={running}
                    className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {running ? "Running cycle…" : "Prepare route & run cycle"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    disabled={running}
                    className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 hover:border-zinc-600 disabled:cursor-not-allowed disabled:opacity-40"
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
                    resetExecution();
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
          {settlement === null ? null : <SettlementPanel settlement={settlement} />}

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
