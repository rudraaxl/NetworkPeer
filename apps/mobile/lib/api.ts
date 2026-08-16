import * as SecureStore from "expo-secure-store";
import type {
  ApiEnvelope,
  AuthTokens,
  EvidenceSummary,
  EvidenceUploadTarget,
  WalletBalance,
  WorkerJobDetail,
  WorkerJobSummary,
  WorkerSession,
} from "./types";

const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "");
if (!configuredApiUrl && !__DEV__) {
  throw new Error("EXPO_PUBLIC_API_URL must be configured for production builds.");
}
if (!__DEV__ && configuredApiUrl && !configuredApiUrl.startsWith("https://")) {
  throw new Error("Production API URLs must use HTTPS.");
}
export const API_BASE_URL = configuredApiUrl ?? "http://localhost:3000";

const ACCESS_KEY = "np.accessToken";
const REFRESH_KEY = "np.refreshToken";
const WORKER_KEY = "np.worker";

export async function getStoredTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const accessToken = await SecureStore.getItemAsync(ACCESS_KEY);
  const refreshToken = await SecureStore.getItemAsync(REFRESH_KEY);
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

export async function getStoredWorker(): Promise<WorkerSession | null> {
  const raw = await SecureStore.getItemAsync(WORKER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkerSession;
  } catch {
    return null;
  }
}

export async function storeSession(tokens: AuthTokens) {
  await SecureStore.setItemAsync(ACCESS_KEY, tokens.access_token);
  await SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh_token);
  await SecureStore.setItemAsync(WORKER_KEY, JSON.stringify({
    id: tokens.user.id,
    role: "WORKER" as const,
    phone: tokens.user.phone_number,
    fullName: tokens.user.full_name || undefined,
  } satisfies WorkerSession));
}

async function storeTokens(accessToken: string, refreshToken: string) {
  await SecureStore.setItemAsync(ACCESS_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_KEY, refreshToken);
}

export async function storeWorker(worker: WorkerSession) {
  await SecureStore.setItemAsync(WORKER_KEY, JSON.stringify(worker));
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
  await SecureStore.deleteItemAsync(WORKER_KEY);
}

export class ApiClientError extends Error {
  code: string;
  statusCode: number;

  constructor(code: string, message: string, statusCode = 0) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof ApiClientError && error.statusCode === 401;
}

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  try {
    return (await response.json()) as ApiEnvelope<T>;
  } catch {
    return { success: false, data: null, error: { code: "BAD_RESPONSE", message: "Invalid server response" } };
  }
}

type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; role: "CLIENT" | "WORKER" | "ADMIN"; phone: string; full_name: string };
  is_new_account?: boolean;
};

function sessionFromPair(pair: TokenPair): AuthTokens {
  return {
    access_token: pair.access_token,
    refresh_token: pair.refresh_token,
    expires_in: pair.expires_in,
    user: {
      id: pair.user.id,
      phone_number: pair.user.phone,
      email: null,
      full_name: pair.user.full_name ?? "",
      role: pair.user.role,
      avatar_url: null,
      is_active: true,
      is_verified: true,
      last_login_at: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
  };
}

export type VerifyOtpResult = {
  session: AuthTokens;
  isNewAccount: boolean;
};

async function performRequest<T>(
  path: string,
  init: RequestInit | undefined,
  accessToken: string,
): Promise<{ response: Response; payload: ApiEnvelope<T> | null }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiClientError("NETWORK_ERROR", "Could not reach the server. Check your connection.");
  }
  const payload = await parseEnvelope<T>(response);
  return { response, payload };
}

let refreshing: Promise<TokenPair | null> | null = null;

async function refreshAccessToken(refreshToken: string): Promise<TokenPair> {
  if (!refreshing) {
    refreshing = (async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const payload = await parseEnvelope<TokenPair>(response);
      if (!response.ok || !payload.success || !payload.data) return null;
      await storeTokens(payload.data.access_token, payload.data.refresh_token);
      return payload.data;
    })().finally(() => {
      refreshing = null;
    });
  }
  const pair = await refreshing;
  if (!pair) throw new ApiClientError("UNAUTHORIZED", "Token refresh failed.", 401);
  return pair;
}

async function fetchWithAuth<T>(path: string, init?: RequestInit): Promise<T> {
  const tokens = await getStoredTokens();
  if (!tokens) throw new ApiClientError("UNAUTHORIZED", "No session.", 401);

  let result = await performRequest<T>(path, init, tokens.accessToken);
  if (result.response.status === 401 && tokens.refreshToken) {
    try {
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      result = await performRequest<T>(path, init, refreshed.access_token);
    } catch {
      await clearSession();
      throw new ApiClientError("UNAUTHORIZED", "Your session has expired. Please sign in again.", 401);
    }
  }

  if (!result.response.ok) {
    throw new ApiClientError(
      result.payload?.error?.code ?? "REQUEST_FAILED",
      result.payload?.error?.message ?? "Request failed",
      result.response.status,
    );
  }
  if (!result.payload?.success || result.payload.data === null) {
    throw new ApiClientError(
      result.payload?.error?.code ?? "BAD_RESPONSE",
      result.payload?.error?.message ?? "Unexpected server response",
      result.response.status,
    );
  }
  return result.payload.data;
}

