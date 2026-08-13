import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, ok } from "../contracts.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { AdminWorkerServiceError, adminWorkerService } from "../services/admin-worker-service.js";

const workerParamsSchema = z.object({ workerId: z.string().uuid() }).strict();
const verificationSchema = z.object({
  verification_status: z.enum(["PENDING", "VERIFIED", "REJECTED", "SUSPENDED"]),
  is_available: z.boolean().default(false),
  reason: z.string().trim().min(3).max(2_000),
}).strict();

function handleAdminWorkerError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof AdminWorkerServiceError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "admin worker update failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function adminWorkerRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (child) => {
    child.addHook("onRequest", requireAuth);
    child.addHook("onRequest", requireRole(["ADMIN"]));

    child.patch("/admin/workers/:workerId/verification", async (request, reply) => {
      const params = workerParamsSchema.safeParse(request.params);
      const body = verificationSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid worker verification update"));
      }
      try {
          const profile = await adminWorkerService.setVerification(
            request.auth.userId,
            params.data.workerId,
            body.data.verification_status,
            body.data.is_available,
            body.data.reason,
        );
        return ok(profile);
      } catch (err) {
        return handleAdminWorkerError(request, reply, err);
      }
    });
  });
}
