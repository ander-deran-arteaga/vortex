import type { DeploymentFile } from "@vortex/shared";
import type { Address } from "viem";

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
import { loadAquaDemoStrategy, type AquaDemoStrategy } from "./config/aquaDeployment";
import { loadDeployment } from "./config/contracts";
import { makeSymbolResolver, tokensForChain, type ChainToken } from "./config/tokens";
import { createLiveAquaQuoteSource } from "./clients/liveAquaQuoteSource";
import { createPublicClientForChain } from "./clients/rpcClient";
import { loadEnv, type Env, type EnvOverrides } from "./config/env";
import type { ExchangeQuoteDeps } from "./services/exchangeQuoteService";
import type { AquaQuoteSource } from "./services/types";
import { createExecutionStore, type ExecutionStore } from "./store/executions";
import {
  createQuoteSessionStore,
  type ExchangeSessionPayload,
  type QuoteSessionStore,
} from "./store/quoteSessions";

/**
 * Everything needed to build a real Aqua/SwapVM transaction. Absent whenever
 * no seeded strategy exists on this chain, which is what stops the API from
 * offering an execution it cannot actually construct.
 */
export interface AquaExecutionContext {
  routerAddress: Address;
  strategy: AquaDemoStrategy;
}

export interface AppContext {
  env: Env;
  deployment: DeploymentFile;
  startedAt: number;
  /** The pair as deployed on this chain — mocks locally, canonical on 42161. */
  tokens: ChainToken[];
  aquaExecution: AquaExecutionContext | null;
  exchange: ExchangeQuoteDeps & {
    uniswapClient: UniswapApiClient | null;
    sessions: QuoteSessionStore<ExchangeSessionPayload>;
  };
  executions: ExecutionStore;
}

export interface BuildContextOverrides {
  envSource?: NodeJS.ProcessEnv;
  aquaExecution?: AquaExecutionContext | null;
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

  const deployment = loadDeployment(env.CHAIN_ID);
  const tokens = tokensForChain(env.CHAIN_ID, deployment);
  const resolveSymbol = makeSymbolResolver(tokens);
  const strategy = loadAquaDemoStrategy(env.CHAIN_ID);
  const routerAddress = deployment.contracts.AquaSwapVMRouter;
  const lensAddress = deployment.contracts.VortexAquaLens;
  const oracleAddress = deployment.contracts.MockReferenceOracle;

  // Live only when every piece the router and lens need is actually deployed.
  // A partially deployed chain falls back to the fixture rather than throwing
  // at boot or, worse, quoting against half a system.
  const canQuoteLive =
    strategy !== null &&
    routerAddress !== undefined &&
    lensAddress !== undefined &&
    oracleAddress !== undefined;

  const aquaExecution: AquaExecutionContext | null =
    deps.aquaExecution !== undefined
      ? deps.aquaExecution
      : canQuoteLive
        ? { routerAddress: routerAddress as Address, strategy: strategy as AquaDemoStrategy }
        : null;

  const liveAquaSource = canQuoteLive
    ? createLiveAquaQuoteSource({
        client: createPublicClientForChain(env),
        lensAddress: lensAddress as Address,
        routerAddress: routerAddress as Address,
        oracleAddress: oracleAddress as Address,
        baseToken: (strategy as AquaDemoStrategy).baseToken,
        quoteToken: (strategy as AquaDemoStrategy).quoteToken,
        resolveSymbol,
        // The order is not derivable from the hash, so only the seeded
        // strategy resolves; anything else is genuinely unknown.
        resolveOrder: (strategyHash) => {
          const seeded = strategy as AquaDemoStrategy;
          if (strategyHash.toLowerCase() !== seeded.strategyHash.toLowerCase()) {
            throw new Error(`unknown strategy ${strategyHash}`);
          }
          return seeded.order;
        },
      })
    : null;

  return {
    env,
    deployment,
    startedAt: Date.now(),
    tokens,
    aquaExecution,
    exchange: {
      aquaSource:
        deps.aquaSource ??
        liveAquaSource ??
        createFixtureAquaQuoteSource({
          ...AQUA_FIXTURE_PROFILES[env.AQUA_FIXTURE_PROFILE],
          resolveSymbol,
        }),
      uniswapClient,
      sessions: deps.sessions ?? createQuoteSessionStore<ExchangeSessionPayload>(),
    },
    executions:
      deps.executions ??
      createExecutionStore({ dir: env.STORE_DIR, baseDir: API_ROOT }),
  };
}
