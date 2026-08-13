import type {
  JobStatus,
  JobSubtask,
  MediaStatus,
  MediaType,
  Point,
  User,
  WorkerJobDetail,
  WorkerJobSummary,
} from "@networkpeer/contracts";

export type {
  JobStatus,
  JobSubtask,
  MediaStatus,
  MediaType,
  Point,
  User,
  WorkerJobDetail,
  WorkerJobSummary,
};

export type WorkerSession = {
  id: string;
  role: "WORKER";
  phone: string;
};

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: User;
};

export type EvidenceUploadTarget = {
  url: string;
  fields: Record<string, string>;
  expires_at: string;
};

export type EvidenceSummary = {
  id: string;
  job_id: string;
  subtask_id: string;
  media_type: MediaType;
  mime_type: string | null;
  file_size_bytes: number | null;
  captured_at: string;
  uploaded_at: string | null;
  status: MediaStatus;
};

export type WalletBalance = {
  currency: string;
  availableBalanceCents: string;
  pendingEscrowCents: string;
  lifetimeEarningsCents: string;
  lifetimeSpendCents: string;
};

export type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
};

export const jobStatusLabel: Record<JobStatus, string> = {
  FUNDING: "Funding",
  POSTED: "Open",
  ASSIGNED: "Accepted",
  EN_ROUTE: "En route",
  AT_LOCATION: "At location",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Under review",
  APPROVED: "Approved",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DISPUTED: "Disputed",
};
