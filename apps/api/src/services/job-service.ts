/**
 * Client job workflow service (Phase 3): create, list, view, and cancel jobs.
 * Enforces ownership and state-machine rules above the repository layer.
 */

import {
  cancelJobForClient,
  countJobsByClient,
  getJobById,
  getSubtasksByJob,
  insertJobWithSubtasks,
  JobIdempotencyConflictError,
  listJobsByClient,
  resolveJobForClient,
} from "../repository.js";
import { createHash } from "node:crypto";
import { config } from "../config.js";
import type { CreateSubtaskInput } from "../repository.js";
import { canClientCancel } from "../state-machine.js";
import type { Job, JobStatus, JobSubtask, Point } from "../contracts.js";

export class JobServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "JobServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type JobSubtaskInput = {
  title: string;
  description?: string;
  isRequired?: boolean;
};

export type CreateJobParams = {
  clientId: string;
  title: string;
  description: string;
  category: string;
  budgetCents: number;
  currency: string;
  location: Point;
  address?: string;
  scheduledAt?: Date;
  metadata?: Record<string, unknown>;
  publicTitle?: string;
  publicDescription?: string;
  subtasks?: JobSubtaskInput[];
  idempotencyKey?: string;
};

export type ListJobsParams = {
  clientId: string;
  statuses?: JobStatus[];
  page: number;
  perPage: number;
};

const MAX_PAGE = 1000;
const MAX_PER_PAGE = 100;

export class JobService {
  /**
   * Create an unfunded job owned by the client. PostgreSQL makes it visible to
   * workers only after the Phase 8 escrow webhook transitions it to POSTED.
   */
  async create(params: CreateJobParams): Promise<Job> {
    const normalizedSubtasks = (params.subtasks ?? []).map((subtask, index) =>
      ({
        title: subtask.title.trim(),
        description: subtask.description,
        sequenceOrder: index,
        isRequired: subtask.isRequired,
      }) satisfies CreateSubtaskInput,
    );
    const normalizedInput = {
      clientId: params.clientId,
      title: params.title.trim(),
      description: params.description.trim(),
      category: params.category.trim(),
      budgetCents: params.budgetCents,
      currency: params.currency,
      location: params.location,
      address: params.address,
      scheduledAt: params.scheduledAt,
      metadata: params.metadata,
      publicTitle: params.publicTitle?.trim(),
      publicDescription: params.publicDescription?.trim(),
    };
    const platformFeeCents = Math.floor((params.budgetCents * config.PLATFORM_FEE_BPS) / 10_000);
    const idempotencyFingerprint = params.idempotencyKey
      ? createHash("sha256").update(JSON.stringify({ ...normalizedInput, platformFeeCents, subtasks: normalizedSubtasks })).digest("hex")
      : undefined;
    try {
      return await insertJobWithSubtasks(
      {
        ...normalizedInput,
        budgetCents: params.budgetCents,
        platformFeeCents,
        idempotencyKey: params.idempotencyKey,
        idempotencyFingerprint,
      },
        normalizedSubtasks,
      );
    } catch (err) {
      if (err instanceof JobIdempotencyConflictError) {
        throw new JobServiceError("IDEMPOTENCY_KEY_REUSED", err.message, 409);
      }
      throw err;
    }
  }

  async list(params: ListJobsParams): Promise<{ items: Job[]; total: number; page: number; perPage: number }> {
    if (!Number.isSafeInteger(params.page) || params.page < 1 || params.page > MAX_PAGE) {
      throw new JobServiceError("INVALID_PAGE", `page must be between 1 and ${MAX_PAGE}`);
    }
    if (!Number.isSafeInteger(params.perPage) || params.perPage < 1 || params.perPage > MAX_PER_PAGE) {
      throw new JobServiceError("INVALID_PAGE_SIZE", `per_page must be between 1 and ${MAX_PER_PAGE}`);
    }
    const statuses = params.statuses ?? [];
    const [items, total] = await Promise.all([
      listJobsByClient(params.clientId, statuses, params.perPage, (params.page - 1) * params.perPage),
      countJobsByClient(params.clientId, statuses),
    ]);
    return { items, total, page: params.page, perPage: params.perPage };
  }

  /**
   * Fetch one job with its subtasks, but only for its owner. A non-owner sees
   * NOT_FOUND (not 403) so job existence is not leaked to other clients.
   */
  async getForClient(clientId: string, jobId: string): Promise<{ job: Job; subtasks: JobSubtask[] }> {
    const job = await getJobById(jobId);
    if (!job || job.client_id !== clientId) {
      throw new JobServiceError("JOB_NOT_FOUND", "Job not found", 404);
    }
    const subtasks = await getSubtasksByJob(jobId);
    return { job, subtasks };
  }

  /**
   * Cancel a client's own POSTED job. Enforced atomically in SQL (ownership +
   * status) and guarded here by the state machine.
   */
  async cancel(clientId: string, jobId: string, reason?: string): Promise<Job> {
    const existing = await getJobById(jobId);
    if (!existing || existing.client_id !== clientId) {
      throw new JobServiceError("JOB_NOT_FOUND", "Job not found", 404);
    }
    if (!canClientCancel(existing.status)) {
      throw new JobServiceError(
        "JOB_NOT_CANCELABLE",
        `Job cannot be cancelled in its current state (${existing.status})`,
        409,
      );
    }
    const cancelled = await cancelJobForClient(jobId, clientId, reason);
    if (!cancelled) {
      // Lost a race (e.g. a worker accepted between our read and the update).
      throw new JobServiceError("JOB_NOT_CANCELABLE", "Job is no longer cancelable", 409);
    }
    return cancelled;
  }

  async resolve(
    clientId: string,
    jobId: string,
    action: "APPROVE" | "COMPLETE" | "DISPUTE",
  ): Promise<Job> {
    const resolved = await resolveJobForClient(jobId, clientId, action);
    if (!resolved) {
      throw new JobServiceError("JOB_NOT_FOUND", "Job not found", 404);
    }
    return resolved;
  }
}

export const jobService = new JobService();
