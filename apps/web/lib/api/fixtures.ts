import type {
  ConfigResponse,
  ExchangeQuoteRequest,
  ExchangeQuoteResponse,
  ExecutionRecord,
  GrowOpportunity,
  GrowPrepareResponse,
  GrowScanRequest,
  GrowScanResponse,
  StrategyHealth,
} from "@vortex/shared";
import { USDC, WBTC } from "@vortex/shared";

/**
 * Deterministic fixture data used while the backend comparison router
 * (Phase 3) is still landing. Everything here is schema-shaped and is ALWAYS
 * surfaced through `Sourced<T>` with `source: "fixture"` so the UI labels it.
 * No value in this file may ever be rendered without its badge.
 *
 * Reference price: 1 WBTC = 100,000 USDC. WBTC has 8 decimals, USDC 6, so a
 * WBTC base-unit amount converts to USDC base units by multiplying by 1000.
 */
const MID_PRICE_MULTIPLIER = 1000n;
const BPS = 10_000n;

/** Aqua reprices in the maker's favour when the trade recentres inventory. */
const AQUA_EDGE_BPS = 12n;
/** External venues quote below mid after their own fee and slippage. */
const UNISWAP_EDGE_BPS = -4n;

const AQUA_GAS_USD = "0.42";
const UNISWAP_GAS_USD = "1.87";

/**
 * Obviously-synthetic placeholders. These are sent as the real `strategyHash`
 * request parameter, so they must never be mistakable for a deployed
 * strategy: a repeating nibble pattern reads as fake at a glance.
 */
export const FIXTURE_STRATEGY_HASH = `0x${"f1".repeat(32)}`;
export const FIXTURE_GROW_STRATEGY_HASH = `0x${"f2".repeat(32)}`;
export const FIXTURE_MAKER = "0x1111111111111111111111111111111111111111";

function applyBps(amount: bigint, edgeBps: bigint): bigint {
  return (amount * (BPS + edgeBps)) / BPS;
}

function afterSlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * (BPS - BigInt(slippageBps))) / BPS;
}

