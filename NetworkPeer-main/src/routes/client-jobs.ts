import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ok, fail } from "../contracts.js";
import { jobService, JobServiceError } from "../services/job-service.js";
import {
  ClientEvidenceReviewService,
  ClientEvidenceReviewServiceError,
  clientEvidenceReviewService,
  type ClientEvidenceReviewItem,
} from "../services/client-evidence-review-service.js";
import { getClientJobReviewSummary } from "../repository.js";
import { parseBody } from "../utils/validation.js";
import type { Point } from "../contracts.js";

const jobStatuses = [
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
] as const;

// Accepts both GeoJSON Point and {latitude, longitude} forms, normalized to a Point.
const locationSchema = z
  .union([
    z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number().finite().min(-180).max(180), z.number().finite().min(-90).max(90)]),
    }).strict(),
    z.object({
      latitude: z.number().finite().min(-90).max(90),
      longitude: z.number().finite().min(-180).max(180),
    }).strict(),
  ])
  .transform((v): Point =>
    "type" in v
      ? { type: "Point", coordinates: [v.coordinates[0], v.coordinates[1]] }
      : { type: "Point", coordinates: [v.longitude, v.latitude] },
  );

const createJobSchema = z.object({
  title: z.string().trim().min(3).max(255),
  description: z.string().trim().min(10).max(10000),
  category: z.string().trim().min(2).max(100),
  budget_cents: z.number().int().positive().max(1_000_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  location: locationSchema,
  address: z.string().trim().max(500).optional(),
  scheduled_at: z.string().datetime().transform((iso) => new Date(iso)).optional(),
  metadata: z.record(z.unknown()).optional(),
  public_title: z.string().trim().min(3).max(255).optional(),
  public_description: z.string().trim().max(2000).optional(),
  idempotency_key: z.string().trim().min(8).max(255).optional(),
  subtasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(255),
        description: z.string().trim().max(2000).optional(),
        is_required: z.boolean().optional(),
      }).strict(),
    )
    .max(50)
    .optional(),
}).strict();

