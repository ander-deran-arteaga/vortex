"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { truncateAddress } from "@/lib/format";

const BASE =
  "shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors";

export function ConnectButton() {
  // Hydration safety: wallet state differs between server and client, so we
  // render a neutral placeholder until after the first client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { address, chain, isConnected } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        className={`${BASE} border border-zinc-800 text-zinc-400`}
      >
        Connect
      </button>
    );
  }

  if (isConnected && address) {
    // `chain` is undefined when the wallet is on a chain outside our config
    // (anything other than Arbitrum One or the local fork).
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        title="Disconnect"
        aria-label={`Disconnect ${truncateAddress(address)}`}
        className={
          chain
            ? `${BASE} border border-teal-500/30 bg-teal-500/10 text-teal-400 hover:border-teal-500/60`
            : `${BASE} border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:border-amber-500/70`
        }
      >
        <span className="font-mono tabular-nums">{truncateAddress(address)}</span>
        <span className="ml-2 text-xs opacity-80">
          {chain ? chain.name : "Unsupported chain"}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => connect({ connector: injected() })}
      disabled={isPending}
      className={`${BASE} bg-teal-500 text-zinc-950 hover:bg-teal-400 disabled:opacity-60`}
    >
      {isPending ? "Connecting…" : "Connect"}
    </button>
  );
}
