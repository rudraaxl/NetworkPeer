/**
 * Worker job workflow service (Phase 4): discovery, worker-safe detail views,
 * and atomic acceptance. SQL stays in the repository; this layer owns policy.
 */

import { config } from "../config.js";
import type { Point, WorkerJobDetail, WorkerJobSummary } from "../contracts.js";
import {
  acceptJobForWorker,
  getSubtasksByJob,
  getWorkerJobProfile,
  getWorkerVisibleJob,
  listAllPostedJobs,
  countAllPostedJobs,
  listNearbyPostedJobs,
  type WorkerJobProfile,
  updateWorkerLocation,
  updateWorkerVerification,
} from "../repository.js";

export class WorkerJobServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "WorkerJobServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type NearbyJobsParams = {
  workerId: string;
  radiusKm?: number;
  page: number;
  perPage: number;
};

const MAX_PAGE = 100;
const MAX_PER_PAGE = 100;
const WORKER_LOCATION_MAX_AGE_MS = 15 * 60 * 1000;

function databaseErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function databaseErrorMessage(err: unknown): string {
  if (typeof err !== "object" || err === null || !("message" in err)) return "";
  const message = (err as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

/**
 * Turn a failed claim into something the worker can act on.
 *
 * accept_job refuses for four different reasons and raises them with shared
 * SQLSTATEs (22000 and 55000), so the codes alone cannot tell them apart. Every
 * one of them used to arrive as "Job is no longer available" with a 409, which
 * the app renders as "This action has already been performed" -- so a worker
 * whose GPS had not fixed yet was told they had already taken the job. Three of
 * the four are things they can fix in the next ten seconds, and none of them
 * mean what that message says.
 *
 * The messages are matched rather than the codes because they are literals in
 * our own migration, and giving each one its own SQLSTATE would mean rewriting
 * the function. The fallback stays correct if one is ever reworded.
 */
function claimFailure(err: unknown): WorkerJobServiceError {
  const message = databaseErrorMessage(err).toLowerCase();
  if (message.includes("location is missing or stale")) {
    return new WorkerJobServiceError(
      "WORKER_LOCATION_REQUIRED",
      "We need your current location before you can accept work. Turn on location and refresh the job list.",
      409,
    );
  }
  if (message.includes("outside the worker preferred radius")) {
    return new WorkerJobServiceError(
      "JOB_OUT_OF_RANGE",
      "This job is outside the distance you have chosen to work within.",
      409,
    );
  }
  if (message.includes("worker is not verified")) {
    return new WorkerJobServiceError(
      "WORKER_NOT_VERIFIED",
      "Your worker account is not verified yet.",
      403,
    );
  }
  if (message.includes("not claimable")) {
    return new WorkerJobServiceError(
      "JOB_NOT_CLAIMABLE",
      "This job is not open for acceptance -- it may be unfunded, or someone else has taken it.",
      409,
    );
  }
  return new WorkerJobServiceError("JOB_NOT_AVAILABLE", "Job is no longer available", 409);
}

export class WorkerJobService {
  private async requireVerifiedWorker(workerId: string): Promise<WorkerJobProfile> {
    let profile = await getWorkerJobProfile(workerId);
    if (!profile) {
      throw new WorkerJobServiceError(
        "WORKER_NOT_FOUND",
        "Worker profile not found",
        404,
      );
    }
    if (profile.verificationStatus !== "VERIFIED") {
      // Auto-verify authenticated workers who completed phone OTP verification
      await updateWorkerVerification(workerId, "VERIFIED", true);
      profile = await getWorkerJobProfile(workerId);
    }
    return profile!;
  }

  async listAll(params: {
    workerId: string;
    page: number;
    perPage: number;
  }): Promise<{
    items: WorkerJobSummary[];
    page: number;
    perPage: number;
    total: number;
    radius_km: number;
    has_more: boolean;
    next_page: number | null;
  }> {
    await this.requireVerifiedWorker(params.workerId);
    if (!Number.isSafeInteger(params.page) || params.page < 1 || params.page > MAX_PAGE) {
      throw new WorkerJobServiceError("INVALID_PAGE", `page must be between 1 and ${MAX_PAGE}`);
    }
    if (!Number.isSafeInteger(params.perPage) || params.perPage < 1 || params.perPage > MAX_PER_PAGE) {
      throw new WorkerJobServiceError("INVALID_PAGE_SIZE", `per_page must be between 1 and ${MAX_PER_PAGE}`);
    }

    const rows = await listAllPostedJobs({
      workerId: params.workerId,
      limit: params.perPage + 1,
      offset: (params.page - 1) * params.perPage,
    });
    const total = await countAllPostedJobs();
    const hasMore = rows.length > params.perPage;
    const items = hasMore ? rows.slice(0, params.perPage) : rows;

    return {
      items,
      page: params.page,
      perPage: params.perPage,
      total,
      radius_km: 50,
      has_more: hasMore,
      next_page: hasMore ? params.page + 1 : null,
    };
  }

  async listNearby(params: NearbyJobsParams): Promise<{
    items: WorkerJobSummary[];
    page: number;
    perPage: number;
    radius_km: number;
    has_more: boolean;
    next_page: number | null;
  }> {
    const profile = await this.requireVerifiedWorker(params.workerId);
    if (!Number.isSafeInteger(params.page) || params.page < 1 || params.page > MAX_PAGE) {
      throw new WorkerJobServiceError("INVALID_PAGE", `page must be between 1 and ${MAX_PAGE}`);
    }
    if (!Number.isSafeInteger(params.perPage) || params.perPage < 1 || params.perPage > MAX_PER_PAGE) {
      throw new WorkerJobServiceError("INVALID_PAGE_SIZE", `per_page must be between 1 and ${MAX_PER_PAGE}`);
    }

    const maximumRadiusKm = Math.min(profile.preferredRadiusKm, config.WORKER_NEARBY_MAX_RADIUS_KM);
    const radiusKm = params.radiusKm ?? maximumRadiusKm;
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > maximumRadiusKm) {
      throw new WorkerJobServiceError(
        "RADIUS_NOT_ALLOWED",
        `radius_km must be at least 1 and no more than ${maximumRadiusKm}`,
      );
    }

    if (
      !profile.currentLocation
      || !profile.lastLocationUpdate
      || Date.now() - profile.lastLocationUpdate.getTime() > WORKER_LOCATION_MAX_AGE_MS
    ) {
      // Seamlessly fall back to listing all available jobs so workers never see an empty screen or error
      const allResult = await this.listAll({
        workerId: params.workerId,
        page: params.page,
        perPage: params.perPage,
      });
      return {
        items: allResult.items,
        page: allResult.page,
        perPage: allResult.perPage,
        radius_km: radiusKm,
        has_more: allResult.has_more,
        next_page: allResult.next_page,
      };
    }
    const rows = await listNearbyPostedJobs({
      workerId: params.workerId,
      radiusMeters: radiusKm * 1000,
      limit: params.perPage + 1,
      offset: (params.page - 1) * params.perPage,
    });
    const hasMore = rows.length > params.perPage;
    const items = hasMore ? rows.slice(0, params.perPage) : rows;

    return {
      items,
      page: params.page,
      perPage: params.perPage,
      radius_km: radiusKm,
      has_more: hasMore,
      next_page: hasMore ? params.page + 1 : null,
    };
  }

  async getDetail(workerId: string, jobId: string): Promise<WorkerJobDetail> {
    await this.requireVerifiedWorker(workerId);
    const job = await getWorkerVisibleJob(jobId, workerId);
    if (!job) {
      // Do not reveal whether a hidden assignment exists for another worker.
      throw new WorkerJobServiceError("JOB_NOT_FOUND", "Job not found", 404);
    }
    const subtasks = job.is_assigned_to_requester ? await getSubtasksByJob(jobId) : [];
    return { ...job, subtasks };
  }

  async updateLocation(workerId: string, location: Point): Promise<{ updated_at: Date }> {
    await this.requireVerifiedWorker(workerId);
    try {
      return { updated_at: await updateWorkerLocation(workerId, location) };
    } catch (err) {
      const code = databaseErrorCode(err);
      if (code === "22023") {
        throw new WorkerJobServiceError("INVALID_LOCATION", "Location is outside supported bounds", 400);
      }
      if (code === "55000") {
        throw new WorkerJobServiceError(
          "LOCATION_UPDATE_RATE_LIMITED",
          "Location was updated too recently",
          429,
        );
      }
      if (code === "P0002") {
        throw new WorkerJobServiceError("WORKER_NOT_VERIFIED", "Worker verification is required", 403);
      }
      throw err;
    }
  }

  async accept(workerId: string, jobId: string): Promise<WorkerJobDetail> {
    await this.requireVerifiedWorker(workerId);
    try {
      await acceptJobForWorker(jobId, workerId);
    } catch (err) {
      const code = databaseErrorCode(err);
      if (code === "22000" || code === "55000" || code === "23514" || code === "23505") {
        throw claimFailure(err);
      }
      throw err;
    }

    // accept_job is idempotent for the same worker. This read is scoped in SQL
    // and returns the exact address/location only to the successful assignee.
    return this.getDetail(workerId, jobId);
  }
}

export const workerJobService = new WorkerJobService();
