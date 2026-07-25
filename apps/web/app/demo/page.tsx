import type { Metadata } from "next";
import { DemoClient } from "@/components/demo/demo-client";

export const metadata: Metadata = {
  title: "Demo — Vortex",
  description:
    "A deterministic one-click walkthrough of the Vortex sequence, with per-step evidence.",
};

export default function DemoPage() {
  return <DemoClient />;
}
