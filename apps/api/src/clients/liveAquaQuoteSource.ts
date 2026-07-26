import { minOutAfterSlippage } from "@vortex/shared";
import { decodeErrorResult, type Address, type Hex, type PublicClient } from "viem";

import type { StrategyHealth, StrategyTokenHealth } from "@vortex/shared";

import { buildTakerTraits } from "./takerTraits";
import { symbolForAddress } from "./tokenSymbols";

import type {
  AquaQuote,
  AquaQuoteSource,
  QuoteRequestParams,
} from "../services/types";
import {
  aquaSwapVmRouterAbi,
  vortexAquaLensAbi,
  vortexErrorsAbi,
  VORTEX_ERROR_NAMES,
} from "./aquaAbis";

/**
 * Gas an Aqua/SwapVM settlement is expected to burn: the router call plus the
 * Aqua pull/push legs and two ERC20 transfers. Documented constant rather than
 * an eth_estimateGas, because quoting must not require the taker to already
 * hold balance/approvals. The comparator prices these units in the output
 * token from the Uniswap rate, so `gasCostInOutputToken` stays null here.
 */
export const AQUA_SWAP_GAS_UNITS = 260_000n;

/** Reason used when a revert carries no decodable Vortex custom error. */
export const AQUA_GENERIC_REVERT_REASON = "AQUA_QUOTE_REVERTED";

export const FULL_COVERAGE_BPS = 10_000;

/** `struct ISwapVM.Order` as the router and lens expect it. */
export interface AquaOrder {
  maker: Address;
  /** MakerTraits — a uint256 user-defined value type. */
  traits: bigint;
  data: Hex;
}

/** The subset of viem's PublicClient this source uses; trivially mockable. */
export type AquaReadClient = Pick<PublicClient, "readContract">;

export interface LiveAquaQuoteSourceConfig {
  client: AquaReadClient;
  lensAddress: Address;
  routerAddress: Address;
  /** Reference oracle the lens values the strategy inventory against. */
  oracleAddress: Address;
  /** Base/quote of the strategy — WBTC/USDC. Decimals never assumed here. */
  baseToken: Address;
  quoteToken: Address;
  /**
   * strategyHash -> the order it was shipped with. The order is not derivable
   * from the hash, so the caller (order builder / registry) supplies it.
   */
  resolveOrder: (strategyHash: Hex) => Promise<AquaOrder> | AquaOrder;
  /** Coverage below this makes the quote non-executable. Default: fully covered. */
  minimumCoverageBps?: number;
  /**
   * Commercial-fee rebate previewed in the breakdown.
   *
   * MVP: this is STATIC CONFIGURATION and defaults to 0. Nothing derives it
   * from the competitor's quote and no `VortexQuoteAuthorization` is signed,
   * so no rebate is ever applied on the live path. The onchain mechanism
   * exists and is tested; the backend derivation is a documented cut — see
   * docs/economic-model.md, "Competitive rebate — CUT for the MVP".
   */
  rebateBps?: number;
  /** Taker traits blob forwarded to `router.quote`; empty means "no rebate". */
  takerTraitsAndData?: Hex;
  gasUnits?: bigint;
  /** Chain-aware symbol lookup; defaults to the canonical token list. */
  resolveSymbol?: (address: string) => string;
}

interface QuoteScaffold {
  strategyHash: Hex;
  amountIn: bigint;
  gasUnits: bigint;
  safetyFeeBps: number;
  commercialFeeBps: number;
  inventoryAdjustmentBps: number;
  makerCoverageBps: number;
}

function unexecutable(scaffold: QuoteScaffold, reason: string): AquaQuote {
  return {
    ...scaffold,
    amountOut: 0n,
    minimumAmountOut: 0n,
    gasCostInOutputToken: null,
    executable: false,
    reason,
  };
}

function clampBps(value: bigint): number {
  if (value <= 0n) return 0;
  return value > BigInt(FULL_COVERAGE_BPS) ? FULL_COVERAGE_BPS : Number(value);
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const candidate = error as { shortMessage?: unknown; message?: unknown };
    if (typeof candidate.shortMessage === "string") return candidate.shortMessage;
    if (typeof candidate.message === "string") return candidate.message;
  }
  return "";
}

