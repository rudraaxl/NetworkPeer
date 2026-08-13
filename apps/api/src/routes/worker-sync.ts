import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, ok } from "../contracts.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { notificationService, NotificationServiceError } from "../services/notification-service.js";

const cursorSchema = z.string().regex(/^\d+$/).refine((value) => {
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}, "cursor exceeds PostgreSQL BIGINT");

const workerSyncQuerySchema = z.object({
  cursor: cursorSchema.default("0"),
  limit: z.coerce.number().int().min(1).max(500).default(50),
}).strict();

function handleWorkerSyncError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof NotificationServiceError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "worker sync request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

/**
 * Worker SQLite sync endpoint. Events remain the durable delta source; related
 * job/ledger records are included so clients do not need to infer domain state
 * from notification text.
 */
export default async function workerSyncRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (child) => {
    child.addHook("onRequest", requireAuth);
    child.addHook("onRequest", requireRole(["WORKER"]));

    child.get("/worker/sync", async (request, reply) => {
      const parsed = workerSyncQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid worker sync query"));
      }
      try {
        return ok(await notificationService.workerSync(
          request.auth.userId,
          parsed.data.cursor,
          parsed.data.limit,
        ));
      } catch (err) {
        return handleWorkerSyncError(request, reply, err);
      }
    });
  });
}
