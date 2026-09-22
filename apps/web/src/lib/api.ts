import { authSession, type AuthSession, type AppRole } from "@/lib/auth-session";
import {
  jobStatusSchema,
  type JobStatus,
  type MediaStatus,
  type MediaType,
  type SyncTopic,
} from "@networkpeer/contracts";

interface WorkerSyncResult {
  events: SyncEvent[];
  jobs: WorkerJobDetail[];
  snapshot_jobs: WorkerJobDetail[];
  ledger_entries: unknown[];
  removed_job_ids: string[];
  has_more: boolean;
  next_cursor: string;
}

export function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    return "/api/v1";
  }
  if (process.env.VITE_API_BASE_URL && !process.env.VITE_API_BASE_URL.startsWith("/")) {
    return process.env.VITE_API_BASE_URL.replace(/\/$/, "");
  }
  // NP-18: this used to fall back to a hardcoded plaintext staging load
  // balancer, so a misconfigured deployment silently talked to staging instead
  // of failing. Server-side rendering needs an explicit origin.
  return "http://127.0.0.1:3000/api/v1";
}

const apiBaseUrl = resolveApiBaseUrl();

type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
};

type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    role: AppRole;
    phone?: string;
    full_name?: string;
    email?: string;
    mobile_number?: string;
  };
  is_new_account?: boolean;
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

export type OCRResult = {
  engineVersion?: string;
  modelName?: string;
  text: string;
  hindiText?: string;
  englishText?: string;
  detectedScript?: "hindi" | "english" | "bilingual" | "unknown";
  confidence?: number;
  language?: string;
  generatedAt?: string;
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
  preview_url?: string;
  ocrStatus?: "idle" | "processing" | "ready" | "failed";
  ocrResult?: OCRResult;
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
    eligibleRoles?: string[];
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

export interface ReviewSubmissionItem {
  id: string;
  jobId: string;
  assignmentId?: string;
  workerId?: string;
  subtaskId?: string;
  unitRef?: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  ocrResult?: {
    engineVersion?: string;
    text: string;
    hindiText?: string;
    englishText?: string;
    confidence: number;
    language?: string;
    detectedScript?: "Devanagari" | "Latin" | "Bilingual";
    generatedAt?: string;
  };
  ocrStatus?: "ready" | "processing" | "failed";
  ocrSnippet?: string;
  status: "pending_review" | "approved" | "redo_requested" | "rejected";
  submittedAt: string;
}

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
  expiresInSeconds?: number;
  expires_in_seconds?: number;
  otpLength?: number;
  otp_length?: number;
  challenge_id?: string;
  challengeId?: string;
  delivery?: { transport: "sms" | "email" | "log"; to?: string };
  otp?: string;
  success?: boolean;
  message?: string;
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
      response.status === 404 ? "NOT_FOUND" : "SERVICE_UNAVAILABLE",
      response.status === 404
        ? "Requested service route was not found."
        : "The service is temporarily unavailable. Please try again shortly.",
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


const WORKER_SYNC_CACHE_KEY = "networkpeer_worker_sync_cache_v1";

// Field workers lose signal mid-job, so the last successful /worker/sync payload
// is kept for offline reads. Only server-returned data is ever written here.
function cacheWorkerSync(result: WorkerSyncResult): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      WORKER_SYNC_CACHE_KEY,
      JSON.stringify({ cachedAt: new Date().toISOString(), result }),
    );
  } catch {
    // Storage unavailable (private mode, quota). Caching is best effort.
  }
}

export function loadCachedWorkerSync(): { cachedAt: string; result: WorkerSyncResult } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WORKER_SYNC_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}


