"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = async () => {
    try {
      const me = await api.auth.me();
      setUser(me);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refetch().finally(() => setLoading(false));
  }, []);

  const login = async (usernameOrEmail: string, password: string) => {
    const me = await api.auth.login(usernameOrEmail, password);
    setUser(me);
  };

  const logout = async () => {
    await api.auth.logout();
    setUser(null);
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
