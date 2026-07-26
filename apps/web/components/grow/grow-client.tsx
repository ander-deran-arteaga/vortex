"use client";

import { useMemo, useState } from "react";
import { useAccount } from "wagmi";
import { WBTC } from "@vortex/shared";
import { CycleDiagram } from "@/components/grow/cycle-diagram";
import { OpportunityCard } from "@/components/grow/opportunity-card";
import { ProfitBreakdown } from "@/components/grow/profit-breakdown";
import { FixtureNotice, SourceBadge } from "@/components/source-badge";
import {
  Action,
  Page,
  PageHead,
  QuietAction,
  Row,
  Rows,
  StatusMark,
} from "@/components/ui/primitives";
import { VortexMark } from "@/components/ui/vortex-mark";
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

type StepTone = "done" | "active" | "failed" | "pending";

const STEP_SPOKEN: Record<StepTone, string> = {
  done: "completed",
  active: "in progress",
  failed: "failed",
  pending: "not started",
};

/**
 * What is verified complete, in order. A step is only marked done when there is
 * something on the client that proves it, and a step is only marked failed when
 * the run could not have failed anywhere else — an ambiguous failure leaves the
 * remaining steps untouched and lets the error message speak for itself.
 */
function ProgressRail({
  steps,
}: {
  steps: ReadonlyArray<{ label: string; tone: StepTone }>;
}) {
  return (
    // Sits inside the aria-live status panel; the step marks would otherwise be
    // re-announced on every tick, over the message that actually matters.
    <ol aria-live="off" className="space-y-2.5">
      {steps.map((step) => (
        <li
          key={step.label}
          aria-current={step.tone === "active" ? "step" : undefined}
          className="flex items-center gap-2.5"
        >
          <StatusMark
            tone={
              step.tone === "failed"
                ? "loss"
                : step.tone === "active"
                  ? "accent"
                  : step.tone === "done"
                    ? "gain"
                    : "muted"
            }
            className={step.tone === "pending" ? "opacity-45" : ""}
          />
          <span
            className={
              step.tone === "failed"
                ? "text-sm text-loss"
                : step.tone === "active"
                  ? "text-sm font-medium text-say-1"
                  : step.tone === "done"
                    ? "text-sm text-say-2"
                    : "text-sm text-say-3"
            }
          >
            {step.label}
            <span className="sr-only">, {STEP_SPOKEN[step.tone]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A caution that is a note, not an error: warn ink, no drawn outline. */
function CautionNote({ children }: { children: string }) {
  return (
    <div className="panel-raised mt-4 flex gap-3 px-4 py-3">
      <span
        aria-hidden="true"
        className="mt-[7px] inline-block size-[6px] shrink-0 rotate-45 bg-warn"
      />
      <p className="text-sm leading-relaxed text-say-2">{children}</p>
    </div>
  );
}

function SettlementRow({
  label,
  value,
  mono = true,
  tone = "default",
}: {
  label: string;
  value: string;
  mono?: boolean;
  tone?: "default" | "gain" | "loss" | "muted";
}) {
  const toneClass =
    tone === "gain"
      ? "text-gain"
      : tone === "loss"
        ? "text-loss"
        : tone === "muted"
          ? "text-say-3"
          : "text-say-1";
  return (
    <div className="flex items-baseline justify-between gap-5 py-2.5">
      <dt className="shrink-0 text-sm text-say-2">{label}</dt>
      <dd
        className={`${mono ? "num" : ""} break-all text-right text-sm ${toneClass}`}
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

  const deltaText =
    delta === null
      ? "—"
      : delta > 0n
        ? `+ ${amount(delta)}`
        : delta === 0n
          ? amount(0n)
          : `− ${amount(-delta)}`;
  const deltaTone =
    delta === null
      ? "text-say-3"
      : delta > 0n
        ? "text-gain"
        : delta < 0n
          ? "text-loss"
          : "text-say-1";

  return (
    <section aria-live="polite" className="panel">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 px-5 pt-5">
        <h2 className="text-[15px] text-say-1">Settlement</h2>
        {/* A real receipt is what makes these numbers onchain facts; without
            one there is nothing to label as live. */}
        {settlement.receipt === "unverified" ? null : <SourceBadge source="live" />}
      </header>

      <div className="p-5">
        {/* The whole point of the cycle, so it is read first and read largest. */}
        <div className="panel-raised px-5 py-5">
          <p className="text-sm text-say-2">Maker WBTC delta</p>
          <p className={`num mt-2 text-[1.6rem] leading-none sm:text-[2rem] ${deltaTone}`}>
            {deltaText}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-say-3">
            {delta === null
              ? "No balance could be read for this run, so no delta is claimed."
              : "Read from the maker's balance either side of the cycle's block."}
          </p>
        </div>

        <dl className="mt-4 divide-y divide-[rgba(255,238,222,0.05)]">
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
            tone={
              settlement.receipt === "confirmed"
                ? "gain"
                : settlement.receipt === "reverted"
                  ? "loss"
                  : "muted"
            }
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
            tone={settlement.blockNumber === null ? "muted" : "default"}
          />
          <SettlementRow
            label="Maker"
            value={settlement.maker === null ? "—" : truncateAddress(settlement.maker)}
            tone={settlement.maker === null ? "muted" : "default"}
          />
          <SettlementRow
            label="Maker WBTC before"
            value={before === null ? "—" : amount(before)}
            tone={before === null ? "muted" : "default"}
          />
          <SettlementRow
            label="Maker WBTC after"
            value={after === null ? "—" : amount(after)}
            tone={after === null ? "muted" : "default"}
          />
        </dl>

        {settlement.balanceNote === null ? (
          <p className="mt-4 text-xs leading-relaxed text-say-3">
            Balances read with <code className="num">balanceOf</code> at blocks{" "}
            {settlement.blockNumber === null
              ? "—"
              : `${(settlement.blockNumber - 1n).toString()} and ${settlement.blockNumber.toString()}`}
            .
          </p>
        ) : (
          <CautionNote>{settlement.balanceNote}</CautionNote>
        )}
      </div>
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
        ? "The cycle was broadcast, but no receipt could be read in this browser, so treat it as submitted, not settled."
        : STATUS_COPY[snapshot.state];

  /*
    Progress is derived from evidence, never from optimism: an opportunity on
    screen proves the scan ran, a prepared route proves the API built one, a
    settlement proves something was broadcast. Failure is only pinned to a step
    when no other step could have been the one that failed.
  */
  const broadcast = settlement !== null || snapshot.txHash !== null;
  const stepFacts = [
    {
      label: "Scan",
      done: opportunity !== null || snapshot.state === "NO_OPPORTUNITY",
      active: scanning,
    },
    {
      label: "Prepare route",
      done: prepared !== null,
      active: snapshot.state === "PREPARING_ROUTE",
    },
    {
      label: "Simulate",
      done: broadcast || snapshot.state === "EXECUTING" || snapshot.state === "CONFIRMED",
      active: snapshot.state === "SIMULATING",
    },
    { label: "Broadcast", done: broadcast, active: snapshot.state === "EXECUTING" },
    { label: "Confirm", done: snapshot.state === "CONFIRMED", active: false },
  ];
  const failedStep: number | null =
    snapshot.state !== "FAILED"
      ? null
      : opportunity === null
        ? 0
        : prepared === null
          ? 1
          : settlement === null
            ? null
            : 4;
  const steps = stepFacts.map((step, index) => ({
    label: step.label,
    tone: (index === failedStep
      ? "failed"
      : step.active
        ? "active"
        : step.done
          ? "done"
          : "pending") as StepTone,
  }));

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
    <Page>
      <PageHead
        title="Vortex Grow"
        lead="Only execute when the position ends with more WBTC. A custom Aqua app temporarily pulls maker WBTC, runs one atomic cycle across the Vortex PermAMM and an external venue, then returns principal plus profit."
      />

      {source === "fixture" ? <FixtureNotice className="mb-6" /> : null}

      {strategyIsPlaceholder ? (
        <div role="status" className="panel-raised mb-6 flex gap-3 p-4">
          <span
            aria-hidden="true"
            className="mt-[7px] inline-block size-[6px] shrink-0 rotate-45 bg-warn"
          />
          <p className="text-sm leading-relaxed text-say-2">
            <span className="text-warn">Placeholder strategy hash.</span> Scans
            are sent for <span className="num text-say-1">{truncateAddress(strategyHash)}</span>,
            which exists only in this app: a live API answers{" "}
            <span className="num text-say-1">STRATEGY_NOT_FOUND</span> for it. Set{" "}
            <span className="num text-say-1">NEXT_PUBLIC_DEMO_GROW_STRATEGY_HASH</span>{" "}
            to the seeded Grow strategy hash for this deployment to scan the real
            one.
          </p>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-8">
        <div className="space-y-6">
          <form
            className="panel p-5"
            onSubmit={(event) => {
              event.preventDefault();
              handleScan();
            }}
          >
            <label htmlFor="grow-principal" className="block text-sm text-say-2">
              Principal
            </label>
            {/* Money is the loudest thing on this form, so the amount is set
                well above every label around it. */}
            <div className="panel-raised mt-2.5 flex items-center gap-3 px-4 py-3">
              <input
                id="grow-principal"
                name="grow-principal"
                type="text"
                size={1}
                inputMode="decimal"
                autoComplete="off"
                value={principalInput}
                onChange={(event) => {
                  setPrincipalInput(event.target.value);
                  setInputError(null);
                }}
                aria-invalid={inputError !== null}
                className="num w-full min-w-0 bg-transparent text-xl text-say-1 outline-none placeholder:text-say-3"
              />
              <span className="shrink-0 text-sm text-say-2">WBTC</span>
            </div>

            {inputError === null ? null : (
              <p role="alert" className="mt-3 text-sm leading-relaxed text-loss">
                {inputError}
              </p>
            )}

            <Action
              type="submit"
              disabled={scanning || running}
              busy={scanning}
              className="mt-4 w-full"
            >
              {scanning ? "Scanning…" : "Scan for opportunity"}
            </Action>
          </form>

          {isConnected ? null : (
            <p className="panel px-5 py-4 text-sm leading-relaxed text-say-2">
              Scanning works without a wallet. Connect one on chain{" "}
              <span className="num text-say-1">{chainId}</span> to broadcast the
              cycle yourself when the API has no solver key.
            </p>
          )}

          <section aria-live="polite" className="panel">
            <header className="px-5 pt-5">
              <h2 className="text-[15px] text-say-1">Run status</h2>
            </header>

            <div className="p-5">
              <ProgressRail steps={steps} />

              <div className="mt-5">
                {snapshot.state === "FAILED" ? (
                  <p role="alert" className="text-sm leading-relaxed text-loss">
                    {snapshot.error ?? "The cycle failed."}
                  </p>
                ) : snapshot.state === "NO_OPPORTUNITY" ? (
                  <p className="text-sm leading-relaxed text-say-1">
                    {noOpportunityReason ??
                      (expiredByTimeout
                        ? "That opportunity expired before it was executed. Scan again to re-price it."
                        : "The scan returned no opportunity.")}
                  </p>
                ) : (
                  <p
                    className={`text-sm leading-relaxed ${
                      // Green only for a receipt actually read: a broadcast the
                      // browser could not verify does not get to look settled.
                      snapshot.state === "CONFIRMED" &&
                      settlement?.receipt === "confirmed"
                        ? "text-gain"
                        : "text-say-1"
                    }`}
                  >
                    {statusMessage}
                  </p>
                )}
              </div>

              {simulationNote === null ? null : (
                <CautionNote>{simulationNote}</CautionNote>
              )}

              {executionNote === null ? null : (
                <CautionNote>{executionNote}</CautionNote>
              )}

              {snapshot.txHash === null ? null : (
                <p className="mt-4 text-xs leading-relaxed text-say-2">
                  Transaction:{" "}
                  <span className="num break-all text-say-1">{snapshot.txHash}</span>
                </p>
              )}

              {prepared === null ? null : (
                <div className="panel-raised mt-5 px-4 py-4">
                  {/* Only a live prepare ever reaches this state — the fixture
                      fallback stops the flow — so the badge says so. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="text-sm text-say-1">Prepared route</h3>
                    <SourceBadge source="live" variant="response" />
                  </div>
                  <div className="mt-2">
                    <Rows>
                      <Row
                        label="Route hash"
                        value={
                          <span title={prepared.routeHash}>
                            {truncateAddress(prepared.routeHash)}
                          </span>
                        }
                      />
                      <Row label="Gas estimate" value={prepared.gasEstimate ?? "—"} />
                      <Row
                        label="Minimum final"
                        value={`${formatTokenAmount(BigInt(prepared.minFinalAsset), WBTC.decimals)} WBTC`}
                      />
                    </Rows>
                  </div>
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
                {snapshot.state === "OPPORTUNITY_READY" || running ? (
                  <>
                    <Action
                      onClick={() => void handlePrepare()}
                      disabled={running}
                      busy={running}
                    >
                      {running ? "Running cycle…" : "Prepare route & run cycle"}
                    </Action>
                    <QuietAction onClick={() => void refresh()} disabled={running}>
                      Refresh
                    </QuietAction>
                  </>
                ) : null}
                {snapshot.state === "NO_OPPORTUNITY" ||
                snapshot.state === "FAILED" ||
                snapshot.state === "CONFIRMED" ? (
                  <Action onClick={handleScan}>Scan again</Action>
                ) : null}
                {snapshot.state === "CONFIRMED" || snapshot.state === "FAILED" ? (
                  <QuietAction
                    onClick={() => {
                      setExecutionNote(null);
                      resetExecution();
                      reset();
                    }}
                  >
                    Start over
                  </QuietAction>
                ) : null}
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          {settlement === null ? null : <SettlementPanel settlement={settlement} />}

          {opportunity === null || source === null ? (
            <section className="panel flex flex-col items-center justify-center px-6 py-16 text-center">
              {/* The mark sits bare on the surface: no tile, no chip. */}
              <VortexMark size={40} className="text-cu-dim" />
              <p className="mt-6 text-base text-say-1">No opportunity on screen.</p>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-say-2">
                Scan to price a cycle against current venue liquidity. Nothing is
                quoted until you do, so there is no profit figure to show yet.
              </p>
            </section>
          ) : (
            <>
              <ProfitBreakdown
                principal={BigInt(opportunity.principalAmount)}
                grossProfit={BigInt(opportunity.estimatedGrossProfit)}
                performanceFee={BigInt(opportunity.performanceFee)}
                source={source}
              />
              <OpportunityCard
                opportunity={opportunity}
                source={source}
                secondsRemaining={secondsRemaining}
              />
            </>
          )}
        </div>
      </div>

      <details open className="group panel mt-8 p-5 sm:p-6">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 font-display text-[15px] text-say-1 marker:content-none [&::-webkit-details-marker]:hidden">
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="size-3 shrink-0 text-say-3 group-open:rotate-90 motion-safe:transition-transform motion-safe:duration-200"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 2.5 L8 6 L4 9.5" />
          </svg>
          How the cycle works
        </summary>

        <div className="mt-6 grid items-center gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-12">
          <CycleDiagram />

          <div className="max-w-md">
            <p className="text-[15px] leading-relaxed text-say-2">
              Vortex borrows the maker&rsquo;s WBTC, trades one leg here and one
              on an external venue, and can only settle if the maker ends with
              more WBTC than it started with. Otherwise the whole transaction
              reverts and nothing moved.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-say-3">
              The contract keeps 20% of realised profit. Principal is never
              touched.
            </p>
          </div>
        </div>
      </details>
    </Page>
  );
}
