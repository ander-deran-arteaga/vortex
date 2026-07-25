/**
 * Minimal ERC-20 surface used by the maker interface.
 *
 * Only what the UI actually sends is declared here: `approve`. Vortex never
 * needs an infinite allowance — the maker approves the exact amount they typed
 * into the strategy form, parsed as a bigint through `lib/format.ts` — so no
 * `MAX_UINT256` constant is exported on purpose.
 */
export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export type Erc20ApproveAbi = typeof ERC20_APPROVE_ABI;

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Narrows an address that arrived as a plain string (e.g. `config.contracts`
 * from the API, typed as `Record<string, string>`) to viem's `0x${string}`.
 * Returns undefined rather than throwing so callers can disable an action
 * instead of rendering a broken panel — and so we never build a transaction
 * against a value we could not verify.
 */
export function asEvmAddress(value: string | undefined): `0x${string}` | undefined {
  if (value === undefined || !ADDRESS_PATTERN.test(value)) {
    return undefined;
  }
  return value as `0x${string}`;
}
