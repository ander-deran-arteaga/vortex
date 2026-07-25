import type { Metadata } from "next";
import { GrowClient } from "@/components/grow/grow-client";

export const metadata: Metadata = {
  title: "Grow — Vortex",
  description:
    "Vortex Grow: same-asset compounding of maker WBTC through one atomic cycle.",
};

export default function GrowPage() {
  return <GrowClient />;
}
