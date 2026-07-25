import type { Address } from "viem";

/**
 * Contract names as they appear in deployments/<chainId>.json.
 * Kept in lockstep with coordination/interfaces/contracts.md — blockend
 * writes addresses as contracts deploy; absent key = not deployed yet.
 */
export const CONTRACT_NAMES = [
  "PoolManager",
  "Aqua",
  "AquaSwapVMRouter",
  "MockWBTC",
  "MockUSDC",
  "MockReferenceOracle",
  "MockStalePool",
  "MockExternalRouter",
  "VortexAquaPricing",
  "VortexAquaOrderBuilder",
  "VortexAquaLens",
  "VortexAquaRouter",
  "VortexHook",
  "VortexRouter",
  "VortexQuoter",
  "VortexLiquidityManager",
  "VortexFeeAuthorization",
  "VortexCompounder",
  "VortexRouteValidator",
  "VortexSystemLens",
] as const;
export type ContractName = (typeof CONTRACT_NAMES)[number];

/** Shape of deployments/<chainId>.json — blockend writes, everyone reads. */
export interface DeploymentFile {
  chainId: number;
  contracts: Partial<Record<ContractName, Address>>;
}

export function getContractAddress(
  deployment: DeploymentFile,
  name: ContractName,
): Address {
  const address = deployment.contracts[name];
  if (!address) {
    throw new Error(
      `contract ${name} not deployed on chain ${deployment.chainId}`,
    );
  }
  return address;
}

/**
 * Canonical Vortex event names (master plan §11.2 / §12.5). Solidity and the
 * indexer both bind to these exact names.
 */
export const VORTEX_EVENT_NAMES = {
  permSwap: "VortexPermSwap",
  growExecuted: "VortexGrowExecuted",
} as const;
