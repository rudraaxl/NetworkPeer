import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { WorkerSession } from "./types";
import { api, clearSession, getStoredWorker, storeWorker } from "./api";

type AuthState = {
  worker: WorkerSession | null;
  loading: boolean;
  login: (phone: string, code: string) => Promise<WorkerSession>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  worker: null,
  loading: true,
  login: async () => null as unknown as WorkerSession,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [worker, setWorker] = useState<WorkerSession | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getStoredWorker();
        if (!stored) return;
        const me = await api.me();
        setWorker(me);
        await storeWorker(me);
      } catch {
        await clearSession();
        setWorker(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (phone: string, code: string) => {
    const session = await api.verifyOtp(phone, code);
    const workerSession: WorkerSession = {
      id: session.user.id,
      role: "WORKER",
      phone: session.user.phone_number,
    };
    setWorker(workerSession);
    await storeWorker(workerSession);
    return workerSession;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // api.logout already clears the local session.
    }
    setWorker(null);
  }, []);

  return (
    <AuthContext.Provider value={{ worker, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
