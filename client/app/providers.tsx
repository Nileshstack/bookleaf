"use client";

import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      {children}
      <Toaster
        position="top-right"
        closeButton
        toastOptions={{
          classNames: {
            toast: "!rounded-xl !border-line !shadow-pop !font-sans",
            title: "!text-ink !font-medium",
            description: "!text-muted",
          },
        }}
      />
    </AuthProvider>
  );
}
