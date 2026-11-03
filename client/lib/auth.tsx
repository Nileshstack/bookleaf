"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, onUnauthorized } from "./api";
import type { Role, User } from "./types";

type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Where each role lands after login, or when it opens the wrong area. */
export const HOME_BY_ROLE: Record<Role, string> = {
  author: "/author/dashboard",
  admin: "/admin/dashboard",
};

/**
 * Session state for the whole app. The session itself is the API's httpOnly
 * cookie. This provider only asks "who am I?" once on load, and flips to
 * anonymous whenever any API call returns 401 (expired or revoked session).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();
    api.auth
      .me(controller.signal)
      .then((u) => {
        setUser(u);
        setStatus("authenticated");
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        // 401 just means "not logged in". A network error also lands here;
        // the login page then shows its own error when the user tries.
        setUser(null);
        setStatus("anonymous");
      });
    return () => controller.abort();
  }, []);

  useEffect(
    () =>
      onUnauthorized(() => {
        setUser(null);
        setStatus("anonymous");
      }),
    [],
  );

  const login = useCallback(async (email: string, password: string) => {
    const u = await api.auth.login(email, password);
    setUser(u);
    setStatus("authenticated");
    return u;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch (err) {
      // Even if the request fails, the local session should end.
      if (!(err instanceof ApiError)) throw err;
    }
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
