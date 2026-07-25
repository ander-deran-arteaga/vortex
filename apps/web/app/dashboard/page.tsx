import type { Metadata } from "next";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const metadata: Metadata = {
  title: "Dashboard — Vortex",
  description:
    "Executions, venue wins, balance coverage and realized Vortex Grow profit.",
};

export default function DashboardPage() {
  return <DashboardClient />;
}
