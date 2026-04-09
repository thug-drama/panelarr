import { createContext, useCallback, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

const AuthContext = createContext(null);

async function fetchAuthStatus() {
  const resp = await fetch("/api/auth/status");
  return resp.json();
}

export function AuthProvider({ children }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["auth-status"],
    queryFn: fetchAuthStatus,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const login = useCallback(async (username, password) => {
    const resp = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const result = await resp.json();
    if (!resp.ok) {
      throw new Error(result.detail || "Login failed");
    }
    await qc.invalidateQueries({ queryKey: ["auth-status"] });
    return result;
  }, [qc]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    qc.clear();
    await qc.invalidateQueries({ queryKey: ["auth-status"] });
  }, [qc]);

  const value = useMemo(() => ({
    mode: data?.mode ?? "none",
    isAuthenticated: data?.authenticated ?? false,
    user: data?.user ?? null,
    isWritable: data?.writable ?? true,
    storedUsername: data?.username ?? "",
    hasPassword: data?.has_password ?? false,
    proxyHeader: data?.proxy_header ?? "Remote-User",
    isLoading,
    login,
    logout,
  }), [data, isLoading, login, logout]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
