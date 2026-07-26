"use client";

import { useMemo, useState, type ReactNode } from "react";
import { erc20Abi } from "viem";
import { useAccount, useReadContract, useSwitchChain } from "wagmi";
import { WBTC } from "@vortex/shared";
import { FixtureNotice } from "@/components/source-badge";
import { QuoteComparison } from "@/components/swap/quote-comparison";
import { SwapForm } from "@/components/swap/swap-form";
import { Action, Page, PageHead, Panel, StatusMark } from "@/components/ui/primitives";
import { VortexMark } from "@/components/ui/vortex-mark";
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
  SUBMITTED: "Transaction submitted. Waiting for the network.",
  CONFIRMING: "Waiting for confirmation…",
  CONFIRMED: "Swap confirmed.",
  EXPIRED: "This quote expired. Request a fresh one to continue.",
  FAILED: null,
};

/** A warn-toned notice: a mark, then the text. No tinted box, no bright edge. */
function Caution({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`panel-raised flex gap-3 p-4 ${className}`}>
      <StatusMark tone="warn" className="mt-[7px] shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A quiet text action carrying the caution tone, never an outlined twin. */
function CautionAction({
  children,
  onClick,
  disabled = false,
  busy = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={busy}
      className="mt-2 text-sm font-medium text-warn underline-offset-4 transition-colors duration-150 hover:text-cu disabled:cursor-not-allowed disabled:text-say-3"
    >
      {children}
    </button>
  );
}

/**
 * Shown only when the live API rejected a quote AND we are still pointed at a
 * placeholder strategy hash. That combination has exactly one cause worth
 * telling the user about, so this turns an opaque `AQUA_ORDER_UNAVAILABLE`
 * into a one-line fix. It never appears on a fixture-backed response:
 * `FixtureNotice` already owns that case, nor while quotes are succeeding.
 */
function PlaceholderStrategyNotice() {
  return (
    <div role="status" className="mb-6">
      <Caution>
        <p className="text-sm leading-relaxed text-say-2">
          <span className="text-warn">Placeholder strategy hash.</span> This
          page is quoting against{" "}
          <span className="num text-say-1" title={STRATEGY_HASHES.swap}>
            {truncateAddress(STRATEGY_HASHES.swap)}
          </span>
          , a placeholder that exists only in this app&rsquo;s fixtures. No such
          strategy was ever shipped on the chain this API serves, so it answers{" "}
          <span className="num text-say-1">AQUA_ORDER_UNAVAILABLE</span> (or{" "}
          <span className="num text-say-1">NO_VENUE_AVAILABLE</span>) instead of
          pricing the trade. The comparison is unavailable, not unfavourable.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-say-2">
          Set{" "}
          <span className="num text-say-1">NEXT_PUBLIC_DEMO_STRATEGY_HASH</span>{" "}
          to the strategy hash the demo seeding actually produced, then restart
          the web app so the value is rebuilt into the client.
        </p>
      </Caution>
    </div>
  );
}

/**
 * The comparison slot before there is a comparison. Each variant says what
 * would be here and why it is not; the failure variant defers to the execution
 * panel, which carries the API's own error code verbatim.
 */
function ComparisonPlaceholder({ status }: { status: "empty" | "loading" | "failed" }) {
  const copy =
    status === "loading"
      ? "Pricing this trade at both venues. The comparison appears as soon as Aqua and the Uniswap API answer."
      : status === "failed"
        ? "No comparison to show: this request did not come back with a price. The reason, as the API reported it, is in the execution panel."
        : "Nothing to compare yet. Enter a WBTC amount and request a quote: Aqua prices it against maker inventory, the Uniswap API prices the same trade against external liquidity, and the higher net output after gas wins.";

  return (
    <Panel cut title="Venue comparison">
      <div className="flex flex-col items-center gap-5 px-2 py-12 text-center">
        <VortexMark
          size={36}
          className={status === "failed" ? "text-say-3/60" : "text-say-3"}
        />
        <p className="max-w-md text-[15px] leading-relaxed text-say-2">{copy}</p>
      </div>
    </Panel>
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
    tokens,
  } = useSwapFlow();
  const { execute, approve, approvalNeed } = useSwapExecution(dispatch);
  const { address, chain, isConnected } = useAccount();

  // The taker's own WBTC balance, for the Max action. Only read when a wallet
  // is connected; the field degrades to no Max rather than guessing.
  const wbtcBalance = useReadContract({
    abi: erc20Abi,
    address: tokens.wbtc.address as `0x${string}`,
    functionName: "balanceOf",
    args: address === undefined ? undefined : [address],
    query: { enabled: address !== undefined },
  });
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
    // nothing to sign. Say so rather than sending a doomed request.
    if (source === "fixture") {
      setExecutionNote(
        "Execution needs the live Vortex API: this quote came from fixtures, so there is no transaction to sign. Start the API to execute for real.",
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
  // this: `source` is "live" only when the API actually answered.
  const showPlaceholderNotice =
    STRATEGY_HASHES.isPlaceholder &&
    source === "live" &&
    quote === null &&
    snapshot.state === "FAILED";

  const failed = snapshot.state === "FAILED";
  const confirmed = snapshot.state === "CONFIRMED";
  const quoteExpired = snapshot.state === "EXPIRED";
  const terminal = failed || confirmed || quoteExpired;

  const statusTone = confirmed
    ? "gain"
    : quoteExpired
      ? "warn"
      : stepMessage === null
        ? "muted"
        : "accent";
  const statusClass = confirmed
    ? "text-[15px] leading-relaxed text-gain"
    : quoteExpired
      ? "text-sm leading-relaxed text-warn"
      : stepMessage === null
        ? "text-sm leading-relaxed text-say-2"
        : "text-sm leading-relaxed text-say-1";

  return (
    <Page>
      <PageHead
        title="Vortex Swap"
        lead="Aqua quotes your trade against its maker inventory while the Uniswap API quotes the same trade against external liquidity. Whichever nets you more after gas is the one that executes."
      />

      {source === "fixture" ? <FixtureNotice className="mb-6" /> : null}

      {showPlaceholderNotice ? <PlaceholderStrategyNotice /> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:items-start">
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
            quote={quote}
            quoteStale={expired}
            {...(wbtcBalance.data === undefined
              ? {}
              : { walletBalance: wbtcBalance.data })}
          />

          {!isConnected ? (
            <p className="px-1 text-sm leading-relaxed text-say-2">
              Quotes work without a wallet. Connect one to execute a swap.
            </p>
          ) : null}

          {wrongChain ? (
            <Caution>
              <p className="text-sm leading-relaxed text-say-2">
                Your wallet is on an unsupported network. Vortex runs on
                Arbitrum One and the local Arbitrum fork.
              </p>
              <CautionAction
                onClick={() => switchChain({ chainId: 42161 })}
                disabled={switchPending}
                busy={switchPending}
              >
                {switchPending ? "Switching…" : "Switch to Arbitrum One"}
              </CautionAction>
            </Caution>
          ) : null}
        </div>

        <div className="space-y-6">
          {quote === null || source === null ? (
            <ComparisonPlaceholder
              status={quoting ? "loading" : failed ? "failed" : "empty"}
            />
          ) : (
            <QuoteComparison
              quote={quote}
              source={source}
              secondsRemaining={secondsRemaining}
            />
          )}

          {/* Hand-rolled rather than <Panel> so the live region stays on the
              element that actually holds the changing status. */}
          <section aria-live="polite" className="panel">
            <header className="px-5 pt-5">
              <h2 className="text-[15px] text-say-1">Execution</h2>
            </header>

            <div className="p-5">
              {failed ? (
                /*
                  The mark carries the tone; the message itself stays at full
                  ink so a verbatim API error code is never hard to read.
                */
                <div role="alert" className="flex gap-3">
                  <StatusMark tone="loss" className="mt-[7px] shrink-0" />
                  <p className="min-w-0 text-sm leading-relaxed text-say-1">
                    {snapshot.error ?? "The swap failed."}
                  </p>
                </div>
              ) : (
                <div className="flex gap-3">
                  <StatusMark tone={statusTone} className="mt-[7px] shrink-0" />
                  <p className={`min-w-0 ${statusClass}`}>
                    {stepMessage === null
                      ? quote === null
                        ? "No quote requested yet."
                        : "Review the comparison, then execute through the winning venue."
                      : stepMessage}
                  </p>
                </div>
              )}

              {snapshot.txHash === null ? null : (
                <p className="mt-4 text-sm text-say-2">
                  Transaction:{" "}
                  <span className="num break-all text-say-1">{snapshot.txHash}</span>
                </p>
              )}

              {approvalNeed === null ? null : (
                <Caution className="mt-4">
                  <p className="text-sm leading-relaxed text-say-2">
                    The router needs an allowance for this trade before it can
                    settle.
                  </p>
                  <CautionAction onClick={() => void approve()}>
                    Approve WBTC
                  </CautionAction>
                </Caution>
              )}

              {executionNote === null ? null : (
                <Caution className="mt-4">
                  <p className="text-sm leading-relaxed text-say-2">
                    {executionNote}
                  </p>
                </Caution>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-4">
                {terminal ? (
                  <Action
                    onClick={() => {
                      setExecutionNote(null);
                      reset();
                    }}
                  >
                    Start over
                  </Action>
                ) : (
                  <Action onClick={handleExecute} disabled={!canExecute}>
                    Execute swap
                  </Action>
                )}
              </div>

              {address === undefined ? null : (
                <p className="mt-4 text-xs text-say-2">
                  Executing as{" "}
                  <span className="num text-say-2" title={address}>
                    {truncateAddress(address)}
                  </span>
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </Page>
  );
}
