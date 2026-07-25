"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useConfig } from "@/hooks/useVortexQueries";
import { resolveTokens } from "@/lib/tokens";
import { USDC, WBTC, type ExchangeQuoteResponse } from "@vortex/shared";
import { ApiContractError, ApiRequestError, fetchExchangeQuote } from "@/lib/api";
import type { DataSource } from "@/lib/api/source";
import {
  canSend,
  initialSwapSnapshot,
  swapReducer,
  type SwapEvent,
} from "@/lib/machines/swapMachine";
import { STRATEGY_HASHES } from "@/lib/strategy-config";
import { secondsUntil } from "@/lib/swap-selection";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOCAL_FORK_CHAIN_ID = 31337;

/**
 * The API's own code, verbatim, in front of its message. Seeing
 * `AQUA_ORDER_UNAVAILABLE` instead of a generic sentence is what lets a user
 * tell an environment gap (a strategy hash that was never shipped on this
 * chain) apart from a trade the maker simply will not price.
 */
function quoteFailureReason(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Quote request failed";
}

/**
 * An error the API itself answered with is a LIVE response — it is not the
 * fixture fallback, which only fires on `ApiUnavailableError` and never
 * reaches this path. Recording its provenance is what lets the page separate
 * "the API rejected this request" from "the API is not running".
 */
function isLiveResponseError(error: unknown): boolean {
  return error instanceof ApiRequestError || error instanceof ApiContractError;
}

export interface RequestQuoteInput {
  amountIn: bigint;
  slippageBps: number;
}

export function useSwapFlow() {
  const [snapshot, rawDispatch] = useReducer(swapReducer, initialSwapSnapshot);
  const [quote, setQuote] = useState<ExchangeQuoteResponse | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  const { address, chain } = useAccount();
  // The deployed chain reports its own token addresses; the shared constants
  // are only correct on Arbitrum One itself.
  const config = useConfig();
  const tokens = resolveTokens(config.data?.data);

  // Every in-flight quote carries a sequence number. A response whose sequence
  // is stale (the user re-quoted, or reset) is dropped instead of overwriting
  // fresher state — otherwise a slow first request can clobber a fast second.
  const sequenceRef = useRef(0);

  /**
   * All dispatches go through the machine's own guard. An async resolution
   * that arrives after the state moved on (expiry, reset) is a no-op rather
   * than an illegal transition.
   */
  const dispatch = useCallback((event: SwapEvent) => {
    rawDispatch(event);
  }, []);

  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const dispatchIfAllowed = useCallback((event: SwapEvent) => {
    if (canSend(snapshotRef.current.state, event.type)) {
      rawDispatch(event);
      return true;
    }
    return false;
  }, []);

  const requestQuote = useCallback(
    async ({ amountIn, slippageBps }: RequestQuoteInput) => {
      if (!dispatchIfAllowed({ type: "REQUEST_QUOTE" })) {
        return;
      }
      const sequence = ++sequenceRef.current;
      setQuote(null);
      setSource(null);
      setSecondsRemaining(null);

      try {
        const result = await fetchExchangeQuote(
          {
            chainId: chain?.id === 42161 ? 42161 : LOCAL_FORK_CHAIN_ID,
            strategyHash: STRATEGY_HASHES.swap,
            tokenIn: tokens.wbtc.address,
            tokenOut: tokens.usdc.address,
            amountIn: amountIn.toString(),
            taker: address ?? ZERO_ADDRESS,
            slippageBps,
          },
          { now: Date.now() },
        );
        if (sequence !== sequenceRef.current) {
          return;
        }
        setQuote(result.data);
        setSource(result.source);
        dispatchIfAllowed({
          type: "QUOTE_SUCCESS",
          quoteId: result.data.quoteSessionId,
          venue: result.data.selectedVenue,
        });
      } catch (error) {
        if (sequence !== sequenceRef.current) {
          return;
        }
        if (isLiveResponseError(error)) {
          setSource("live");
        }
        dispatchIfAllowed({
          type: "QUOTE_FAILURE",
          reason: quoteFailureReason(error),
        });
      }
    },
    [address, chain?.id, dispatchIfAllowed, tokens.wbtc.address, tokens.usdc.address],
  );

  // Countdown starts only after mount, so the server never renders a
  // time-derived value and hydration cannot mismatch.
  useEffect(() => {
    if (quote === null) {
      setSecondsRemaining(null);
      return;
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const remaining = secondsUntil(quote.expiresAt, Date.now());
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        dispatchIfAllowed({ type: "QUOTE_EXPIRED" });
        // Nothing left to count down; stop rather than ticking forever.
        if (timer !== undefined) clearInterval(timer);
      }
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [quote, dispatchIfAllowed]);

  const proceed = useCallback(() => {
    if (quote === null) {
      return;
    }
    if (quote.execution.kind === "AQUA_SWAPVM") {
      dispatchIfAllowed({ type: "PROCEED" });
      return;
    }
    dispatchIfAllowed(
      quote.execution.approvalRequired
        ? { type: "APPROVAL_NEEDED" }
        : { type: "PERMIT_REQUIRED" },
    );
  }, [quote, dispatchIfAllowed]);

  const reset = useCallback(() => {
    // Bumping the sequence orphans any in-flight response.
    sequenceRef.current += 1;
    setQuote(null);
    setSource(null);
    setSecondsRemaining(null);
    dispatchIfAllowed({ type: "RESET" });
  }, [dispatchIfAllowed]);

  return {
    snapshot,
    quote,
    source,
    secondsRemaining,
    requestQuote,
    proceed,
    reset,
    dispatch,
    isConnected: Boolean(address),
    chainId: chain?.id,
  };
}
