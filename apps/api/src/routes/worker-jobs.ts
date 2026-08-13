import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, ok } from "../contracts.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { WorkerJobServiceError, workerJobService } from "../services/worker-job-service.js";
import { parseBody } from "../utils/validation.js";

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
      child.addHook("onRequest", requireRole(["WORKER"]));

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
    },
    {},
  );
}