/** viem exposes either a decoded `{errorName, args}` or the raw revert bytes. */
function errorNameFrom(data: unknown): string | undefined {
  if (typeof data === "object" && data !== null) {
    const name = (data as { errorName?: unknown }).errorName;
    if (typeof name === "string") return name;
  }
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      return decodeErrorResult({ abi: vortexErrorsAbi, data: data as Hex })
        .errorName;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Best-effort mapping of a contract revert to the custom-error name the API
 * surfaces as `reason`. Walks the viem error cause chain, then the raw revert
 * bytes, then the message text, and finally gives up to `fallback`.
 */
export function decodeAquaRevertReason(
  error: unknown,
  fallback: string = AQUA_GENERIC_REVERT_REASON,
): string {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const node = current as { data?: unknown; raw?: unknown; cause?: unknown };
    const decoded = errorNameFrom(node.data) ?? errorNameFrom(node.raw);
    if (decoded) return decoded;
    current = node.cause;
  }
  const message = messageOf(error);
  return VORTEX_ERROR_NAMES.find((name) => message.includes(name)) ?? fallback;
}

/**
 * Plain-English gloss for the guards a taker can actually trip.
 *
 * The raw custom-error name is kept alongside this — it is what a developer
 * greps for — but a bare `VortexMaxTradeExceeded` tells someone trying to swap
 * a round number nothing about what to do next. Each of these is a maker
 * safety rule doing its job, so the message explains the rule rather than
 * apologising for it.
 */
const AQUA_REASON_EXPLANATION: Readonly<Record<string, string>> = {
  VortexMaxTradeExceeded:
    "the trade is larger than the maker's per-trade limit — try a smaller amount",
  VortexInventoryBoundBreached:
    "the trade would push the maker's inventory outside its allowed band — try a smaller amount",
  VortexMakerNotCovered:
    "the maker cannot currently settle this size (wallet balance or Aqua allowance is short)",
  VortexStaleOracle:
    "the maker's reference price is stale, so quoting is refused until it refreshes",
  VortexOracleSpreadTooWide:
    "the maker's reference price has an implausibly wide spread, so quoting is refused",
};

/**
 * `VortexMaxTradeExceeded` on its own is a fact; "…— try a smaller amount" is
 * a next step. Returns the raw name when we have no gloss for it, so nothing
 * is ever swallowed.
 */
export function explainAquaReason(reason: string): string {
  const explanation = AQUA_REASON_EXPLANATION[reason];
  return explanation === undefined ? reason : `${reason}: ${explanation}`;
}

/**
 * Live Aqua leg: the lens supplies the fee breakdown and strategy health, the
 * router supplies the amounts that settlement would actually produce.
 * Never throws — an unreachable or reverting strategy comes back as
 * `executable: false` with a reason so the comparator can fall back to Uniswap.
 */
