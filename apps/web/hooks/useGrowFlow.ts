"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { useAccount } from "wagmi";
import type { GrowOpportunity, GrowPrepareResponse } from "@vortex/shared";
import {
  ApiContractError,
  ApiRequestError,
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
import { STRATEGY_HASHES } from "@/lib/strategy-config";
import { secondsUntil } from "@/lib/swap-selection";

const LOCAL_FORK_CHAIN_ID = 31337 as const;
const ARBITRUM_CHAIN_ID = 42161 as const;

/**
 * Which chain the scan, the prepare and the eventual broadcast all target.
 * Shared with `useGrowExecution` so the transaction is simulated on the same
 * chain it was priced on.
 */
export function growChainId(
  walletChainId: number | undefined,
): typeof ARBITRUM_CHAIN_ID | typeof LOCAL_FORK_CHAIN_ID {
  return walletChainId === ARBITRUM_CHAIN_ID ? ARBITRUM_CHAIN_ID : LOCAL_FORK_CHAIN_ID;
}

/**
 * The API's own code, verbatim, in front of its message — `GROW_UNAVAILABLE`,
 * `STRATEGY_NOT_FOUND`, `OPPORTUNITY_EXPIRED`, `GROW_SIMULATION_FAILED`. The
 * code is what separates "Grow is not deployed on this chain" from "this
 * cycle is not profitable".
 */
function apiFailureReason(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof ApiContractError) {
    return `The API answered with a payload that does not match the shared schema (${error.path}).`;
  }
  return error instanceof Error ? error.message : fallback;
}

