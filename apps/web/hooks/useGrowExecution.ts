"use client";

import { useCallback, useState } from "react";
import { erc20Abi, parseEventLogs, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useSendTransaction } from "wagmi";
import {
  API_ROUTES,
  WBTC,
  zGrowExecuteResponse,
  type GrowPrepareResponse,
} from "@vortex/shared";
import { ApiRequestError, ApiUnavailableError, apiRequest } from "@/lib/api";
import type { GrowEvent } from "@/lib/machines/growMachine";
import { useServerChainId } from "@/hooks/useVortexQueries";

/**
 * The one event the cycle emits. Hand-written (matching
 * `deployments/abis/VortexCompounder.json`) so the browser reads the maker and
 * the asset out of the receipt itself instead of trusting a client-side guess:
 * balances are then read from those addresses, never assumed.
 */
export const VORTEX_GROW_EXECUTED_ABI = [
  {
    type: "event",
    name: "VortexGrowExecuted",
    anonymous: false,
    inputs: [
      { name: "strategyHash", type: "bytes32", indexed: true },
      { name: "opportunityId", type: "bytes32", indexed: true },
      { name: "maker", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: false },
      { name: "principal", type: "uint256", indexed: false },
      { name: "makerReturn", type: "uint256", indexed: false },
      { name: "grossProfit", type: "uint256", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * Who broadcast the prepared transaction.
 *
 * `SOLVER` — the API held a solver key and sent it.
 * `WALLET` — the API answered 503 SOLVER_UNAVAILABLE, which is a supported
 * mode, not a failure: `executeCompound` is permissionless (it is authorized
 * by the route signature, not by `msg.sender`), so the connected wallet
 * broadcasts the exact transaction the API prepared.
 */
export type GrowExecutionMode = "SOLVER" | "WALLET";

export interface GrowSettlement {
  mode: GrowExecutionMode;
  txHash: Hex;
  /**
   * `confirmed` only when a receipt was actually read in this browser. The
   * solver returns as soon as it broadcasts, so claiming more than that
   * without a receipt would be a fabrication.
   */
  receipt: "confirmed" | "reverted" | "unverified";
  blockNumber: bigint | null;
  maker: Address | null;
  asset: Address | null;
  assetDecimals: number;
  /** Maker asset balance one block before the cycle, read onchain. */
  makerAssetBefore: bigint | null;
  /** Maker asset balance at the cycle's block, read onchain. */
  makerAssetAfter: bigint | null;
  /** Exactly why a balance is absent. Rendered instead of a number. */
  balanceNote: string | null;
}

/**
 * `value` is schema-checked as a decimal string, but a parse that throws here
 * would strand the machine in SIMULATING with nothing to service it, so it
 * fails into a state the user can leave from instead.
 */
function parseWei(input: string): bigint | null {
  try {
    return BigInt(input);
  } catch {
    return null;
  }
}

/** viem wraps revert data; `shortMessage` is the readable reason. */
function chainErrorText(error: unknown, fallback: string): string {
  if (typeof error === "object" && error !== null && "shortMessage" in error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    if (typeof short === "string" && short.trim() !== "") {
      return short;
    }
  }
  return error instanceof Error ? error.message : fallback;
}

/**
 * The API's own code, verbatim, in front of its message. A user who sees
 * `OPPORTUNITY_NOT_PREPARED` or `GROW_EXECUTION_FAILED` can tell an
 * environment gap from a cycle the chain refused.
 */
function apiErrorText(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof ApiUnavailableError) {
    return `The Vortex API could not be reached (${error.message}). Nothing was broadcast.`;
  }
  return error instanceof Error ? error.message : fallback;
}

/**
 * Drives a prepared Grow route through simulate → execute → receipt → maker
 * balance readback, dispatching into the grow machine at each hop.
 *
 * The transaction is broadcast exactly as the API prepared it (`to`/`data`/
 * `value` are passed through untouched); the browser never rebuilds a route,
 * and no hash, balance or block number here is ever synthesised.
 */
export function useGrowExecution(dispatch: (event: GrowEvent) => void) {
  const { address, chain } = useAccount();
  const walletChainId = chain?.id;
  const chainId = useServerChainId();
  // Pinned to the chain the scan and prepare targeted. Without the pin an
  // unconnected browser would simulate a local-fork transaction against
  // Arbitrum, which fails for a reason that has nothing to do with the cycle.
  const publicClient = usePublicClient(chainId === undefined ? {} : { chainId });
  const { sendTransactionAsync } = useSendTransaction();

  const [settlement, setSettlement] = useState<GrowSettlement | null>(null);
  const [mode, setMode] = useState<GrowExecutionMode | null>(null);
  const [simulationNote, setSimulationNote] = useState<string | null>(null);

  const resetExecution = useCallback(() => {
    setSettlement(null);
    setMode(null);
    setSimulationNote(null);
  }, []);

  /**
   * Reads the maker's asset balance either side of the cycle's block. Both
   * reads are real `balanceOf` calls at explicit block heights; anything that
   * cannot be read comes back null with the reason, so the page renders an em
   * dash instead of a plausible number.
   */
  const readMakerBalances = useCallback(
    async (
      maker: Address,
      asset: Address,
      blockNumber: bigint,
    ): Promise<
      Pick<
        GrowSettlement,
        "assetDecimals" | "makerAssetBefore" | "makerAssetAfter" | "balanceNote"
      >
    > => {
      if (publicClient === undefined) {
        return {
          assetDecimals: WBTC.decimals,
          makerAssetBefore: null,
          makerAssetAfter: null,
          balanceNote:
            "No RPC client for this chain in the browser, so the maker's balances could not be read.",
        };
      }
      if (blockNumber === 0n) {
        return {
          assetDecimals: WBTC.decimals,
          makerAssetBefore: null,
          makerAssetAfter: null,
          balanceNote: "The cycle landed in the genesis block; there is no prior block to read.",
        };
      }
      try {
        const [rawDecimals, before, after] = await Promise.all([
          publicClient.readContract({
            abi: erc20Abi,
            address: asset,
            functionName: "decimals",
          }),
          publicClient.readContract({
            abi: erc20Abi,
            address: asset,
            functionName: "balanceOf",
            args: [maker],
            blockNumber: blockNumber - 1n,
          }),
          publicClient.readContract({
            abi: erc20Abi,
            address: asset,
            functionName: "balanceOf",
            args: [maker],
            blockNumber,
          }),
        ]);
        // WBTC is 8 decimals (never 18); the token is still asked, and its
        // answer only stands if it is a usable integer.
        const assetDecimals =
          Number.isInteger(rawDecimals) && rawDecimals >= 0 && rawDecimals <= 36
            ? rawDecimals
            : WBTC.decimals;
        return {
          assetDecimals,
          makerAssetBefore: before,
          makerAssetAfter: after,
          balanceNote: null,
        };
      } catch (error) {
        return {
          assetDecimals: WBTC.decimals,
          makerAssetBefore: null,
          makerAssetAfter: null,
          balanceNote: `The maker's balances could not be read from this RPC: ${chainErrorText(
            error,
            "the historical state call failed",
          )}`,
        };
      }
    },
    [publicClient],
  );

  /**
   * Called with the machine in SIMULATING (the state `ROUTE_READY` leads to).
   * Emits SIMULATION_SUCCESS/SIMULATION_FAILURE, then EXECUTION_CONFIRMED or
   * EXECUTION_FAILURE — the only events EXECUTING accepts.
   */
  const execute = useCallback(
    async (prepared: GrowPrepareResponse) => {
      setSettlement(null);
      setMode(null);
      setSimulationNote(null);

      const to = prepared.to as Address;
      const data = prepared.data as Hex;
      const value = parseWei(prepared.value);
      if (value === null) {
        dispatch({
          type: "SIMULATION_FAILURE",
          reason: `The prepared transaction carries an unreadable value ("${prepared.value}"), so nothing was simulated or broadcast.`,
        });
        return;
      }

      // 1. Simulate the exact prepared transaction. A revert stops here — it
      //    never reaches a wallet or the solver.
      if (publicClient === undefined) {
        setSimulationNote(
          "This browser has no RPC client for the chain, so the cycle was not re-simulated here. The API simulated this exact transaction when it prepared it.",
        );
        dispatch({ type: "SIMULATION_SUCCESS" });
      } else {
        try {
          // `executeCompound` is permissionless, so an unconnected visitor can
          // still simulate it; the connected account is used when there is one
          // so the simulation matches the broadcast exactly.
          await publicClient.call({ account: address, to, data, value });
          dispatch({ type: "SIMULATION_SUCCESS" });
        } catch (error) {
          dispatch({
            type: "SIMULATION_FAILURE",
            reason: chainErrorText(error, "The cycle reverted in simulation."),
          });
          return;
        }
      }

      // 2. Ask the solver. 503 SOLVER_UNAVAILABLE is the supported
      //    permissionless mode, not an error.
      let txHash: Hex | null = null;
      let executionMode: GrowExecutionMode = "SOLVER";
      try {
        const response = await apiRequest(API_ROUTES.growExecute, {
          method: "POST",
          body: { opportunityId: prepared.opportunityId },
          schema: zGrowExecuteResponse,
        });
        txHash = response.txHash as Hex;
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === "SOLVER_UNAVAILABLE") {
          executionMode = "WALLET";
        } else {
          dispatch({
            type: "EXECUTION_FAILURE",
            reason: apiErrorText(error, "The cycle could not be executed."),
          });
          return;
        }
      }
      setMode(executionMode);

      // 3. Permissionless mode: broadcast the prepared transaction ourselves.
      if (executionMode === "WALLET") {
        if (address === undefined) {
          dispatch({
            type: "EXECUTION_FAILURE",
            reason:
              "SOLVER_UNAVAILABLE: no solver key is configured, so the prepared transaction has to be broadcast from a wallet — and no wallet is connected. Connect one on this chain and prepare the route again. Nothing was broadcast.",
          });
          return;
        }
        if (walletChainId !== undefined && walletChainId !== chainId) {
          dispatch({
            type: "EXECUTION_FAILURE",
            reason: `SOLVER_UNAVAILABLE: the prepared transaction targets chain ${chainId}, but the wallet is connected to chain ${walletChainId}. Switch networks and prepare the route again. Nothing was broadcast.`,
          });
          return;
        }
        try {
          txHash = await sendTransactionAsync({ to, data, value });
        } catch (error) {
          dispatch({
            type: "EXECUTION_FAILURE",
            reason: chainErrorText(error, "The wallet rejected the transaction."),
          });
          return;
        }
      }

      if (txHash === null) {
        dispatch({
          type: "EXECUTION_FAILURE",
          reason: "The execution finished without a transaction hash, so nothing can be shown.",
        });
        return;
      }

      // 4. The solver returns as soon as it broadcasts, so the receipt is what
      //    actually decides confirmed vs reverted.
      if (publicClient === undefined) {
        setSettlement({
          mode: executionMode,
          txHash,
          receipt: "unverified",
          blockNumber: null,
          maker: null,
          asset: null,
          assetDecimals: WBTC.decimals,
          makerAssetBefore: null,
          makerAssetAfter: null,
          balanceNote:
            "No RPC client for this chain in the browser, so neither the receipt nor the maker's balances could be read here.",
        });
        dispatch({ type: "EXECUTION_CONFIRMED", txHash });
        return;
      }

      try {
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        const parsed = parseEventLogs({
          abi: VORTEX_GROW_EXECUTED_ABI,
          logs: receipt.logs,
        });
        // The maker and the asset come out of the receipt itself, so the
        // balances below are read from addresses the chain reported.
        const event = parsed[0];
        const maker = event?.args.maker ?? null;
        const asset = event?.args.asset ?? null;

        const balances =
          maker === null || asset === null
            ? {
                assetDecimals: WBTC.decimals,
                makerAssetBefore: null,
                makerAssetAfter: null,
                balanceNote:
                  receipt.status === "success"
                    ? "The receipt carried no VortexGrowExecuted event, so the maker and asset addresses are unknown here."
                    : "The transaction reverted, so no cycle event was emitted and no balance moved.",
              }
            : await readMakerBalances(maker, asset, receipt.blockNumber);

        setSettlement({
          mode: executionMode,
          txHash,
          receipt: receipt.status === "success" ? "confirmed" : "reverted",
          blockNumber: receipt.blockNumber,
          maker,
          asset,
          ...balances,
        });

        if (receipt.status === "success") {
          dispatch({ type: "EXECUTION_CONFIRMED", txHash });
        } else {
          dispatch({
            type: "EXECUTION_FAILURE",
            reason: `The cycle reverted onchain in transaction ${txHash}. The maker keeps the principal — the profit floor is enforced by the contract.`,
          });
        }
      } catch (error) {
        setSettlement({
          mode: executionMode,
          txHash,
          receipt: "unverified",
          blockNumber: null,
          maker: null,
          asset: null,
          assetDecimals: WBTC.decimals,
          makerAssetBefore: null,
          makerAssetAfter: null,
          balanceNote: "The receipt could not be read, so no balance was read either.",
        });
        dispatch({
          type: "EXECUTION_FAILURE",
          reason: `Broadcast as ${txHash}, but the receipt could not be read: ${chainErrorText(
            error,
            "the node did not return a receipt",
          )}`,
        });
      }
    },
    [address, walletChainId, chainId, dispatch, publicClient, readMakerBalances, sendTransactionAsync],
  );

  return { execute, resetExecution, settlement, mode, simulationNote, chainId };
}
