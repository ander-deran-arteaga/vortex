"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VortexMark } from "@/components/ui/vortex-mark";

const SECTIONS = [
  { href: "#problem", label: "The leak" },
  { href: "#choice", label: "The trade-off" },
  { href: "#how", label: "How it works" },
  { href: "#guarantees", label: "Guarantees" },
  { href: "#products", label: "Products" },
] as const;

/**
 * The landing header carries no wallet button: connecting is friction on a
 * marketing page and belongs where it is used. One action only, and it goes
 * straight to the product.
 *
 * The header is opaque from the first paint and only gains a tonal step once
 * the page has scrolled, so nothing here depends on JavaScript to be readable.
 */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-colors duration-300 ${
        scrolled ? "bg-ink-0/90 backdrop-blur-md" : "bg-ink-0"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6 sm:px-8">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 text-say-1"
          aria-label="Vortex, home"
        >
          <VortexMark
            size={22}
            className="text-cu transition-transform duration-500 ease-out group-hover:rotate-45"
          />
          <span className="font-display text-lg leading-none">Vortex</span>
        </Link>

        <nav
          aria-label="Sections"
          className="hidden min-w-0 flex-1 items-center gap-6 text-sm md:flex"
        >
          {SECTIONS.map((section) => (
            <a
              key={section.href}
              href={section.href}
              className="text-say-2 transition-colors duration-150 hover:text-say-1"
            >
              {section.label}
            </a>
          ))}
        </nav>

        <Link
          href="/swap"
          className="cut-tr ml-auto bg-cu px-5 py-2.5 pr-6 text-sm font-medium text-ink-0 transition-colors duration-150 hover:bg-cu-hi"
        >
          Launch App
        </Link>
      </div>
    </header>
  );
}
