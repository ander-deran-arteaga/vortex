import { API_ROUTES, zBytes32, type StrategyHealth } from "@vortex/shared";
import type { FastifyInstance } from "fastify";
import type { Hex } from "viem";
import { z } from "zod";

import type { AppContext } from "../context";
import { parseRequest } from "../lib/errors";

const zStrategyParams = z.object({ strategyHash: zBytes32 });

export function registerStrategyRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.get(`${API_ROUTES.strategies}/:strategyHash`, async (req, reply) => {
    const params = parseRequest(zStrategyParams, req.params);

    const health: StrategyHealth | null =
      await ctx.exchange.aquaSource.strategyHealth(params.strategyHash as Hex);

    if (!health) {
      // Distinct from the bare NOT_FOUND used for unregistered routes: this
      // says the route exists and the strategy does not, so a client can tell
      // "no such maker" from "no such endpoint" and never render an absent
      // strategy as if it were data.
      return reply.status(404).send({
        error: {
          code: "STRATEGY_NOT_FOUND",
          message:
            `no strategy ${params.strategyHash} on chain ${ctx.env.CHAIN_ID}. ` +
            `This is an unshipped strategy, not unreadable coverage: the ` +
            `contracts can all be deployed while nothing was shipped into ` +
            `Aqua. Run ./scripts/ensure-demo.sh — it is safe to re-run.`,
        },
      });
    }

    return health;
  });
}
