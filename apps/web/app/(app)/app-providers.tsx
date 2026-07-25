"use client";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import type { ReactNode } from "react";
import "@rainbow-me/rainbowkit/styles.css";

/**
 * RainbowKit lives in the app shell only.
 *
 * It sits inside the root WagmiProvider and reuses the existing wagmi config,
 * so there is one source of truth for chains and connectors. Keeping it out of
 * the marketing group means the landing page never mounts wallet UI or its
 * stylesheet, which is what lets that page render with no wallet, no API and
 * no chain.
 *
 * The theme is tuned to the Vortex system rather than left on RainbowKit's
 * default blue, so the modal belongs to this product.
 */
const theme = darkTheme({
  accentColor: "#c8794a",
  accentColorForeground: "#0c0a09",
  borderRadius: "small",
  overlayBlur: "small",
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <RainbowKitProvider theme={theme} modalSize="compact">
      {children}
    </RainbowKitProvider>
  );
}
