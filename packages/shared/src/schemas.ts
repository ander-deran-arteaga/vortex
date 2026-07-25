import { z } from "zod";

export const zAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "invalid address");
export const zBytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, "invalid bytes32");
export const zHex = z.string().regex(/^0x[0-9a-fA-F]*$/, "invalid hex");
/** Base-unit token amount encoded as a decimal string. */
export const zAmount = z.string().regex(/^[0-9]+$/, "invalid amount");
export const zChainId = z.union([z.literal(42161), z.literal(31337)]);
export const zBps = z.number().int().min(0).max(10_000);

export const zVenue = z.enum(["AQUA", "UNISWAP"]);
export type Venue = z.infer<typeof zVenue>;

export const zGrowDirection = z.enum([
  "AUTO",
  "VORTEX_THEN_EXTERNAL",
  "EXTERNAL_THEN_VORTEX",
]);
export type GrowDirection = z.infer<typeof zGrowDirection>;

// ── Vortex Swap — best execution ───────────────────────────────────

export const zExchangeQuoteRequest = z.object({
  chainId: zChainId,
  strategyHash: zBytes32,
  tokenIn: zAddress,
  tokenOut: zAddress,
  amountIn: zAmount,
  taker: zAddress,
  slippageBps: zBps.default(30),
});
export type ExchangeQuoteRequest = z.infer<typeof zExchangeQuoteRequest>;

/**
 * Provenance of a displayed quote. Required on every venue comparison so the
 * UI can never render a simulated number as if it were live — presenting mock
 * data as live data is a blocked implementation (security rules, §21).
 * There is deliberately no default: a caller must state which it is.
 */
export const zQuoteSource = z.enum(["live", "fixture"]);
export type QuoteSource = z.infer<typeof zQuoteSource>;

export const zAquaComparison = z.object({
  source: zQuoteSource,
  amountOut: zAmount,
  minimumAmountOut: zAmount,
  estimatedGasUsd: z.string(),
  netAmountOut: zAmount,
  safetyFeeBps: z.number(),
  commercialFeeBps: z.number(),
  inventoryAdjustmentBps: z.number(),
  makerCoverageBps: z.number(),
});
export type AquaComparison = z.infer<typeof zAquaComparison>;

export const zUniswapComparison = z.object({
  source: zQuoteSource,
  amountOut: zAmount,
  minimumAmountOut: zAmount,
  estimatedGasUsd: z.string(),
  netAmountOut: zAmount,
  requestId: z.string().optional(),
});
export type UniswapComparison = z.infer<typeof zUniswapComparison>;

export const zAquaExecution = z.object({
  kind: z.literal("AQUA_SWAPVM"),
  order: z.unknown(),
  amount: zAmount,
  takerTraitsAndData: zHex,
});
export type AquaExecution = z.infer<typeof zAquaExecution>;

export const zUniswapExecution = z.object({
  kind: z.literal("UNISWAP_API"),
  quoteSessionId: z.string(),
  permitData: z.unknown().nullable(),
  approvalRequired: z.boolean(),
});
export type UniswapExecution = z.infer<typeof zUniswapExecution>;

export const zExchangeQuoteResponse = z.object({
  quoteSessionId: z.string(),
  selectedVenue: zVenue,
  expiresAt: z.number().int(),
  comparison: z.object({
    aqua: zAquaComparison.nullable(),
    uniswap: zUniswapComparison.nullable(),
  }),
  execution: z.discriminatedUnion("kind", [zAquaExecution, zUniswapExecution]),
});
export type ExchangeQuoteResponse = z.infer<typeof zExchangeQuoteResponse>;

export const zUniswapBuildRequest = z.object({
  quoteSessionId: z.string(),
  permitSignature: zHex.optional(),
});
export type UniswapBuildRequest = z.infer<typeof zUniswapBuildRequest>;

export const zUniswapBuildResponse = z.object({
  to: zAddress,
  data: zHex,
  value: zAmount,
  gasLimit: zAmount.nullable(),
  requestId: z.string().optional(),
});
export type UniswapBuildResponse = z.infer<typeof zUniswapBuildResponse>;

// ── Vortex Grow ────────────────────────────────────────────────────

export const zGrowScanRequest = z.object({
  chainId: zChainId,
  strategyHash: zBytes32,
  principalAmount: zAmount,
  direction: zGrowDirection.default("AUTO"),
});
export type GrowScanRequest = z.infer<typeof zGrowScanRequest>;

export const zGrowOpportunity = z.object({
  opportunityFound: z.literal(true),
  opportunityId: z.string(),
  direction: z.enum(["VORTEX_THEN_EXTERNAL", "EXTERNAL_THEN_VORTEX"]),
  principalAmount: zAmount,
  bridgeAmount: zAmount,
  maxAssetSpent: zAmount,
  minFinalAsset: zAmount,
  minimumProfit: zAmount,
  estimatedGrossProfit: zAmount,
  performanceFee: zAmount,
  expiresAt: z.number().int(),
  /** Present when the external leg comes from the Uniswap Trade API; absent
   * for the deterministic stale-pool demo venue (clearly labeled simulated). */
  uniswap: z
    .object({
      requestId: z.string(),
      routing: z.string(),
    })
    .optional(),
});
export type GrowOpportunity = z.infer<typeof zGrowOpportunity>;

export const zGrowNoOpportunity = z.object({
  opportunityFound: z.literal(false),
  reason: z.string(),
});
export type GrowNoOpportunity = z.infer<typeof zGrowNoOpportunity>;