export const api = {
  async requestEmailOtp(email: string, role?: string): Promise<OtpRequestResult> {
    return await request("/auth/email-otp/request", {
      method: "POST",
      body: JSON.stringify({ email, role: role ?? "CLIENT" }),
    });
  },
  async verifyEmailOtp(input: {
    email: string;
    otp: string;
    challengeId?: string;
    fullName?: string;
    mobileNumber?: string;
    role?: Exclude<AppRole, "ADMIN">;
  }): Promise<AuthSession & { isNewAccount: boolean }> {
    const pair = await request<TokenPair & { is_new_account?: boolean }>("/auth/email-otp/verify", {
      method: "POST",
      body: JSON.stringify({
        email: input.email,
        otp: input.otp,
        challenge_id: input.challengeId,
        full_name: input.fullName,
        mobile_number: input.mobileNumber,
        transport: "browser",
      }),
    });
    const session = sessionFromTokenPair(pair);
    authSession.set(session);
    return { ...session, isNewAccount: Boolean(pair.is_new_account) };
  },

  getProfile(): Promise<{
    id: string;
    phoneNumber?: string;
    phone_number?: string;
    fullName?: string;
    full_name?: string;
    email?: string | null;
    role?: string;
  }> {
    return request("/auth/profile");
  },
  updateProfile(body: {
    full_name?: string;
    fullName?: string;
    email?: string | null;
    mobile_number?: string;
    mobileNumber?: string;
  }): Promise<any> {
    const payload = {
      full_name: body.full_name ?? body.fullName,
      email: body.email,
      mobile_number: body.mobile_number ?? body.mobileNumber,
    };
    return request("/auth/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }).catch(() =>
      request("/auth/profile", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
  },
  updateProfileName(fullName: string): Promise<{ full_name: string }> {
    return request("/auth/profile", {
      method: "POST",
      body: JSON.stringify({ full_name: fullName }),
    });
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
  async createClientJob(input: CreateJobInput): Promise<Job> {
    return request<Job>("/client/jobs", { method: "POST", body: JSON.stringify(input) });
  },
  async fundClientJob(jobId: string, idempotencyKey: string): Promise<FundingResult> {
    return request<FundingResult>(`/client/jobs/${encodeURIComponent(jobId)}/fund`, {
      method: "POST",
      body: JSON.stringify({ idempotency_key: idempotencyKey }),
    });
  },
  async approveClientJob(jobId: string, idempotencyKey: string): Promise<ApprovalResult> {
    return request<ApprovalResult>(`/client/jobs/${encodeURIComponent(jobId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ idempotency_key: idempotencyKey }),
    });
  },
  clientWallet(): Promise<{ balances: WalletBalance[] }> {
    return request<{ balances: WalletBalance[] }>("/client/wallet");
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
    return request<{ items: Job[]; total: number; page: number; perPage: number }>(
      `/client/jobs?${params.toString()}`,
    );
  },
  clientJob(jobId: string): Promise<{ job: Job; subtasks: JobSubtask[] }> {
    return request<{ job: Job; subtasks: JobSubtask[] }>(
      `/client/jobs/${encodeURIComponent(jobId)}`,
    );
  },
  clientJobEvidence(jobId: string): Promise<{ job: Job; evidence: EvidenceSummary[] }> {
    return request<{ job: Job; evidence: EvidenceSummary[] }>(
      `/client/jobs/${encodeURIComponent(jobId)}/evidence`,
    );
  },
  clientEvidenceDownloadUrl(jobId: string, mediaId: string): Promise<{ url: string }> {
    return request<{ url: string }>(
      `/client/jobs/${encodeURIComponent(jobId)}/evidence/${encodeURIComponent(mediaId)}/download`,
    );
  },
  grantConsent(purpose: string): Promise<{ granted: boolean }> {
    return request<{ granted: boolean }>("/consent", { method: "POST", body: JSON.stringify({ purpose }) });
  },
  withdrawConsent(purpose: string): Promise<{ withdrawn: boolean }> {
    return request<{ withdrawn: boolean }>("/consent/withdraw", { method: "POST", body: JSON.stringify({ purpose }) });
  },
  deleteAccount(): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>("/data/delete", { method: "POST" });
  },
  openDispute(jobId: string, reason: string): Promise<{ dispute_id: string }> {
    return request<{ dispute_id: string }>("/disputes", {
      method: "POST",
      body: JSON.stringify({ job_id: jobId, reason }),
    });
  },
  cancelClientJob(
    jobId: string,
    cancellationReason?: string,
  ): Promise<{ job: Job; cancelled: boolean }> {
    return request<{ job: Job; cancelled: boolean }>(
      `/client/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: "POST",
        body: JSON.stringify(cancellationReason ? { cancellation_reason: cancellationReason } : {}),
      },
    );
  },
  updateWorkerLocation(input: {
    latitude: number;
    longitude: number;
  }): Promise<{ updated_at: string }> {
    return request<{ updated_at: string }>("/worker/location", { method: "POST", body: JSON.stringify(input) });
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
    is_available: boolean;
  }> {
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      per_page: String(input.perPage ?? 20),
    });
    if (input.radiusKm !== undefined) params.set("radius_km", String(input.radiusKm));
    return request(`/worker/jobs/nearby?${params.toString()}`);
  },
  workerJob(jobId: string): Promise<WorkerJobDetail> {
    return request<WorkerJobDetail>(`/worker/jobs/${encodeURIComponent(jobId)}`);
  },
  acceptWorkerJob(jobId: string): Promise<WorkerJobDetail> {
    return request<WorkerJobDetail>(`/worker/jobs/${encodeURIComponent(jobId)}/accept`, {
      method: "POST",
    });
  },
  workerWallet(): Promise<{ balances: WalletBalance[] }> {
    return request<{ balances: WalletBalance[] }>("/worker/wallet");
  },
  workerProfile(): Promise<{
    verificationStatus: "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
    preferredRadiusKm: number;
    isAvailable: boolean;
    currentLocation: { type: "Point"; coordinates: [number, number] } | null;
    lastLocationUpdate: string | null;
    eligibleRoles?: string[];
    eligible_roles?: string[];
  }> {
    return request("/worker/profile");
  },
  workerReviewQueue(jobId?: string): Promise<{ submissions: ReviewSubmissionItem[] }> {
    return request<{ submissions: ReviewSubmissionItem[] }>(
      jobId ? `/worker/jobs/${encodeURIComponent(jobId)}/review-queue` : "/worker/review-queue",
    );
  },
  submitReviewDecision(
    submissionId: string,
    decision: "approve" | "redo" | "reject",
    note?: string,
  ): Promise<{ success: boolean }> {
    return request<{ success: boolean }>(
      `/submissions/${encodeURIComponent(submissionId)}/review`,
      { method: "POST", body: JSON.stringify({ decision, note }) },
    );
  },
  async workerJobs(): Promise<WorkerSyncResult> {
    const result = await request<WorkerSyncResult>("/worker/sync?cursor=0&limit=100");
    cacheWorkerSync(result);
    return result;
  },
  workerEvidence(jobId: string): Promise<{ job_id: string; evidence: EvidenceSummary[] }> {
    return request<{ job_id: string; evidence: EvidenceSummary[] }>(
      `/work/jobs/${encodeURIComponent(jobId)}/evidence`,
    );
  },
  advanceWorkStatus(
    jobId: string,
    status: "EN_ROUTE" | "AT_LOCATION" | "IN_PROGRESS",
  ): Promise<Job> {
    return request<Job>("/work/status", {
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
    location?: { latitude: number; longitude: number };
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
        ...(input.location ? { location: input.location } : {}),
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
      throw new ApiError("UPLOAD_FAILED", "Could not reach evidence storage. Check your connection.", 0);
    }
    if (!response.ok) {
      throw new ApiError("UPLOAD_FAILED", "Evidence upload was rejected by storage.", response.status);
    }
  },
  confirmEvidence(mediaId: string): Promise<EvidenceSummary> {
    return request<EvidenceSummary>("/work/evidence", {
      method: "POST",
      body: JSON.stringify({ media_id: mediaId }),
    });
  },
  submitWork(jobId: string): Promise<Job> {
    return request<Job>("/work/submit", { method: "POST", body: JSON.stringify({ job_id: jobId }) });
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
    const params = new URLSearchParams({
      page: String(input.page ?? 1),
      per_page: String(input.perPage ?? 20),
    });
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
      body: JSON.stringify({
        verification_status: verificationStatus,
        is_available: isAvailable,
        reason,
      }),
    });
  },
  adminSetWorkerRole(
    workerId: string,
    role: "correctionist" | "collectionist",
    action: "grant" | "revoke",
  ): Promise<{ workerId: string; eligibleRoles: string[]; action: string }> {
    return request(`/admin/workers/${encodeURIComponent(workerId)}/roles`, {
      method: "POST",
      body: JSON.stringify({ role, action }),
    });
  },
};

export function realtimeBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  try {
    if (apiBaseUrl.startsWith("http://") || apiBaseUrl.startsWith("https://")) {
      return new URL(apiBaseUrl).origin;
    }
  } catch {
    // fallback
  }
  return "http://localhost:3000";
}
