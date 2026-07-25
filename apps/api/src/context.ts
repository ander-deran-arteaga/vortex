import type { DeploymentFile } from "@vortex/shared";

import {
  AQUA_COMPETITIVE_FIXTURE,
  AQUA_UNCOMPETITIVE_FIXTURE,
  createFixtureAquaQuoteSource,
  type FixtureAquaConfig,
} from "./clients/fixtureAquaQuoteSource";
import {
  createUniswapApiClient,
  type UniswapApiClient,
} from "./clients/uniswapApiClient";
import { loadDeployment } from "./config/contracts";
import { loadEnv, type Env, type EnvOverrides } from "./config/env";
import type { ExchangeQuoteDeps } from "./services/exchangeQuoteService";
import type { AquaQuoteSource } from "./services/types";
import { createExecutionStore, type ExecutionStore } from "./store/executions";
import {
  createQuoteSessionStore,
  type ExchangeSessionPayload,
  type QuoteSessionStore,
} from "./store/quoteSessions";

export interface AppContext {
  env: Env;
  deployment: DeploymentFile;
  startedAt: number;
  exchange: ExchangeQuoteDeps & {
    uniswapClient: UniswapApiClient | null;
    sessions: QuoteSessionStore<ExchangeSessionPayload>;
  };
  executions: ExecutionStore;
}

export interface BuildContextOverrides {
  envSource?: NodeJS.ProcessEnv;
  /** Tests and the Phase 2 hand-off swap the Aqua leg without touching routes. */
  aquaSource?: AquaQuoteSource;
  uniswapClient?: UniswapApiClient | null;
  executions?: ExecutionStore;
  sessions?: QuoteSessionStore<ExchangeSessionPayload>;
}

const API_ROOT = new URL("../", import.meta.url).pathname;

const AQUA_FIXTURE_PROFILES: Record<
  Env["AQUA_FIXTURE_PROFILE"],
  Partial<FixtureAquaConfig>
> = {
  competitive: AQUA_COMPETITIVE_FIXTURE,
  uncompetitive: AQUA_UNCOMPETITIVE_FIXTURE,
  stale: { ...AQUA_COMPETITIVE_FIXTURE, forcedReason: "VortexStaleOracle" },
};

export function buildContext(
  overrides: EnvOverrides = {},
  deps: BuildContextOverrides = {},
): AppContext {
  const env = loadEnv(overrides, deps.envSource);

  // The key stays optional in env so the server boots without secrets; the
  // client refuses to exist without one, so Uniswap is simply absent instead.
  const uniswapClient =
    deps.uniswapClient !== undefined
      ? deps.uniswapClient
      : env.UNISWAP_API_KEY
        ? createUniswapApiClient({
            apiKey: env.UNISWAP_API_KEY,
            baseUrl: env.UNISWAP_API_BASE,
          })
        : null;

  return {
    env,
    deployment: loadDeployment(env.CHAIN_ID),
    startedAt: Date.now(),
    exchange: {
      aquaSource:
        deps.aquaSource ??
        createFixtureAquaQuoteSource(
          AQUA_FIXTURE_PROFILES[env.AQUA_FIXTURE_PROFILE],
        ),
      uniswapClient,
      sessions: deps.sessions ?? createQuoteSessionStore<ExchangeSessionPayload>(),
    },
    executions:
      deps.executions ??
      createExecutionStore({ dir: env.STORE_DIR, baseDir: API_ROOT }),
  };
}