export const zGrowScanResponse = z.discriminatedUnion("opportunityFound", [
  zGrowOpportunity,
  zGrowNoOpportunity,
]);
export type GrowScanResponse = z.infer<typeof zGrowScanResponse>;

export const zGrowPrepareRequest = z.object({
  opportunityId: z.string(),
});
export type GrowPrepareRequest = z.infer<typeof zGrowPrepareRequest>;

export const zGrowPrepareResponse = z.object({
  opportunityId: z.string(),
  to: zAddress,
  data: zHex,
  value: zAmount,
  gasEstimate: zAmount.nullable(),
  routeHash: zBytes32,
  minFinalAsset: zAmount,
  expiresAt: z.number().int(),
});
export type GrowPrepareResponse = z.infer<typeof zGrowPrepareResponse>;

export const zGrowExecuteRequest = z.object({
  opportunityId: z.string(),
});
export type GrowExecuteRequest = z.infer<typeof zGrowExecuteRequest>;

export const zGrowExecuteResponse = z.object({
  opportunityId: z.string(),
  txHash: zBytes32,
});
export type GrowExecuteResponse = z.infer<typeof zGrowExecuteResponse>;

// ── Strategy health ────────────────────────────────────────────────

export const zStrategyTokenHealth = z.object({
  address: zAddress,
  symbol: z.string(),
  /** Aqua virtual balance for this strategy. */
  virtualBalance: zAmount,
  /** Maker's actual ERC-20 balance. */
  actualBalance: zAmount,
  /** Maker's ERC-20 allowance to Aqua. */
  aquaAllowance: zAmount,
  /** min(virtualBalance, actualBalance, aquaAllowance) — what is actually executable. */
  executableBalance: zAmount,
});
export type StrategyTokenHealth = z.infer<typeof zStrategyTokenHealth>;

export const zStrategyHealth = z.object({
  strategyHash: zBytes32,
  maker: zAddress,
  active: z.boolean(),
  solvent: z.boolean(),
  /** executable/virtual coverage across tokens, in bps. */
  coverageBps: z.number(),
  tokens: z.array(zStrategyTokenHealth),
  lastUpdatedBlock: z.number().int().nullable(),
});
export type StrategyHealth = z.infer<typeof zStrategyHealth>;

// ── Executions / indexing ──────────────────────────────────────────

export const zExecutionKind = z.enum([
  "BEST_EXECUTION_AQUA",
  "BEST_EXECUTION_UNISWAP",
  "GROW",
]);
export type ExecutionKind = z.infer<typeof zExecutionKind>;

export const zExecutionRecord = z.object({
  id: z.string(),
  kind: zExecutionKind,
  chainId: zChainId,
  txHash: zBytes32.nullable(),
  blockNumber: z.number().int().nullable(),
  strategyHash: zBytes32.nullable(),
  maker: zAddress.nullable(),
  taker: zAddress.nullable(),
  tokenIn: zAddress.nullable(),
  tokenOut: zAddress.nullable(),
  amountIn: zAmount.nullable(),
  amountOut: zAmount.nullable(),
  uniswapRequestId: z.string().nullable(),
  opportunityId: z.string().nullable(),
  grossProfit: zAmount.nullable(),
  makerReturn: zAmount.nullable(),
  performanceFee: zAmount.nullable(),
  failureCategory: z.string().nullable(),
  timestamp: z.number().int(),
});
export type ExecutionRecord = z.infer<typeof zExecutionRecord>;

// ── Resolver-facing Aqua access ────────────────────────────────────

export const zResolverQuoteRequest = z.object({
  chainId: zChainId,
  tokenIn: zAddress,
  tokenOut: zAddress,
  amountIn: zAmount,
});
export type ResolverQuoteRequest = z.infer<typeof zResolverQuoteRequest>;

export const zResolverQuoteResponse = z.object({
  strategyHash: zBytes32,
  amountOut: zAmount,
  safetyFeeBps: z.number(),
  commercialFeeBps: z.number(),
  inventoryAdjustmentBps: z.number(),
  expiresAt: z.number().int(),
});
export type ResolverQuoteResponse = z.infer<typeof zResolverQuoteResponse>;

export const zResolverBuildRequest = z.object({
  chainId: zChainId,
  tokenIn: zAddress,
  tokenOut: zAddress,
  amountIn: zAmount,
  taker: zAddress,
  slippageBps: zBps.default(30),
});
export type ResolverBuildRequest = z.infer<typeof zResolverBuildRequest>;

export const zResolverBuildResponse = z.object({
  strategyHash: zBytes32,
  order: z.unknown(),
  amount: zAmount,
  takerTraitsAndData: zHex,
  minimumAmountOut: zAmount,
  expiresAt: z.number().int(),
});
export type ResolverBuildResponse = z.infer<typeof zResolverBuildResponse>;

// ── Config / health ────────────────────────────────────────────────

export const zConfigResponse = z.object({
  chainId: zChainId,
  tokens: z.array(
    z.object({ address: zAddress, symbol: z.string(), decimals: z.number().int() }),
  ),
  contracts: z.record(z.string(), zAddress),
  features: z.object({
    growEnabled: z.boolean(),
    demoMode: z.boolean(),
  }),
});
export type ConfigResponse = z.infer<typeof zConfigResponse>;

export const zHealthResponse = z.object({
  ok: z.boolean(),
  chainId: zChainId,
  uptimeSec: z.number(),
});
export type HealthResponse = z.infer<typeof zHealthResponse>;

/** Error envelope for every non-2xx response. */
export const zApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof zApiError>;
