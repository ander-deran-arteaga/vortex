import {
  encodeAbiParameters,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import {
  VORTEX_COMPOUND_ROUTE_TYPES,
  VORTEX_PERM_FEE_AUTHORIZATION_TYPES,
  vortexCompoundRouteDomain,
  vortexPermFeeAuthorizationDomain,
  type VortexCompoundRoute,
  type VortexPermFeeAuthorization,
} from "@vortex/shared";

/**
 * The two signatures a Grow cycle needs.
 *
 * Neither signer can widen the maker's envelope: the hook adds an immutable
 * safety fee on top of whatever commercial fee is signed here, and the
 * compounder enforces the target allowlist, the final balance check, and
 * nonce replay onchain. A fully compromised key costs commercial margin, not
 * principal — which is why these live in the backend at all.
 */

export const PRICE_ORACLE_ABI = [
  {
    type: "function",
    name: "latestPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "midPriceE18", type: "uint256" },
      { name: "bidPriceE18", type: "uint256" },
      { name: "askPriceE18", type: "uint256" },
      { name: "updatedAt", type: "uint40" },
    ],
  },
] as const;

/** v4 price-limit sentinels; a Grow leg accepts any price the guards allow. */
export const MIN_SQRT_PRICE_PLUS_ONE = 4295128740n;
export const MAX_SQRT_PRICE_MINUS_ONE =
  1461446703485210103287273052203988822378723970342n - 1n;

export interface PermFeeSignerConfig {
  account: PrivateKeyAccount;
  chainId: number;
  /** The hook verifies the signature, so it is the verifying contract. */
  hookAddress: Address;
  poolId: Hex;
  oracleAddress: Address;
  client: Pick<PublicClient, "readContract">;
}

export interface PermHookDataParams {
  quoteId: Hex;
  swapper: Address;
  tokenIn: Address;
  tokenOut: Address;
  zeroForOne: boolean;
  amountSpecified: bigint;
  commercialFeePips: number;
  deadline: number;
  nonce: bigint;
}

/**
 * Builds the `hookData` blob VortexHook expects: the authorization struct plus
 * its signature, ABI-encoded as a pair. The oracle snapshot is hashed into the
 * struct, so an authorization signed against one price cannot be replayed
 * after the oracle moves.
 */
export async function buildPermHookData(
  config: PermFeeSignerConfig,
  params: PermHookDataParams,
): Promise<{ hookData: Hex; auth: VortexPermFeeAuthorization }> {
  const [midPriceE18, bidPriceE18, askPriceE18, updatedAt] =
    await config.client.readContract({
      address: config.oracleAddress,
      abi: PRICE_ORACLE_ABI,
      functionName: "latestPrice",
    });

  const oracleSnapshotHash = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint40" },
      ],
      [midPriceE18, bidPriceE18, askPriceE18, updatedAt],
    ),
  );

  const auth: VortexPermFeeAuthorization = {
    poolId: config.poolId,
    quoteId: params.quoteId,
    oracleSnapshotHash,
    swapper: params.swapper,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    zeroForOne: params.zeroForOne,
    amountSpecified: params.amountSpecified,
    sqrtPriceLimitX96: params.zeroForOne
      ? MIN_SQRT_PRICE_PLUS_ONE
      : MAX_SQRT_PRICE_MINUS_ONE,
    commercialFeePips: params.commercialFeePips,
    deadline: params.deadline,
    nonce: params.nonce,
  };

  const signature = await config.account.signTypedData({
    domain: vortexPermFeeAuthorizationDomain(config.chainId, config.hookAddress),
    types: VORTEX_PERM_FEE_AUTHORIZATION_TYPES,
    primaryType: "VortexPermFeeAuthorization",
    message: auth,
  });

  const hookData = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
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
      },
      { type: "bytes" },
    ],
    [auth, signature],
  );

  return { hookData, auth };
}

export interface RouteSignerConfig {
  account: PrivateKeyAccount;
  chainId: number;
  /** The compounder verifies the route signature. */
  compounderAddress: Address;
}

export async function signCompoundRoute(
  config: RouteSignerConfig,
  route: VortexCompoundRoute,
): Promise<Hex> {
  return config.account.signTypedData({
    domain: vortexCompoundRouteDomain(config.chainId, config.compounderAddress),
    types: VORTEX_COMPOUND_ROUTE_TYPES,
    primaryType: "VortexCompoundRoute",
    message: route,
  });
}

/**
 * anvil account #0. Public knowledge, and the default deployer/signer for the
 * local stack — but only ever acceptable on a throwaway chain, so it is gated
 * on the chain id rather than merely documented.
 */
const ANVIL_ACCOUNT_ZERO_KEY: Hex =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export function resolveSignerAccount(
  chainId: number,
  configuredKey: string | undefined,
  label: string,
): PrivateKeyAccount | null {
  if (configuredKey && configuredKey.trim() !== "") {
    return privateKeyToAccount(configuredKey.trim() as Hex);
  }
  if (chainId === 31337) return privateKeyToAccount(ANVIL_ACCOUNT_ZERO_KEY);
  // Never invent a signing key on a real chain.
  void label;
  return null;
}
