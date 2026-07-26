"use client";

import { type ReactNode, useState } from "react";
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { USDC, WBTC } from "@vortex/shared";
import { CoveragePanel } from "@/components/maker/coverage-panel";
import {
  StrategyForm,
  type StrategyField,
  type StrategyStep,
} from "@/components/maker/strategy-form";
import { FixtureNotice } from "@/components/source-badge";
import { Action, Page, PageHead, Panel, StatusMark } from "@/components/ui/primitives";
import { useConfig, useServerChainId, useStrategyHealth } from "@/hooks/useVortexQueries";
import { resolveTokens } from "@/lib/tokens";
import { ApiRequestError } from "@/lib/api";
import { ERC20_APPROVE_ABI, asEvmAddress } from "@/lib/erc20";
import { parseTokenAmount } from "@/lib/format";
import { STRATEGY_HASHES } from "@/lib/strategy-config";

/** Aqua is not deployed from the UI; approvals target the address the API reports. */
const SHIP_BLOCKED_NOTE = "Requires the Aqua strategy contracts, Phase 2/6";

/** The API's own code in front of its message (STRATEGY_NOT_FOUND, …). */
function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Every page-level condition wears the same shape: a status mark, a sentence
 * that says what is true, and the action that resolves it if there is one.
 */
function Notice({
  tone,
  lead,
  children,
  role,
}: {
  tone: "gain" | "loss" | "warn" | "muted" | "accent";
  lead?: string;
  children: ReactNode;
  role?: "alert";
}) {
  const leadTone =
    tone === "loss" ? "text-loss" : tone === "warn" ? "text-warn" : "text-say-1";
  return (
    <div role={role} className="panel-raised flex gap-3 p-4">
      <StatusMark tone={tone} className="mt-[7px] shrink-0" />
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-say-2">
        {lead === undefined ? null : <span className={leadTone}>{lead} </span>}
        {children}
      </div>
    </div>
  );
}

