import {
  API_ROUTES,
  zConfigResponse,
  zExchangeQuoteResponse,
  zExecutionRecord,
  zGrowPrepareResponse,
  zGrowScanResponse,
  zStrategyHealth,
  zAquaBuildResponse,
  zUniswapBuildResponse,
  type ConfigResponse,
  type ExchangeQuoteRequest,
  type ExchangeQuoteResponse,
  type ExecutionRecord,
  type GrowPrepareResponse,
  type GrowScanRequest,
  type GrowScanResponse,
  type StrategyHealth,
  type AquaBuildResponse,
  type UniswapBuildRequest,
  type UniswapBuildResponse,
} from "@vortex/shared";
import { z } from "zod";
import { apiRequest } from "./client";
import { ApiUnavailableError } from "./errors";
import {
  FIXTURE_GROW_STRATEGY_HASH,
  FIXTURE_STRATEGY_HASH,
  buildConfigFixture,
  buildExchangeQuoteFixture,
  buildExecutionsFixture,
  buildGrowPrepareFixture,
  buildGrowScanFixture,
  buildStrategyHealthFixture,
  type GrowFixtureOptions,
  type QuoteFixtureOptions,
} from "./fixtures";
import { fixture, live, type Sourced } from "./source";

/**
 * Read paths return `Sourced<T>`: the live API when it answers, otherwise
 * clearly-labeled fixture data. ONLY `ApiUnavailableError` (API down or route
 * not registered yet) triggers the fallback — a real API error propagates so
 * the user sees the actual failure instead of a plausible-looking mock.
 */
async function withFixtureFallback<T>(
  request: () => Promise<T>,
  makeFixture: () => T,
): Promise<Sourced<T>> {
  try {
    return live(await request());
  } catch (error) {
    if (error instanceof ApiUnavailableError) {
      return fixture(makeFixture());
    }
    throw error;
  }
}

export async function fetchConfig(): Promise<Sourced<ConfigResponse>> {
  return withFixtureFallback(
    () => apiRequest(API_ROUTES.config, { schema: zConfigResponse }),
    buildConfigFixture,
  );
}

export async function fetchExchangeQuote(
  request: ExchangeQuoteRequest,
  options: QuoteFixtureOptions,
): Promise<Sourced<ExchangeQuoteResponse>> {
  return withFixtureFallback(
    () =>
      apiRequest(API_ROUTES.exchangeQuote, {
        method: "POST",
        body: request,
        schema: zExchangeQuoteResponse,
      }),
    () => buildExchangeQuoteFixture(request, options),
  );
}

/**
 * Builds the Uniswap transaction. There is deliberately NO fixture fallback:
 * broadcasting a fabricated transaction is never acceptable, so this fails
 * loudly when the backend is not available.
 */
export async function buildUniswapTransaction(
  request: UniswapBuildRequest,
): Promise<UniswapBuildResponse> {
  return apiRequest(API_ROUTES.transactionsUniswap, {
    method: "POST",
    body: request,
    schema: zUniswapBuildResponse,
  });
}

/**
 * Builds the Aqua + SwapVM transaction for a quote session. Like the Uniswap
 * builder there is deliberately NO fixture fallback — a fabricated transaction
 * must never reach a wallet — so this surfaces the API's own error instead
 * (AQUA_EXECUTION_UNAVAILABLE, STRATEGY_NOT_EXECUTABLE, SESSION_*).
 */
export async function buildAquaTransaction(
  quoteSessionId: string,
): Promise<AquaBuildResponse> {
  return apiRequest(API_ROUTES.transactionsAqua, {
    method: "POST",
    body: { quoteSessionId },
    schema: zAquaBuildResponse,
  });
}

export async function scanGrowOpportunity(
  request: GrowScanRequest,
  options: GrowFixtureOptions,
): Promise<Sourced<GrowScanResponse>> {
  return withFixtureFallback(
    () =>
      apiRequest(API_ROUTES.growScan, {
        method: "POST",
        body: request,
        schema: zGrowScanResponse,
      }),
    () => buildGrowScanFixture(request, options),
  );
}

export async function prepareGrowRoute(
  opportunityId: string,
  options: { now: number; principalAmount: string },
): Promise<Sourced<GrowPrepareResponse>> {
  return withFixtureFallback(
    () =>
      apiRequest(API_ROUTES.growPrepare, {
        method: "POST",
        body: { opportunityId },
        schema: zGrowPrepareResponse,
      }),
    () => buildGrowPrepareFixture(opportunityId, options),
  );
}

/**
 * Fixture health is scoped to the two known demo strategies. Answering for an
 * arbitrary hash would render a strategy nobody ever shipped as a healthy
 * maker holding real inventory — the same back-door the API closed by scoping
 * its own fixture to one demo hash. An unknown hash gets the real failure.
 */
const FIXTURE_STRATEGY_HASHES = new Set<string>([
  FIXTURE_STRATEGY_HASH.toLowerCase(),
  FIXTURE_GROW_STRATEGY_HASH.toLowerCase(),
]);

export async function fetchStrategyHealth(
  strategyHash: string,
  options: { covered?: boolean } = {},
): Promise<Sourced<StrategyHealth>> {
  const request = () =>
    apiRequest(API_ROUTES.strategy(strategyHash), { schema: zStrategyHealth });

  if (!FIXTURE_STRATEGY_HASHES.has(strategyHash.toLowerCase())) {
    return live(await request());
  }

  return withFixtureFallback(request, () =>
    buildStrategyHealthFixture(strategyHash, options),
  );
}

/**
 * The API returns the history wrapped as `{ executions: [...] }`, not a bare
 * array. Validating the real shape is what surfaced the mismatch instead of
 * silently rendering an empty table, so the envelope is modelled here rather
 * than tolerated loosely: if it changes again, this fails loudly on purpose.
 */
const zExecutionsResponse = z.object({
  executions: z.array(zExecutionRecord),
});

export async function fetchExecutions(options: {
  now: number;
}): Promise<Sourced<ExecutionRecord[]>> {
  return withFixtureFallback(
    async () => {
      const response = await apiRequest(API_ROUTES.executions, {
        schema: zExecutionsResponse,
      });
      return response.executions;
    },
    () => buildExecutionsFixture(options),
  );
}
