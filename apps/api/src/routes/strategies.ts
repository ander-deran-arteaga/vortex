import { API_ROUTES, zBytes32, type StrategyHealth } from "@vortex/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Hex } from "viem";
import { z } from "zod";

import type { AppContext } from "../context";
import { parseRequest } from "../lib/errors";
import {
  isTokenNotInStrategyRevert,
  readGrowStrategyHealth,
} from "../services/growHealth";

const zStrategyParams = z.object({ strategyHash: zBytes32 });

const sameHash = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function registerStrategyRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.get(`${API_ROUTES.strategies}/:strategyHash`, async (req, reply) => {
    const params = parseRequest(zStrategyParams, req.params);
    const strategyHash = params.strategyHash as Hex;

    // Vortex Grow is a SINGLE-ASSET strategy: it ships one token. Asking it
    // for a token pair makes Aqua revert, which previously surfaced as
    // STRATEGY_NOT_FOUND for a strategy that was shipped and compounding.
    // Dispatch on which strategy this is, and query each with its own asset
    // set rather than a hardcoded pair.
    const grow = ctx.grow;
    const aqua = ctx.deployment.contracts.Aqua;
    if (grow && aqua && sameHash(strategyHash, grow.deployment.strategyHash)) {
      let health: StrategyHealth | null;
      try {
        health = await readGrowStrategyHealth(
          grow.client,
          grow.deployment,
          aqua,
          ctx.resolveSymbol,
        );
      } catch (err) {
        if (isTokenNotInStrategyRevert(err)) {
          // Active strategy, different asset set — never "not found".
          return reply.status(409).send({
            error: {
              code: "STRATEGY_ASSET_MISMATCH",
              message:
                `strategy ${strategyHash} is active but does not hold the ` +
                `token that was queried. This is a shape mismatch, not a ` +
                `missing strategy.`,
            },
          });
        }
        throw err;
      }
      if (health) return health;
      return notShipped(reply, strategyHash, ctx.env.CHAIN_ID);
    }

    let health: StrategyHealth | null;
    try {
      health = await ctx.exchange.aquaSource.strategyHealth(strategyHash);
    } catch (err) {
      if (isTokenNotInStrategyRevert(err)) {
        return reply.status(409).send({
          error: {
            code: "STRATEGY_ASSET_MISMATCH",
            message:
              `strategy ${strategyHash} is active but does not hold the token ` +
              `that was queried. This is a shape mismatch, not a missing ` +
              `strategy.`,
          },
        });
      }
      throw err;
    }

    if (!health) return notShipped(reply, strategyHash, ctx.env.CHAIN_ID);
    return health;
  });
}

/**
 * Only a genuinely absent strategy reaches here. The message stays factual:
 * pointing at a bring-up script would be a dead end whenever the chain is
 * healthy and the hash is simply wrong — the script correctly reports
 * "nothing to do" and the user loops.
 */
function notShipped(
  reply: FastifyReply,
  strategyHash: string,
  chainId: number,
) {
  return reply.status(404).send({
    error: {
      code: "STRATEGY_NOT_FOUND",
      message:
        `no strategy ${strategyHash} on chain ${chainId}: nothing is shipped ` +
        `under that hash.`,
    },
  });
}
