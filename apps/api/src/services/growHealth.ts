import { erc20Abi, type Address, type Hex, type PublicClient } from "viem";
import type { StrategyHealth } from "@vortex/shared";

import type { GrowDeployment } from "../config/growDeployment";
import { symbolForAddress } from "../clients/tokenSymbols";

/**
 * Aqua reverts with this when a strategy is asked about a token it does not
 * hold. It means "active, different shape" — NOT "absent". Collapsing the two
 * sends operators to redeploy a perfectly healthy chain.
 */
export const SAFE_BALANCES_TOKEN_NOT_IN_STRATEGY_SELECTOR = "0xb63386a6";

export const aquaBalancesAbi = [
  {
    type: "function",
    name: "rawBalances",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "safeBalances",
    stateMutability: "view",
    inputs: [
      { name: "maker", type: "address" },
      { name: "app", type: "address" },
      { name: "strategyHash", type: "bytes32" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
    ],
    outputs: [
      { name: "balance0", type: "uint256" },
      { name: "balance1", type: "uint256" },
    ],
  },
] as const;

const BPS = 10_000;

/**
 * Health for Vortex Grow, which is a **single-asset** strategy: it ships WBTC
 * and only WBTC. Querying it as a token pair is what made Aqua revert and the
 * API report a shipped, compounding strategy as missing — so the asset set
 * comes from the deployed strategy itself, never from a hardcoded pair.
 */
export async function readGrowStrategyHealth(
  client: Pick<PublicClient, "readContract">,
  grow: GrowDeployment,
  aqua: Address,
  /** Chain-aware lookup; the canonical list does not know local mocks. */
  resolveSymbol: (address: string) => string = symbolForAddress,
): Promise<StrategyHealth | null> {
  const { maker, asset } = grow.strategy;

  const virtualBalance = await client.readContract({
    address: aqua,
    abi: aquaBalancesAbi,
    functionName: "rawBalances",
    args: [maker, grow.compounder, grow.strategyHash, asset],
  });

  // A zero virtual balance is the one honest "absent": nothing was shipped.
  if (virtualBalance === 0n) return null;

  // Same token twice — the strategy's whole asset set is one token.
  const [executableBalance] = await client.readContract({
    address: aqua,
    abi: aquaBalancesAbi,
    functionName: "safeBalances",
    args: [maker, grow.compounder, grow.strategyHash, asset, asset],
  });

  const [actualBalance, aquaAllowance] = await Promise.all([
    client.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [maker],
    }),
    client.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "allowance",
      args: [maker, aqua],
    }),
  ]);

  const coverageBps =
    virtualBalance === 0n
      ? 0
      : Number((executableBalance * BigInt(BPS)) / virtualBalance);

  return {
    strategyHash: grow.strategyHash as Hex,
    maker,
    active: virtualBalance > 0n,
    solvent: executableBalance > 0n,
    coverageBps: Math.min(coverageBps, BPS),
    tokens: [
      {
        address: asset,
        symbol: resolveSymbol(asset),
        virtualBalance: virtualBalance.toString(),
        actualBalance: actualBalance.toString(),
        aquaAllowance: aquaAllowance.toString(),
        executableBalance: executableBalance.toString(),
      },
    ],
    lastUpdatedBlock: null,
  };
}

/** True when a thrown error is Aqua's "token not in this strategy" revert. */
export function isTokenNotInStrategyRevert(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.message}${error.stack ?? ""}` : String(error);
  return (
    text.includes(SAFE_BALANCES_TOKEN_NOT_IN_STRATEGY_SELECTOR) ||
    text.includes("SafeBalancesForTokenNotInActiveStrategy")
  );
}
