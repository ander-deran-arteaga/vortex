"use client";

import { useMemo, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { WBTC } from "@vortex/shared";
import { PageHeader } from "@/components/page-header";
import { FixtureNotice } from "@/components/source-badge";
import { QuoteComparison } from "@/components/swap/quote-comparison";
import { SwapForm } from "@/components/swap/swap-form";
import { useSwapExecution } from "@/hooks/useSwapExecution";
import { useSwapFlow } from "@/hooks/useSwapFlow";
import { parseTokenAmount, truncateAddress } from "@/lib/format";
import type { SwapState } from "@/lib/machines/swapMachine";
import { STRATEGY_HASHES } from "@/lib/strategy-config";

const SUPPORTED_CHAIN_IDS = [42161, 31337];

/** What the user is waiting on, per machine state. */
const STEP_COPY: Record<SwapState, string | null> = {
  IDLE: null,
  FETCHING_QUOTE: "Requesting quotes from Aqua and the Uniswap API…",
  QUOTE_READY: null,
  APPROVAL_REQUIRED: "Approve the token allowance in your wallet to continue.",
  SIGNING_PERMIT: "Sign the Permit2 message in your wallet.",
  BUILDING_TRANSACTION: "Building the execution transaction…",
  SIMULATING: "Simulating the transaction before you sign it…",
  AWAITING_WALLET: "Confirm the transaction in your wallet.",
  SUBMITTED: "Transaction submitted — waiting for the network.",
  CONFIRMING: "Waiting for confirmation…",
  CONFIRMED: "Swap confirmed.",
  EXPIRED: "This quote expired. Request a fresh one to continue.",
  FAILED: null,
};

/**
 * Shown only when the live API rejected a quote AND we are still pointed at a
 * placeholder strategy hash. That combination has exactly one cause worth
 * telling the user about, so this turns an opaque `AQUA_ORDER_UNAVAILABLE`
 * into a one-line fix. It never appears on a fixture-backed response —
 * `FixtureNotice` already owns that case — nor while quotes are succeeding.
 */
function PlaceholderStrategyNotice() {
  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200"
    >
      <p className="mb-2">
        <span className="font-medium text-amber-300">
          Placeholder strategy hash.
        </span>{" "}
        This page is quoting against{" "}
        <span
          className="font-mono tabular-nums"
          title={STRATEGY_HASHES.swap}
        >
          {truncateAddress(STRATEGY_HASHES.swap)}
        </span>
        , a placeholder that exists only in this app&rsquo;s fixtures. No such
        strategy was ever shipped on the chain this API serves, so it answers{" "}
        <span className="font-mono">AQUA_ORDER_UNAVAILABLE</span> (or{" "}
        <span className="font-mono">NO_VENUE_AVAILABLE</span>) instead of
        pricing the trade. The comparison is unavailable, not unfavourable.
      </p>
      <p>
        Set <span className="font-mono">NEXT_PUBLIC_DEMO_STRATEGY_HASH</span> to
        the strategy hash the demo seeding actually produced, then restart the
        web app so the value is rebuilt into the client.
      </p>
    </div>
  );
}

