import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/lib/api";

export type PendingMediaType = "IMAGE" | "VIDEO" | "AUDIO";

export type PendingEvidence = {
  id: string;
  localUri: string;
  jobId: string;
  subtaskId: string;
  mediaType: PendingMediaType;
  mimeType: string;
  fileSizeBytes: number;
  capturedAt: string;
  location: { type: "Point"; coordinates: [number, number] };
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

const STORAGE_KEY = "@networkpeer/pending-evidence/v1";
const RESERVATION_SLACK_MS = 60_000;
const AUTO_FLUSH_MAX_ATTEMPTS = 8;

let entries: PendingEvidence[] | null = null;
let loading: Promise<PendingEvidence[]> | null = null;
const listeners = new Set<() => void>();
let flushing = false;

function notifyChange(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // listener errors must not break the queue
    }
  }
}

async function loadEntries(): Promise<PendingEvidence[]> {
  if (entries) return entries;
  if (loading) return loading;
  loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      entries = Array.isArray(parsed) ? (parsed as PendingEvidence[]) : [];
    } catch {
      entries = [];
    }
    return entries;
  })();
  try {
    return await loading;
  } finally {
    loading = null;
  }
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries ?? []));
  } catch {
    // storage failures should not take the capture flow down
  }
}

export async function listPendingEvidence(jobId?: string): Promise<PendingEvidence[]> {
  const all = await loadEntries();
  return jobId ? all.filter((e) => e.jobId === jobId) : all;
}

export function subscribePendingEvidence(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function enqueuePendingEvidence(
  input: Omit<PendingEvidence, "id" | "attempts" | "createdAt">,
): Promise<PendingEvidence> {
  const entry: PendingEvidence = {
    ...input,
    id: `${input.jobId}:${input.subtaskId}:${input.idempotencyKey}`,
    attempts: 0,
    createdAt: Date.now(),
  };
  const all = await loadEntries();
  const existing = all.find((e) => e.id === entry.id);
  if (existing) return existing;
  all.push(entry);
  await persist();
  notifyChange();
  return entry;
}

export async function removePendingEvidence(id: string): Promise<void> {
  const all = await loadEntries();
  const next = all.filter((e) => e.id !== id);
  if (next.length !== all.length) {
    entries = next;
    await persist();
    notifyChange();
  }
}

export async function uploadPendingEvidence(entry: PendingEvidence): Promise<{ evidenceId: string }> {
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
      location: entry.location,
      checksumSha256: entry.checksumSha256,
      idempotencyKey: entry.idempotencyKey,
    });
    if (!res.upload) {
      // Server no longer accepts an upload for this item (already uploaded or
      // the job changed); nothing left to do.
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
    await persist();
  }

  const form = new FormData();
  for (const [name, value] of Object.entries(reservation.fields)) {
    form.append(name, value);
  }
  form.append("file", {
    uri: entry.localUri,
    name: entry.localUri.split("/").pop() ?? "evidence",
    type: entry.mimeType,
  } as unknown as Blob);
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

export async function flushPendingEvidence(options?: { force?: boolean }): Promise<FlushResult> {
  if (flushing) return { flushed: 0, failed: 0, remaining: (await loadEntries()).length };
  flushing = true;
  const result: FlushResult = { flushed: 0, failed: 0, remaining: 0 };
  try {
    const snapshot = [...(await loadEntries())].sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of snapshot) {
      const fresh = (await loadEntries()).find((e) => e.id === entry.id);
      if (!fresh) continue;
      if (!options?.force && fresh.attempts >= AUTO_FLUSH_MAX_ATTEMPTS) continue;
      try {
        await uploadPendingEvidence(fresh);
        result.flushed += 1;
      } catch (e) {
        fresh.attempts += 1;
        fresh.lastError = e instanceof Error && e.message ? e.message : "Upload pending";
        await persist();
        result.failed += 1;
      }
    }
    result.remaining = (await loadEntries()).length;
  } finally {
    flushing = false;
  }
  notifyChange();
  return result;
}