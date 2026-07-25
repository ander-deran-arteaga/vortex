import { pathToFileURL } from "node:url";

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";

import {
  buildContext,
  type AppContext,
  type BuildContextOverrides,
} from "./context";
import type { EnvOverrides } from "./config/env";
import { RequestValidationError } from "./lib/errors";
import { registerConfigRoutes } from "./routes/config";
import { registerExecutionRoutes } from "./routes/executions";
import { registerHealthRoutes } from "./routes/health";
import { registerQuoteRoutes } from "./routes/quotes";
import { registerTransactionRoutes } from "./routes/transactions";

/** One sweep per TTL window is enough to bound the map. */
export const SESSION_SWEEP_INTERVAL_MS = 60_000;

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
}

export function buildServer(
  overrides: EnvOverrides = {},
  opts: { logger?: boolean } & BuildContextOverrides = {},
): BuiltServer {
  const { logger, ...contextDeps } = opts;
  const ctx = buildContext(overrides, contextDeps);
  const app = Fastify({ logger: logger ?? false });

  app.register(cors, { origin: true });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof RequestValidationError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "invalid request",
          details: err.zodError.flatten(),
        },
      });
    }
    const e = err as { statusCode?: unknown; code?: unknown; message?: unknown };
    const status =
      typeof e.statusCode === "number" && e.statusCode >= 400
        ? e.statusCode
        : 500;
    if (status >= 500) {
      req.log.error({ err }, "request failed");
    }
    return reply.status(status).send({
      error: {
        code: typeof e.code === "string" ? e.code : "INTERNAL_ERROR",
        message:
          status >= 500
            ? "internal error"
            : typeof e.message === "string"
              ? e.message
              : "request failed",
      },
    });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: `route ${req.method} ${req.url} not found`,
      },
    }),
  );

  registerHealthRoutes(app, ctx);
  registerConfigRoutes(app, ctx);
  registerQuoteRoutes(app, ctx);
  registerTransactionRoutes(app, ctx);
  registerExecutionRoutes(app, ctx);

  // Sessions are only ever removed by being consumed, so an abandoned quote
  // would otherwise live in the map for the life of the process.
  const sweepTimer = setInterval(() => {
    ctx.exchange.sessions.sweep();
  }, SESSION_SWEEP_INTERVAL_MS);
  // Never hold the process (or a test runner) open on account of the sweeper.
  sweepTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(sweepTimer);
  });

  return { app, ctx };
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const { app, ctx } = buildServer({}, { logger: true });
  app
    .listen({ host: ctx.env.HOST, port: ctx.env.PORT })
    .catch((err: unknown) => {
      app.log.error(err);
      process.exit(1);
    });
}
