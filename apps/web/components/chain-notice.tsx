"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { StatusMark } from "@/components/ui/primitives";

const CHAIN_NAMES: Record<number, string> = {
  42161: "Arbitrum One",
  31337: "the local Arbitrum fork",
};

function chainName(id: number): string {
  return CHAIN_NAMES[id] ?? `chain ${id}`;
}

/**
 * The wallet's chain only matters when something is broadcast. Quotes and
 * scans are priced by the API on the chain it serves, so this never blocks
 * reading a price — it appears when a connected wallet sits on a different
 * chain than the one the transaction would be sent to, and offers the switch.
 */
export function ChainNotice({ serverChainId }: { serverChainId: number | undefined }) {
  const { isConnected, chain } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chain === undefined || serverChainId === undefined) {
    return null;
  }
  if (chain.id === serverChainId) {
    return null;
  }

  return (
    <div className="panel-raised flex gap-3 p-4">
      <StatusMark tone="warn" className="mt-[7px] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-say-2">
          Your wallet is on {chainName(chain.id)}. Vortex is serving{" "}
          {chainName(serverChainId)} — switch before you execute.
        </p>
        <button
          type="button"
          onClick={() => switchChain({ chainId: serverChainId })}
          disabled={isPending}
          aria-busy={isPending}
          className="mt-2 text-sm font-medium text-warn underline-offset-4 transition-colors duration-150 hover:text-cu disabled:cursor-not-allowed disabled:text-say-3"
        >
          {isPending ? "Switching…" : `Switch to ${chainName(serverChainId)}`}
        </button>
      </div>
    </div>
  );
}
