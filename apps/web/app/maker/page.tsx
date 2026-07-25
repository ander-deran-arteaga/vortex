import type { Metadata } from "next";
import { MakerClient } from "@/components/maker/maker-client";

export const metadata: Metadata = {
  title: "Maker — Vortex",
  description:
    "Configure the Vortex Swap and Vortex Grow strategies, approve what Aqua may pull, and monitor balance coverage.",
};

export default function MakerPage() {
  return <MakerClient />;
}
