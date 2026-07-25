"use client";

import { useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { USDC, WBTC } from "@vortex/shared";
import { CoveragePanel } from "@/components/maker/coverage-panel";
import {
  StrategyForm,
  type StrategyField,
  type StrategyStep,
} from "@/components/maker/strategy-form";
import { PageHeader } from "@/components/page-header";
import { FixtureNotice } from "@/components/source-badge";
import { useStrategyHealth } from "@/hooks/useVortexQueries";
import { ApiRequestError } from "@/lib/api";
import { ERC20_APPROVE_ABI, asEvmAddress } from "@/lib/erc20";
import { parseTokenAmount } from "@/lib/format";
import { STRATEGY_HASHES } from "@/lib/strategy-config";

const SUPPORTED_CHAIN_IDS = [42161, 31337];
/** Aqua is not deployed from the UI; approvals target the address the API reports. */
const SHIP_BLOCKED_NOTE = "Requires the Aqua strategy contracts — Phase 2/6";

/** The API's own code in front of its message (STRATEGY_NOT_FOUND, …). */
function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

function useApproval() {
  const { writeContractAsync, isPending, error, reset } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const receipt = useWaitForTransactionReceipt({ hash });

  const approve = async (token: `0x${string}`, spender: `0x${string}`, amount: bigint) => {
    const txHash = await writeContractAsync({
      abi: ERC20_APPROVE_ABI,
      address: token,
      functionName: "approve",
      args: [spender, amount],
    });
    setHash(txHash);
    return txHash;
  };

  return { approve, isPending, error, hash, receipt, reset };
}

export function MakerClient() {
  const { isConnected, chain } = useAccount();
  const { switchChain, isPending: switchPending } = useSwitchChain();
  const wrongChain = isConnected && chain !== undefined && !SUPPORTED_CHAIN_IDS.includes(chain.id);

  // The resolved hashes, not the fixtures: a real deployment must be read
  // through the hash the demo seeding produced. `fetchStrategyHealth` only
  // falls back to a fixture for the two known fixture hashes, so a real hash
  // surfaces the API's own error instead of a fabricated healthy maker.
  const swapHealth = useStrategyHealth(STRATEGY_HASHES.swap);
  const growHealth = useStrategyHealth(STRATEGY_HASHES.grow);

  // Those errors have no other home on this page — without this a failed read
  // would render as two missing panels and no explanation.
  const healthFailures: { label: string; message: string }[] = [
    { label: "Vortex Swap strategy", error: swapHealth.error },
    { label: "Vortex Grow strategy", error: growHealth.error },
  ].flatMap(({ label, error }) =>
    error instanceof Error ? [{ label, message: describeError(error) }] : [],
  );

  const [swapForm, setSwapForm] = useState({
    wbtc: "1.00000000",
    usdc: "100000.000000",
    targetWeight: "5000",
    maxTrade: "0.50000000",
    safetyFee: "5",
    commercialFee: "10",
    inventoryStrength: "2500",
    boundLower: "3000",
    boundUpper: "7000",
    expiry: "86400",
  });
  const [growForm, setGrowForm] = useState({
    maxPerExecution: "1.00000000",
    minProfit: "0.00240000",
    performanceFee: "2000",
    maxSlippage: "50",
    expiry: "86400",
  });

  const swapApproval = useApproval();
  const growApproval = useApproval();
  const [approvalNote, setApprovalNote] = useState<string | null>(null);

  const setSwapField = (key: keyof typeof swapForm) => (value: string) =>
    setSwapForm((current) => ({ ...current, [key]: value }));
  const setGrowField = (key: keyof typeof growForm) => (value: string) =>
    setGrowForm((current) => ({ ...current, [key]: value }));

  const swapFields: StrategyField[] = [
    { key: "wbtc", label: "WBTC allocated", kind: "amount", decimals: WBTC.decimals, value: swapForm.wbtc, onChange: setSwapField("wbtc") },
    { key: "usdc", label: "USDC allocated", kind: "amount", decimals: USDC.decimals, value: swapForm.usdc, onChange: setSwapField("usdc") },
    { key: "targetWeight", label: "Target weight", kind: "bps", value: swapForm.targetWeight, onChange: setSwapField("targetWeight"), hint: "Share of inventory the strategy steers toward." },
    { key: "maxTrade", label: "Maximum trade", kind: "amount", decimals: WBTC.decimals, value: swapForm.maxTrade, onChange: setSwapField("maxTrade") },
    { key: "safetyFee", label: "Safety fee floor", kind: "bps", value: swapForm.safetyFee, onChange: setSwapField("safetyFee"), hint: "Immutable floor — quotes never price below it." },
    { key: "commercialFee", label: "Commercial fee", kind: "bps", value: swapForm.commercialFee, onChange: setSwapField("commercialFee") },
    { key: "inventoryStrength", label: "Inventory strength", kind: "bps", value: swapForm.inventoryStrength, onChange: setSwapField("inventoryStrength"), hint: "How hard pricing pushes back toward the target weight." },
    { key: "boundLower", label: "Hard weight bound — lower", kind: "bps", value: swapForm.boundLower, onChange: setSwapField("boundLower") },
    { key: "boundUpper", label: "Hard weight bound — upper", kind: "bps", value: swapForm.boundUpper, onChange: setSwapField("boundUpper") },
    { key: "swapExpiry", label: "Strategy expiry", kind: "duration", value: swapForm.expiry, onChange: setSwapField("expiry") },
  ];

  const growFields: StrategyField[] = [
    { key: "maxPerExecution", label: "Maximum WBTC per execution", kind: "amount", decimals: WBTC.decimals, value: growForm.maxPerExecution, onChange: setGrowField("maxPerExecution") },
    { key: "minProfit", label: "Minimum profit", kind: "amount", decimals: WBTC.decimals, value: growForm.minProfit, onChange: setGrowField("minProfit"), hint: "The cycle reverts below this." },
    { key: "performanceFee", label: "Performance fee", kind: "bps", value: growForm.performanceFee, onChange: setGrowField("performanceFee"), hint: "Charged on realized profit only." },
    { key: "maxSlippage", label: "Maximum slippage", kind: "bps", value: growForm.maxSlippage, onChange: setGrowField("maxSlippage") },
    { key: "growExpiry", label: "Strategy expiry", kind: "duration", value: growForm.expiry, onChange: setGrowField("expiry") },
  ];

  const approvalStatus = (
    approval: ReturnType<typeof useApproval>,
  ): StrategyStep["status"] => {
    if (approval.error) return "error";
    if (approval.receipt.isSuccess) return "done";
    if (approval.isPending || approval.receipt.isLoading) return "active";
    return "pending";
  };

  const swapSteps: StrategyStep[] = [
    { label: "Approve WBTC", status: approvalStatus(swapApproval) },
    { label: "Approve USDC", status: "pending" },
    { label: "Build strategy", status: "blocked", note: SHIP_BLOCKED_NOTE },
    { label: "Ship strategy", status: "blocked", note: SHIP_BLOCKED_NOTE },
    { label: "Read strategy hash", status: "pending" },
    { label: "Active", status: "pending" },
  ];

  const growSteps: StrategyStep[] = [
    { label: "Approve WBTC", status: approvalStatus(growApproval) },
    { label: "Ship strategy", status: "blocked", note: SHIP_BLOCKED_NOTE },
    { label: "Strategy hash", status: "pending" },
    { label: "Balances", status: "pending" },
  ];

  const handleApprove = async (
    approval: ReturnType<typeof useApproval>,
    tokenAddress: string,
    rawAmount: string,
    decimals: number,
  ) => {
    setApprovalNote(null);
    const token = asEvmAddress(tokenAddress);
    // Aqua's address comes from deployments once the contracts land; until then
    // there is no spender to approve, and we say so rather than sending a
    // transaction to an address we invented.
    const spender = asEvmAddress(process.env.NEXT_PUBLIC_AQUA_ADDRESS);
    if (token === undefined || spender === undefined) {
      setApprovalNote(
        "No Aqua address is configured yet, so there is nothing to approve. This unlocks once the strategy contracts are deployed (Phase 2/6).",
      );
      return;
    }
    try {
      const amount = parseTokenAmount(rawAmount, decimals);
      await approval.approve(token, spender, amount);
    } catch (error) {
      setApprovalNote(
        error instanceof Error ? error.message : "The approval was not sent.",
      );
    }
  };

  const walletBlocked = !isConnected || wrongChain;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-12">
      <PageHeader
        overline="Maker"
        title="Ship inventory"
        description="One inventory backs both Vortex products. Configure the market-making strategy and the compounding strategy, approve what Aqua may pull, and watch coverage as the position works."
      />

      {swapHealth.data?.source === "fixture" || growHealth.data?.source === "fixture" ? (
        <FixtureNotice className="mb-6" />
      ) : null}

      {!isConnected ? (
        <p className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-400">
          Connect a wallet to approve tokens. You can still review the strategy
          parameters without one.
        </p>
      ) : null}

      {wrongChain ? (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p className="mb-2">
            Your wallet is on an unsupported network. Vortex runs on Arbitrum
            One and the local Arbitrum fork.
          </p>
          <button
            type="button"
            onClick={() => switchChain({ chainId: 42161 })}
            disabled={switchPending}
            aria-busy={switchPending}
            className="rounded-lg border border-amber-500/50 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-40"
          >
            {switchPending ? "Switching…" : "Switch to Arbitrum One"}
          </button>
        </div>
      ) : null}

      {approvalNote === null ? null : (
        <p className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {approvalNote}
        </p>
      )}

      {healthFailures.length === 0 ? null : (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <p className="mb-1 font-medium text-red-300">
            Coverage could not be read, so the panels below are missing rather
            than empty.
          </p>
          <ul className="list-inside list-disc">
            {healthFailures.map((failure) => (
              <li key={failure.label}>
                {failure.label}: {failure.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {[
        { form: "Vortex Swap", error: swapApproval.error },
        { form: "Vortex Grow", error: growApproval.error },
      ].flatMap(({ form, error }) =>
        error ? [{ form, message: error.message }] : [],
      ).map((failure) => (
        <p
          key={failure.form}
          role="alert"
          className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          {failure.form} approval failed: {failure.message}
        </p>
      ))}

      <div className="grid gap-6 lg:grid-cols-2">
        <StrategyForm
          title="Vortex Swap — WBTC/USDC"
          description="A two-token market-making position quoted through SwapVM. Pricing leans against inventory: trades that recentre the book get a better price, trades that worsen it pay more."
          fields={swapFields}
          steps={swapSteps}
          onSubmit={() =>
            void handleApprove(swapApproval, WBTC.address, swapForm.wbtc, WBTC.decimals)
          }
          disabled={walletBlocked || swapApproval.isPending}
          busy={swapApproval.isPending}
          submitLabel={swapApproval.isPending ? "Approving…" : "Approve WBTC"}
        />

        <StrategyForm
          title="Vortex Grow — WBTC"
          description="A single-asset position. The Grow app may pull WBTC for one atomic cycle and must return more than it took, or the transaction reverts."
          fields={growFields}
          steps={growSteps}
          onSubmit={() =>
            void handleApprove(
              growApproval,
              WBTC.address,
              growForm.maxPerExecution,
              WBTC.decimals,
            )
          }
          disabled={walletBlocked || growApproval.isPending}
          busy={growApproval.isPending}
          submitLabel={growApproval.isPending ? "Approving…" : "Approve WBTC"}
        />
      </div>

      <div className="mt-6 space-y-6">
        {swapHealth.data === undefined ? null : (
          <CoveragePanel
            health={swapHealth.data.data}
            source={swapHealth.data.source}
            title="Vortex Swap — balance coverage"
          />
        )}
        {growHealth.data === undefined ? null : (
          <CoveragePanel
            health={growHealth.data.data}
            source={growHealth.data.source}
            title="Vortex Grow — balance coverage"
          />
        )}
      </div>
    </div>
  );
}
