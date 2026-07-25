import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ARBITRUM_ONE, USDC, WBTC } from "@vortex/shared";
import { Providers } from "@/app/providers";
import { Nav } from "@/components/nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vortex",
  description:
    "One maker inventory. Three coordinated execution products on Arbitrum.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-zinc-800">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-6 text-sm text-zinc-500">
              <p>
                Vortex · {WBTC.symbol}/{USDC.symbol} · Arbitrum One (
                <span className="font-mono tabular-nums">{ARBITRUM_ONE}</span>)
              </p>
              <p>Built on 1inch Aqua, SwapVM, and Uniswap v4.</p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
