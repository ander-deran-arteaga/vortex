"use client";

import { useCallback, useState } from "react";
import { erc20Abi } from "viem";
import { usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import type { ExchangeQuoteResponse } from "@vortex/shared";
import { WBTC } from "@vortex/shared";
import { buildAquaTransaction, buildUniswapTransaction } from "@/lib/api/endpoints";
import { ApiRequestError } from "@/lib/api/errors";
import type { SwapEvent } from "@/lib/machines/swapMachine";

/** A built transaction, normalised across both venues. */
interface BuiltTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  /** Present for Aqua: the taker must approve this before broadcasting. */
  spender?: `0x${string}`;
  minimumAmountOut?: bigint;
}

export interface ApprovalNeed {
  spender: `0x${string}`;
  amount: bigint;
}

/**
 * Drives a quote through build → allowance check → simulate → broadcast →
 * receipt, dispatching into the swap machine at each hop. The transaction is
 * broadcast exactly as the API built it; the browser never reconstructs an
 * order.
 */
export function useSwapExecution(dispatch: (event: SwapEvent) => void) {
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const [approvalNeed, setApprovalNeed] = useState<ApprovalNeed | null>(null);

  const execute = useCallback(
    async (quote: ExchangeQuoteResponse, taker: `0x${string}`, amountIn: bigint) => {
      setApprovalNeed(null);

      let built: BuiltTransaction;
      try {
        if (quote.execution.kind === "AQUA_SWAPVM") {
          const response = await buildAquaTransaction(quote.quoteSessionId);
          built = {
            to: response.to as `0x${string}`,
            data: response.data as `0x${string}`,
            value: BigInt(response.value),
            spender: response.spender as `0x${string}`,
            minimumAmountOut: BigInt(response.minimumAmountOut),
          };
        } else {
          const response = await buildUniswapTransaction({
            quoteSessionId: quote.quoteSessionId,
          });
          built = {
            to: response.to as `0x${string}`,
            data: response.data as `0x${string}`,
            value: BigInt(response.value),
          };
        }
        dispatch({ type: "BUILD_SUCCESS" });
      } catch (error) {
        // The API's own code is more useful than a generic failure — a taker
        // seeing AQUA_EXECUTION_UNAVAILABLE knows it is an environment gap,
        // not their transaction.
        dispatch({
          type: "BUILD_FAILURE",
          reason:
            error instanceof ApiRequestError
              ? `${error.code}: ${error.message}`
              : error instanceof Error
                ? error.message
                : "Could not build the transaction.",
        });
        return;
      }

      // Simulate before asking for a signature, so a doomed transaction never
      // reaches the wallet.
      try {
        if (built.spender !== undefined && publicClient !== undefined) {
          const allowance = await publicClient.readContract({
            abi: erc20Abi,
            address: WBTC.address as `0x${string}`,
            functionName: "allowance",
            args: [taker, built.spender],
          });
          if (allowance < amountIn) {
            setApprovalNeed({ spender: built.spender, amount: amountIn });
            dispatch({
              type: "SIMULATION_FAILURE",
              reason:
                "The router is not approved to move this much WBTC yet. Approve it, then request a fresh quote.",
            });
            return;
          }
        }
        if (publicClient !== undefined) {
          await publicClient.call({ account: taker, to: built.to, data: built.data, value: built.value });
        }
        dispatch({ type: "SIMULATION_SUCCESS" });
      } catch (error) {
        dispatch({
          type: "SIMULATION_FAILURE",
          reason: error instanceof Error ? error.message : "Simulation reverted.",
        });
        return;
      }

      let txHash: `0x${string}`;
      try {
        txHash = await sendTransactionAsync({
          to: built.to,
          data: built.data,
          value: built.value,
        });
        dispatch({ type: "WALLET_CONFIRMED", txHash });
      } catch (error) {
        dispatch({
          type: "REJECTED",
          reason: error instanceof Error ? error.message : "The wallet rejected the transaction.",
        });
        return;
      }

      dispatch({ type: "TX_SEEN" });
      try {
        if (publicClient === undefined) {
          return;
        }
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
        if (receipt.status === "success") {
          dispatch({ type: "TX_CONFIRMED" });
        } else {
          dispatch({ type: "TX_FAILURE", reason: "The transaction reverted onchain." });
        }
      } catch (error) {
        dispatch({
          type: "TX_FAILURE",
          reason: error instanceof Error ? error.message : "Could not confirm the transaction.",
        });
      }
    },
    [dispatch, publicClient, sendTransactionAsync],
  );

  const approve = useCallback(async () => {
    if (approvalNeed === null) {
      return;
    }
    await writeContractAsync({
      abi: erc20Abi,
      address: WBTC.address as `0x${string}`,
      functionName: "approve",
      args: [approvalNeed.spender, approvalNeed.amount],
    });
    setApprovalNeed(null);
  }, [approvalNeed, writeContractAsync]);

  return { execute, approve, approvalNeed };
}