/** "1.87" USD → USDC base units (6 decimals). */
function usdToUsdcBaseUnits(usd: string): bigint {
  const [whole = "0", fraction = ""] = usd.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

export interface QuoteFixtureOptions {
  /** Which venue should win — lets tests drive both selection branches. */
  winner?: "AQUA" | "UNISWAP";
  /** Epoch milliseconds (D-010); callers pass Date.now() outside of render. */
  now: number;
  ttlMs?: number;
}

export function buildExchangeQuoteFixture(
  request: ExchangeQuoteRequest,
  options: QuoteFixtureOptions,
): ExchangeQuoteResponse {
  const { winner = "AQUA", now, ttlMs = 45_000 } = options;
  const amountIn = BigInt(request.amountIn);
  const mid = amountIn * MID_PRICE_MULTIPLIER;

  // Flipping the edges is what makes the loser lose; every other number stays
  // derived from the same mid price so the panel stays internally consistent.
  const aquaEdge = winner === "AQUA" ? AQUA_EDGE_BPS : -20n;
  const uniswapEdge = winner === "AQUA" ? UNISWAP_EDGE_BPS : 6n;

  const aquaOut = applyBps(mid, aquaEdge);
  const uniswapOut = applyBps(mid, uniswapEdge);
  // Gas can exceed the output on a dust trade. The shared schema types every
  // amount as /^[0-9]+$/, so the floor keeps the fixture schema-valid instead
  // of emitting a negative decimal string.
  const floorAtZero = (value: bigint) => (value < 0n ? 0n : value);
  const aquaNet = floorAtZero(aquaOut - usdToUsdcBaseUnits(AQUA_GAS_USD));
  const uniswapNet = floorAtZero(uniswapOut - usdToUsdcBaseUnits(UNISWAP_GAS_USD));
  const selectedVenue = aquaNet >= uniswapNet ? "AQUA" : "UNISWAP";

  return {
    quoteSessionId: `fixture-quote-${request.amountIn}-${winner.toLowerCase()}`,
    selectedVenue,
    expiresAt: now + ttlMs,
    comparison: {
      aqua: {
        amountOut: aquaOut.toString(),
        minimumAmountOut: afterSlippage(aquaOut, request.slippageBps).toString(),
        estimatedGasUsd: AQUA_GAS_USD,
        netAmountOut: aquaNet.toString(),
        safetyFeeBps: 5,
        commercialFeeBps: 10,
        inventoryAdjustmentBps: winner === "AQUA" ? -27 : 15,
        makerCoverageBps: 10_000,
      },
      uniswap: {
        amountOut: uniswapOut.toString(),
        minimumAmountOut: afterSlippage(uniswapOut, request.slippageBps).toString(),
        estimatedGasUsd: UNISWAP_GAS_USD,
        netAmountOut: uniswapNet.toString(),
        requestId: "fixture-request-id-not-from-uniswap",
      },
    },
    execution:
      selectedVenue === "AQUA"
        ? {
            kind: "AQUA_SWAPVM",
            order: null,
            amount: request.amountIn,
            takerTraitsAndData: "0x",
          }
        : {
            kind: "UNISWAP_API",
            quoteSessionId: `fixture-quote-${request.amountIn}-${winner.toLowerCase()}`,
            permitData: null,
            approvalRequired: true,
          },
  };
}

export interface GrowFixtureOptions {
  now: number;
  ttlMs?: number;
  /** Drives the empty state without needing a live scanner. */
  opportunityFound?: boolean;
}

export function buildGrowScanFixture(
  request: GrowScanRequest,
  options: GrowFixtureOptions,
): GrowScanResponse {
  const { now, ttlMs = 30_000, opportunityFound = true } = options;
  if (!opportunityFound) {
    return {
      opportunityFound: false,
      reason: "No profitable cycle at current prices after fees and gas.",
    };
  }

  const principal = BigInt(request.principalAmount);
  const bridgeAmount = principal * MID_PRICE_MULTIPLIER;
  // A 30 bps gross edge on the round trip, of which 20% is the performance fee.
  const grossProfit = (principal * 30n) / BPS;
  const performanceFee = (grossProfit * 2000n) / BPS;
  const minimumProfit = grossProfit - performanceFee;

  const opportunity: GrowOpportunity = {
    opportunityFound: true,
    opportunityId: `fixture-opportunity-${request.principalAmount}`,
    direction: "VORTEX_THEN_EXTERNAL",
    principalAmount: request.principalAmount,
    bridgeAmount: bridgeAmount.toString(),
    maxAssetSpent: ((principal * 9980n) / BPS).toString(),
    minFinalAsset: (principal + minimumProfit).toString(),
    minimumProfit: minimumProfit.toString(),
    estimatedGrossProfit: grossProfit.toString(),
    performanceFee: performanceFee.toString(),
    expiresAt: now + ttlMs,
  };
  return opportunity;
}

export function buildGrowPrepareFixture(
  opportunityId: string,
  options: { now: number; principalAmount: string; ttlMs?: number },
): GrowPrepareResponse {
  const { now, principalAmount, ttlMs = 30_000 } = options;
  const principal = BigInt(principalAmount);
  const grossProfit = (principal * 30n) / BPS;
  const minimumProfit = grossProfit - (grossProfit * 2000n) / BPS;
  return {
    opportunityId,
    to: "0x2222222222222222222222222222222222222222",
    data: "0x",
    value: "0",
    gasEstimate: "480000",
    routeHash: `0x${"f3".repeat(32)}`,
    minFinalAsset: (principal + minimumProfit).toString(),
    expiresAt: now + ttlMs,
  };
}

export function buildStrategyHealthFixture(
  strategyHash: string,
  options: { covered?: boolean } = {},
): StrategyHealth {
  const { covered = true } = options;
  // Partial coverage models the maker having spent or un-approved part of the
  // inventory they shipped: executable is min(virtual, actual, allowance).
  const wbtcActual = covered ? "150000000" : "60000000";
  const usdcAllowance = covered ? "200000000000" : "80000000000";
  return {
    strategyHash,
    maker: FIXTURE_MAKER,
    active: true,
    solvent: covered,
    coverageBps: covered ? 10_000 : 6_000,
    tokens: [
      {
        address: WBTC.address,
        symbol: WBTC.symbol,
        virtualBalance: "100000000",
        actualBalance: wbtcActual,
        aquaAllowance: "150000000",
        executableBalance: covered ? "100000000" : "60000000",
      },
      {
        address: USDC.address,
        symbol: USDC.symbol,
        virtualBalance: "100000000000",
        actualBalance: "120000000000",
        aquaAllowance: usdcAllowance,
        executableBalance: covered ? "100000000000" : "80000000000",
      },
    ],
    lastUpdatedBlock: null,
  };
}

export function buildExecutionsFixture(options: { now: number }): ExecutionRecord[] {
  const { now } = options;
  return [
    {
      id: "fixture-exec-1",
      kind: "BEST_EXECUTION_AQUA",
      chainId: 31337,
      txHash:
        "0xaaaa000000000000000000000000000000000000000000000000000000000001",
      blockNumber: null,
      strategyHash: FIXTURE_STRATEGY_HASH,
      maker: FIXTURE_MAKER,
      taker: "0x3333333333333333333333333333333333333333",
      tokenIn: WBTC.address,
      tokenOut: USDC.address,
      amountIn: "50000000",
      amountOut: "50060000000",
      uniswapRequestId: null,
      opportunityId: null,
      grossProfit: null,
      makerReturn: null,
      performanceFee: null,
      failureCategory: null,
      timestamp: now - 240_000,
    },
    {
      id: "fixture-exec-2",
      kind: "BEST_EXECUTION_UNISWAP",
      chainId: 31337,
      txHash:
        "0xbbbb000000000000000000000000000000000000000000000000000000000002",
      blockNumber: null,
      strategyHash: FIXTURE_STRATEGY_HASH,
      maker: FIXTURE_MAKER,
      taker: "0x3333333333333333333333333333333333333333",
      tokenIn: WBTC.address,
      tokenOut: USDC.address,
      amountIn: "200000000",
      amountOut: "199920000000",
      uniswapRequestId: "fixture-request-id-not-from-uniswap",
      opportunityId: null,
      grossProfit: null,
      makerReturn: null,
      performanceFee: null,
      failureCategory: null,
      timestamp: now - 600_000,
    },
    {
      id: "fixture-exec-3",
      kind: "GROW",
      chainId: 31337,
      txHash:
        "0xcccc000000000000000000000000000000000000000000000000000000000003",
      blockNumber: null,
      strategyHash: FIXTURE_GROW_STRATEGY_HASH,
      maker: FIXTURE_MAKER,
      taker: null,
      tokenIn: WBTC.address,
      tokenOut: WBTC.address,
      amountIn: "100000000",
      amountOut: "100300000",
      uniswapRequestId: null,
      opportunityId: "fixture-opportunity-100000000",
      grossProfit: "300000",
      makerReturn: "100240000",
      performanceFee: "60000",
      failureCategory: null,
      timestamp: now - 900_000,
    },
  ];
}

export function buildConfigFixture(): ConfigResponse {
  return {
    chainId: 31337,
    tokens: [
      { address: WBTC.address, symbol: WBTC.symbol, decimals: WBTC.decimals },
      { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals },
    ],
    contracts: {},
    features: { growEnabled: false, demoMode: true },
  };
}