export function useGrowFlow() {
  const [snapshot, rawDispatch] = useReducer(growReducer, initialGrowSnapshot);
  const [opportunity, setOpportunity] = useState<GrowOpportunity | null>(null);
  const [source, setSource] = useState<DataSource | null>(null);
  const [prepared, setPrepared] = useState<GrowPrepareResponse | null>(null);
  const [noOpportunityReason, setNoOpportunityReason] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [principalAmount, setPrincipalAmount] = useState<bigint | null>(null);
  const [expiredByTimeout, setExpiredByTimeout] = useState(false);

  const { chain } = useAccount();
  const chainId = growChainId(chain?.id);
  const sequenceRef = useRef(0);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  /**
   * Every dispatch goes through the machine's own transition table, so an
   * event the current state does not accept is never sent. The ref advances
   * with the same pure reducer the store uses, so back-to-back dispatches
   * inside one async step (SIMULATION_SUCCESS then EXECUTION_CONFIRMED) are
   * guarded against the state they will actually be in, not a stale render.
   */
  const dispatchIfAllowed = useCallback((event: GrowEvent) => {
    const current = snapshotRef.current;
    if (!canSendGrow(current.state, event.type)) {
      return false;
    }
    snapshotRef.current = growReducer(current, event);
    rawDispatch(event);
    return true;
  }, []);

  const dispatch = useCallback(
    (event: GrowEvent) => {
      dispatchIfAllowed(event);
    },
    [dispatchIfAllowed],
  );

  const runScan = useCallback(
    async (principal: bigint, event: GrowEvent) => {
      if (!dispatchIfAllowed(event)) {
        return;
      }
      const sequence = ++sequenceRef.current;
      setOpportunity(null);
      setSource(null);
      setPrepared(null);
      setNoOpportunityReason(null);
      setSecondsRemaining(null);
      setExpiredByTimeout(false);
      setPrincipalAmount(principal);

      try {
        const result = await scanGrowOpportunity(
          {
            chainId,
            // The real seeded strategy when the environment names it; the
            // fixture placeholder otherwise, which a live API rejects with
            // STRATEGY_NOT_FOUND rather than pricing something that does not
            // exist.
            strategyHash: STRATEGY_HASHES.grow,
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
        // `source` stays null: nothing from this response is on screen, and a
        // badge with no data behind it would be noise. The API's own code
        // travels in the reason instead.
        dispatchIfAllowed({
          type: "SCAN_FAILURE",
          reason: apiFailureReason(error, "Scan failed"),
        });
      }
    },
    [chainId, dispatchIfAllowed],
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

  /**
   * Prepares the route and returns it so the caller can simulate and execute
   * the exact transaction the API built. Returns null when nothing executable
   * came back — the machine has already been moved to FAILED with the reason
   * in that case, so the user always has an exit.
   */
  const prepare = useCallback(async (): Promise<GrowPrepareResponse | null> => {
    if (opportunity === null || principalAmount === null) {
      return null;
    }
    if (!dispatchIfAllowed({ type: "PREPARE" })) {
      return null;
    }
    const sequence = ++sequenceRef.current;
    try {
      const result = await prepareGrowRoute(opportunity.opportunityId, {
        now: Date.now(),
        principalAmount: principalAmount.toString(),
      });
      if (sequence !== sequenceRef.current) {
        return null;
      }
      // The prepare call has its own provenance: the scan can be live while
      // the route falls back to a fixture. Dropping it would let fixture route
      // data render under a "Live data" badge.
      setSource(result.source);
      if (result.source === "fixture") {
        // A fixture route has calldata of "0x" against a placeholder address.
        // Simulating or broadcasting it would be theatre, so the flow stops
        // here and says why instead.
        dispatchIfAllowed({
          type: "ROUTE_FAILURE",
          reason:
            "The Vortex API is unreachable, so the route came from fixtures. A fixture route is never simulated or broadcast — start the API to run the cycle for real.",
        });
        return null;
      }
      setPrepared(result.data);
      // ROUTE_READY moves the machine to SIMULATING; the caller simulates the
      // prepared transaction and drives it on from there.
      dispatchIfAllowed({ type: "ROUTE_READY" });
      return result.data;
    } catch (error) {
      if (sequence !== sequenceRef.current) {
        return null;
      }
      // The scan's provenance is left exactly as it was: the opportunity card
      // is still on screen, and relabelling it from a *different* response
      // would be the laundering §21 forbids.
      dispatchIfAllowed({
        type: "ROUTE_FAILURE",
        reason: apiFailureReason(error, "Route preparation failed"),
      });
      return null;
    }
  }, [opportunity, principalAmount, dispatchIfAllowed]);

  // Opportunities expire after 30s; the countdown starts post-mount so the
  // server never renders a time-derived value.
  useEffect(() => {
    if (opportunity === null) {
      setSecondsRemaining(null);
      return;
    }
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => {
      const remaining = secondsUntil(opportunity.expiresAt, Date.now());
      setSecondsRemaining(remaining);
      if (remaining === 0) {
        // Only an opportunity the machine actually dropped counts as expired:
        // once the route is prepared the cycle is in flight and the window
        // passing is not what the user is waiting on.
        if (dispatchIfAllowed({ type: "OPPORTUNITY_EXPIRED" })) {
          setExpiredByTimeout(true);
        }
        if (timer !== undefined) clearInterval(timer);
      }
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [opportunity, dispatchIfAllowed]);

  const reset = useCallback(() => {
    sequenceRef.current += 1;
    setOpportunity(null);
    setSource(null);
    setPrepared(null);
    setNoOpportunityReason(null);
    setSecondsRemaining(null);
    setPrincipalAmount(null);
    setExpiredByTimeout(false);
    dispatchIfAllowed({ type: "RESET" });
  }, [dispatchIfAllowed]);

  return {
    snapshot,
    opportunity,
    source,
    prepared,
    noOpportunityReason,
    expiredByTimeout,
    secondsRemaining,
    principalAmount,
    chainId,
    strategyHash: STRATEGY_HASHES.grow,
    /** True while the UI is still quoting the fixture placeholder hash. */
    strategyIsPlaceholder: STRATEGY_HASHES.grow === FIXTURE_GROW_STRATEGY_HASH,
    scan,
    refresh,
    prepare,
    reset,
    dispatch,
  };
}
