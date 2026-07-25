/**
 * Proves the backend's taker-traits encoding is byte-compatible with the real
 * swap-vm router, and that a Vortex Swap transaction built by the API settles
 * onchain and moves real ERC-20s.
 *
 * Opt-in — needs the local 31337 stack from `scripts/bootstrap-fork.sh`:
 *   VORTEX_INTEGRATION=1 npx vitest run tests/integration/aquaSwapVm
 *
 * The taker blob is a packed byte layout, not an ABI struct, so a unit test
 * can only check it against my own understanding. Only the router can confirm
 * it, which is why this test exists.
 */
import { readFileSync } from "node:fs";

import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { beforeAll, describe, expect, it } from "vitest";

import { buildTakerTraits } from "../../src/clients/takerTraits";

const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
const ROOT = new URL("../../../../", import.meta.url).pathname;

const readJson = (name: string): Record<string, never> | null => {
  try {
    return JSON.parse(readFileSync(`${ROOT}deployments/${name}`, "utf8"));
  } catch {
    return null;
  }
};

const deployment = readJson("31337.json") as unknown as {
  contracts: Record<string, Address>;
} | null;
const demo = readJson("31337.demo.json") as unknown as {
  maker: Address;
  baseToken: Address;
  quoteToken: Address;
  strategyHash: Hex;
  order: { maker: Address; traits: Hex; data: Hex };
  sampleQuote: { amountIn: number; amountOut: number };
} | null;

const enabled =
  process.env.VORTEX_INTEGRATION === "1" && deployment !== null && demo !== null;

const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

// anvil account #2 — a taker with no prior relationship to the strategy.
const TAKER_PK: Hex =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

const routerAbi = parseAbi([
  "struct Order { address maker; uint256 traits; bytes data; }",
  "function quote(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) view returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
  "function swap(Order order, address tokenIn, address tokenOut, uint256 amount, bytes takerTraitsAndData) returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash)",
]);

describe.skipIf(!enabled)("taker traits against the real SwapVM router", () => {
  const dep = deployment!;
  const d = demo!;
  const account = privateKeyToAccount(TAKER_PK);
  const pub = createPublicClient({ chain: anvil, transport: http(RPC) });
  const wallet = createWalletClient({ account, chain: anvil, transport: http(RPC) });

  const router = dep.contracts.AquaSwapVMRouter as Address;
  const order = {
    maker: d.order.maker,
    traits: BigInt(d.order.traits),
    data: d.order.data,
  } as const;
  const amountIn = BigInt(d.sampleQuote.amountIn);
  const expectedOut = BigInt(d.sampleQuote.amountOut);

  const quoteWith = (takerTraitsAndData: Hex) =>
    pub.readContract({
      address: router,
      abi: routerAbi,
      functionName: "quote",
      args: [order, d.baseToken, d.quoteToken, amountIn, takerTraitsAndData],
    });

  beforeAll(async () => {
    const rpc = (method: string, params: unknown[]) =>
      fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
    await rpc("anvil_setBalance", [account.address, "0x8ac7230489e80000"]);
  }, 60_000);

  it("encodes unbounded traits the router accepts", async () => {
    const traits = buildTakerTraits({
      taker: account.address,
      isExactIn: true,
      threshold: null,
    });

    // 20-byte slice header + 2-byte flags, nothing else.
    expect((traits.length - 2) / 2).toBe(22);

    const [, amountOut, orderHash] = await quoteWith(traits);
    expect(amountOut).toBe(expectedOut);
    // Aqua-mode order hash IS the strategy hash.
    expect(orderHash.toLowerCase()).toBe(d.strategyHash.toLowerCase());
  });

  it("appends a 32-byte threshold without disturbing the quote", async () => {
    const traits = buildTakerTraits({
      taker: account.address,
      isExactIn: true,
      threshold: expectedOut,
    });

    expect((traits.length - 2) / 2).toBe(22 + 32);

    const [, amountOut] = await quoteWith(traits);
    expect(amountOut).toBe(expectedOut);
  });

  it("settles onchain and moves real tokens, bounded by the threshold", async () => {
    const base = d.baseToken;
    const quote = d.quoteToken;

    // Fund and approve the taker exactly as an EOA taker would.
    const [makerBaseBefore] = await Promise.all([
      pub.readContract({
        address: base,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [d.maker],
      }),
    ]);
    void makerBaseBefore;

    await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_impersonateAccount",
        params: [d.maker],
      }),
    });
    const makerWallet = createWalletClient({
      account: d.maker,
      chain: anvil,
      transport: http(RPC),
    });
    const fund = await makerWallet.writeContract({
      address: base,
      abi: erc20Abi,
      functionName: "transfer",
      args: [account.address, amountIn],
    });
    await pub.waitForTransactionReceipt({ hash: fund });

    const approve = await wallet.writeContract({
      address: base,
      abi: erc20Abi,
      functionName: "approve",
      args: [router, amountIn],
    });
    await pub.waitForTransactionReceipt({ hash: approve });

    const [, quotedOut] = await quoteWith(
      buildTakerTraits({ taker: account.address, isExactIn: true, threshold: null }),
    );

    const takerQuoteBefore = await pub.readContract({
      address: quote,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

    // Bind the floor the taker was shown — this is the whole point of the blob.
    const traits = buildTakerTraits({
      taker: account.address,
      isExactIn: true,
      threshold: quotedOut,
    });

    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: "swap",
      args: [order, base, quote, amountIn, traits],
    });

    // Broadcast the calldata unchanged, exactly as a browser would.
    const hash = await wallet.sendTransaction({ to: router, data, gas: 3_000_000n });
    const receipt = await pub.waitForTransactionReceipt({ hash });

    const takerQuoteAfter = await pub.readContract({
      address: quote,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

    expect(receipt.status).toBe("success");
    expect(takerQuoteAfter - takerQuoteBefore).toBeGreaterThanOrEqual(quotedOut);

    console.log(
      JSON.stringify({
        evidence: "VORTEX_SWAP_AQUA_SETTLEMENT",
        txHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        strategyHash: d.strategyHash,
        amountIn: amountIn.toString(),
        amountOut: (takerQuoteAfter - takerQuoteBefore).toString(),
        thresholdEnforced: quotedOut.toString(),
      }),
    );
  }, 120_000);

  it("reverts rather than settling below the taker's threshold", async () => {
    const traits = buildTakerTraits({
      taker: account.address,
      isExactIn: true,
      // Demand ten times what the maker will pay.
      threshold: expectedOut * 10n,
    });

    const data = encodeFunctionData({
      abi: routerAbi,
      functionName: "swap",
      args: [order, d.baseToken, d.quoteToken, amountIn, traits],
    });

    await expect(
      pub.call({ account: account.address, to: router, data }),
    ).rejects.toThrow();
  });
});
