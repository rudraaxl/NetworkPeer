import { authSession, type AuthSession, type AppRole } from "@/lib/auth-session";
import {
  jobStatusSchema,
  type JobStatus,
  type MediaStatus,
  type MediaType,
  type SyncTopic,
} from "@networkpeer/contracts";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1").replace(
  /\/$/,
  "",
);

type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
};

type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; role: AppRole; phone: string };
};

export const JOB_STATUSES = jobStatusSchema.options as readonly JobStatus[];

export type { JobStatus, MediaStatus, MediaType, SyncTopic };

export type Point = {
  type: "Point";
  coordinates: [number, number];
};

export type Job = {
  id: string;
  client_id: string;
  worker_id: string | null;
  title: string;
  description: string;
  category: string;
  status: JobStatus;
  priority: number;
  budget_cents: number;
  platform_fee_cents: number;
  currency: string;
  location: Point;
  address: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type JobSubtask = {
  id: string;
  job_id: string;
  title: string;
  description: string | null;
  sequence_order: number;
  is_required: boolean;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "SKIPPED";
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type FundingResult = {
  operationId: string;
  ledgerTransactionId: string;
  amountCents: string;
  currency: string;
  status: "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  providerReference: string | null;
  clientSecret: string | null;
};

export type ApprovalResult = {
  jobId: string;
  status: JobStatus;
  settlementLedgerTransactionId: string;
  payoutOperationId: string;
  payoutAmountCents: string;
  currency: string;
  payoutStatus: "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  payoutProviderReference: string | null;
  payoutDispatchPending: boolean;
};

export type WalletBalance = {
  currency: string;
  availableBalanceCents: string;
  pendingEscrowCents: string;
  lifetimeEarningsCents: string;
  lifetimeSpendCents: string;
};

export type EvidenceSummary = {
  id: string;
  job_id: string;
  subtask_id: string;
  media_type: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
  mime_type: string | null;
  file_size_bytes: number | null;
  captured_at: string;
  uploaded_at: string | null;
  status: "PENDING" | "UPLOADED" | "VERIFIED" | "REJECTED";
};

export type EvidenceUploadTarget = {
  url: string;
  fields: Record<string, string>;
  expires_at: string;
};

export type AdminUserSummary = {
  id: string;
  phone_number: string;
  email: string | null;
  full_name: string;
  role: "CLIENT" | "WORKER" | "ADMIN";
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  workerProfile: {
    verificationStatus: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
    isAvailable: boolean;
  } | null;
  activeJobCount: number;
};

export type AdminAuditEntry = {
  id: string;
  createdAt: string;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type WorkerJobSummary = {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: number;
  budget_cents: number;
  currency: string;
  scheduled_at: string | null;
  created_at: string;
  distance_band: "UNDER_1_KM" | "1_TO_5_KM" | "5_TO_20_KM" | "20KM_PLUS";
};

export type WorkerJobDetail = {
  id: string;
  title: string;
  description: string;
  category: string;
  status: JobStatus;
  priority: number;
  budget_cents: number;
  currency: string;
  scheduled_at: string | null;
  created_at: string;
  updated_at: string;
  location: Point | null;
  address: string | null;
  is_assigned_to_requester: boolean;
  subtasks: JobSubtask[];
};

export type CreateJobInput = {
  title: string;
  description: string;
  category: string;
  budget_cents: number;
  currency: string;
  location: Point;
  address?: string;
  scheduled_at?: string;
  metadata?: Record<string, unknown>;
  public_title?: string;
  public_description?: string;
  idempotency_key?: string;
  subtasks?: Array<{
    title: string;
    description?: string;
    is_required?: boolean;
  }>;
};

export type SyncEvent = {
  cursor: string;
  event_id: string;
  topic: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  notification: { id: string; title: string; body: string; read_at: string | null } | null;
};

export type AppNotification = {
  id: string;
  cursor: string;
  topic: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let refreshInFlight: Promise<AuthSession | null> | null = null;

export type OtpRequestResult = {
  expiresInSeconds: number;
  otpLength: number;
  delivery: { transport: "sms" | "log"; to?: string };
  otp?: string;
};

function endpoint(path: string): string {
  return `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function sessionFromTokenPair(pair: TokenPair): AuthSession {
  return {
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
    expiresIn: pair.expires_in,
    user: pair.user,
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  let envelope: ApiEnvelope<T>;
  try {
    envelope = (await response.json()) as ApiEnvelope<T>;
  } catch {
    throw new ApiError(
      "NETWORK_RESPONSE_INVALID",
      "The server returned an invalid response",
      response.status,
    );
  }
  if (!response.ok || !envelope.success || envelope.data === null) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ApiError(
      envelope.error?.code ?? "REQUEST_FAILED",
      envelope.error?.message ?? "The request could not be completed",
      response.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  return envelope.data;
}

async function refreshAccessToken(): Promise<AuthSession | null> {
  if (refreshInFlight) return refreshInFlight;

  const sessionBeforeRefresh = authSession.get();
  if (!sessionBeforeRefresh) return null;

  refreshInFlight = (async () => {
    let response: Response;
    try {
      response = await fetch(endpoint("/auth/refresh"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: sessionBeforeRefresh.refreshToken }),
      });
    } catch {
      return null;
    }

    try {
      const pair = await parseResponse<TokenPair>(response);
      const next = sessionFromTokenPair(pair);
      authSession.set(next);
      return next;
    } catch (error) {
      const current = authSession.get();
      if (
        error instanceof ApiError &&
        (error.statusCode === 401 || error.statusCode === 403) &&
        current?.refreshToken === sessionBeforeRefresh.refreshToken
      ) {
        authSession.clear();
      }
      return null;
    }
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const current = authSession.get();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (current?.accessToken) headers.set("authorization", `Bearer ${current.accessToken}`);
  let response: Response;
  try {
    response = await fetch(endpoint(path), { ...init, headers });
  } catch {
    throw new ApiError(
      "NETWORK_ERROR",
      "Cannot reach the API. Check your connection and try again.",
      0,
    );
  }
  if (response.status === 401 && retry && current?.refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, init, false);
  }
  return parseResponse<T>(response);
}

export const api = {
  async requestOtp(phoneNumber: string): Promise<OtpRequestResult> {
    return request("/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ phone_number: phoneNumber }),
    });
  },
  async verifyOtp(
    phoneNumber: string,
    otp: string,
    role: Exclude<AppRole, "ADMIN">,
  ): Promise<AuthSession> {
    const pair = await request<TokenPair>("/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone_number: phoneNumber, otp, role }),
    });
    const session = sessionFromTokenPair(pair);
    authSession.set(session);
    return session;
  },
  async logout(): Promise<void> {
    const current = authSession.get();
    if (!current) return;
    try {
      await request("/auth/logout", {
        method: "POST",
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      });
    } finally {
      authSession.clear();
    }
  },
  sync(cursor: string): Promise<{ events: SyncEvent[]; has_more: boolean; next_cursor: string }> {
    return request(`/sync?cursor=${encodeURIComponent(cursor)}&limit=100`);
  },
  notifications(): Promise<{
    items: AppNotification[];
    has_more: boolean;
    next_cursor: string | null;
  }> {
    return request("/notifications?limit=100");
  },
  markNotificationRead(notificationId: string): Promise<AppNotification> {
    return request(`/notifications/${notificationId}/read`, { method: "POST" });
  },
  markAllNotificationsRead(): Promise<{ marked_count: number }> {
    return request("/notifications/read-all", { method: "POST" });
  },
  registerDevice(
    token: string,
    platform: "WEB" | "IOS" | "ANDROID",
  ): Promise<{ id: string; platform: string; active: boolean }> {
    return request("/notifications/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform }),
    });
  },
  createClientJob(input: CreateJobInput): Promise<Job> {
    return request("/client/jobs", { method: "POST", body: JSON.stringify(input) });
  },
  fundClientJob(jobId: string, idempotencyKey: string): Promise<FundingResult> {
    return request(`/client/jobs/${encodeURIComponent(jobId)}/fund`, {
      method: "POST",
      body: JSON.stringify({ idempotency_key: idempotencyKey }),
    });
  },
  approveClientJob(jobId: string, idempotencyKey: string): Promise<ApprovalResult> {
    return request(`/client/jobs/${encodeURIComponent(jobId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ idempotency_key: idempotencyKey }),
    });
  },
  clientWallet(): Promise<{ balances: WalletBalance[] }> {
    return request("/client/wallet");
  },
  clientJobs(
    input: {
      status?: JobStatus;
      page?: number;
      perPage?: number;
    } = {},
  ): Promise<{ items: Job[]; total: number; page: number; perPage: number }> {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      per_page: String(input.perPage ?? 20),
    });
    if (input.status) params.set("status", input.status);
    return request(`/client/jobs?${params.toString()}`);
  },
  clientJob(jobId: string): Promise<{ job: Job; subtasks: JobSubtask[] }> {
    return request(`/client/jobs/${encodeURIComponent(jobId)}`);
  },
  clientJobEvidence(
    jobId: string,
  ): Promise<{ job: Job; evidence: EvidenceSummary[] }> {
    return request(`/client/jobs/${encodeURIComponent(jobId)}/evidence`);
  },
  clientEvidenceDownloadUrl(
    jobId: string,
    mediaId: string,
  ): Promise<{ url: string }> {
    return request(`/client/jobs/${encodeURIComponent(jobId)}/evidence/${encodeURIComponent(mediaId)}/download`);
  },
  grantConsent(purpose: string): Promise<{ granted: boolean }> {
    return request("/consent", { method: "POST", body: JSON.stringify({ purpose }) });
  },
  withdrawConsent(purpose: string): Promise<{ withdrawn: boolean }> {
    return request("/consent/withdraw", { method: "POST", body: JSON.stringify({ purpose }) });
  },
  deleteAccount(): Promise<{ deleted: boolean }> {
    return request("/data/delete", { method: "POST" });
  },
  openDispute(jobId: string, reason: string): Promise<{ dispute_id: string }> {
    return request("/disputes", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, reason }),
    });
  },
  cancelClientJob(
    jobId: string,
    cancellationReason?: string,
  ): Promise<{ job: Job; cancelled: boolean }> {
    return request(`/client/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: "POST",
      body: JSON.stringify(cancellationReason ? { cancellation_reason: cancellationReason } : {}),
    });
  },
  updateWorkerLocation(input: {
    latitude: number;
    longitude: number;
  }): Promise<{ updated_at: string }> {
    return request("/worker/location", { method: "POST", body: JSON.stringify(input) });
  },
  nearbyWorkerJobs(
    input: {
      radiusKm?: number;
      page?: number;
      perPage?: number;
    } = {},
  ): Promise<{
    items: WorkerJobSummary[];
    page: number;
    perPage: number;
    radius_km: number;
    has_more: boolean;
    next_page: number | null;
  }> {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      per_page: String(input.perPage ?? 20),
    });
    if (input.radiusKm !== undefined) params.set("radius_km", String(input.radiusKm));
    return request(`/worker/jobs/nearby?${params.toString()}`);
  },
  workerJob(jobId: string): Promise<WorkerJobDetail> {
    return request(`/worker/jobs/${encodeURIComponent(jobId)}`);
  },
  acceptWorkerJob(jobId: string): Promise<WorkerJobDetail> {
    return request(`/worker/jobs/${encodeURIComponent(jobId)}/accept`, { method: "POST" });
  },
  workerWallet(): Promise<{ balances: WalletBalance[] }> {
    return request("/worker/wallet");
  },
  advanceWorkStatus(
    jobId: string,
    status: "EN_ROUTE" | "AT_LOCATION" | "IN_PROGRESS",
  ): Promise<Job> {
    return request("/work/status", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, status }),
    });
  },
  reserveEvidenceUpload(input: {
    jobId: string;
    subtaskId: string;
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
    mimeType: string;
    fileSizeBytes: number;
    capturedAt: string;
    checksumSha256: string;
    idempotencyKey: string;
  }): Promise<{ evidence: EvidenceSummary; upload: EvidenceUploadTarget | null }> {
    return request("/work/upload-url", {
      method: "POST",
      body: JSON.stringify({
        job_id: input.jobId,
        subtask_id: input.subtaskId,
        media_type: input.mediaType,
        mime_type: input.mimeType,
        file_size_bytes: input.fileSizeBytes,
        captured_at: input.capturedAt,
        checksum_sha256: input.checksumSha256,
        idempotency_key: input.idempotencyKey,
      }),
    });
  },
  async uploadEvidenceToStorage(target: EvidenceUploadTarget, file: File): Promise<void> {
    const form = new FormData();
    for (const [name, value] of Object.entries(target.fields)) form.append(name, value);
    form.append("file", file);
    let response: Response;
    try {
      response = await fetch(target.url, { method: "POST", body: form });
    } catch {
      throw new ApiError(
        "EVIDENCE_UPLOAD_NETWORK_ERROR",
        "The evidence upload could not reach storage",
        0,
      );
    }
    if (!response.ok) {
      throw new ApiError(
        "EVIDENCE_UPLOAD_REJECTED",
        "Storage rejected the evidence upload",
        response.status,
      );
    }
  },
  confirmEvidence(mediaId: string): Promise<EvidenceSummary> {
    return request("/work/evidence", {
      method: "POST",
      body: JSON.stringify({ media_id: mediaId }),
    });
  },
  submitWork(jobId: string): Promise<Job> {
    return request("/work/submit", { method: "POST", body: JSON.stringify({ job_id: jobId }) });
  },
  adminAnalytics(): Promise<{
    as_of: string;
    active_jobs: number;
    escrow_hold_volume: { currency: string; cents: string }[];
    platform_fee_revenue: { currency: string; cents: string }[];
    financial_basis: "completed_wallet_ledger_postings";
  }> {
    return request("/admin/analytics");
  },
  adminUsers(input: { role?: "CLIENT" | "WORKER"; page?: number; perPage?: number } = {}): Promise<{
    items: AdminUserSummary[];
    total: number;
    page: number;
    per_page: number;
  }> {
    const params = new URLSearchParams({ page: String(input.page ?? 1), per_page: String(input.perPage ?? 20) });
    if (input.role) params.set("role", input.role);
    return request(`/admin/users?${params.toString()}`);
  },
  adminAuditLog(input: { limit?: number; beforeId?: string } = {}): Promise<{
    items: AdminAuditEntry[];
    has_more: boolean;
    next_before_id: string | null;
  }> {
    const params = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.beforeId) params.set("before_id", input.beforeId);
    return request(`/admin/audit-log?${params.toString()}`);
  },
  adminSetWorkerVerification(
    workerId: string,
    verificationStatus: "VERIFIED" | "SUSPENDED" | "PENDING" | "REJECTED",
    isAvailable: boolean,
    reason: string,
  ): Promise<{ audit_id: string; profile: unknown }> {
    return request(`/admin/workers/${encodeURIComponent(workerId)}/verification`, {
      method: "PATCH",
      body: JSON.stringify({ verification_status: verificationStatus, is_available: isAvailable, reason }),
    });
  },
};

export function realtimeBaseUrl(): string {
  return new URL(apiBaseUrl).origin;
}