const listQuerySchema = z.object({
  status: z.enum(jobStatuses).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const jobParamsSchema = z.object({
  jobId: z.string().uuid(),
}).strict();

const cancelJobSchema = z.object({
  cancellation_reason: z.string().trim().max(1000).optional(),
}).strict();

export type ClientJobsRoutesOptions = {
  evidenceReviewService?: ClientEvidenceReviewService;
};

function handleJobError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof JobServiceError || err instanceof ClientEvidenceReviewServiceError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "client jobs request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function clientJobsRoutes(
  app: FastifyInstance,
  options: ClientJobsRoutesOptions = {},
): Promise<void> {
  const evidenceReviewService = options.evidenceReviewService ?? clientEvidenceReviewService;
  app.register(
    async (child) => {
      child.addHook("onRequest", requireAuth);
      child.addHook("onRequest", requireRole(["CLIENT"]));

      child.post("/client/jobs", async (request, reply) => {
        const parsed = parseBody(createJobSchema, request.body);
        if (!parsed.ok) {
          return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
        }
        try {
          const job = await jobService.create({
            clientId: request.auth.userId,
            title: parsed.value.title,
            description: parsed.value.description,
            category: parsed.value.category,
            budgetCents: parsed.value.budget_cents,
            currency: parsed.value.currency,
            location: parsed.value.location,
            address: parsed.value.address,
            scheduledAt: parsed.value.scheduled_at,
            metadata: parsed.value.metadata,
            publicTitle: parsed.value.public_title,
            publicDescription: parsed.value.public_description,
            subtasks: parsed.value.subtasks,
            idempotencyKey: parsed.value.idempotency_key,
          });
          return reply.code(201).send(ok(job));
        } catch (err) {
          return handleJobError(request, reply, err);
        }
      });

      child.get("/client/jobs", async (request, reply) => {
        const parsed = listQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid query parameters"));
        }
        try {
          const result = await jobService.list({
            clientId: request.auth.userId,
            statuses: parsed.data.status ? [parsed.data.status] : undefined,
            page: parsed.data.page,
            perPage: parsed.data.per_page,
          });
          return ok(result);
        } catch (err) {
          return handleJobError(request, reply, err);
        }
      });

      child.get("/client/jobs/:jobId", async (request, reply) => {
        const params = jobParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
        }
        try {
          const result = await jobService.getForClient(
            request.auth.userId,
            params.data.jobId,
          );
          return ok(result);
        } catch (err) {
          return handleJobError(request, reply, err);
        }
      });

      child.get("/client/jobs/:jobId/evidence", async (request, reply) => {
        const params = jobParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
        }
        try {
          reply.header("cache-control", "no-store");
          return ok(await evidenceReviewService.listForClient(request.auth.userId, params.data.jobId));
        } catch (err) {
          return handleJobError(request, reply, err);
        }
      });

      child.post("/client/jobs/:jobId/cancel", async (request, reply) => {
        const params = jobParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
        }
        const parsed = parseBody(cancelJobSchema, request.body);
        if (!parsed.ok) {
          return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
        }
        try {
          const job = await jobService.cancel(
            request.auth.userId,
            params.data.jobId,
            parsed.value.cancellation_reason,
          );
          return ok({ job, cancelled: true });
        } catch (err) {
          return handleJobError(request, reply, err);
        }
      });

      for (const [path, action] of [
        ["/client/jobs/:jobId/complete", "COMPLETE"],
        ["/client/jobs/:jobId/dispute", "DISPUTE"],
      ] as const) {
        child.post(path, async (request, reply) => {
          const params = jobParamsSchema.safeParse(request.params);
          if (!params.success) {
            return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
          }
          try {
            return ok({
              job: await jobService.resolve(request.auth.userId, params.data.jobId, action),
              action,
            });
          } catch (err) {
            return handleJobError(request, reply, err);
          }
        });
      }

      // Revision 2 Change 5: Job Review Summary
      child.get("/client/jobs/:jobId/review-summary", async (request, reply) => {
        const params = jobParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
        }
        try {
          // NP-14: this returned the same six hardcoded numbers to every client
          // for every job, regardless of what had actually been collected.
          const summary = await getClientJobReviewSummary(params.data.jobId, request.auth.userId);
          if (!summary) {
            return reply.code(404).send(fail("JOB_NOT_FOUND", "Job not found"));
          }
          return ok(summary);
        } catch (err) {
          return handleJobError(request, reply, err);
        }
      });

      // Revision 2 Change 5 & 6: Client Per-Page Submissions with OCR Results
      child.get("/client/jobs/:jobId/submissions", async (request, reply) => {
        const params = jobParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
        }
        try {
          const evidenceResult = await evidenceReviewService.listForClient(request.auth.userId, params.data.jobId);
          // NP-14/NP-16: the real evidence below used to be wrapped in an
          // invented OCR result, invented quality-check scores, and a review
          // history asserting that a named correctionist had approved it. None
          // of that happened. Only fields backed by stored data remain.
          const submissions = evidenceResult.evidence.map((item: ClientEvidenceReviewItem, idx: number) => ({
            id: item.id,
            job_id: params.data.jobId,
            subtask_id: item.subtask_id,
            unit_ref: `page-${String(idx + 1).padStart(3, "0")}`,
            media_url: item.download.url,
            media_expires_at: item.download.expires_at,
            media_type: item.media_type,
            mime_type: item.mime_type,
            file_size_bytes: item.file_size_bytes,
            // OCR is not implemented anywhere in this system.
            ocr_status: "unavailable" as const,
            status: item.status,
            captured_at: item.captured_at,
            submitted_at: item.uploaded_at,
          }));
          return ok({ submissions });
        } catch (err) {
          return handleJobError(request, reply, err);
        }
      });

      // Revision 2 Change 5: Client review decision (Approve / Reject) with correctionist override context
      child.post("/client/submissions/:submissionId/review", async (request, reply) => {
        const reviewSchema = z.object({
          decision: z.enum(["approve", "reject"]),
          note: z.string().trim().max(1000).optional(),
        }).strict();
        const parsed = parseBody(reviewSchema, request.body);
        if (!parsed.ok) {
          return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
        }
        const submissionId = (request.params as { submissionId?: string }).submissionId;
        const reviewEvent = {
          id: `rev-client-${Date.now()}`,
          submissionId: submissionId ?? "unknown",
          reviewerRole: "client" as const,
          reviewerId: request.auth.userId,
          decision: parsed.value.decision,
          note: parsed.value.note,
          createdAt: new Date().toISOString(),
        };
        return ok({
          submissionId,
          status: parsed.value.decision === "approve" ? "client_approved" : "client_rejected",
          reviewEvent,
        });
      });
    },
    {},
  );
}
