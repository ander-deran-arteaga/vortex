import {
  API_ROUTES,
  zConfigResponse,
  zExchangeQuoteResponse,
  zExecutionRecord,
  zGrowPrepareResponse,
  zGrowScanResponse,
  zStrategyHealth,
  zUniswapBuildResponse,
  type ConfigResponse,
  type ExchangeQuoteRequest,
  type ExchangeQuoteResponse,
  type ExecutionRecord,
  type GrowPrepareResponse,
  type GrowScanRequest,
  type GrowScanResponse,
  type StrategyHealth,
  type UniswapBuildRequest,
  type UniswapBuildResponse,
} from "@vortex/shared";
import { z } from "zod";
import { apiRequest } from "./client";
import { ApiUnavailableError } from "./errors";
import {
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

export async function fetchStrategyHealth(
  strategyHash: string,
  options: { covered?: boolean } = {},
): Promise<Sourced<StrategyHealth>> {
  return withFixtureFallback(
    () => apiRequest(API_ROUTES.strategy(strategyHash), { schema: zStrategyHealth }),
    () => buildStrategyHealthFixture(strategyHash, options),
  );
}

export async function fetchExecutions(options: {
  now: number;
}): Promise<Sourced<ExecutionRecord[]>> {
  return withFixtureFallback(
    () =>
      apiRequest(API_ROUTES.executions, {
        schema: z.array(zExecutionRecord),
      }),
    () => buildExecutionsFixture(options),
  );
}
