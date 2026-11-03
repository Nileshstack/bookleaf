import type { Metadata } from "next";
import { Suspense } from "react";
import { FullPageLoader } from "@/components/ui/states";
import { LoginView } from "./login-view";

export const metadata: Metadata = { title: "Sign in" };

// LoginView reads ?next=, and search params need a Suspense boundary.
export default function LoginPage() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <LoginView />
    </Suspense>
  );
}
