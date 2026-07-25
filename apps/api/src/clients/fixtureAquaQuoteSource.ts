import {
  bpsOf,
  minOutAfterSlippage,
  mulDiv,
  PRICE_SCALE,
  USDC,
  WBTC,
} from "@vortex/shared";
import type { Address, Hex } from "viem";

import type { StrategyHealth, StrategyTokenHealth } from "@vortex/shared";

import type {
  AquaQuote,
  AquaQuoteSource,
  QuoteRequestParams,
} from "../services/types";
import { AQUA_SWAP_GAS_UNITS, FULL_COVERAGE_BPS } from "./liveAquaQuoteSource";

export interface FixtureToken {
  address: Address;
  decimals: number;
}

/**
 * Everything the fixture leg needs, stated explicitly — there is no randomness
 * and no clock, so the same config plus the same request always yields the
 * same quote. `kind: "fixture"` is how the API labels this data as simulated.
 */
export interface FixtureAquaConfig {
  /** Oracle mid: quote-token units per 1 base token, scaled 1e18 (E18). */
  midPriceE18: bigint;
  safetyFeeBps: number;
  commercialFeeBps: number;
  /** Signed: negative pays the taker a premium to rebalance the inventory. */
  inventoryAdjustmentBps: number;
  makerCoverageBps: number;
  active: boolean;
  solvent: boolean;
  /** Coverage below this makes the quote non-executable. */
  minimumCoverageBps: number;
  /** Forces `executable: false` with this reason, e.g. "VortexStaleOracle". */
  forcedReason: string | null;
  baseToken: FixtureToken;
  quoteToken: FixtureToken;
  gasUnits: bigint;
  /** Address reported as the maker in strategy health. */
  maker: Address;
  /** Only this hash resolves; any other is reported as not found. */
  knownStrategyHash: Hex | null;
  baseInventory: bigint;
  quoteInventory: bigint;
}

export const DEFAULT_FIXTURE_AQUA_CONFIG: FixtureAquaConfig = {
  midPriceE18: 65_000n * PRICE_SCALE,
  safetyFeeBps: 5,
  commercialFeeBps: 3,
  inventoryAdjustmentBps: 0,
  makerCoverageBps: FULL_COVERAGE_BPS,
  active: true,
  solvent: true,
  minimumCoverageBps: FULL_COVERAGE_BPS,
  forcedReason: null,
  baseToken: { address: WBTC.address, decimals: WBTC.decimals },
  quoteToken: { address: USDC.address, decimals: USDC.decimals },
  gasUnits: AQUA_SWAP_GAS_UNITS,
  maker: "0x2222222222222222222222222222222222222222",
  knownStrategyHash: null,
  baseInventory: 100_000_000n, // 1 WBTC
  quoteInventory: 65_000_000_000n, // 65_000 USDC
};

/** 8 bps all-in — beats a 30 bps AMM route at the same mid. */
export const AQUA_COMPETITIVE_FIXTURE: Partial<FixtureAquaConfig> = {
  safetyFeeBps: 5,
  commercialFeeBps: 3,
  inventoryAdjustmentBps: 0,
};

/** 150 bps all-in — a stressed strategy that any AMM route beats. */
export const AQUA_UNCOMPETITIVE_FIXTURE: Partial<FixtureAquaConfig> = {
  safetyFeeBps: 40,
  commercialFeeBps: 60,
  inventoryAdjustmentBps: 50,
};

const sameAddress = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

const pow10 = (decimals: number): bigint => 10n ** BigInt(decimals);

/** base -> quote at the configured mid, floored (never overstate the payout). */
function baseToQuote(amount: bigint, config: FixtureAquaConfig): bigint {
  return mulDiv(
    amount,
    config.midPriceE18 * pow10(config.quoteToken.decimals),
    pow10(config.baseToken.decimals) * PRICE_SCALE,
  );
}

function quoteToBase(amount: bigint, config: FixtureAquaConfig): bigint {
  return mulDiv(
    amount,
    pow10(config.baseToken.decimals) * PRICE_SCALE,
    config.midPriceE18 * pow10(config.quoteToken.decimals),
  );
}

