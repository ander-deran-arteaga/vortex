import { readFileSync } from "node:fs";

import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/**
 * Vortex Grow deployment: the shipped strategy plus everything the compounder
 * needs to execute a cycle. Absent when Grow is not deployed on this chain,
 * which is what keeps the endpoints honestly unavailable rather than faking a
 * compound.
 */
export interface GrowStrategyStruct {
  maker: Address;
  asset: Address;
  bridgeToken: Address;
  externalTarget: Address;
  routeSigner: Address;
  feeRecipient: Address;
  maxAmountPerExecution: bigint;
  minProfitBps: number;
  performanceFeeBps: number;
  strategyDeadline: number;
  salt: bigint;
}

/** Uniswap v4 `PoolKey`. */
export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export interface GrowDeployment {
  chainId: number;
  compounder: Address;
  strategyHash: Hex;
  strategy: GrowStrategyStruct;
  externalTarget: Address;
  /** "SIMULATED" for the deterministic mock venue — surfaced, never hidden. */
  externalVenueKind: string;
  shippedAsset: bigint;
  poolKey: PoolKey;
  /** True when the strategy asset sorts as v4 `currency0`. */
  assetIsCurrency0: boolean;
  hookAddress: Address;
  quoterAddress: Address;
  oracleAddress: Address;
}

/** `LPFeeLibrary.DYNAMIC_FEE_FLAG` — the pool prices per-swap through the hook. */
export const DYNAMIC_FEE_FLAG = 0x800000;
/** Matches `DeployPermAMM.s.sol`'s TICK_SPACING. */
export const PERM_AMM_TICK_SPACING = 60;

const DEFAULT_DEPLOYMENTS_DIR = new URL(
  "../../../../deployments/",
  import.meta.url,
);

interface RawGrow {
  chainId: number;
  compounder: Address;
  externalTarget: Address;
  externalVenueKind: string;
  growStrategyHash: Hex;
  shippedAsset: number | string;
  strategy: {
    maker: Address;
    asset: Address;
    bridgeToken: Address;
    externalTarget: Address;
    routeSigner: Address;
    feeRecipient: Address;
    maxAmountPerExecution: number | string;
    minProfitBps: number;
    performanceFeeBps: number;
    strategyDeadline: number;
    salt: number | string;
  };
}

/**
 * Rebuilds the v4 `PoolKey` from its parts. The deployment publishes only the
 * derived pool id, so the key is reconstructed and then checked against it —
 * currency ordering is address-sorted, and getting it backwards is the exact
 * bug class that bit the oracle orientation.
 */
export function derivePoolKey(
  asset: Address,
  bridgeToken: Address,
  hooks: Address,
): { poolKey: PoolKey; poolId: Hex; assetIsCurrency0: boolean } {
  const assetFirst = asset.toLowerCase() < bridgeToken.toLowerCase();
  const [currency0, currency1] = assetFirst
    ? [asset, bridgeToken]
    : [bridgeToken, asset];

  const poolKey: PoolKey = {
    currency0,
    currency1,
    fee: DYNAMIC_FEE_FLAG,
    tickSpacing: PERM_AMM_TICK_SPACING,
    hooks,
  };

  const poolId = keccak256(
    encodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
        },
      ],
      [poolKey],
    ),
  );

  return { poolKey, poolId, assetIsCurrency0: assetFirst };
}

export function loadGrowDeployment(
  chainId: number,
  contracts: Partial<Record<string, Address>>,
  expectedPoolId?: Hex,
  deploymentsDir: URL = DEFAULT_DEPLOYMENTS_DIR,
): GrowDeployment | null {
  let raw: RawGrow;
  try {
    const url = new URL(`${chainId}.grow.json`, deploymentsDir);
    raw = JSON.parse(readFileSync(url, "utf8")) as RawGrow;
  } catch {
    return null;
  }

  if (raw.chainId !== chainId) {
    throw new Error(
      `deployments/${chainId}.grow.json declares chainId ${raw.chainId}`,
    );
  }

  const hookAddress = contracts.VortexHook;
  const quoterAddress = contracts.VortexQuoter;
  const oracleAddress = contracts.MockReferenceOracle;
  if (!hookAddress || !quoterAddress || !oracleAddress) {
    // Grow's first leg is the PermAMM pool; without it there is no cycle.
    return null;
  }

  const { poolKey, poolId, assetIsCurrency0 } = derivePoolKey(
    raw.strategy.asset,
    raw.strategy.bridgeToken,
    hookAddress,
  );

  if (expectedPoolId && poolId.toLowerCase() !== expectedPoolId.toLowerCase()) {
    // A mismatch means the reconstruction is wrong, which would silently quote
    // and execute against the wrong pool.
    throw new Error(
      `derived PermAMM pool id ${poolId} does not match deployed ${expectedPoolId}`,
    );
  }

  return {
    chainId: raw.chainId,
    compounder: raw.compounder,
    strategyHash: raw.growStrategyHash,
    externalTarget: raw.externalTarget,
    externalVenueKind: raw.externalVenueKind,
    shippedAsset: BigInt(raw.shippedAsset),
    poolKey,
    assetIsCurrency0,
    hookAddress,
    quoterAddress,
    oracleAddress,
    strategy: {
      maker: raw.strategy.maker,
      asset: raw.strategy.asset,
      bridgeToken: raw.strategy.bridgeToken,
      externalTarget: raw.strategy.externalTarget,
      routeSigner: raw.strategy.routeSigner,
      feeRecipient: raw.strategy.feeRecipient,
      maxAmountPerExecution: BigInt(raw.strategy.maxAmountPerExecution),
      minProfitBps: raw.strategy.minProfitBps,
      performanceFeeBps: raw.strategy.performanceFeeBps,
      strategyDeadline: raw.strategy.strategyDeadline,
      salt: BigInt(raw.strategy.salt),
    },
  };
}
