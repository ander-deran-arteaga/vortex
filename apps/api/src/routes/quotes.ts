import {
  API_ROUTES,
  zExchangeQuoteRequest,
  type ExchangeQuoteResponse,
} from "@vortex/shared";
import type { FastifyInstance } from "fastify";
import type { Address, Hex } from "viem";

import type { AppContext } from "../context";
import { parseRequest } from "../lib/errors";
import {
  NoVenueAvailableError,
  quoteExchange,
} from "../services/exchangeQuoteService";

export function registerQuoteRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.post(API_ROUTES.exchangeQuote, async (req, reply) => {
    const body = parseRequest(zExchangeQuoteRequest, req.body);

    if (body.chainId !== ctx.env.CHAIN_ID) {
      return reply.status(400).send({
        error: {
          code: "CHAIN_MISMATCH",
          message: `server is configured for chain ${ctx.env.CHAIN_ID}`,
        },
      });
    }

    let response: ExchangeQuoteResponse;
    try {
      response = await quoteExchange(
        {
          chainId: body.chainId,
          tokenIn: body.tokenIn as Address,
          tokenOut: body.tokenOut as Address,
          amountIn: BigInt(body.amountIn),
          taker: body.taker as Address,
          slippageBps: body.slippageBps,
          strategyHash: body.strategyHash as Hex,
        },
        ctx.exchange,
      );
    } catch (err) {
      if (err instanceof NoVenueAvailableError) {
        return reply.status(503).send({
          error: { code: "NO_VENUE_AVAILABLE", message: err.detail },
        });
      }
      throw err;
    }

    return response;
  });
}
