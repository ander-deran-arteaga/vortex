import { readFileSync } from "node:fs";

import type { Address, Hex } from "viem";

/**
 * The seeded Vortex Swap strategy blockend ships with `SeedDemo.s.sol`.
 *
 * The SwapVM `Order` tuple is NOT derivable from the strategy hash, so quoting
 * and transaction building both need this file. Its absence is the honest
 * signal that no live Aqua strategy exists on this chain — callers fall back
 * to the labeled fixture rather than inventing an order.
 */
export interface AquaDemoStrategy {
  chainId: number;
  maker: Address;
  strategyHash: Hex;
  baseToken: Address;
  quoteToken: Address;
  rebateSigner: Address;
  order: { maker: Address; traits: bigint; data: Hex };
  sampleQuote: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    amountOut: bigint;
    isExactIn: boolean;
  };
}

interface RawDemo {
  chainId: number;
  maker: Address;
  strategyHash: Hex;
  baseToken: Address;
  quoteToken: Address;
  rebateSigner: Address;
  order: { maker: Address; traits: Hex; data: Hex };
  sampleQuote: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: number | string;
    amountOut: number | string;
    isExactIn: boolean;
  };
}

const DEFAULT_DEPLOYMENTS_DIR = new URL(
  "../../../../deployments/",
  import.meta.url,
);

export function loadAquaDemoStrategy(
  chainId: number,
  deploymentsDir: URL = DEFAULT_DEPLOYMENTS_DIR,
  variant: "default" | "fork" = "default",
): AquaDemoStrategy | null {
  let raw: RawDemo;
  try {
    const suffix = variant === "fork" ? ".fork" : "";
    const url = new URL(`${chainId}${suffix}.demo.json`, deploymentsDir);
    raw = JSON.parse(readFileSync(url, "utf8")) as RawDemo;
  } catch {
    // No seeded strategy on this chain. Not an error — 42161 has none.
    return null;
  }

  if (raw.chainId !== chainId) {
    throw new Error(
      `deployments/${chainId}.demo.json declares chainId ${raw.chainId}`,
    );
  }

  return {
    chainId: raw.chainId,
    maker: raw.maker,
    strategyHash: raw.strategyHash,
    baseToken: raw.baseToken,
    quoteToken: raw.quoteToken,
    rebateSigner: raw.rebateSigner,
    order: {
      maker: raw.order.maker,
      // MakerTraits is a uint256 user-defined type; the file stores it as hex.
      traits: BigInt(raw.order.traits),
      data: raw.order.data,
    },
    sampleQuote: {
      tokenIn: raw.sampleQuote.tokenIn,
      tokenOut: raw.sampleQuote.tokenOut,
      amountIn: BigInt(raw.sampleQuote.amountIn),
      amountOut: BigInt(raw.sampleQuote.amountOut),
      isExactIn: raw.sampleQuote.isExactIn,
    },
  };
}
