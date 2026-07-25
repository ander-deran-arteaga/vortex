import type { Address, Hex, TypedDataDomain } from "viem";

/**
 * Canonical EIP-712 definitions for every Vortex signed authorization.
 *
 * THIS FILE IS THE SINGLE SOURCE OF TRUTH (master-owned, MASTER R-006).
 * Solidity structs must match field-for-field, order-for-order, and the
 * verifying contracts must use exactly these domain names. Deviations are
 * bugs in the contracts, not in this file.
 */

export const EIP712_DOMAIN_VERSION = "1";

export const VORTEX_SWAP_DOMAIN_NAME = "Vortex Swap";
export const VORTEX_PERMAMM_DOMAIN_NAME = "Vortex PermAMM";
export const VORTEX_GROW_DOMAIN_NAME = "Vortex Grow";

function domain(
  name: string,
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return { name, version: EIP712_DOMAIN_VERSION, chainId, verifyingContract };
}

// ── Vortex Swap — bounded competitive rebate for an Aqua quote ─────
// The signer can only grant a bounded commercial rebate against an observed
// competitor quote; the onchain safety fee floor is immutable and out of the
// signer's reach.

export const VORTEX_QUOTE_AUTHORIZATION_TYPES = {
  VortexQuoteAuthorization: [
    { name: "orderHash", type: "bytes32" },
    { name: "quoteId", type: "bytes32" },
    { name: "competitorQuoteHash", type: "bytes32" },
    { name: "taker", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amount", type: "uint128" },
    { name: "isExactIn", type: "bool" },
    { name: "commercialRebateBps", type: "uint16" },
    { name: "deadline", type: "uint40" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export interface VortexQuoteAuthorization {
  orderHash: Hex;
  quoteId: Hex;
  competitorQuoteHash: Hex;
  taker: Address;
  tokenIn: Address;
  tokenOut: Address;
  amount: bigint;
  isExactIn: boolean;
  commercialRebateBps: number;
  /** uint40 — fits in a JS number; viem's typed-data codec expects number here. */
  deadline: number;
  nonce: bigint;
}

export function vortexQuoteAuthorizationDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return domain(VORTEX_SWAP_DOMAIN_NAME, chainId, verifyingContract);
}

// ── Vortex PermAMM — per-swap commercial fee authorization ─────────
// Consumed by VortexHook.beforeSwap. The immutable minimum safety fee is
// added on top and cannot be reduced by the signer. Binds pool, swapper,
// direction, amount, price limit, and an oracle snapshot.

export const VORTEX_PERM_FEE_AUTHORIZATION_TYPES = {
  VortexPermFeeAuthorization: [
    { name: "poolId", type: "bytes32" },
    { name: "quoteId", type: "bytes32" },
    { name: "oracleSnapshotHash", type: "bytes32" },
    { name: "swapper", type: "address" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "zeroForOne", type: "bool" },
    { name: "amountSpecified", type: "int256" },
    { name: "sqrtPriceLimitX96", type: "uint160" },
    { name: "commercialFeePips", type: "uint24" },
    { name: "deadline", type: "uint40" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export interface VortexPermFeeAuthorization {
  poolId: Hex;
  quoteId: Hex;
  oracleSnapshotHash: Hex;
  swapper: Address;
  tokenIn: Address;
  tokenOut: Address;
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
  commercialFeePips: number;
  /** uint40 — fits in a JS number; viem's typed-data codec expects number here. */
  deadline: number;
  nonce: bigint;
}

export function vortexPermFeeAuthorizationDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return domain(VORTEX_PERMAMM_DOMAIN_NAME, chainId, verifyingContract);
}

// ── Vortex Grow — signed compound route ────────────────────────────
// Consumed by VortexCompounder. Binds strategy, opportunity, direction,
// principal, bridge amount, spend cap, minimum final asset, external target
// + exact calldata hash, Vortex PermAMM hook-data hash, deadline, and nonce.
// Even a compromised signer cannot escape the target allowlist, the final
// balance check, or replay protection — those are enforced onchain.

export const VORTEX_COMPOUND_ROUTE_TYPES = {
  VortexCompoundRoute: [
    { name: "strategyHash", type: "bytes32" },
    { name: "opportunityId", type: "bytes32" },
    { name: "direction", type: "uint8" },
    { name: "principalAmount", type: "uint128" },
    { name: "bridgeAmount", type: "uint128" },
    { name: "maxAssetSpent", type: "uint128" },
    { name: "minFinalAsset", type: "uint128" },
    { name: "externalTarget", type: "address" },
    { name: "externalValue", type: "uint256" },
    { name: "externalCalldataHash", type: "bytes32" },
    { name: "permHookDataHash", type: "bytes32" },
    { name: "deadline", type: "uint40" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export interface VortexCompoundRoute {
  strategyHash: Hex;
  opportunityId: Hex;
  direction: number;
  principalAmount: bigint;
  bridgeAmount: bigint;
  maxAssetSpent: bigint;
  minFinalAsset: bigint;
  externalTarget: Address;
  externalValue: bigint;
  externalCalldataHash: Hex;
  permHookDataHash: Hex;
  /** uint40 — fits in a JS number; viem's typed-data codec expects number here. */
  deadline: number;
  nonce: bigint;
}

export function vortexCompoundRouteDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return domain(VORTEX_GROW_DOMAIN_NAME, chainId, verifyingContract);
}

/** Route direction encoding for VortexCompoundRoute.direction. */
export const COMPOUND_DIRECTION = {
  /** asset → bridge on Vortex PermAMM, bridge → asset on the external venue */
  VORTEX_THEN_EXTERNAL: 0,
  /** asset → bridge on the external venue, bridge → asset on Vortex PermAMM */
  EXTERNAL_THEN_VORTEX: 1,
} as const;
export type CompoundDirectionCode =
  (typeof COMPOUND_DIRECTION)[keyof typeof COMPOUND_DIRECTION];
