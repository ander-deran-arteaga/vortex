"use client";

import { ConnectButton as RainbowConnectButton } from "@rainbow-me/rainbowkit";
import { Action, StatusMark } from "@/components/ui/primitives";

/**
 * RainbowKit supplies the connection flow, the wallet list and the account
 * modal. The button itself is ours, via `ConnectButton.Custom`, so the control
 * speaks the Vortex system rather than shipping RainbowKit's default pill.
 *
 * `mounted` from the render prop is RainbowKit's own hydration gate: nothing
 * wallet-derived is rendered until it is true, so server and client markup
 * cannot disagree. The placeholder that shows until then is a real, visible
 * control, never an invisible element waiting to be revealed.
 */
export function ConnectButton() {
  return (
    <RainbowConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        if (!mounted) {
          return (
            <Action disabled className="shrink-0">
              Connect
            </Action>
          );
        }

        if (account === undefined || chain === undefined) {
          return (
            <Action onClick={openConnectModal} className="shrink-0">
              Connect
            </Action>
          );
        }

        // An unsupported chain is a real warning, so it is stated in words and
        // in the warn tone, never by colour alone.
        if (chain.unsupported === true) {
          return (
            <button
              type="button"
              onClick={openChainModal}
              className="flex shrink-0 items-center gap-2.5 text-sm text-warn transition-colors duration-150 hover:text-say-1"
            >
              <StatusMark tone="warn" />
              Unsupported chain
            </button>
          );
        }

        return (
          <button
            type="button"
            onClick={openAccountModal}
            aria-label={`Account ${account.displayName}. Open wallet options.`}
            className="group flex shrink-0 items-center gap-2.5 text-left"
          >
            <StatusMark tone="gain" />
            <span className="flex flex-col items-start leading-tight">
              <span className="num text-[13px] text-say-1 transition-colors duration-150 group-hover:text-cu">
                {account.displayName}
              </span>
              <span className="text-[11px] text-say-2">{chain.name}</span>
            </span>
          </button>
        );
      }}
    </RainbowConnectButton.Custom>
  );
}
