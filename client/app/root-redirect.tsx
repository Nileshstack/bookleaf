"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { FullPageLoader } from "@/components/ui/states";
import { HOME_BY_ROLE, useAuth } from "@/lib/auth";

/** "/" sends signed-in users to their portal and everyone else to login. */
export function RootRedirect() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated" && user) router.replace(HOME_BY_ROLE[user.role]);
    if (status === "anonymous") router.replace("/login");
  }, [status, user, router]);

  return <FullPageLoader label="Opening BookLeaf" />;
}
