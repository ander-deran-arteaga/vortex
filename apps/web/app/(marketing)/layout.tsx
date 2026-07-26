import { GitHubMark, LinkedInMark } from "@/components/marketing/brand-icons";
import type { ReactNode } from "react";
import { LandingHeader } from "@/components/marketing/landing-header";

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

      <footer className="mt-24">
        <div className="mx-auto w-full max-w-6xl px-6 sm:px-8">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 py-6 text-sm text-say-3">
            <p>
              Built by <span className="text-say-2">Ander Arteaga</span>
            </p>
            <div className="flex items-center gap-4">
              <a
                href="https://github.com/ander-deran-arteaga"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Ander Arteaga on GitHub"
                className="text-say-3 transition-colors duration-150 hover:text-cu"
              >
                <GitHubMark className="size-[18px]" />
              </a>
              <a
                href="https://www.linkedin.com/in/ander-arteaga/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Ander Arteaga on LinkedIn"
                className="text-say-3 transition-colors duration-150 hover:text-cu"
              >
                <LinkedInMark className="size-[18px]" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