async function requestJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  return fetchWithAuth<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  async requestOtp(phoneNumber: string): Promise<{
    expiresInSeconds: number;
    otpLength: number;
    otp?: string;
    delivery: { transport: "sms" | "log"; to?: string };
  }> {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/otp/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone_number: phoneNumber }),
    });
    const payload = await parseEnvelope<{
      expiresInSeconds: number;
      otpLength: number;
      otp?: string;
      delivery: { transport: "sms" | "log"; to?: string };
    }>(response);
    if (!response.ok || !payload.success || !payload.data) {
      throw new ApiClientError(
        payload.error?.code ?? "OTP_REQUEST_FAILED",
        payload.error?.message ?? "Failed to send OTP.",
        response.status,
      );
    }
    return payload.data;
  },

  async verifyOtp(phoneNumber: string, otp: string): Promise<VerifyOtpResult> {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/otp/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone_number: phoneNumber, otp, role: "WORKER" }),
    });
    const payload = await parseEnvelope<TokenPair>(response);
    if (!response.ok || !payload.success || !payload.data) {
      throw new ApiClientError(
        payload.error?.code ?? "OTP_VERIFY_FAILED",
        payload.error?.message ?? "Invalid OTP.",
        response.status,
      );
    }
    const session = sessionFromPair(payload.data);
    await storeSession(session);
    return { session, isNewAccount: Boolean(payload.data.is_new_account) };
  },

  async setProfileName(fullName: string): Promise<{ full_name: string }> {
    return requestJson("/auth/profile", "POST", { full_name: fullName });
  },

  async logout() {
    const tokens = await getStoredTokens();
    if (tokens) {
      try {
        await fetchWithAuth("/auth/logout", {
          method: "POST",
          body: JSON.stringify({ refresh_token: tokens.refreshToken }),
        });
      } catch {
        // Local session is cleared below even if the network call fails.
      }
    }
    await clearSession();
  },

  async me(): Promise<WorkerSession> {
    const user = await fetchWithAuth<{ id: string; role: "WORKER"; phone: string; full_name: string }>("/auth/me");
    return { id: user.id, role: "WORKER", phone: user.phone, fullName: user.full_name || undefined };
  },

  async grantConsent(purpose: string): Promise<void> {
    await requestJson("/consent", "POST", { purpose });
  },

  async withdrawConsent(purpose: string): Promise<void> {
    await requestJson("/consent/withdraw", "POST", { purpose });
  },

  async deleteAccount(): Promise<void> {
    await requestJson("/data/delete", "POST");
  },

  async updateLocation(latitude: number, longitude: number): Promise<{ updated_at: string }> {
    return requestJson("/worker/location", "POST", { latitude, longitude });
  },

  async nearbyJobs(page = 1, perPage = 20): Promise<{
    items: WorkerJobSummary[];
    page: number;
    perPage: number;
    radius_km: number;
    has_more: boolean;
    next_page: number | null;
  }> {
    return fetchWithAuth(`/worker/jobs/nearby?page=${page}&per_page=${perPage}`);
  },

  async job(jobId: string): Promise<WorkerJobDetail> {
    return fetchWithAuth(`/worker/jobs/${jobId}`);
  },

  async acceptJob(jobId: string): Promise<WorkerJobDetail> {
    return requestJson(`/worker/jobs/${jobId}/accept`, "POST", {});
  },

  async advanceStatus(jobId: string, status: "EN_ROUTE" | "AT_LOCATION" | "IN_PROGRESS"): Promise<{ job_id: string; status: string }> {
    return requestJson("/work/status", "POST", { job_id: jobId, status });
  },

  async reserveEvidenceUpload(input: {
    jobId: string;
    subtaskId: string;
    mediaType: "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT";
    mimeType: string;
    fileSizeBytes: number;
    capturedAt: string;
    location: { type: "Point"; coordinates: [number, number] };
    checksumSha256: string;
    idempotencyKey: string;
  }): Promise<{ evidence: EvidenceSummary; upload: EvidenceUploadTarget | null }> {
    return requestJson("/work/upload-url", "POST", {
      job_id: input.jobId,
      subtask_id: input.subtaskId,
      media_type: input.mediaType,
      mime_type: input.mimeType,
      file_size_bytes: input.fileSizeBytes,
      captured_at: input.capturedAt,
      location: input.location,
      checksum_sha256: input.checksumSha256,
      idempotency_key: input.idempotencyKey,
    });
  },

  async confirmEvidence(mediaId: string): Promise<EvidenceSummary> {
    return requestJson("/work/evidence", "POST", { media_id: mediaId });
  },

  async submitWork(jobId: string): Promise<{ job_id: string; status: string }> {
    return requestJson("/work/submit", "POST", { job_id: jobId });
  },

  async wallet(): Promise<{ balances: WalletBalance[] }> {
    return fetchWithAuth("/worker/wallet");
  },

  async workerSync(cursor = "0", limit = 100): Promise<{
    jobs: WorkerJobDetail[];
    snapshot_jobs: WorkerJobDetail[];
    ledger_entries: unknown[];
    removed_job_ids: string[];
    has_more: boolean;
    next_cursor: string;
  }> {
    return fetchWithAuth(`/worker/sync?cursor=${encodeURIComponent(cursor)}&limit=${limit}`);
  },
};