export function SwapClient() {
  const [amountInput, setAmountInput] = useState("");
  const [slippageBps, setSlippageBps] = useState(30);
  const [inputError, setInputError] = useState<string | null>(null);
  const [executionNote, setExecutionNote] = useState<string | null>(null);

  const {
    snapshot,
    quote,
    source,
    secondsRemaining,
    requestQuote,
    proceed,
    reset,
    dispatch,
  } = useSwapFlow();
  const { execute, approve, approvalNeed } = useSwapExecution(dispatch);
  const { address, chain, isConnected } = useAccount();
  const { switchChain, isPending: switchPending } = useSwitchChain();

  const parsedAmount = useMemo(() => {
    if (amountInput.trim() === "") {
      return null;
    }
    try {
      return parseTokenAmount(amountInput, WBTC.decimals);
    } catch {
      return null;
    }
  }, [amountInput]);

  const wrongChain = isConnected && chain !== undefined && !SUPPORTED_CHAIN_IDS.includes(chain.id);
  const quoting = snapshot.state === "FETCHING_QUOTE";
  const expired = snapshot.state === "EXPIRED" || secondsRemaining === 0;
  const stepMessage = STEP_COPY[snapshot.state];

  const handleSubmit = () => {
    setExecutionNote(null);
    if (amountInput.trim() === "") {
      setInputError("Enter the amount of WBTC you want to sell.");
      return;
    }
    if (parsedAmount === null) {
      setInputError(`Enter a valid WBTC amount with at most ${WBTC.decimals} decimals.`);
      return;
    }
    if (parsedAmount === 0n) {
      setInputError("Enter an amount greater than zero.");
      return;
    }
    setInputError(null);
    void requestQuote({ amountIn: parsedAmount, slippageBps });
  };

  const handleExecute = () => {
    // A fixture quote has no session the builder would recognise, so there is
    // nothing to sign — say so rather than sending a doomed request.
    if (source === "fixture") {
      setExecutionNote(
        "Execution needs the live Vortex API — this quote came from fixtures, so there is no transaction to sign. Start the API to execute for real.",
      );
      return;
    }
    if (quote === null || address === undefined || parsedAmount === null) {
      return;
    }
    setExecutionNote(null);
    proceed();
    void execute(quote, address, parsedAmount);
  };

  const canExecute =
    snapshot.state === "QUOTE_READY" && !expired && isConnected && !wrongChain;

  // The live API rejected the QUOTE itself (`quote === null` in FAILED rules
  // out a failure further down the flow, where a quote did succeed), and we are
  // still on a placeholder hash. A fixture-backed response can never satisfy
  // this — `source` is "live" only when the API actually answered.
  const showPlaceholderNotice =
    STRATEGY_HASHES.isPlaceholder &&
    source === "live" &&
    quote === null &&
    snapshot.state === "FAILED";

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Best execution"
        title="Vortex Swap"
        description="Aqua quotes your trade against its maker inventory while the Uniswap API quotes the same trade against external liquidity. Whichever nets you more after gas is the one that executes."
      />

      {source === "fixture" ? <FixtureNotice className="mb-6" /> : null}

      {showPlaceholderNotice ? <PlaceholderStrategyNotice /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <SwapForm
            amountInput={amountInput}
            onAmountChange={(value) => {
              setAmountInput(value);
              setInputError(null);
            }}
            slippageBps={slippageBps}
            onSlippageChange={setSlippageBps}
            onSubmit={handleSubmit}
            disabled={quoting}
            busy={quoting}
            error={inputError}
          />

          {!isConnected ? (
            <p className="rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
              Quotes work without a wallet. Connect one to execute a swap.
            </p>
          ) : null}

          {wrongChain ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              <p className="mb-2">
                Your wallet is on an unsupported network. Vortex runs on
                Arbitrum One and the local Arbitrum fork.
              </p>
              <button
                type="button"
                onClick={() => switchChain({ chainId: 42161 })}
                disabled={switchPending}
                aria-busy={switchPending}
                className="rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
              >
                {switchPending ? "Switching…" : "Switch to Arbitrum One"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          {quote === null || source === null ? (
            <div className="rounded-xl border border-dashed border-zinc-800 px-6 py-12 text-center text-sm text-zinc-500">
              Enter an amount and request a quote to compare Aqua against the
              Uniswap API.
            </div>
          ) : (
            <QuoteComparison
              quote={quote}
              source={source}
              secondsRemaining={secondsRemaining}
            />
          )}

          <section
            aria-live="polite"
            className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
          >
            <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-zinc-500">
              Execution
            </h2>

            {snapshot.state === "FAILED" ? (
              <p role="alert" className="mb-4 text-sm text-red-400">
                {snapshot.error ?? "The swap failed."}
              </p>
            ) : stepMessage === null ? (
              <p className="mb-4 text-sm text-zinc-400">
                {quote === null
                  ? "No quote requested yet."
                  : "Review the comparison, then execute through the winning venue."}
              </p>
            ) : (
              <p className="mb-4 text-sm text-zinc-300">{stepMessage}</p>
            )}

            {snapshot.txHash === null ? null : (
              <p className="mb-4 font-mono text-xs tabular-nums text-zinc-400">
                Transaction: {snapshot.txHash}
              </p>
            )}

            {approvalNeed === null ? null : (
              <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                <p className="mb-2">
                  The router needs an allowance for this trade before it can
                  settle.
                </p>
                <button
                  type="button"
                  onClick={() => void approve()}
                  className="rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/10"
                >
                  Approve WBTC
                </button>
              </div>
            )}

            {executionNote === null ? null : (
              <p className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
                {executionNote}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              {snapshot.state === "CONFIRMED" || snapshot.state === "FAILED" ||
              snapshot.state === "EXPIRED" ? (
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
              ) : (
                <button
                  type="button"
                  onClick={handleExecute}
                  disabled={!canExecute}
                  className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Execute swap
                </button>
              )}
            </div>

            {address === undefined ? null : (
              <p className="mt-4 text-xs text-zinc-600">
                Executing as {address}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
