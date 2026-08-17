import { api } from "@/lib/api";

export type PendingMediaType = "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";

export type PendingEvidence = {
  id: string;
  file: Blob;
  fileName: string;
  mimeType: string;
  mediaType: PendingMediaType;
  fileSizeBytes: number;
  jobId: string;
  subtaskId: string;
  capturedAt: string;
  location?: { latitude: number; longitude: number } | null;
  checksumSha256: string;
  idempotencyKey: string;
  reservation?: {
    uploadUrl: string;
    fields: Record<string, string>;
    evidenceId: string;
    expiresAt: number;
  };
  attempts: number;
  createdAt: number;
  lastError?: string;
};

const DB_NAME = "networkpeer-evidence";
const STORE = "pending";
const QUEUE_EVENT = "np:evidence-queue";
const RESERVATION_SLACK_MS = 60_000;
const AUTO_FLUSH_MAX_ATTEMPTS = 8;

let dbPromise: Promise<IDBDatabase> | null = null;
let flushing = false;
const listeners = new Set<() => void>();

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB could not open"));
  });
  return dbPromise;
}

function notifyChange(): void {
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT));
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // listener errors must not break the queue
    }
  }
}

async function runStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });
}

export async function listPendingEvidence(jobId?: string): Promise<PendingEvidence[]> {
  try {
    const all = (await runStore<PendingEvidence[]>("readonly", (store) => store.getAll())) ?? [];
    return jobId ? all.filter((entry) => entry.jobId === jobId) : all;
  } catch {
    return [];
  }
}

export async function enqueuePendingEvidence(
  input: Omit<PendingEvidence, "id" | "attempts" | "createdAt">,
): Promise<PendingEvidence | null> {
  const entry: PendingEvidence = {
    ...input,
    id: `${input.jobId}:${input.subtaskId}:${input.idempotencyKey}`,
    attempts: 0,
    createdAt: Date.now(),
  };
  try {
    const existing = await runStore<PendingEvidence | undefined>("readonly", (store) =>
      store.get(entry.id),
    );
    if (existing) return existing;
    await runStore("readwrite", (store) => store.add(entry));
    notifyChange();
    return entry;
  } catch {
    return null;
  }
}

export async function removePendingEvidence(id: string): Promise<void> {
  try {
    await runStore("readwrite", (store) => store.delete(id));
    notifyChange();
  } catch {
    // nothing to repair
  }
}

export function subscribeOfflineEvidence(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function uploadPendingEvidence(
  entry: PendingEvidence,
): Promise<{ evidenceId: string }> {
  const now = Date.now();
  let reservation = entry.reservation;
  if (!reservation || reservation.expiresAt <= now + RESERVATION_SLACK_MS) {
    const res = await api.reserveEvidenceUpload({
      jobId: entry.jobId,
      subtaskId: entry.subtaskId,
      mediaType: entry.mediaType,
      mimeType: entry.mimeType,
      fileSizeBytes: entry.fileSizeBytes,
      capturedAt: entry.capturedAt,
      checksumSha256: entry.checksumSha256,
      idempotencyKey: entry.idempotencyKey,
      ...(entry.location ? { location: entry.location } : {}),
    });
    if (!res.upload) {
      await removePendingEvidence(entry.id);
      return { evidenceId: res.evidence.id };
    }
    reservation = {
      uploadUrl: res.upload.url,
      fields: res.upload.fields,
      evidenceId: res.evidence.id,
      expiresAt: new Date(res.upload.expires_at).getTime(),
    };
    entry.reservation = reservation;
    const fresh = [...(await listPendingEvidence())];
    const idx = fresh.findIndex((item) => item.id === entry.id);
    if (idx >= 0) {
      fresh[idx] = entry;
      try {
        await runStore("readwrite", (store) => store.put(entry));
      } catch {
        // reservation is kept in memory only; next attempt re-reserves
      }
    }
  }

  const form = new FormData();
  for (const [name, value] of Object.entries(reservation.fields)) {
    form.append(name, value);
  }
  form.append("file", entry.file, entry.fileName);
  const uploadResponse = await fetch(reservation.uploadUrl, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    throw new Error(`Upload rejected (${uploadResponse.status})`);
  }

  const confirmed = await api.confirmEvidence(reservation.evidenceId);
  await removePendingEvidence(entry.id);
  return { evidenceId: confirmed.id };
}

export type FlushResult = {
  flushed: number;
  failed: number;
  remaining: number;
};

export async function flushOfflineEvidence(options?: { force?: boolean }): Promise<FlushResult> {
  if (flushing) {
    return { flushed: 0, failed: 0, remaining: (await listPendingEvidence()).length };
  }
  flushing = true;
  const result: FlushResult = { flushed: 0, failed: 0, remaining: 0 };
  try {
    const snapshot = (await listPendingEvidence()).sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of snapshot) {
      if (!options?.force && entry.attempts >= AUTO_FLUSH_MAX_ATTEMPTS) continue;
      try {
        await uploadPendingEvidence(entry);
        result.flushed += 1;
      } catch {
        entry.attempts += 1;
        entry.lastError = "Still offline";
        try {
          await runStore("readwrite", (store) => store.put(entry));
        } catch {
          // keep retrying next cycle
        }
        result.failed += 1;
      }
    }
    result.remaining = (await listPendingEvidence()).length;
  } finally {
    flushing = false;
  }
  notifyChange();
  return result;
}
