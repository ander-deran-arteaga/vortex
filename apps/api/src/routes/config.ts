import { API_ROUTES, type ConfigResponse } from "@vortex/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context";

export function registerConfigRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): void {
  app.get(API_ROUTES.config, async (): Promise<ConfigResponse> => ({
    chainId: ctx.env.CHAIN_ID,
    tokens: ctx.tokens.map((t) => ({
      address: t.address,
      symbol: t.symbol,
      decimals: t.decimals,
    })),
    contracts: ctx.deployment.contracts as ConfigResponse["contracts"],
    // Published so no client hardcodes a hash: these change on every reseed,
    // and a stale constant quotes a strategy that was never shipped — which
    // reads in the UI as "Aqua is broken" rather than "wrong strategy".
    strategies: {
      swap: ctx.aquaExecution?.strategy.strategyHash ?? null,
      grow: ctx.grow?.deployment.strategyHash ?? null,
    },
    features: {
      // True only when a compounder, both signers and the PermAMM leg are
      // actually deployed — the same condition the Grow endpoints require, so
      // the flag can never advertise a capability that would 503.
      growEnabled: ctx.grow !== null,
      // MASTER Addendum 4 §3: DEMO_MODE gates the labeling of simulated
      // venues. While the Aqua leg is served by the deterministic fixture,
      // some of the quoted data IS simulated, so the flag is forced on — the
      // UI must never present a fixture number as a live one (§21).
      demoMode:
        ctx.env.DEMO_MODE || ctx.exchange.aquaSource.kind === "fixture",
    },
  }));
}
