import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { WorkerSession } from "./types";
import { api, clearSession, getStoredWorker, storeWorker } from "./api";

type AuthState = {
  worker: WorkerSession | null;
  loading: boolean;
  login: (phone: string, code: string) => Promise<{ worker: WorkerSession; isNewAccount: boolean }>;
  setWorkerName: (fullName: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState>({
  worker: null,
  loading: true,
  login: async () => ({ worker: null as unknown as WorkerSession, isNewAccount: false }),
  setWorkerName: async () => {},
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
    const result = await api.verifyOtp(phone, code);
    const workerSession: WorkerSession = {
      id: result.session.user.id,
      role: "WORKER",
      phone: result.session.user.phone_number,
      fullName: result.session.user.full_name || undefined,
    };
    setWorker(workerSession);
    await storeWorker(workerSession);
    return { worker: workerSession, isNewAccount: result.isNewAccount };
  }, []);

  const setWorkerName = useCallback(async (fullName: string) => {
    const name = fullName.trim();
    if (!name) return;
    await api.setProfileName(name);
    setWorker((current) => {
      if (!current) return current;
      const next = { ...current, fullName: name };
      void storeWorker(next);
      return next;
    });
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
    <AuthContext.Provider value={{ worker, loading, login, setWorkerName, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
