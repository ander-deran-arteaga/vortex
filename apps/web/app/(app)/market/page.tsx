import type { Metadata } from "next";
import { MarketClient } from "@/components/market/market-client";

export const metadata: Metadata = {
  title: "Market · Vortex",
  description:
    "The same trade priced at every venue, normalised to basis points of each venue's own mid.",
};

export default function MarketPage() {
  return <MarketClient />;
}
