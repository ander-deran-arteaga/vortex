import { tokenByAddress } from "@vortex/shared";

/**
 * Resolves a token symbol from its address.
 *
 * Never infer a symbol from the slot a token occupies: a maker's USDC balance
 * rendered as "WBTC" because it sat in the quote position misreports money by
 * four orders of magnitude. An address Vortex does not know returns "UNKNOWN"
 * rather than a guess — the caller still has the address to render.
 */
export function symbolForAddress(address: string): string {
  return tokenByAddress(address)?.symbol ?? "UNKNOWN";
}
