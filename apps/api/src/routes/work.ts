import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, mediaTypeSchema, ok, type Point } from "../contracts.js";
import { config } from "../config.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { parseBody } from "../utils/validation.js";
import { WorkEvidenceService, WorkEvidenceServiceError, workEvidenceService } from "../services/work-evidence-service.js";

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
  .transform((value): Point =>
    "type" in value
      ? { type: "Point", coordinates: [value.coordinates[0], value.coordinates[1]] }
      : { type: "Point", coordinates: [value.longitude, value.latitude] },
  );

const uploadUrlSchema = z.object({
  job_id: z.string().uuid(),
  subtask_id: z.string().uuid(),
  media_type: mediaTypeSchema,
  mime_type: z.string().trim().min(3).max(100).transform((value) => value.toLowerCase()),
  file_size_bytes: z.number().int().positive().max(config.MEDIA_MAX_FILE_SIZE_BYTES),
  captured_at: z.string().datetime().transform((value) => new Date(value)),
  location: locationSchema.optional(),
  checksum_sha256: z.string().regex(/^[0-9a-f]{64}$/, "must be a lowercase SHA-256 hex digest"),
  idempotency_key: z.string().trim().min(8).max(255),
}).strict();

const mediaIdSchema = z.object({ media_id: z.string().uuid() }).strict();
const submitSchema = z.object({ job_id: z.string().uuid() }).strict();
const progressSchema = z.object({
  job_id: z.string().uuid(),
  status: z.enum(["EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"]),
}).strict();

export type WorkRoutesOptions = {
  evidenceService?: WorkEvidenceService;
};

function handleWorkError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof WorkEvidenceServiceError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "work evidence request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function workRoutes(app: FastifyInstance, options: WorkRoutesOptions = {}): Promise<void> {
  const evidenceService = options.evidenceService ?? workEvidenceService;
  app.register(async (child) => {
    child.addHook("onRequest", requireAuth);
    child.addHook("onRequest", requireRole(["WORKER"]));

    child.post("/work/upload-url", async (request, reply) => {
      const parsed = parseBody(uploadUrlSchema, request.body);
      if (!parsed.ok) return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
      try {
        const result = await evidenceService.createUploadUrl({
          workerId: request.auth.userId,
          jobId: parsed.value.job_id,
          subtaskId: parsed.value.subtask_id,
          mediaType: parsed.value.media_type,
          mimeType: parsed.value.mime_type,
          fileSizeBytes: parsed.value.file_size_bytes,
          capturedAt: parsed.value.captured_at,
          location: parsed.value.location,
          checksumSha256: parsed.value.checksum_sha256,
          idempotencyKey: parsed.value.idempotency_key,
        });
        return reply.code(201).send(ok(result));
      } catch (err) {
        return handleWorkError(request, reply, err);
      }
    });

    child.post("/work/evidence", async (request, reply) => {
      const parsed = parseBody(mediaIdSchema, request.body);
      if (!parsed.ok) return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
      try {
        return ok(await evidenceService.confirmEvidence(request.auth.userId, parsed.value.media_id));
      } catch (err) {
        return handleWorkError(request, reply, err);
      }
    });

    child.post("/work/submit", async (request, reply) => {
      const parsed = parseBody(submitSchema, request.body);
      if (!parsed.ok) return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
      try {
        return ok(await evidenceService.submit(request.auth.userId, parsed.value.job_id));
      } catch (err) {
        return handleWorkError(request, reply, err);
      }
    });

    child.post("/work/status", async (request, reply) => {
      const parsed = parseBody(progressSchema, request.body);
      if (!parsed.ok) return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
      try {
        return ok(await evidenceService.advanceStatus(request.auth.userId, parsed.value.job_id, parsed.value.status));
      } catch (err) {
        return handleWorkError(request, reply, err);
      }
    });
  });
}
