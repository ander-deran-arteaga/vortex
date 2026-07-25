"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/connect-button";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/maker", label: "Maker" },
  { href: "/swap", label: "Swap" },
  { href: "/grow", label: "Grow" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/demo", label: "Demo" },
  { href: "/architecture", label: "Architecture" },
] as const;

function SpiralGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="h-5 w-5 text-teal-400"
      aria-hidden="true"
    >
      <path d="M12.6 12.9c-.9.5-2-.1-2.2-1.1-.3-1.5 1-2.8 2.5-2.8 2.2 0 3.7 2.1 3.3 4.2-.5 2.9-3.5 4.5-6.3 3.8-3.6-.9-5.6-4.7-4.5-8.2C6.7 4.4 11.4 2 15.7 3.5c3 1 5 3.6 5.6 6.6" />
    </svg>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-base font-semibold tracking-tight text-zinc-100"
        >
          <SpiralGlyph />
          Vortex
        </Link>

        <nav
          aria-label="Primary"
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap text-sm"
        >
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-md bg-teal-500/10 px-3 py-1.5 font-medium text-teal-400"
                    : "rounded-md px-3 py-1.5 text-zinc-400 transition-colors hover:text-zinc-100"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <ConnectButton />
      </div>
    </header>
  );
}
