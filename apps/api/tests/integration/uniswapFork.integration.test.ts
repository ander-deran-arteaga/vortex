/**
 * Phase 3 exit criterion: a transaction built by the Uniswap Trade API
 * actually executes onchain and moves real tokens.
 *
 * Runs against a local Arbitrum fork and the live Trade API, so it is opt-in:
 *   VORTEX_INTEGRATION=1 FORK_RPC_URL=http://127.0.0.1:8546 npx vitest run tests/integration
 * Never part of normal CI (master plan §14: live API tests are not mandatory).
 *
 * Evidence produced: the Uniswap requestId and the resulting transaction hash
 * are written to the evidence log so the demo can cite them.
 */
import { readFileSync } from "node:fs";

import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  http,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { beforeAll, describe, expect, it } from "vitest";

const WBTC: Address = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";
const USDC: Address = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

// anvil default account #0
const PRIVATE_KEY: Hex =
  "0xac0976bbd47bbcc7f9f2c50a4cea16d7c1e59d1b6d1c6e2f5b16fbdc6b6e5f0d";

function readEnvFile(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../../../../.env", import.meta.url), "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [
          l.slice(0, l.indexOf("=")).trim(),
          l.slice(l.indexOf("=") + 1).trim(),
        ]),
    );
  } catch {
    return {};
  }
}

const fileEnv = readEnvFile();
const API_KEY = process.env.UNISWAP_API_KEY ?? fileEnv.UNISWAP_API_KEY;
const FORK_URL =
  process.env.FORK_RPC_URL ?? fileEnv.FORK_RPC_URL ?? "http://127.0.0.1:8546";
const BASE =
  process.env.UNISWAP_API_BASE ??
  fileEnv.UNISWAP_API_BASE ??
  "https://trade-api.gateway.uniswap.org/v1";

const enabled = process.env.VORTEX_INTEGRATION === "1" && Boolean(API_KEY);

/**
 * Arbitrum WBTC is a proxy whose balance mapping slot is not knowable a
 * priori, so fund the swapper by impersonating an existing large holder
 * (the Aave v3 aWBTC reserve) rather than writing storage directly.
 */
const WBTC_WHALE: Address = "0x078f358208685046a11C85e8ad32895DED33A249";

