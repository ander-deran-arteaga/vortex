"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { Action, StatusMark } from "@/components/ui/primitives";
import { truncateAddress } from "@/lib/format";

/**
 * The wallet control, in the nav's own language.
 *
 * Disconnected it is the primary `Action`: copper, chamfered, the one thing in
 * the bar you can press. Connected it stops being a button-shaped object and
 * becomes a readout: the address in data type over the network it is on, quiet
 * until you hover it to disconnect. No bordered pill either way.
 */
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
      <Action disabled className="shrink-0">
        Connect
      </Action>
    );
  }

  if (isConnected && address) {
    // `chain` is undefined when the wallet is on a chain outside our config
    // (anything other than Arbitrum One or the local fork). That is a real
    // warning, so it is stated in words and in the warn tone, not colour alone.
    return (
      <button
        type="button"
        onClick={() => disconnect()}
        title="Disconnect"
        aria-label={`Disconnect ${truncateAddress(address)}`}
        className="group flex shrink-0 items-center gap-2.5 text-left"
      >
        <StatusMark tone={chain ? "gain" : "warn"} />
        <span className="flex flex-col items-start leading-tight">
          <span className="num text-[13px] text-say-1 transition-colors duration-150 group-hover:text-cu">
            {truncateAddress(address)}
          </span>
          <span
            className={
              chain
                ? "text-[11px] text-say-3 transition-colors duration-150 group-hover:text-say-2"
                : "text-[11px] text-warn"
            }
          >
            {chain ? chain.name : "Unsupported chain"}
          </span>
        </span>
      </button>
    );
  }

  return (
    <Action
      onClick={() => connect({ connector: injected() })}
      disabled={isPending}
      busy={isPending}
      className="shrink-0"
    >
      {isPending ? "Connecting…" : "Connect"}
    </Action>
  );
}
