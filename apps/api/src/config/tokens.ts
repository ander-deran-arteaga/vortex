import { TOKENS, USDC, WBTC, type DeploymentFile } from "@vortex/shared";
import type { Address } from "viem";

/**
 * The tradeable pair as it exists on a specific chain.
 *
 * Arbitrum One uses the canonical WBTC/USDC addresses. The local chain uses
 * blockend's mocks, which are the same assets with the same decimals at
 * different addresses. Serving the canonical addresses on 31337 would hand
 * the frontend contracts that do not exist there, so approvals and balance
 * reads would fail against an empty address — silently, since a call to a
 * non-contract returns no data rather than reverting loudly.
 */
export interface ChainToken {
  address: Address;
  symbol: string;
  decimals: number;
}

export function tokensForChain(
  chainId: number,
  deployment: DeploymentFile,
): ChainToken[] {
  const mockWbtc = deployment.contracts.MockWBTC;
  const mockUsdc = deployment.contracts.MockUSDC;

  // Decimals come from the shared constants, not from the mock: they describe
  // the asset, and the mocks are deployed to match (verified 8 / 6 onchain).
  if (chainId !== 42161 && mockWbtc && mockUsdc) {
    return [
      { address: mockWbtc, symbol: WBTC.symbol, decimals: WBTC.decimals },
      { address: mockUsdc, symbol: USDC.symbol, decimals: USDC.decimals },
    ];
  }

  return TOKENS.map((t) => ({
    address: t.address,
    symbol: t.symbol,
    decimals: t.decimals,
  }));
}

/**
 * Address -> symbol for a specific chain. Never infers a symbol from the slot
 * a token occupies, and never guesses: an address the chain does not know
 * returns "UNKNOWN" so the caller renders the address instead of a wrong name.
 */
export function makeSymbolResolver(
  tokens: readonly ChainToken[],
): (address: string) => string {
  const bySymbol = new Map(
    tokens.map((t) => [t.address.toLowerCase(), t.symbol]),
  );
  return (address: string) => bySymbol.get(address.toLowerCase()) ?? "UNKNOWN";
}
