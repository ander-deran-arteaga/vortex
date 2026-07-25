import Link from "next/link";
import type { ReactNode } from "react";
import { LandingHeader } from "@/components/marketing/landing-header";
import { VortexMark } from "@/components/ui/vortex-mark";

/**
 * The marketing chrome. No wallet, no API reads, no chain: this whole group
 * renders statically so a judge's first paint never depends on a running
 * backend.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LandingHeader />
      <main className="flex-1">{children}</main>

      <footer className="mt-24 overflow-hidden">
        <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
          <div className="flex flex-wrap items-center gap-x-10 gap-y-3 py-6 text-sm text-say-3">
            <p>WBTC/USDC on Arbitrum One</p>
            <p>Built on 1inch Aqua, SwapVM and Uniswap v4.</p>
            <Link
              href="/architecture"
              className="text-say-2 transition-colors duration-150 hover:text-cu"
            >
              Read the architecture
            </Link>
          </div>
        </div>

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
    </>
  );
}
