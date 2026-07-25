import { API_ROUTES, TOKENS, type ConfigResponse } from "@vortex/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context";

export function registerConfigRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.get(API_ROUTES.config, async (): Promise<ConfigResponse> => ({
    chainId: ctx.env.CHAIN_ID,
    tokens: TOKENS.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
    })),
    contracts: ctx.deployment.contracts as ConfigResponse["contracts"],
    features: {
      // Grow execution stays off until Phase 6 opens the compound route.
      growEnabled: false,
      demoMode: ctx.env.DEMO_MODE,
    },
  }));
}
