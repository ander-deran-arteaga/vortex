/**
 * Canonical API route paths (MASTER R-005) — frontend and backend both
 * import these; never hardcode a path. All endpoints are versioned under
 * /api/v1.
 */
export const API_PREFIX = "/api/v1";

export const API_ROUTES = {
  health: `${API_PREFIX}/health`,
  config: `${API_PREFIX}/config`,
  strategies: `${API_PREFIX}/strategies`,
  strategy: (strategyHash: string) => `${API_PREFIX}/strategies/${strategyHash}`,
  executions: `${API_PREFIX}/executions`,
  exchangeQuote: `${API_PREFIX}/quotes/exchange`,
  transactionsAqua: `${API_PREFIX}/transactions/aqua`,
  transactionsUniswap: `${API_PREFIX}/transactions/uniswap`,
  growScan: `${API_PREFIX}/grow/scan`,
  growPrepare: `${API_PREFIX}/grow/prepare`,
  growExecute: `${API_PREFIX}/grow/execute`,
  resolverQuote: `${API_PREFIX}/resolver/quote`,
  resolverBuild: `${API_PREFIX}/resolver/build`,
  demoSeed: `${API_PREFIX}/demo/seed`,
} as const;
