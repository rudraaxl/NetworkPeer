import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { toast } from "sonner";

import { api, realtimeBaseUrl, type SyncEvent } from "@/lib/api";
import { useAuthSession } from "@/lib/auth-session";

function cursorStorageKey(userId: string): string {
  return `networkpeer-sync-cursor:${userId}`;
}

function storedCursor(userId: string): string {
  if (typeof window === "undefined") return "0";
  return window.sessionStorage.getItem(cursorStorageKey(userId)) ?? "0";
}

function saveCursor(userId: string, cursor: string): void {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(cursorStorageKey(userId), cursor);
  }
}

/** Reconciles durable cursor sync after reconnects and invalidates live UI data. */
export function RealtimeSyncBridge() {
  const session = useAuthSession();
  const queryClient = useQueryClient();
  const seenEventIds = useRef(new Set<string>());

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let reconciliation: Promise<void> | undefined;
    const applyEvent = (event: SyncEvent, showToast: boolean) => {
      if (seenEventIds.current.has(event.event_id)) return;
      seenEventIds.current.add(event.event_id);
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
      void queryClient.invalidateQueries({ queryKey: ["sync"] });
      void queryClient.invalidateQueries({ queryKey: ["client", "jobs"] });
      void queryClient.invalidateQueries({ queryKey: ["worker", "jobs"] });
      if (showToast && event.notification) {
        toast.info(event.notification.title, { description: event.notification.body });
      }
    };
    const reconcile = async () => {
      if (reconciliation) return reconciliation;
      reconciliation = (async () => {
        let cursor = storedCursor(session.user.id);
        for (;;) {
          const page = await api.sync(cursor);
          if (cancelled) return;
          for (const event of page.events) applyEvent(event, false);
          cursor = page.next_cursor;
          saveCursor(session.user.id, cursor);
          if (!page.has_more) return;
        }
      })().finally(() => {
        reconciliation = undefined;
      });
      return reconciliation;
    };
    const socket = io(realtimeBaseUrl(), {
      path: `${import.meta.env.VITE_API_PREFIX ?? "/api/v1"}/realtime`,
      auth: { token: session.accessToken },
      transports: ["websocket", "polling"],
    });
    socket.on("sync:ready", () => {
      void reconcile().catch(() => undefined);
    });
    socket.on("sync:event", (event: SyncEvent) => {
      applyEvent(event, true);
      // Live delivery is an optimization; REST sync advances the durable checkpoint in order.
      void reconcile().catch(() => undefined);
    });
    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [queryClient, session]);

  return null;
}
