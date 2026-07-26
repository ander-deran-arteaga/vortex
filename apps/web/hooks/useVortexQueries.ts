"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { SupportedChainId } from "@vortex/shared";
import {
  fetchConfig,
  fetchExecutions,
  fetchStrategyHealth,
} from "@/lib/api/endpoints";

/** Reads are polled gently; nothing here drives money movement on its own. */
const READ_STALE_MS = 15_000;

export function useConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: () => fetchConfig(),
    staleTime: READ_STALE_MS,
  });
}

/**
 * The chain every quote, scan and prepare is priced on.
 *
 * It comes from `GET /api/v1/config` and never from the wallet. A wallet on
 * Arbitrum One talking to a server running the local fork used to make the
 * frontend ask for a 42161 quote from a 31337 server, which the API rejected
 * with `CHAIN_MISMATCH`. Pricing is a property of the server; the wallet's
 * chain only matters when something is broadcast, and that is handled where
 * the transaction is sent.
 *
 * While config is in flight there is nothing authoritative to report, so this
 * returns undefined rather than guessing — callers hold the request.
 */
export function useServerChainId(): SupportedChainId | undefined {
  return useConfig().data?.data.chainId;
}

/**
 * Resolves that same chain id at request time, awaiting the config query if it
 * has not landed yet. A quote requested in the first moments after load must
 * not fail for want of a value that is already in flight, so this joins the
 * existing request rather than racing it. A config request that genuinely
 * fails rejects here, and the caller reports the API's own reason.
 */
export function useResolveServerChainId(): () => Promise<SupportedChainId> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    const config = await queryClient.ensureQueryData({
      queryKey: ["config"],
      queryFn: () => fetchConfig(),
      staleTime: READ_STALE_MS,
    });
    return config.data.chainId;
  }, [queryClient]);
}

export function useStrategyHealth(strategyHash: string | undefined) {
  return useQuery({
    queryKey: ["strategy-health", strategyHash],
    queryFn: () => fetchStrategyHealth(strategyHash as string),
    enabled: Boolean(strategyHash),
    staleTime: READ_STALE_MS,
  });
}

export function useExecutions() {
  return useQuery({
    // Date.now() lives in the query function, never in render, so server and
    // client markup cannot disagree.
    queryKey: ["executions"],
    queryFn: () => fetchExecutions({ now: Date.now() }),
    staleTime: READ_STALE_MS,
  });
}
