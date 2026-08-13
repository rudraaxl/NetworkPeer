import { useSyncExternalStore } from "react";

export type AppRole = "CLIENT" | "WORKER" | "ADMIN";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    role: AppRole;
    phone: string;
  };
};

const STORAGE_KEY = "networkpeer-auth-session";
let snapshot: AuthSession | null | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function readSession(): AuthSession | null {
  if (snapshot !== undefined) return snapshot;
  const stored = storage()?.getItem(STORAGE_KEY);
  if (!stored) {
    snapshot = null;
    return snapshot;
  }
  try {
    const parsed = JSON.parse(stored) as AuthSession;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id)
      throw new Error("Invalid session");
    snapshot = parsed;
  } catch {
    storage()?.removeItem(STORAGE_KEY);
    snapshot = null;
  }
  return snapshot;
}

function notify(): void {
  for (const listener of listeners) listener();
}

export const authSession = {
  get(): AuthSession | null {
    return readSession();
  },
  set(next: AuthSession): void {
    snapshot = next;
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next));
    notify();
  },
  clear(): void {
    snapshot = null;
    storage()?.removeItem(STORAGE_KEY);
    notify();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useAuthSession(): AuthSession | null {
  return useSyncExternalStore(authSession.subscribe, authSession.get, () => null);
}