async function dealWbtc(
  rpcUrl: string,
  publicClient: ReturnType<typeof createPublicClient>,
  holder: Address,
  amount: bigint,
): Promise<void> {
  const rpc = async (method: string, params: unknown[]) => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return res.json();
  };

  const whaleBalance = await publicClient.readContract({
    address: WBTC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [WBTC_WHALE],
  });
  if (whaleBalance < amount) {
    throw new Error(
      `WBTC whale ${WBTC_WHALE} holds ${whaleBalance}, needs ${amount}`,
    );
  }

  await rpc("anvil_setBalance", [WBTC_WHALE, toHex(10n ** 19n)]);
  await rpc("anvil_impersonateAccount", [WBTC_WHALE]);
  const whaleClient = createWalletClient({
    account: WBTC_WHALE,
    chain: arbitrum,
    transport: http(rpcUrl),
  });
  const hash = await whaleClient.writeContract({
    address: WBTC,
    abi: erc20Abi,
    functionName: "transfer",
    args: [holder, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  await rpc("anvil_stopImpersonatingAccount", [WBTC_WHALE]);

  const funded = await publicClient.readContract({
    address: WBTC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });
  if (funded < amount) throw new Error(`funding failed: holder has ${funded}`);
}

describe.skipIf(!enabled)("Uniswap API transaction executes on an Arbitrum fork", () => {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const publicClient = createPublicClient({
    chain: arbitrum,
    transport: http(FORK_URL),
  });
  const walletClient = createWalletClient({
    account,
    chain: arbitrum,
    transport: http(FORK_URL),
  });

  const amountIn = 1_000_000n; // 0.01 WBTC

  beforeAll(async () => {
    await fetch(FORK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "anvil_setBalance",
        params: [account.address, toHex(10n ** 19n)],
      }),
    });
    await dealWbtc(FORK_URL, publicClient, account.address, amountIn * 10n);
  }, 120_000);

  it("swaps real WBTC for real USDC using API-built calldata", async () => {
    const headers = {
      "x-api-key": API_KEY as string,
      accept: "application/json",
      "content-type": "application/json",
      "x-universal-router-version": "2.0",
    };

    const quoteRes = await fetch(`${BASE}/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "EXACT_INPUT",
        amount: amountIn.toString(),
        tokenInChainId: 42161,
        tokenOutChainId: 42161,
        tokenIn: WBTC,
        tokenOut: USDC,
        swapper: account.address,
        slippageTolerance: 0.5,
        protocols: ["V2", "V3", "V4"],
        routingPreference: "BEST_PRICE",
      }),
    });
    const quote = await quoteRes.json();
    expect(quoteRes.status, JSON.stringify(quote)).toBe(200);
    expect(quote.routing).toBe("CLASSIC");
    expect(quote.requestId).toBeTruthy();

    // Permit2 flow: approve Permit2 on the token, then let Permit2 approve the
    // Universal Router. Approving via transaction (rather than signing the
    // permit) keeps the proof independent of permit-signature handling.
    const approveHash = await walletClient.writeContract({
      address: WBTC,
      abi: erc20Abi,
      functionName: "approve",
      args: [PERMIT2, amountIn * 10n],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    const permit2Abi = parseAbi([
      "function approve(address token, address spender, uint160 amount, uint48 expiration)",
    ]);
    const universalRouter = "0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3" as Address;
    const p2Hash = await walletClient.writeContract({
      address: PERMIT2,
      abi: permit2Abi,
      functionName: "approve",
      args: [WBTC, universalRouter, amountIn * 10n, 2 ** 48 - 1],
    });
    await publicClient.waitForTransactionReceipt({ hash: p2Hash });

    // Build the transaction through the API. permitData is omitted, which the
    // live API accepts (verified) and which avoids sending permitData without
    // its required signature peer.
    const swapRes = await fetch(`${BASE}/swap`, {
      method: "POST",
      headers,
      body: JSON.stringify({ quote: quote.quote }),
    });
    const swap = await swapRes.json();
    expect(swapRes.status, JSON.stringify(swap)).toBe(200);
    expect(swap.swap?.data).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(swap.swap.data.length).toBeGreaterThan(2);
    expect(swap.swap.to.toLowerCase()).toBe(universalRouter.toLowerCase());

    const wbtcBefore = await publicClient.readContract({
      address: WBTC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    const usdcBefore = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

    // Broadcast the API's calldata completely unmodified.
    const txHash = await walletClient.sendTransaction({
      to: swap.swap.to as Address,
      data: swap.swap.data as Hex,
      value: BigInt(swap.swap.value ?? "0x00"),
      gas: 2_000_000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const wbtcAfter = await publicClient.readContract({
      address: WBTC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });
    const usdcAfter = await publicClient.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [account.address],
    });

    expect(receipt.status).toBe("success");
    expect(wbtcBefore - wbtcAfter).toBe(amountIn);
    expect(usdcAfter - usdcBefore).toBeGreaterThanOrEqual(
      BigInt(quote.quote.output.minimumAmount),
    );

    // Evidence for the demo and FEEDBACK.md.
    console.log(
      JSON.stringify({
        evidence: "UNISWAP_API_FORK_EXECUTION",
        uniswapRequestId: quote.requestId,
        swapRequestId: swap.requestId,
        txHash,
        blockNumber: receipt.blockNumber.toString(),
        wbtcSpent: (wbtcBefore - wbtcAfter).toString(),
        usdcReceived: (usdcAfter - usdcBefore).toString(),
        quotedOutput: quote.quote.output.amount,
        minimumOutput: quote.quote.output.minimumAmount,
      }),
    );
  }, 180_000);
});
