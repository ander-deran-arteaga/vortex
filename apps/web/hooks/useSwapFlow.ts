"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { USDC, WBTC, type ExchangeQuoteResponse } from "@vortex/shared";
import { FIXTURE_STRATEGY_HASH, fetchExchangeQuote } from "@/lib/api";
import type { DataSource } from "@/lib/api/source";
import {
  canSend,
  initialSwapSnapshot,
  swapReducer,
  type SwapEvent,
} from "@/lib/machines/swapMachine";
import { secondsUntil } from "@/lib/swap-selection";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const LOCAL_FORK_CHAIN_ID = 31337;

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
            strategyHash: FIXTURE_STRATEGY_HASH,
            tokenIn: WBTC.address,
            tokenOut: USDC.address,
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
        dispatchIfAllowed({
          type: "QUOTE_FAILURE",
          reason: error instanceof Error ? error.message : "Quote request failed",
        });
      }
    },
    [address, chain?.id, dispatchIfAllowed],
  );

  // Countdown starts only after mount, so the server never renders a
  // time-derived value and hydration cannot mismatch.
  useEffect(() => {
    if (quote === null) {
      setSecondsRemaining(null);
      return;
    }
    const tick = () => {
      const remaining = secondsUntil(quote.expiresAt, Date.now());
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        dispatchIfAllowed({ type: "QUOTE_EXPIRED" });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
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
