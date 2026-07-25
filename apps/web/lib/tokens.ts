import type { ConfigResponse } from "@vortex/shared";
import { USDC, WBTC } from "@vortex/shared";

/**
 * Which token addresses to trade against.
 *
 * `packages/shared/src/chains.ts` carries the canonical Arbitrum One addresses
 * and notes that the local chain is an Arbitrum fork, so the addresses match.
 * That is not true of the deployment we actually run against: 31337 is a bare
 * anvil with freshly-deployed mock tokens at different addresses. Quoting the
 * mainnet addresses there reaches a pool that does not exist and the Aqua
 * quote reverts (AQUA_QUOTE_REVERTED).
 *
 * `GET /api/v1/config` reports the tokens for the chain the API actually
 * serves, so it wins whenever it has answered. The shared constants remain the
 * fallback for the very first render and for a UI running with no API.
 */
export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
}

export interface ResolvedTokens {
  wbtc: TokenRef;
  usdc: TokenRef;
  all: readonly TokenRef[];
  /** True while we are still on the compile-time fallback. */
  fromConfig: boolean;
}

const FALLBACK: ResolvedTokens = {
  wbtc: { address: WBTC.address, symbol: WBTC.symbol, decimals: WBTC.decimals },
  usdc: { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals },
  all: [
    { address: WBTC.address, symbol: WBTC.symbol, decimals: WBTC.decimals },
    { address: USDC.address, symbol: USDC.symbol, decimals: USDC.decimals },
  ],
  fromConfig: false,
};

export function resolveTokens(config?: ConfigResponse): ResolvedTokens {
  if (config === undefined || config.tokens.length === 0) {
    return FALLBACK;
  }
  const bySymbol = (symbol: string): TokenRef | undefined =>
    config.tokens.find((token) => token.symbol === symbol);

  const wbtc = bySymbol("WBTC");
  const usdc = bySymbol("USDC");
  if (wbtc === undefined || usdc === undefined) {
    return FALLBACK;
  }
  return { wbtc, usdc, all: config.tokens, fromConfig: true };
}

/**
 * Decimals for an address, or undefined when the token is unknown. Callers
 * render an em dash rather than guessing: defaulting to 18 would misstate a
 * balance by ten orders of magnitude.
 */
export function decimalsFor(
  tokens: ResolvedTokens,
  address: string | null,
): number | undefined {
  if (address === null) {
    return undefined;
  }
  const needle = address.toLowerCase();
  return tokens.all.find((token) => token.address.toLowerCase() === needle)?.decimals;
}
