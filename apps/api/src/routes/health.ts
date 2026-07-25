import { API_ROUTES, type HealthResponse } from "@vortex/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context";

export function registerHealthRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.get(API_ROUTES.health, async (): Promise<HealthResponse> => ({
    ok: true,
    chainId: ctx.env.CHAIN_ID,
    uptimeSec: Math.round((Date.now() - ctx.startedAt) / 1000),
  }));
}