/** No numbers yet, so none are shown: the panel says what it is waiting for. */
function CoveragePending({ title }: { title: string }) {
  return (
    <Panel title={title} aside={<span className="text-xs text-say-3">Reading…</span>}>
      <p className="max-w-prose text-sm leading-relaxed text-say-2">
        Reading virtual balances, wallet balances and Aqua allowances for this
        strategy. Nothing is shown until the API answers, because a coverage
        figure guessed from stale state is worse than none.
      </p>
    </Panel>
  );
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
  // Approvals are transactions, so the wallet has to be on the chain this API
  // serves. That chain comes from the API, never from the wallet.
  const serverChainId = useServerChainId();
  const wrongChain =
    isConnected && chain !== undefined && serverChainId !== undefined && chain.id !== serverChainId;

  // The resolved hashes, not the fixtures: a real deployment must be read
  // through the hash the demo seeding produced. `fetchStrategyHealth` only
  // falls back to a fixture for the two known fixture hashes, so a real hash
  // surfaces the API's own error instead of a fabricated healthy maker.
  const config = useConfig();
  const tokens = resolveTokens(config.data?.data);
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
    maxTrade: "0.50000000",
    safetyFee: "5",
    commercialFee: "10",
  });
  const [growForm, setGrowForm] = useState({
    maxPerExecution: "1.00000000",
    minProfit: "0.00240000",
    maxSlippage: "50",
  });

  const swapApproval = useApproval();
  const growApproval = useApproval();
  const [approvalNote, setApprovalNote] = useState<string | null>(null);

  const setSwapField = (key: keyof typeof swapForm) => (value: string) =>
    setSwapForm((current) => ({ ...current, [key]: value }));
  const setGrowField = (key: keyof typeof growForm) => (value: string) =>
    setGrowForm((current) => ({ ...current, [key]: value }));

  // Only the parameters a reader needs to see what the strategy is doing. The
  // full set the contract accepts — weight targets, inventory strength, hard
  // bounds, expiry — is configuration, not explanation, and it belongs in the
  // shipping tool rather than on a page someone is reading to understand.
  const swapFields: StrategyField[] = [
    { key: "wbtc", label: "WBTC allocated", kind: "amount", decimals: WBTC.decimals, value: swapForm.wbtc, onChange: setSwapField("wbtc") },
    { key: "usdc", label: "USDC allocated", kind: "amount", decimals: USDC.decimals, value: swapForm.usdc, onChange: setSwapField("usdc") },
    { key: "maxTrade", label: "Maximum trade", kind: "amount", decimals: WBTC.decimals, value: swapForm.maxTrade, onChange: setSwapField("maxTrade") },
    { key: "safetyFee", label: "Safety fee floor", kind: "bps", value: swapForm.safetyFee, onChange: setSwapField("safetyFee"), hint: "Immutable floor: quotes never price below it." },
    { key: "commercialFee", label: "Commercial fee", kind: "bps", value: swapForm.commercialFee, onChange: setSwapField("commercialFee") },
  ];

  const growFields: StrategyField[] = [
    { key: "maxPerExecution", label: "Maximum WBTC per execution", kind: "amount", decimals: WBTC.decimals, value: growForm.maxPerExecution, onChange: setGrowField("maxPerExecution") },
    { key: "minProfit", label: "Minimum profit", kind: "amount", decimals: WBTC.decimals, value: growForm.minProfit, onChange: setGrowField("minProfit"), hint: "The cycle reverts below this." },
    { key: "maxSlippage", label: "Maximum slippage", kind: "bps", value: growForm.maxSlippage, onChange: setGrowField("maxSlippage") },
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

  const approvalFailures: { form: string; message: string }[] = [
    { form: "Vortex Swap", error: swapApproval.error },
    { form: "Vortex Grow", error: growApproval.error },
  ].flatMap(({ form, error }) => (error ? [{ form, message: error.message }] : []));

  const anyFixture =
    swapHealth.data?.source === "fixture" || growHealth.data?.source === "fixture";
  const hasNotices =
    anyFixture ||
    !isConnected ||
    wrongChain ||
    approvalNote !== null ||
    healthFailures.length > 0 ||
    approvalFailures.length > 0;

  return (
    <Page>
      <PageHead
        title="Ship inventory"
        lead="One inventory backs both products. Approve what Aqua may pull, and watch coverage as the position works."
      />

      {hasNotices ? (
        <div className="mb-10 space-y-3">
          {anyFixture ? <FixtureNotice /> : null}

          {!isConnected ? (
            <Notice tone="muted">
              Connect a wallet to approve tokens. You can still review the
              strategy parameters without one.
            </Notice>
          ) : null}

          {wrongChain ? (
            <Notice tone="warn" lead="Wrong network.">
              This API serves chain{" "}
              <span className="num text-say-1">{serverChainId}</span>. Approvals
              stay disabled until your wallet is on it.
              <span className="mt-3 block">
                <Action
                  onClick={() => {
                    if (serverChainId !== undefined) {
                      switchChain({ chainId: serverChainId });
                    }
                  }}
                  disabled={switchPending}
                  busy={switchPending}
                >
                  {switchPending ? "Switching…" : `Switch to chain ${serverChainId}`}
                </Action>
              </span>
            </Notice>
          ) : null}

          {approvalNote === null ? null : (
            <Notice tone="warn" lead="Nothing to approve yet.">
              {approvalNote}
            </Notice>
          )}

          {healthFailures.length === 0 ? null : (
            <Notice
              tone="loss"
              role="alert"
              lead="Coverage could not be read, so the panels below are missing rather than empty."
            >
              <ul className="mt-2 space-y-1 break-words">
                {healthFailures.map((failure) => (
                  <li key={failure.label}>
                    <span className="text-say-1">{failure.label}</span>:{" "}
                    {failure.message}
                  </li>
                ))}
              </ul>
            </Notice>
          )}

          {approvalFailures.map((failure) => (
            <Notice
              key={failure.form}
              tone="loss"
              role="alert"
              lead={`${failure.form} approval failed.`}
            >
              {failure.message}
            </Notice>
          ))}
        </div>
      ) : null}

      {/*
        Two strategies, one grid. Each form subgrids the same four rows, so the
        headers, field stacks, sequences and submit actions share baselines no
        matter that one strategy carries ten fields and the other five.
      */}
      <div className="grid gap-6 lg:grid-cols-2 lg:grid-rows-[auto_auto_1fr_auto]">
        <StrategyForm
          title="Vortex Swap · WBTC/USDC"
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
          title="Vortex Grow · WBTC"
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
        {swapHealth.data === undefined ? (
          swapHealth.error instanceof Error ? null : (
            <CoveragePending title="Vortex Swap balance coverage" />
          )
        ) : (
          <CoveragePanel
            tokens={tokens}
            health={swapHealth.data.data}
            source={swapHealth.data.source}
            title="Vortex Swap balance coverage"
          />
        )}
        {growHealth.data === undefined ? (
          growHealth.error instanceof Error ? null : (
            <CoveragePending title="Vortex Grow balance coverage" />
          )
        ) : (
          <CoveragePanel
            tokens={tokens}
            health={growHealth.data.data}
            source={growHealth.data.source}
            title="Vortex Grow balance coverage"
          />
        )}
      </div>
    </Page>
  );
}
