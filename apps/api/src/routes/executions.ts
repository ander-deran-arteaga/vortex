import { API_ROUTES, zExecutionKind } from "@vortex/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppContext } from "../context";
import { parseRequest } from "../lib/errors";

const zExecutionsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  kind: zExecutionKind.optional(),
});

export function registerExecutionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.get(API_ROUTES.executions, async (req) => {
    const query = parseRequest(zExecutionsQuery, req.query ?? {});
    return {
      executions: ctx.executions.listExecutions({
        limit: query.limit,
        ...(query.kind ? { kind: query.kind } : {}),
      }),
    };
  });
}
