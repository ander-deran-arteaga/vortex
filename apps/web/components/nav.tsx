"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@/components/connect-button";
import { VortexMark } from "@/components/ui/vortex-mark";

const LINKS = [
  { href: "/maker", label: "Maker" },
  { href: "/swap", label: "Swap" },
  { href: "/grow", label: "Grow" },
  { href: "/market", label: "Market" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 bg-ink-0/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-6 sm:px-8">
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 text-say-1"
          aria-label="Vortex, back to the landing page"
        >
          {/* The mark sits bare on the surface. No tile, no chip behind it. */}
          <VortexMark
            size={22}
            className="text-cu transition-transform duration-500 ease-out group-hover:rotate-45"
          />
          <span className="font-display text-lg leading-none">Vortex</span>
        </Link>

        <nav
          aria-label="Primary"
          className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto whitespace-nowrap text-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                /*
                  The active page reads through the type itself - copper ink and
                  a heavier weight - not a dot, a pill or an underline bolted on
                  beneath it.
                */
                className={
                  active
                    ? "font-medium text-cu"
                    : "text-say-2 transition-colors duration-150 hover:text-say-1"
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
