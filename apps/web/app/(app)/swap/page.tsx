import type { Metadata } from "next";
import { SwapClient } from "@/components/swap/swap-client";

export const metadata: Metadata = {
  title: "Swap · Vortex",
  description:
    "Best execution across Aqua maker inventory and the Uniswap API, decided on net output after gas.",
};

export default function SwapPage() {
  return <SwapClient />;
}
