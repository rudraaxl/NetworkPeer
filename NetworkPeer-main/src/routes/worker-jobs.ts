import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, ok } from "../contracts.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { WorkerJobServiceError, workerJobService } from "../services/worker-job-service.js";
import { parseBody } from "../utils/validation.js";
import {
  getWorkerEligibleRoles,
  listSubmissionsForCorrectionistReview,
  listSubmissionsForWorker,
  recordCorrectionistReviewDecision,
  type CorrectionistReviewRecord,
} from "../repository.js";
import { mediaStorage } from "../services/media-storage-service.js";
import { config } from "../config.js";

const nearbyQuerySchema = z.object({
  radius_km: z.coerce.number().finite().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).max(100).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

const jobParamsSchema = z.object({
  jobId: z.string().uuid(),
}).strict();

const locationSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}).strict();

function handleWorkerJobError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof WorkerJobServiceError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "worker jobs request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function workerJobsRoutes(app: FastifyInstance): Promise<void> {
  app.register(
    async (child) => {
      child.addHook("onRequest", requireAuth);
      child.addHook("onRequest", requireRole(["WORKER", "CLIENT"]));

      child.get("/worker/jobs", async (request, reply) => {
        const parsed = nearbyQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid jobs query"));
        }
        try {
          const result = await workerJobService.listAll({
            workerId: request.auth.userId,
            page: parsed.data.page,
            perPage: parsed.data.per_page,
          });
          return ok(result);
        } catch (err) {
          return handleWorkerJobError(request, reply, err);
        }
      });

      child.get("/worker/jobs/nearby", async (request, reply) => {
        const parsed = nearbyQuerySchema.safeParse(request.query);
        if (!parsed.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid nearby-jobs query"));
        }
        try {
          const result = await workerJobService.listNearby({
            workerId: request.auth.userId,
            radiusKm: parsed.data.radius_km,
            page: parsed.data.page,
            perPage: parsed.data.per_page,
          });
          return ok(result);
        } catch (err) {
          return handleWorkerJobError(request, reply, err);
        }
      });

      child.post("/worker/location", async (request, reply) => {
        const parsed = parseBody(locationSchema, request.body);
        if (!parsed.ok) {
          return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
        }
        try {
          return ok(await workerJobService.updateLocation(request.auth.userId, {
            type: "Point",
            coordinates: [parsed.value.longitude, parsed.value.latitude],
          }));
        } catch (err) {
          return handleWorkerJobError(request, reply, err);
        }
      });

      child.get("/worker/jobs/:jobId", async (request, reply) => {
        const params = jobParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
        }
        try {
          return ok(await workerJobService.getDetail(request.auth.userId, params.data.jobId));
        } catch (err) {
          return handleWorkerJobError(request, reply, err);
        }
      });

      child.post("/worker/jobs/:jobId/accept", async (request, reply) => {
        const params = jobParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
        }
        try {
          return ok(await workerJobService.accept(request.auth.userId, params.data.jobId));
        } catch (err) {
          return handleWorkerJobError(request, reply, err);
        }
      });

      // Revision 5 §22.3: Correctionist Review Queue
      // RELEASE BLOCKER §26 Finding 2: Server-side gating with 403 Forbidden
      /**
       * NP-14/NP-16: this handler used to build the queue out of a job's
       * subtasks -- inventing submission ids, pointing every item at the same
       * stock photograph, and attaching an `ocrResult` that named an OCR engine
       * and a 0.96 confidence score. No OCR runs anywhere in this system and no
       * column stores one. It now returns the evidence that was actually
       * uploaded and is actually awaiting review, with signed, expiring URLs.
       */
      const presentSubmission = async (record: CorrectionistReviewRecord, expiresAt: Date) => {
        const download = record.s3VersionId
          ? await mediaStorage.createDownloadTarget({
            bucket: record.s3Bucket,
            key: record.s3Key,
            versionId: record.s3VersionId,
          })
          : null;
        return {
          id: record.id,
          job_id: record.jobId,
          subtask_id: record.subtaskId,
          worker_id: record.workerId,
          media_type: record.mediaType,
          mime_type: record.mimeType,
          file_size_bytes: record.fileSizeBytes,
          captured_at: record.capturedAt,
          uploaded_at: record.uploadedAt,
          status: record.status,
          verification_notes: record.verificationNotes,
          // OCR is not implemented. This states that plainly rather than
          // fabricating a result the reviewer might act on.
          ocr_status: "unavailable" as const,
          media: download ? { url: download.url, expires_at: expiresAt } : null,
        };
      };

      const handleReviewQueue = async (request: FastifyRequest, reply: FastifyReply) => {
        const eligibleRoles = await getWorkerEligibleRoles(request.auth.userId);
        if (!eligibleRoles.includes("correctionist")) {
          return reply.code(403).send(fail("FORBIDDEN", "Correctionist role required. Worker must be approved by an administrator."));
        }

        const params = jobParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job id"));
        }

        try {
          const records = await listSubmissionsForCorrectionistReview(params.data.jobId);
          if (records === null) {
            return reply.code(404).send(fail("JOB_NOT_FOUND", "Job not found"));
          }
          const expiresAt = new Date(Date.now() + config.AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS * 1000);
          const submissions = await Promise.all(records.map((record) => presentSubmission(record, expiresAt)));
          return ok({ submissions });
        } catch (err) {
          return handleWorkerJobError(request, reply, err);
        }
      };

      child.get("/worker/jobs/:jobId/review-queue", handleReviewQueue);
      child.get("/jobs/:jobId/review-queue", handleReviewQueue);

      // Revision 5 §22.3: Review submission decision (Approve / Redo)
      // RELEASE BLOCKER §26 Finding 2: Server-side gating with 403 Forbidden
      const handleSubmissionReview = async (request: FastifyRequest, reply: FastifyReply) => {
        const eligibleRoles = await getWorkerEligibleRoles(request.auth.userId);
        if (!eligibleRoles.includes("correctionist")) {
          return reply.code(403).send(fail("FORBIDDEN", "Correctionist role required. Worker must be approved by an administrator."));
        }

        const reviewSchema = z.object({
          decision: z.enum(["approve", "redo", "reject"]),
          note: z.string().trim().max(1000).optional(),
        }).strict();
        const parsed = parseBody(reviewSchema, request.body);
        if (!parsed.ok) {
          return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
        }
        // NP-14: this previously echoed the request back with a synthesized
        // review event and persisted nothing, so every decision was lost.
        const submissionParams = z.object({ submissionId: z.string().uuid() }).safeParse(request.params);
        if (!submissionParams.success) {
          return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid submission id"));
        }

        try {
          const result = await recordCorrectionistReviewDecision({
            submissionId: submissionParams.data.submissionId,
            decision: parsed.value.decision,
            note: parsed.value.note,
          });
          if (!result) {
            return reply.code(409).send(fail(
              "SUBMISSION_NOT_REVIEWABLE",
              "Submission does not exist or is no longer awaiting review",
            ));
          }
          return ok({
            submission_id: result.id,
            status: result.status,
            decision: parsed.value.decision,
            reviewer_id: request.auth.userId,
            reviewed_at: new Date().toISOString(),
          });
        } catch (err) {
          return handleWorkerJobError(request, reply, err);
        }
      };

      child.post("/worker/submissions/:submissionId/review", handleSubmissionReview);
      child.post("/submissions/:submissionId/review", handleSubmissionReview);

      // NP-14: this returned two hardcoded submissions with stock photo URLs and
      // invented OCR snippets ("IN THE HIGH COURT OF JUSTICE..."). It now
      // returns the worker's real uploads.
      child.get("/worker/submissions/me", async (request, reply) => {
        try {
          const records = await listSubmissionsForWorker(request.auth.userId, 50);
          const expiresAt = new Date(Date.now() + config.AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS * 1000);
          const submissions = await Promise.all(records.map((record) => presentSubmission(record, expiresAt)));
          return ok({ submissions });
        } catch (err) {
          return handleWorkerJobError(request, reply, err);
        }
      });

      // Revision 2 Change 3: Quality-Check Telemetry
      child.post("/telemetry/quality-check", async (request) => {
        request.log.info({ telemetry: request.body }, "capture quality check telemetry received");
        return ok({ logged: true });
      });
    },
    {},
  );

}
