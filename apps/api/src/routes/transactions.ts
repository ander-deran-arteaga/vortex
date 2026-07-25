import {
  API_ROUTES,
  zUniswapBuildRequest,
  type UniswapBuildResponse,
} from "@vortex/shared";
import type { FastifyInstance } from "fastify";
import type { Address, Hex } from "viem";

import { UniswapApiError } from "../clients/uniswapApiClient";
import type { AppContext } from "../context";
import { parseRequest } from "../lib/errors";
import type { QuoteSessionFailure } from "../store/quoteSessions";

const SESSION_ERROR_STATUS: Record<QuoteSessionFailure, number> = {
  NOT_FOUND: 404,
  EXPIRED: 410,
  ALREADY_USED: 409,
};

const SESSION_ERROR_MESSAGE: Record<QuoteSessionFailure, string> = {
  NOT_FOUND: "unknown quote session",
  EXPIRED: "quote session expired; request a new quote",
  ALREADY_USED: "quote session already used; request a new quote",
};

export function registerTransactionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.post(API_ROUTES.transactionsUniswap, async (req, reply) => {
    const body = parseRequest(zUniswapBuildRequest, req.body);

    // Single-use: consuming here means a replayed session id cannot rebuild the
    // same transaction, and the browser never round-trips the quote itself.
    const result = ctx.exchange.sessions.consume(body.quoteSessionId);
    if (!result.ok) {
      return reply.status(SESSION_ERROR_STATUS[result.reason]).send({
        error: {
          code: `QUOTE_SESSION_${result.reason}`,
          message: SESSION_ERROR_MESSAGE[result.reason],
        },
      });
    }

    const { uniswap, request, selectedVenue } = result.session.payload;
    // Both quotes are stored on every session, so presence alone does not mean
    // Uniswap won. Without this the taker could execute the venue the
    // comparator rejected and it would still be logged as best execution.
    if (selectedVenue !== "UNISWAP" || !uniswap) {
      return reply.status(409).send({
        error: {
          code: "NOT_A_UNISWAP_SESSION",
          message: "this quote session did not select the Uniswap venue",
        },
      });
    }

    const client = ctx.exchange.uniswapClient;
    if (!client) {
      return reply.status(503).send({
        error: {
          code: "UNISWAP_API_UNCONFIGURED",
          message: "no Uniswap API key is configured",
        },
      });
    }

    try {
      // The stored quote is echoed verbatim; the API forbids modifying it.
      const built = await client.createSwapTransaction({
        quote: uniswap.rawQuote,
        ...(body.permitSignature && uniswap.permitData
          ? { permitData: uniswap.permitData, signature: body.permitSignature }
          : {}),
      });

      ctx.executions.recordExecution({
        kind: "BEST_EXECUTION_UNISWAP",
        chainId: request.chainId,
        taker: request.taker,
        tokenIn: request.tokenIn,
        tokenOut: request.tokenOut,
        amountIn: request.amountIn.toString(),
        amountOut: uniswap.amountOut.toString(),
        uniswapRequestId: uniswap.requestId,
      });

      const response: UniswapBuildResponse = {
        to: built.swap.to as Address,
        data: built.swap.data as Hex,
        value: BigInt(built.swap.value ?? "0").toString(),
        gasLimit: built.swap.gasLimit
          ? BigInt(built.swap.gasLimit).toString()
          : null,
        requestId: built.requestId,
      };
      return response;
    } catch (err) {
      if (err instanceof UniswapApiError) {
        ctx.executions.recordExecution({
          kind: "BEST_EXECUTION_UNISWAP",
          chainId: request.chainId,
          taker: request.taker,
          uniswapRequestId: uniswap.requestId,
          failureCategory: err.errorCode ?? "UNISWAP_API_ERROR",
        });
        // Upstream venue failure is a gateway problem, not the caller's.
        return reply.status(502).send({
          error: {
            code: err.errorCode ?? "UNISWAP_API_ERROR",
            message: err.detail ?? "uniswap api rejected the swap build",
          },
        });
      }
      throw err;
    }
  });
}
