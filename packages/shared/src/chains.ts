import type { Address } from "viem";

export const ARBITRUM_ONE = 42161;
export const LOCAL_FORK = 31337;

export const SUPPORTED_CHAIN_IDS = [ARBITRUM_ONE, LOCAL_FORK] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export function isSupportedChainId(id: number): id is SupportedChainId {
  return SUPPORTED_CHAIN_IDS.includes(id as SupportedChainId);
}

export interface TokenInfo {
  address: Address;
  symbol: "WBTC" | "USDC";
  decimals: number;
}

// The local chain (31337) is an Arbitrum One fork, so canonical token
// addresses are identical on both supported chains.
export const WBTC: TokenInfo = {
  address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",
  symbol: "WBTC",
  decimals: 8,
};

export const USDC: TokenInfo = {
  address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  symbol: "USDC",
  decimals: 6,
};

export const TOKENS: readonly TokenInfo[] = [WBTC, USDC];

export function tokenByAddress(address: string): TokenInfo | undefined {
  const needle = address.toLowerCase();
  return TOKENS.find((t) => t.address.toLowerCase() === needle);
}
