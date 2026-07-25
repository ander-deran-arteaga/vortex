"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useAccount } from "wagmi";
import type { GrowOpportunity } from "@vortex/shared";
import {
  FIXTURE_GROW_STRATEGY_HASH,
  prepareGrowRoute,
  scanGrowOpportunity,
} from "@/lib/api";
import type { DataSource } from "@/lib/api/source";
import {
  canSendGrow,
  growReducer,
  initialGrowSnapshot,
  type GrowEvent,
} from "@/lib/machines/growMachine";
import { secondsUntil } from "@/lib/swap-selection";

const LOCAL_FORK_CHAIN_ID = 31337;

export function useGrowFlow() {
  const [snapshot, rawDispatch] = useReducer(growReducer, initialGrowSnapshot);
  const [opportunity, setOpportunity] = useState<GrowOpportunity | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [noOpportunityReason, setNoOpportunityReason] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [principalAmount, setPrincipalAmount] = useState<bigint | null>(null);

  const { chain } = useAccount();
  const sequenceRef = useRef(0);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const dispatchIfAllowed = useCallback((event: GrowEvent) => {
    if (canSendGrow(snapshotRef.current.state, event.type)) {
      rawDispatch(event);
      return true;
    }
    return false;
  }, []);

  const runScan = useCallback(
    async (principal: bigint, event: GrowEvent) => {
      if (!dispatchIfAllowed(event)) {
        return;
      }
      const sequence = ++sequenceRef.current;
      setOpportunity(null);
      setNoOpportunityReason(null);
      setSecondsRemaining(null);
      setPrincipalAmount(principal);

      try {
        const result = await scanGrowOpportunity(
          {
            chainId: chain?.id === 42161 ? 42161 : LOCAL_FORK_CHAIN_ID,
            strategyHash: FIXTURE_GROW_STRATEGY_HASH,
            principalAmount: principal.toString(),
            direction: "AUTO",
          },
          { now: Date.now() },
        );
        if (sequence !== sequenceRef.current) {
          return;
        }
        setSource(result.source);
        if (result.data.opportunityFound) {
          setOpportunity(result.data);
          dispatchIfAllowed({
            type: "OPPORTUNITY_FOUND",
            opportunityId: result.data.opportunityId,
          });
        } else {
          setNoOpportunityReason(result.data.reason);
          dispatchIfAllowed({ type: "NOTHING_FOUND" });
        }
      } catch (error) {
        if (sequence !== sequenceRef.current) {
          return;
        }
        dispatchIfAllowed({
          type: "SCAN_FAILURE",
          reason: error instanceof Error ? error.message : "Scan failed",
        });
      }
    },
    [chain?.id, dispatchIfAllowed],
  );

  const scan = useCallback(
    (principal: bigint) => runScan(principal, { type: "SCAN" }),
    [runScan],
  );

  const refresh = useCallback(() => {
    if (principalAmount === null) {
      return Promise.resolve();
    }
    return runScan(principalAmount, { type: "REFRESH" });
  }, [principalAmount, runScan]);

  const prepare = useCallback(async () => {
    if (opportunity === null || principalAmount === null) {
      return;
    }
    if (!dispatchIfAllowed({ type: "PREPARE" })) {
      return;
    }
    const sequence = ++sequenceRef.current;
    try {
      await prepareGrowRoute(opportunity.opportunityId, {
        now: Date.now(),
        principalAmount: principalAmount.toString(),
      });
      if (sequence !== sequenceRef.current) {
        return;
      }
      // ROUTE_READY moves the machine to SIMULATING. EXECUTING is entered only
      // from a real simulation against a live backend, so the flow deliberately
      // rests here rather than pretending a cycle ran.
      dispatchIfAllowed({ type: "ROUTE_READY" });
    } catch (error) {
      if (sequence !== sequenceRef.current) {
        return;
      }
      dispatchIfAllowed({
        type: "ROUTE_FAILURE",
        reason: error instanceof Error ? error.message : "Route preparation failed",
      });
    }
  }, [opportunity, principalAmount, dispatchIfAllowed]);

  // Opportunities expire after 30s; the countdown starts post-mount so the
  // server never renders a time-derived value.
  useEffect(() => {
    if (opportunity === null) {
      setSecondsRemaining(null);
      return;
    }
    const tick = () => {
      const remaining = secondsUntil(opportunity.expiresAt, Date.now());
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        dispatchIfAllowed({ type: "OPPORTUNITY_EXPIRED" });
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [opportunity, dispatchIfAllowed]);

  const reset = useCallback(() => {
    sequenceRef.current += 1;
    setOpportunity(null);
    setSource(null);
    setNoOpportunityReason(null);
    setSecondsRemaining(null);
    setPrincipalAmount(null);
    dispatchIfAllowed({ type: "RESET" });
  }, [dispatchIfAllowed]);

  return {
    snapshot,
    opportunity,
    source,
    noOpportunityReason,
    secondsRemaining,
    principalAmount,
    scan,
    refresh,
    prepare,
    reset,
  };
}