function applyFee(gross: bigint, finalFeeBps: number): bigint {
  if (finalFeeBps >= 0) {
    const fee = bpsOf(gross, Math.min(finalFeeBps, FULL_COVERAGE_BPS));
    return gross - fee;
  }
  return gross + bpsOf(gross, -finalFeeBps);
}

/**
 * Deterministic Aqua leg for demos and tests: same maths shape as the live
 * source (mid price, fee bps, coverage gates) with zero network access.
 */
export function createFixtureAquaQuoteSource(
  overrides: Partial<FixtureAquaConfig> = {},
): AquaQuoteSource {
  const config: FixtureAquaConfig = { ...DEFAULT_FIXTURE_AQUA_CONFIG, ...overrides };

  return {
    kind: "fixture",

    strategyHealth(strategyHash: Hex): Promise<StrategyHealth | null> {
      // A fixture knows exactly one strategy. Anything else is genuinely
      // absent, which is what lets the route answer STRATEGY_NOT_FOUND
      // instead of inventing coverage for a hash nobody shipped.
      if (
        config.knownStrategyHash &&
        strategyHash.toLowerCase() !== config.knownStrategyHash.toLowerCase()
      ) {
        return Promise.resolve(null);
      }

      const token = (
        t: FixtureToken,
        symbol: string,
        balance: bigint,
      ): StrategyTokenHealth => {
        const executable = bpsOf(balance, config.makerCoverageBps);
        return {
          address: t.address,
          symbol,
          virtualBalance: balance.toString(),
          actualBalance: executable.toString(),
          aquaAllowance: executable.toString(),
          executableBalance: executable.toString(),
        };
      };

      return Promise.resolve({
        strategyHash,
        maker: config.maker,
        active: config.active,
        solvent: config.solvent,
        coverageBps: config.makerCoverageBps,
        tokens: [
          token(config.baseToken, "WBTC", config.baseInventory),
          token(config.quoteToken, "USDC", config.quoteInventory),
        ],
        lastUpdatedBlock: null,
      });
    },

    quote(params: QuoteRequestParams & { strategyHash: Hex }): Promise<AquaQuote> {
      const scaffold = {
        strategyHash: params.strategyHash,
        amountIn: params.amountIn,
        gasUnits: config.gasUnits,
        safetyFeeBps: config.safetyFeeBps,
        commercialFeeBps: config.commercialFeeBps,
        inventoryAdjustmentBps: config.inventoryAdjustmentBps,
        makerCoverageBps: config.makerCoverageBps,
        gasCostInOutputToken: null,
      };
      const blocked = (reason: string): Promise<AquaQuote> =>
        Promise.resolve({
          ...scaffold,
          amountOut: 0n,
          minimumAmountOut: 0n,
          executable: false,
          reason,
        });

      if (config.forcedReason) return blocked(config.forcedReason);

      const isBaseIn =
        sameAddress(params.tokenIn, config.baseToken.address) &&
        sameAddress(params.tokenOut, config.quoteToken.address);
      const isQuoteIn =
        sameAddress(params.tokenIn, config.quoteToken.address) &&
        sameAddress(params.tokenOut, config.baseToken.address);
      if (!isBaseIn && !isQuoteIn) return blocked("VortexUnsupportedTokenPair");

      const gross = isBaseIn
        ? baseToQuote(params.amountIn, config)
        : quoteToBase(params.amountIn, config);
      const amountOut = applyFee(
        gross,
        config.safetyFeeBps + config.commercialFeeBps + config.inventoryAdjustmentBps,
      );

      if (amountOut <= 0n) return blocked("VortexZeroAmountOut");
      if (!config.active) return blocked("AQUA_STRATEGY_INACTIVE");
      if (!config.solvent) return blocked("AQUA_STRATEGY_INSOLVENT");
      if (config.makerCoverageBps < config.minimumCoverageBps) {
        return blocked("AQUA_MAKER_NOT_COVERED");
      }

      return Promise.resolve({
        ...scaffold,
        amountOut,
        minimumAmountOut: minOutAfterSlippage(amountOut, params.slippageBps),
        executable: true,
      });
    },
  };
}
