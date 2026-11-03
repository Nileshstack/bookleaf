import { redirect } from "next/navigation";

// /admin itself has no screen; the dashboard is the admin home.
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
