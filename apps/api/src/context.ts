import type { DeploymentFile } from "@vortex/shared";
import {
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { VortexCompoundRoute } from "@vortex/shared";

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
import {
  derivePoolKey,
  loadGrowDeployment,
  type GrowDeployment,
} from "./config/growDeployment";
import {
  resolveSignerAccount,
  type PermFeeSignerConfig,
  type RouteSignerConfig,
} from "./signer/growSigners";
import type { GrowOpportunityDraft } from "./services/growScanner";
import { createLiveAquaQuoteSource } from "./clients/liveAquaQuoteSource";
import { chainForId, createPublicClientForChain, rpcUrlForChain } from "./clients/rpcClient";
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

/** Everything the Grow endpoints need; null when Grow is not deployed here. */
export interface GrowContext {
  deployment: GrowDeployment;
  client: PublicClient;
  permSigner: PermFeeSignerConfig;
  routeSigner: RouteSignerConfig;
  opportunities: Map<Hex, GrowOpportunityDraft>;
  prepared: Map<Hex, { route: VortexCompoundRoute; data: Hex }>;
  nextNonce: () => bigint;
  solverAddress: Address | null;
  /** Present only in demo mode, where the backend holds a solver key. */
  sendTransaction: ((tx: { to: Address; data: Hex }) => Promise<Hex>) | null;
}

export interface AppContext {
  env: Env;
  deployment: DeploymentFile;
  startedAt: number;
  /** The pair as deployed on this chain — mocks locally, canonical on 42161. */
  tokens: ChainToken[];
  /** Address -> symbol for THIS chain; never guesses from position. */
  resolveSymbol: (address: string) => string;
  aquaExecution: AquaExecutionContext | null;
  grow: GrowContext | null;
  exchange: ExchangeQuoteDeps & {
    uniswapClient: UniswapApiClient | null;
    sessions: QuoteSessionStore<ExchangeSessionPayload>;
  };
  executions: ExecutionStore;
}

export interface BuildContextOverrides {
  envSource?: NodeJS.ProcessEnv;
  grow?: GrowContext | null;
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

  const deployment = loadDeployment(
    env.CHAIN_ID,
    undefined,
    env.DEPLOYMENT_VARIANT,
  );
  const tokens = tokensForChain(env.CHAIN_ID, deployment);
  const resolveSymbol = makeSymbolResolver(tokens);
  const strategy = loadAquaDemoStrategy(
    env.CHAIN_ID,
    undefined,
    env.DEPLOYMENT_VARIANT,
  );
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

  const grow = buildGrowContext(env, deployment);

  return {
    env,
    deployment,
    startedAt: Date.now(),
    tokens,
    resolveSymbol,
    aquaExecution,
    grow: deps.grow !== undefined ? deps.grow : grow,
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

/**
 * Assembles the Grow context, or null when anything it needs is missing. The
 * endpoints answer 503 rather than pretending a cycle could run.
 */
function buildGrowContext(
  env: Env,
  deployment: DeploymentFile,
): GrowContext | null {
  const growDeployment = loadGrowDeployment(
    env.CHAIN_ID,
    deployment.contracts,
    (deployment as { permAmmPoolId?: Hex }).permAmmPoolId,
  );
  if (!growDeployment) return null;

  const feeAccount = resolveSignerAccount(
    env.CHAIN_ID,
    env.FEE_SIGNER_PRIVATE_KEY,
    "FEE_SIGNER_PRIVATE_KEY",
  );
  const routeAccount = resolveSignerAccount(
    env.CHAIN_ID,
    env.ROUTE_SIGNER_PRIVATE_KEY,
    "ROUTE_SIGNER_PRIVATE_KEY",
  );
  // Without both signatures a cycle cannot be authorized at all.
  if (!feeAccount || !routeAccount) return null;

  const client = createPublicClientForChain(env);
  const { poolId } = derivePoolKeyId(growDeployment);

  const solverAccount = resolveSignerAccount(
    env.CHAIN_ID,
    env.SOLVER_PRIVATE_KEY,
    "SOLVER_PRIVATE_KEY",
  );

  const sendTransaction = solverAccount
    ? async (tx: { to: Address; data: Hex }): Promise<Hex> => {
        const wallet = createWalletClient({
          account: solverAccount,
          chain: chainForId(env.CHAIN_ID),
          transport: http(rpcUrlForChain(env)),
        });
        return wallet.sendTransaction({ to: tx.to, data: tx.data });
      }
    : null;

  let nonce = BigInt(Date.now());
  return {
    deployment: growDeployment,
    client,
    permSigner: {
      account: feeAccount,
      chainId: env.CHAIN_ID,
      hookAddress: growDeployment.hookAddress,
      poolId,
      oracleAddress: growDeployment.oracleAddress,
      client,
    },
    routeSigner: {
      account: routeAccount,
      chainId: env.CHAIN_ID,
      compounderAddress: growDeployment.compounder,
    },
    opportunities: new Map(),
    prepared: new Map(),
    nextNonce: () => nonce++,
    solverAddress: solverAccount?.address ?? null,
    sendTransaction,
  };
}

function derivePoolKeyId(growDeployment: GrowDeployment): { poolId: Hex } {
  const { poolId } = derivePoolKey(
    growDeployment.strategy.asset,
    growDeployment.strategy.bridgeToken,
    growDeployment.hookAddress,
  );
  return { poolId };
}