export function createLiveAquaQuoteSource(
  config: LiveAquaQuoteSourceConfig,
): AquaQuoteSource {
  const minimumCoverageBps = config.minimumCoverageBps ?? FULL_COVERAGE_BPS;
  const rebateBps = config.rebateBps ?? 0;
  // An empty blob is NOT a valid "no options" value: TakerTraitsLib.parse
  // reads a fixed 22-byte header and reverts with TakerTraitsMissingTraits on
  // anything shorter. Quoting needs a minimal well-formed header, unbounded
  // because a view call enforces no threshold.
  const takerTraitsAndData =
    config.takerTraitsAndData ??
    buildTakerTraits({
      taker: "0x0000000000000000000000000000000000000000",
      isExactIn: true,
      threshold: null,
    });
  const gasUnits = config.gasUnits ?? AQUA_SWAP_GAS_UNITS;

  return {
    kind: "live",

    async strategyHealth(strategyHash: Hex): Promise<StrategyHealth | null> {
      let order: AquaOrder;
      try {
        order = await config.resolveOrder(strategyHash);
      } catch {
        // No order for this hash means no such strategy was ever shipped.
        return null;
      }

      const health = await config.client.readContract({
        address: config.lensAddress,
        abi: vortexAquaLensAbi,
        functionName: "strategyHealth",
        args: [
          order.maker,
          strategyHash,
          config.baseToken,
          config.quoteToken,
          config.oracleAddress,
        ],
      });

      // Symbols are derived from the address, never assumed from position:
      // labelling a maker's USDC balance "WBTC" because it sat in the quote
      // slot would misreport money.
      const token = (
        address: Address,
        entry: {
          virtualBalance: bigint;
          actualBalance: bigint;
          aquaAllowance: bigint;
          executableBalance: bigint;
        },
      ): StrategyTokenHealth => ({
        address,
        symbol: (config.resolveSymbol ?? symbolForAddress)(address),
        virtualBalance: entry.virtualBalance.toString(),
        actualBalance: entry.actualBalance.toString(),
        aquaAllowance: entry.aquaAllowance.toString(),
        executableBalance: entry.executableBalance.toString(),
      });

      return {
        strategyHash,
        maker: order.maker,
        active: health.active,
        solvent: health.solvent,
        coverageBps: clampBps(health.coverageBps),
        tokens: [
          token(config.baseToken, health.base),
          token(config.quoteToken, health.quote),
        ],
        lastUpdatedBlock: null,
      };
    },

    async quote(
      params: QuoteRequestParams & { strategyHash: Hex },
    ): Promise<AquaQuote> {
      const scaffold: QuoteScaffold = {
        strategyHash: params.strategyHash,
        amountIn: params.amountIn,
        gasUnits,
        safetyFeeBps: 0,
        commercialFeeBps: 0,
        inventoryAdjustmentBps: 0,
        makerCoverageBps: 0,
      };

      let order: AquaOrder;
      try {
        order = await config.resolveOrder(params.strategyHash);
      } catch (error) {
        return unexecutable(
          scaffold,
          decodeAquaRevertReason(error, "AQUA_ORDER_UNAVAILABLE"),
        );
      }

      let health;
      try {
        health = await config.client.readContract({
          address: config.lensAddress,
          abi: vortexAquaLensAbi,
          functionName: "strategyHealth",
          args: [
            order.maker,
            params.strategyHash,
            config.baseToken,
            config.quoteToken,
            config.oracleAddress,
          ],
        });
      } catch (error) {
        return unexecutable(
          scaffold,
          decodeAquaRevertReason(error, "AQUA_STRATEGY_HEALTH_UNAVAILABLE"),
        );
      }

      scaffold.makerCoverageBps = clampBps(health.coverageBps);

      const orderArg = {
        maker: order.maker,
        traits: order.traits,
        data: order.data,
      } as const;

      try {
        const breakdown = await config.client.readContract({
          address: config.lensAddress,
          abi: vortexAquaLensAbi,
          functionName: "quoteBreakdown",
          args: [
            orderArg,
            params.tokenIn,
            params.tokenOut,
            true, // exact-in: QuoteRequestParams always carries amountIn
            params.amountIn,
            rebateBps,
          ],
        });
        scaffold.safetyFeeBps = Number(breakdown.safetyFeeBps);
        scaffold.commercialFeeBps = Number(breakdown.commercialFeeBps);
        scaffold.inventoryAdjustmentBps = Number(breakdown.inventoryAdjustmentBps);

        const [amountIn, amountOut, orderHash] = await config.client.readContract({
          address: config.routerAddress,
          abi: aquaSwapVmRouterAbi,
          functionName: "quote",
          args: [
            orderArg,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            takerTraitsAndData,
          ],
        });

        scaffold.amountIn = amountIn;

        // Aqua-mode orderHash == strategyHash; a mismatch means the resolved
        // order is not the strategy that was requested — never quote on it.
        if (orderHash.toLowerCase() !== params.strategyHash.toLowerCase()) {
          return unexecutable(scaffold, "AQUA_ORDER_HASH_MISMATCH");
        }
        if (amountOut <= 0n) {
          return unexecutable(scaffold, "VortexZeroAmountOut");
        }
        if (!health.active) {
          return unexecutable(scaffold, "AQUA_STRATEGY_INACTIVE");
        }
        if (!health.solvent) {
          return unexecutable(scaffold, "AQUA_STRATEGY_INSOLVENT");
        }
        if (scaffold.makerCoverageBps < minimumCoverageBps) {
          return unexecutable(scaffold, "AQUA_MAKER_NOT_COVERED");
        }

        return {
          ...scaffold,
          amountOut,
          minimumAmountOut: minOutAfterSlippage(amountOut, params.slippageBps),
          gasCostInOutputToken: null,
          executable: true,
        };
      } catch (error) {
        return unexecutable(scaffold, decodeAquaRevertReason(error));
      }
    },
  };
}
