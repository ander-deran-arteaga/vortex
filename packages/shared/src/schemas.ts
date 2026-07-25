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

export const zCompoundDirection = z.enum([
  "AUTO",
  "VORTEX_THEN_UNISWAP",
  "UNISWAP_THEN_VORTEX",
]);
export type CompoundDirection = z.infer<typeof zCompoundDirection>;

// ── Best execution ─────────────────────────────────────────────────

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

export const zAquaComparison = z.object({
  amountOut: zAmount,
  minimumAmountOut: zAmount,
  estimatedGasUsd: z.string(),
  netAmountOut: zAmount,
  inventoryFeeBps: z.number(),
});
export type AquaComparison = z.infer<typeof zAquaComparison>;

export const zUniswapComparison = z.object({
  amountOut: zAmount,
  minimumAmountOut: zAmount,
  estimatedGasUsd: z.string(),
  netAmountOut: zAmount,
  requestId: z.string(),
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
  requestId: z.string(),
});
export type UniswapBuildResponse = z.infer<typeof zUniswapBuildResponse>;

// ── Compound ───────────────────────────────────────────────────────

export const zCompoundScanRequest = z.object({
  chainId: zChainId,
  strategyHash: zBytes32,
  principalAmount: zAmount,
  direction: zCompoundDirection.default("AUTO"),
});
export type CompoundScanRequest = z.infer<typeof zCompoundScanRequest>;

export const zCompoundOpportunity = z.object({
  opportunityFound: z.literal(true),
  opportunityId: z.string(),
  direction: z.enum(["VORTEX_THEN_UNISWAP", "UNISWAP_THEN_VORTEX"]),
  principalAmount: zAmount,
  bridgeAmount: zAmount,
  maximumPrincipalSpent: zAmount,
  minimumFinalAmount: zAmount,
  minimumProfit: zAmount,
  estimatedGrossProfit: zAmount,
  performanceFee: zAmount,
  expiresAt: z.number().int(),
  uniswap: z.object({
    requestId: z.string(),
    routing: z.string(),
  }),
});
export type CompoundOpportunity = z.infer<typeof zCompoundOpportunity>;

export const zCompoundNoOpportunity = z.object({
  opportunityFound: z.literal(false),
  reason: z.string(),
});
export type CompoundNoOpportunity = z.infer<typeof zCompoundNoOpportunity>;

export const zCompoundScanResponse = z.discriminatedUnion("opportunityFound", [
  zCompoundOpportunity,
  zCompoundNoOpportunity,
]);
export type CompoundScanResponse = z.infer<typeof zCompoundScanResponse>;

export const zCompoundPrepareRequest = z.object({
  opportunityId: z.string(),
});
export type CompoundPrepareRequest = z.infer<typeof zCompoundPrepareRequest>;

export const zCompoundPrepareResponse = z.object({
  opportunityId: z.string(),
  to: zAddress,
  data: zHex,
  value: zAmount,
  gasEstimate: zAmount.nullable(),
  routeHash: zBytes32,
  minimumFinalAmount: zAmount,
  expiresAt: z.number().int(),
});
export type CompoundPrepareResponse = z.infer<typeof zCompoundPrepareResponse>;

export const zCompoundExecuteRequest = z.object({
  opportunityId: z.string(),
});
export type CompoundExecuteRequest = z.infer<typeof zCompoundExecuteRequest>;

export const zCompoundExecuteResponse = z.object({
  opportunityId: z.string(),
  txHash: zBytes32,
});
export type CompoundExecuteResponse = z.infer<typeof zCompoundExecuteResponse>;

// ── Strategy health ────────────────────────────────────────────────

export const zStrategyHealth = z.object({
  strategyHash: zBytes32,
  maker: zAddress,
  active: z.boolean(),
  solvent: z.boolean(),
  tokens: z.array(
    z.object({
      address: zAddress,
      symbol: z.string(),
      virtualBalance: zAmount,
    }),
  ),
  lastUpdatedBlock: z.number().int().nullable(),
});
export type StrategyHealth = z.infer<typeof zStrategyHealth>;

// ── Executions / indexing ──────────────────────────────────────────

export const zExecutionKind = z.enum([
  "BEST_EXECUTION_AQUA",
  "BEST_EXECUTION_UNISWAP",
  "COMPOUND",
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

export const zAquaResolverQuoteRequest = z.object({
  chainId: zChainId,
  tokenIn: zAddress,
  tokenOut: zAddress,
  amountIn: zAmount,
});
export type AquaResolverQuoteRequest = z.infer<typeof zAquaResolverQuoteRequest>;

export const zAquaResolverQuoteResponse = z.object({
  strategyHash: zBytes32,
  amountOut: zAmount,
  inventoryFeeBps: z.number(),
  expiresAt: z.number().int(),
});
export type AquaResolverQuoteResponse = z.infer<typeof zAquaResolverQuoteResponse>;

export const zAquaResolverBuildRequest = z.object({
  chainId: zChainId,
  tokenIn: zAddress,
  tokenOut: zAddress,
  amountIn: zAmount,
  taker: zAddress,
  slippageBps: zBps.default(30),
});
export type AquaResolverBuildRequest = z.infer<typeof zAquaResolverBuildRequest>;

export const zAquaResolverBuildResponse = z.object({
  strategyHash: zBytes32,
  order: z.unknown(),
  amount: zAmount,
  takerTraitsAndData: zHex,
  minimumAmountOut: zAmount,
  expiresAt: z.number().int(),
});
export type AquaResolverBuildResponse = z.infer<typeof zAquaResolverBuildResponse>;

// ── Config / health ────────────────────────────────────────────────

export const zConfigResponse = z.object({
  chainId: zChainId,
  tokens: z.array(
    z.object({ address: zAddress, symbol: z.string(), decimals: z.number().int() }),
  ),
  contracts: z.record(z.string(), zAddress),
  features: z.object({
    compoundEnabled: z.boolean(),
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

export const zApiError = z.object({
  error: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof zApiError>;
