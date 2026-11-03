import type { Metadata } from "next";
import { DashboardView } from "./dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };
// Client-side auth gate: see app/author/layout.tsx.
export const instant = false;

export default function DashboardPage() {
  return <DashboardView />;
}
