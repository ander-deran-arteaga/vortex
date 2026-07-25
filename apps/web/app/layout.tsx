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

          <footer className="mt-16 overflow-hidden">
            {/*
              The colophon sits on the content grid rather than being split to
              opposite rims with a dead gulf between the halves.
            */}
            <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
              <div className="flex flex-wrap gap-x-10 gap-y-2 py-6 text-sm text-say-3">
                <p>
                  {WBTC.symbol}/{USDC.symbol} on Arbitrum One
                  <span className="num ml-2">{ARBITRUM_ONE}</span>
                </p>
                <p>Built on 1inch Aqua, SwapVM and Uniswap v4.</p>
              </div>
            </div>

            {/*
              The signature. Mark and wordmark are ONE object: same tone, and
              the mark sized in em so the pair scales together at every width.
              It is carved just clear of the background rather than coloured, so
              it reads as a watermark and never competes with the copper the
              interface reserves for actions. Anchored flush to the bottom with
              no gap beneath, bleeding intentionally off the edge.
            */}
            <div
              className="relative mx-auto flex w-full max-w-6xl items-end gap-[0.1em] px-6 text-[clamp(3.5rem,16vw,10.5rem)] text-ink-3 sm:px-8"
              aria-hidden="true"
            >
              <VortexMark
                size={100}
                strokeWidth={4}
                className="mb-[0.155em] h-[0.58em] w-[0.58em] shrink-0"
              />
              <p className="font-display select-none pt-[0.12em] leading-[0.74] tracking-[0.01em]">
                Vortex
              </p>
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
