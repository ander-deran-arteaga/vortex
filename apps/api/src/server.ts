import { pathToFileURL } from "node:url";

import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { buildContext, type AppContext } from "./context";
import type { EnvOverrides } from "./config/env";
import { registerConfigRoutes } from "./routes/config";
import { registerHealthRoutes } from "./routes/health";

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
}

export function buildServer(
  overrides: EnvOverrides = {},
  opts: { logger?: boolean } = {},
): BuiltServer {
  const ctx = buildContext(overrides);
  const app = Fastify({ logger: opts.logger ?? false });

  app.register(cors, { origin: true });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "invalid request",
          details: err.flatten(),
        },
      });
    }
    const status =
      typeof err.statusCode === "number" && err.statusCode >= 400
        ? err.statusCode
        : 500;
    return reply.status(status).send({
      error: {
        code: err.code ?? "INTERNAL_ERROR",
        message: status >= 500 ? "internal error" : err.message,
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
