/** Canonical API route paths — frontend and backend both import these. */
export const API_ROUTES = {
  health: "/v1/health",
  config: "/v1/config",
  strategies: "/v1/strategies",
  strategyHealth: (strategyHash: string) =>
    `/v1/strategies/${strategyHash}/health`,
  exchangeQuote: "/v1/quotes/exchange",
  uniswapBuild: "/v1/uniswap/build",
  compoundScan: "/v1/compound/scan",
  compoundPrepare: "/v1/compound/prepare",
  compoundExecute: "/v1/compound/execute",
  executions: "/v1/executions",
  aquaResolverQuote: "/v1/aqua/quote",
  aquaResolverBuild: "/v1/aqua/build",
  demoSeed: "/v1/demo/seed",
} as const;
