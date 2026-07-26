import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
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
    "Quote like a market maker. Trust like a contract. Makers price actively while the spread, inventory limits and profit floor are enforced onchain.",
};

/**
 * The root shell holds only what both chromes genuinely share: the document
 * and the fonts. Wallet and query context live in the app group alone, so the
 * marketing group renders with no wallet, no API and no chain.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sentient.variable}>
      <body className="flex min-h-screen flex-col">{children}</body>
    </html>
  );
}
