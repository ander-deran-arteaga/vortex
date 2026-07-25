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
      // MASTER Addendum 4 §3: DEMO_MODE gates the labeling of simulated
      // venues. While the Aqua leg is served by the deterministic fixture,
      // some of the quoted data IS simulated, so the flag is forced on — the
      // UI must never present a fixture number as a live one (§21).
      demoMode:
        ctx.env.DEMO_MODE || ctx.exchange.aquaSource.kind === "fixture",
    },
  }));
}
