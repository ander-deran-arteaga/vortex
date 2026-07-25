import type { Address } from "viem";

export const CONTRACT_NAMES = [
  "PoolManager",
  "Aqua",
  "SwapVM",
  "VortexHook",
  "VortexRouter",
  "VortexQuoter",
  "VortexCompounder",
  "BestExecutionStrategy",
  "CompoundStrategy",
  "MockOracle",
  "MockExternalRouter",
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
