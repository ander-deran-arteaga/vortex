import {
  createPublicClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
  type Transport,
} from "viem";
import { arbitrum } from "viem/chains";

import type { Env } from "../config/env";

export { arbitrum };

/**
 * The demo fork: an anvil node running an Arbitrum One fork under chain id
 * 31337. viem/chains has no entry for it, so it is defined here.
 */
export const anvilFork = defineChain({
  id: 31337,
  name: "Anvil (Arbitrum fork)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
});

export const CHAINS_BY_ID: Readonly<Record<number, Chain>> = {
  [arbitrum.id]: arbitrum,
  [anvilFork.id]: anvilFork,
};

export function chainForId(chainId: number): Chain {
  const chain = CHAINS_BY_ID[chainId];
  if (!chain) throw new Error(`unsupported chain id ${chainId}`);
  return chain;
}

/**
 * 31337 reads the local fork; 42161 reads the configured Arbitrum RPC — unless
 * DEPLOYMENT_VARIANT is "fork", which means Vortex is deployed on a LOCAL fork
 * that reports chain id 42161, so the local node is the right endpoint.
 */
export function rpcUrlForChain(env: Env): string {
  if (env.DEPLOYMENT_VARIANT === "fork") return env.FORK_RPC_URL;
  return env.CHAIN_ID === anvilFork.id ? env.FORK_RPC_URL : env.RPC_URL;
}

export interface PublicClientOptions {
  /** Injected by tests so constructing a client never opens a socket. */
  transport?: Transport;
}

export function createPublicClientForChain(
  env: Env,
  options: PublicClientOptions = {},
): PublicClient {
  const chain = chainForId(env.CHAIN_ID);
  const client = createPublicClient({
    chain,
    transport: options.transport ?? http(rpcUrlForChain(env)),
  });
  // The concrete client is parameterised by the chain literal; the app only
  // ever consumes the venue-neutral PublicClient surface.
  return client as unknown as PublicClient;
}
