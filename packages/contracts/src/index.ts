import { z } from "zod";

export const userRoleSchema = z.enum(["CLIENT", "WORKER", "ADMIN"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export const jobStatusSchema = z.enum([
  "FUNDING",
  "POSTED",
  "ASSIGNED",
  "EN_ROUTE",
  "AT_LOCATION",
  "IN_PROGRESS",
  "SUBMITTED",
  "APPROVED",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const escrowStatusSchema = z.enum([
  "UNFUNDED",
  "PENDING",
  "HELD",
  "RELEASED",
  "FROZEN",
  "REFUNDED",
]);
export type EscrowStatus = z.infer<typeof escrowStatusSchema>;

export const mediaStatusSchema = z.enum(["PENDING", "UPLOADED", "VERIFIED", "REJECTED"]);
export type MediaStatus = z.infer<typeof mediaStatusSchema>;

export const mediaTypeSchema = z.enum(["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"]);
export type MediaType = z.infer<typeof mediaTypeSchema>;

export const syncTopicSchema = z.enum([
  "JOB_CREATED",
  "JOB_ASSIGNED",
  "JOB_STATUS_CHANGED",
  "JOB_CANCELLED",
  "JOB_REASSIGNED",
  "EVIDENCE_UPLOADED",
  "LEDGER_POSTED",
  "NOTIFICATION_READ",
  "SYSTEM",
]);
export type SyncTopic = z.infer<typeof syncTopicSchema>;

export const pushPlatformSchema = z.enum(["WEB", "IOS", "ANDROID"]);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

export const subtaskStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED"]);
export type SubtaskStatus = z.infer<typeof subtaskStatusSchema>;

export const transactionTypeSchema = z.enum([
  "ESCROW_HOLD",
  "ESCROW_RELEASE",
  "WORKER_PAYOUT",
  "PLATFORM_FEE",
  "REFUND",
  "TOP_UP",
  "WITHDRAWAL",
]);
export type TransactionType = z.infer<typeof transactionTypeSchema>;

export const transactionStatusSchema = z.enum(["PENDING", "COMPLETED", "FAILED", "REVERSED"]);
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

export const pointSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]),
});
export type Point = z.infer<typeof pointSchema>;

export type User = {
  id: string;
  phone_number: string;
  email: string | null;
  full_name: string;
  role: UserRole;
  avatar_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type WorkerProfile = {
  user_id: string;
  skills: string[];
  hourly_rate_cents: number | null;
  rating: string | number;
  total_jobs_completed: number;
  verification_status: string;
  verification_documents: Record<string, unknown>;
  preferred_radius_km: number | null;
  is_available: boolean;
  current_location: Point | null;
  last_location_update: Date | null;
  created_at: Date;
  updated_at: Date;
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
  escrow_status: EscrowStatus;
  funded_at: Date | null;
  location: Point;
  address: string | null;
  scheduled_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  cancellation_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type WorkerJobSummary = {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: number;
  budget_cents: number;
  currency: string;
  scheduled_at: Date | null;
  created_at: Date;
  distance_band: "UNDER_1_KM" | "1_TO_5_KM" | "5_TO_20_KM" | "20KM_PLUS";
};

export type JobSubtask = {
  id: string;
  job_id: string;
  title: string;
  description: string | null;
  sequence_order: number;
  is_required: boolean;
  status: SubtaskStatus;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
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
  scheduled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  location: Point | null;
  address: string | null;
  is_assigned_to_requester: boolean;
  subtasks: JobSubtask[];
};

export type JobSubtaskMedia = {
  id: string;
  subtask_id: string;
  job_id: string;
  worker_id: string;
  s3_key: string;
  s3_bucket: string;
  media_type: MediaType;
  mime_type: string | null;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  location: Point | null;
  captured_at: Date;
  uploaded_at: Date | null;
  upload_expires_at: Date | null;
  checksum_sha256: string | null;
  s3_etag: string | null;
  s3_version_id: string | null;
  status: MediaStatus;
  verification_notes: string | null;
  metadata: Record<string, unknown>;
  idempotency_key: string | null;
  created_at: Date;
};

export type WalletLedgerEntry = {
  id: string;
  user_id: string;
  job_id: string | null;
  transaction_type: TransactionType;
  transaction_status: TransactionStatus;
  amount_cents: number;
  balance_after_cents: number;
  currency: string;
  reference_id: string | null;
  reference_type: string | null;
  description: string;
  metadata: Record<string, unknown>;
  idempotency_key: string | null;
  processed_at: Date | null;
  created_at: Date;
};

export type SyncEvent = {
  cursor: string;
  event_id: string;
  topic: SyncTopic;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  notification: {
    id: string;
    title: string;
    body: string;
    read_at: Date | null;
  } | null;
};

export type Notification = {
  id: string;
  cursor: string;
  topic: SyncTopic;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read_at: Date | null;
  created_at: Date;
};

export type ApiError = {
  code: string;
  message: string;
};

export type ApiResponse<T> = {
  success: boolean;
  data: T | null;
  error: ApiError | null;
};

export function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

export function fail(code: string, message: string): ApiResponse<never> {
  return { success: false, data: null, error: { code, message } };
}
