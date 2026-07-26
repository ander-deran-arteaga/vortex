"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig, useServerChainId } from "@/hooks/useVortexQueries";
import { resolveTokens } from "@/lib/tokens";
import { STRATEGY_HASHES } from "@/lib/strategy-config";
import {
  BinanceUnavailableError,
  fetchBinanceBook,
  type BinanceBook,
} from "@/lib/market/binance";
import { sampleVortex, type VortexSamples } from "@/lib/market/vortex";

/**
 * Two feeds on two clocks.
 *
 * Binance is one cheap public request, so it refreshes every four seconds and
 * the page always shows a live top of book. A Vortex pass is twelve quotes and
 * each one makes a real Uniswap Trade API call, so it runs on a much slower
 * loop — fast enough to be live, slow enough not to hammer a rate-limited key.
 *
 * Neither feed can mask the other: each carries its own timestamp and its own
 * failure, and a feed that is down renders as absent rather than stale.
 */
const BINANCE_POLL_MS = 4_000;
const VORTEX_POLL_MS = 30_000;

export interface MarketComparison {
  book: BinanceBook | null;
  binanceError: string | null;
  vortex: VortexSamples | null;
  vortexError: string | null;
  /** True only for the first load, so a refresh never blanks the page. */
  loading: boolean;
  refresh: () => void;
}

export function useMarketComparison(): MarketComparison {
  const [book, setBook] = useState<BinanceBook | null>(null);
  const [binanceError, setBinanceError] = useState<string | null>(null);
  const [vortex, setVortex] = useState<VortexSamples | null>(null);
  const [vortexError, setVortexError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const config = useConfig();
  const chainId = useServerChainId();
  const tokens = resolveTokens(config.data?.data);
  const wbtc = tokens.wbtc.address;
  const usdc = tokens.usdc.address;

  // A pass in flight when the next one starts would interleave twelve requests
  // with twelve more; the ref lets a new pass abandon the old one cleanly.
  const passRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const next = await fetchBinanceBook(controller.signal);
        if (!cancelled) {
          setBook(next);
          setBinanceError(null);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        // The previous book stays on screen only if it is labelled stale by the
        // timestamp already rendered beside it; the error says what happened.
        setBinanceError(
          error instanceof BinanceUnavailableError
            ? error.message
            : "Binance could not be reached",
        );
      }
    };

    void poll();
    const id = setInterval(() => void poll(), BINANCE_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (chainId === undefined) {
      return;
    }
    let cancelled = false;
    const controller = new AbortController();

    const run = async () => {
      const pass = ++passRef.current;
      try {
        const next = await sampleVortex(
          { chainId, strategyHash: STRATEGY_HASHES.swap, wbtc, usdc },
          controller.signal,
        );
        if (!cancelled && pass === passRef.current) {
          setVortex(next);
          setVortexError(null);
        }
      } catch (error) {
        if (!cancelled && pass === passRef.current) {
          setVortexError(
            error instanceof Error ? error.message : "the Vortex API could not be reached",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    const id = setInterval(() => void run(), VORTEX_POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [chainId, wbtc, usdc, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { book, binanceError, vortex, vortexError, loading, refresh };
}
