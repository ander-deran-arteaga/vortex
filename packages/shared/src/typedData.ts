import type { Address, Hex, TypedDataDomain } from "viem";

// ── Vortex AMM signed per-swap dynamic fee ─────────────────────────
// Signed offchain by the market-maker signer; verified by VortexHook in
// beforeSwap for pools created with dynamic fees.

export const FEE_AUTHORIZATION_TYPES = {
  FeeAuthorization: [
    { name: "poolId", type: "bytes32" },
    { name: "feePips", type: "uint24" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface FeeAuthorization {
  poolId: Hex;
  feePips: number;
  deadline: bigint;
  nonce: bigint;
}

export function feeAuthorizationDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return { name: "VortexHook", version: "1", chainId, verifyingContract };
}

// ── Compound route authorization ───────────────────────────────────
// Signed by the backend route signer; VortexCompounder only executes
// external calls whose target/data hash matches an authorized route.

export const COMPOUND_ROUTE_TYPES = {
  CompoundRoute: [
    { name: "strategyHash", type: "bytes32" },
    { name: "principalToken", type: "address" },
    { name: "principalAmount", type: "uint256" },
    { name: "bridgeToken", type: "address" },
    { name: "bridgeAmount", type: "uint256" },
    { name: "minimumFinalAmount", type: "uint256" },
    { name: "externalTarget", type: "address" },
    { name: "externalCalldataHash", type: "bytes32" },
    { name: "externalValue", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface CompoundRoute {
  strategyHash: Hex;
  principalToken: Address;
  principalAmount: bigint;
  bridgeToken: Address;
  bridgeAmount: bigint;
  minimumFinalAmount: bigint;
  externalTarget: Address;
  externalCalldataHash: Hex;
  externalValue: bigint;
  deadline: bigint;
  nonce: bigint;
}

export function compoundRouteDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return { name: "VortexCompounder", version: "1", chainId, verifyingContract };
}

// ── Taker rebate authorization (best-execution incentives) ─────────

export const REBATE_AUTHORIZATION_TYPES = {
  RebateAuthorization: [
    { name: "strategyHash", type: "bytes32" },
    { name: "taker", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export interface RebateAuthorization {
  strategyHash: Hex;
  taker: Address;
  token: Address;
  amount: bigint;
  deadline: bigint;
  nonce: bigint;
}

export function rebateAuthorizationDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return { name: "VortexRebates", version: "1", chainId, verifyingContract };
}
