import type { Metadata } from "next";
import { AdminDashboardView } from "./admin-dashboard-view";

export const metadata: Metadata = { title: "Admin dashboard" };
// Client-side auth gate: see app/admin/layout.tsx.
export const instant = false;

export default function AdminDashboardPage() {
  return <AdminDashboardView />;
}
