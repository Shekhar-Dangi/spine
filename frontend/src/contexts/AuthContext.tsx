"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { api } from "@/lib/api";
import type { UserOut } from "@/types";

interface AuthContextValue {
  user: UserOut | null;
  loading: boolean;
  login: (usernameOrEmail: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const PUBLIC_PATHS = ["/login", "/register", "/setup"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const refetch = async () => {
    try {
      const me = await api.auth.me();
      setUser(me);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    async function init() {
      try {
        // Check if setup is needed first
        const { needs_setup } = await api.auth.setupStatus();
        if (needs_setup) {
          if (pathname !== "/setup") {
            router.replace("/setup");
          }
          return;
        }

        // Try to get current user
        const me = await api.auth.me();
        setUser(me);

        // Redirect from auth pages to home if already logged in
        if (PUBLIC_PATHS.includes(pathname)) {
          router.replace("/");
        }
      } catch {
        setUser(null);
        // Redirect to login if not on a public path
        if (!PUBLIC_PATHS.includes(pathname)) {
          router.replace(`/login?from=${encodeURIComponent(pathname)}`);
        }
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (usernameOrEmail: string, password: string) => {
    const me = await api.auth.login(usernameOrEmail, password);
    setUser(me);
  };

  const logout = async () => {
    await api.auth.logout();
    setUser(null);
    router.replace("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
