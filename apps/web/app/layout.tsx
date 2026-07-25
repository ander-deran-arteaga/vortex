import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ARBITRUM_ONE, USDC, WBTC } from "@vortex/shared";
import { Providers } from "@/app/providers";
import { Nav } from "@/components/nav";
import { VortexMark } from "@/components/ui/vortex-mark";
import "./globals.css";

/**
 * Sentient, self-hosted. The signature face is a deliberate choice rather than
 * whatever is trending on a free font shelf, and hosting it locally keeps the
 * build offline and the first paint free of a network round trip.
 */
const sentient = localFont({
  src: [
    { path: "./fonts/Sentient-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Sentient-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Sentient-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sentient",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vortex",
  description:
    "One maker inventory. Three coordinated execution products on Arbitrum.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sentient.variable}>
      <body className="flex min-h-screen flex-col">
        <Providers>
          <Nav />
          <main className="flex-1">{children}</main>

          <footer className="mt-24 overflow-hidden">
            <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-7 text-sm text-say-3">
                <p>
                  {WBTC.symbol}/{USDC.symbol} on Arbitrum One
                  <span className="num ml-2 text-say-3">{ARBITRUM_ONE}</span>
                </p>
                <p>Built on 1inch Aqua, SwapVM and Uniswap v4.</p>
              </div>
            </div>

            {/*
              The signature: mark and wordmark as one lockup, the mark sized in
              em so the two scale together at every width instead of one
              dwarfing the other. It sits above the substrate rather than behind
              it, anchored flush to the bottom with no gap beneath, with room
              above so no cap is shaved by the edge.
            */}
            <div
              className="relative mx-auto flex w-full max-w-6xl items-end gap-[0.14em] px-6 text-[clamp(3.5rem,16vw,10.5rem)] sm:px-8"
              aria-hidden="true"
            >
              <VortexMark
                size={100}
                strokeWidth={4}
                className="mb-[0.1em] h-[0.62em] w-[0.62em] shrink-0 text-cu-dim"
              />
              <p className="font-display select-none pt-[0.12em] leading-[0.74] tracking-[0.01em] text-ink-2">
                Vortex
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
