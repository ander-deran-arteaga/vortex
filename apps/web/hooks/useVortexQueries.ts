"use client";

import { useQuery } from "@tanstack/react-query";
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
