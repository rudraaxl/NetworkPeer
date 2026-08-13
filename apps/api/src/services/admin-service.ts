import { revokeAllRefreshTokenFamiliesForUser } from "../auth.js";
import {
  adminOverrideJob,
  adminSuspendUser,
  getAdminAnalytics,
  listAdminAuditLog,
  listAdminUsers,
  updateWorkerVerificationAsAdmin,
  type AdminJobOverrideInput,
  type ListAdminAuditInput,
  type WorkerVerificationStatus,
} from "../repository.js";
import type { JobStatus, UserRole } from "../contracts.js";

function databaseErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export class AdminServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "AdminServiceError";
  }
}

const MAX_ADMIN_USER_PAGE = 1_000;
const MAX_ADMIN_USER_PAGE_SIZE = 100;

function mapDatabaseError(err: unknown): never {
  const code = databaseErrorCode(err);
  if (code === "P0002") throw new AdminServiceError("NOT_FOUND", "The requested record was not found", 404);
  if (code === "42501") throw new AdminServiceError("FORBIDDEN", "Administrative privileges are required", 403);
  if (code === "55000" || code === "23514" || code === "40001") {
    throw new AdminServiceError("ADMIN_OPERATION_CONFLICT", "The requested operation is not allowed in the current state", 409);
  }
  if (code === "22023") throw new AdminServiceError("VALIDATION_ERROR", "The administrative request is invalid", 400);
  throw err;
}

export class AdminService {
  async listAudit(input: ListAdminAuditInput): Promise<{
    items: Awaited<ReturnType<typeof listAdminAuditLog>>;
    has_more: boolean;
    next_before_id: string | null;
  }> {
    const rows = await listAdminAuditLog({ ...input, limit: input.limit + 1 });
    const hasMore = rows.length > input.limit;
    const items = hasMore ? rows.slice(0, input.limit) : rows;
    return {
      items,
      has_more: hasMore,
      next_before_id: hasMore ? items[items.length - 1]?.id ?? null : null,
    };
  }

  async overrideJob(input: AdminJobOverrideInput): Promise<{
    audit_id: string;
    job: Awaited<ReturnType<typeof adminOverrideJob>>["job"];
  }> {
    try {
      const result = await adminOverrideJob(input);
      return { audit_id: result.auditId, job: result.job };
    } catch (err) {
      return mapDatabaseError(err);
    }
  }

  async listUsers(input: {
    role?: UserRole;
    isActive?: boolean;
    page: number;
    perPage: number;
  }): Promise<{
    items: Awaited<ReturnType<typeof listAdminUsers>>["items"];
    total: number;
    page: number;
    per_page: number;
  }> {
    if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > MAX_ADMIN_USER_PAGE) {
      throw new AdminServiceError(
        "INVALID_PAGE",
        `page must be between 1 and ${MAX_ADMIN_USER_PAGE}`,
      );
    }
    if (
      !Number.isSafeInteger(input.perPage) ||
      input.perPage < 1 ||
      input.perPage > MAX_ADMIN_USER_PAGE_SIZE
    ) {
      throw new AdminServiceError(
        "INVALID_PAGE_SIZE",
        `per_page must be between 1 and ${MAX_ADMIN_USER_PAGE_SIZE}`,
      );
    }
    const result = await listAdminUsers({
      role: input.role,
      isActive: input.isActive,
      limit: input.perPage,
      offset: (input.page - 1) * input.perPage,
    });
    return { items: result.items, total: result.total, page: input.page, per_page: input.perPage };
  }

  async suspendUser(input: {
    actorUserId: string;
    userId: string;
    reason: string;
  }): Promise<{
    user_id: string;
    is_active: false;
    active_job_count: number;
    audit_id: string;
    refresh_sessions_revoked: true;
  }> {
    let suspension;
    try {
      suspension = await adminSuspendUser(input);
    } catch (err) {
      return mapDatabaseError(err);
    }
    try {
      await revokeAllRefreshTokenFamiliesForUser(input.userId);
    } catch {
      throw new AdminServiceError(
        "AUTH_REVOCATION_UNAVAILABLE",
        "The account was suspended, but refresh-session revocation is temporarily unavailable",
        503,
      );
    }
    return {
      user_id: input.userId,
      is_active: false,
      active_job_count: suspension.activeJobCount,
      audit_id: suspension.auditId,
      refresh_sessions_revoked: true,
    };
  }

  async updateWorkerVerification(input: {
    actorUserId: string;
    workerId: string;
    verificationStatus: WorkerVerificationStatus;
    isAvailable: boolean;
    reason: string;
  }): Promise<{
    audit_id: string;
    profile: NonNullable<Awaited<ReturnType<typeof updateWorkerVerificationAsAdmin>>["profile"]>;
  }> {
    try {
      const result = await updateWorkerVerificationAsAdmin(input);
      if (!result.profile) throw new AdminServiceError("WORKER_NOT_FOUND", "Worker profile not found", 404);
      return { audit_id: result.auditId, profile: result.profile };
    } catch (err) {
      if (err instanceof AdminServiceError) throw err;
      return mapDatabaseError(err);
    }
  }

  async analytics(): Promise<{
    as_of: Date;
    active_jobs: number;
    escrow_hold_volume: Awaited<ReturnType<typeof getAdminAnalytics>>["escrowHoldVolume"];
    platform_fee_revenue: Awaited<ReturnType<typeof getAdminAnalytics>>["platformFeeRevenue"];
    financial_basis: "completed_wallet_ledger_postings";
  }> {
    const result = await getAdminAnalytics();
    return {
      as_of: new Date(),
      active_jobs: result.activeJobs,
      escrow_hold_volume: result.escrowHoldVolume,
      platform_fee_revenue: result.platformFeeRevenue,
      financial_basis: "completed_wallet_ledger_postings",
    };
  }
}

export const adminService = new AdminService();

export type AdminOverrideStatus = Extract<JobStatus, "DISPUTED" | "APPROVED" | "COMPLETED">;
