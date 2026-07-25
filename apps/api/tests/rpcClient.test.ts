import { http } from "viem";
import { describe, expect, it } from "vitest";

import { loadEnv } from "../src/config/env";
import {
  anvilFork,
  arbitrum,
  chainForId,
  createPublicClientForChain,
  rpcUrlForChain,
} from "../src/clients/rpcClient";

/**
 * MASTER Addendum 9 standing rule: behaviour that depends on chain id must be
 * tested in BOTH branches. `rpcUrlForChain` is the backend's chain-id switch —
 * if it inverted, the server would read the local anvil fork while reporting
 * chain 42161 (or query mainnet during a fork demo) with nothing to catch it.
 */
const ARBITRUM_RPC = "https://arb1.example.invalid/rpc";
const FORK_RPC = "http://127.0.0.1:9999";

const envFor = (chainId: "42161" | "31337") =>
  loadEnv(
    { CHAIN_ID: chainId, RPC_URL: ARBITRUM_RPC, FORK_RPC_URL: FORK_RPC },
    {},
  );

describe("rpcUrlForChain — both chain branches", () => {
  it("reads the configured Arbitrum RPC on 42161", () => {
    expect(rpcUrlForChain(envFor("42161"))).toBe(ARBITRUM_RPC);
  });

  it("reads the local fork RPC on 31337", () => {
    expect(rpcUrlForChain(envFor("31337"))).toBe(FORK_RPC);
  });

  it("never crosses the two over", () => {
    // Pins the mapping in both directions at once: inverting the ternary
    // flips both assertions, so neither branch can silently swap.
    expect(rpcUrlForChain(envFor("42161"))).not.toBe(FORK_RPC);
    expect(rpcUrlForChain(envFor("31337"))).not.toBe(ARBITRUM_RPC);
  });
});

describe("chainForId", () => {
  it("resolves both supported chains to distinct definitions", () => {
    expect(chainForId(42161).id).toBe(arbitrum.id);
    expect(chainForId(31337).id).toBe(anvilFork.id);
    expect(chainForId(42161).id).not.toBe(chainForId(31337).id);
  });

  it("rejects an unsupported chain rather than defaulting to one", () => {
    // Defaulting here would silently point the whole backend at the wrong
    // network, which is worse than failing to start.
    expect(() => chainForId(1)).toThrow(/unsupported chain id 1/);
    expect(() => chainForId(8453)).toThrow(/unsupported/);
  });
});

describe("createPublicClientForChain — both chain branches", () => {
  // An injected transport keeps this hermetic: no socket is ever opened.
  const transport = http(FORK_RPC);

  it("builds a client bound to Arbitrum One on 42161", () => {
    const client = createPublicClientForChain(envFor("42161"), { transport });
    expect(client.chain?.id).toBe(42161);
  });

  it("builds a client bound to the anvil fork on 31337", () => {
    const client = createPublicClientForChain(envFor("31337"), { transport });
    expect(client.chain?.id).toBe(31337);
  });

  it("exposes the read surface the Aqua source depends on", () => {
    const client = createPublicClientForChain(envFor("31337"), { transport });
    expect(typeof client.readContract).toBe("function");
  });
});

describe("anvilFork definition", () => {
  it("declares 18-decimal ETH as the native currency, not a token decimal", () => {
    // WBTC is 8 and USDC is 6; the *native* currency is still 18, and mixing
    // those up is the decimals bug class this repo keeps guarding against.
    expect(anvilFork.nativeCurrency.decimals).toBe(18);
    expect(anvilFork.id).toBe(31337);
  });
});
