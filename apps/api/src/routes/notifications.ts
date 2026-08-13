import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, ok, pushPlatformSchema } from "../contracts.js";
import { requireAuth } from "../middleware/auth.js";
import { notificationService, NotificationServiceError } from "../services/notification-service.js";
import { parseBody } from "../utils/validation.js";

const cursorSchema = z.string().regex(/^\d+$/).refine((value) => {
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}, "cursor exceeds PostgreSQL BIGINT");

const listQuerySchema = z.object({
  before_cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
}).strict();
const notificationParamsSchema = z.object({ notificationId: z.string().uuid() }).strict();
const deviceSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  platform: pushPlatformSchema,
}).strict();

function handleNotificationError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof NotificationServiceError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "notification request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (child) => {
    child.addHook("onRequest", requireAuth);

    child.get("/notifications", async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid notifications query"));
      try {
        return ok(await notificationService.list(request.auth.userId, parsed.data.before_cursor ?? null, parsed.data.limit));
      } catch (err) {
        return handleNotificationError(request, reply, err);
      }
    });

    child.post("/notifications/read-all", async (request, reply) => {
      try {
        return ok(await notificationService.markAllRead(request.auth.userId));
      } catch (err) {
        return handleNotificationError(request, reply, err);
      }
    });

    child.post("/notifications/:notificationId/read", async (request, reply) => {
      const params = notificationParamsSchema.safeParse(request.params);
      if (!params.success) return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid notification id"));
      try {
        return ok(await notificationService.markRead(request.auth.userId, params.data.notificationId));
      } catch (err) {
        return handleNotificationError(request, reply, err);
      }
    });

    child.post("/notifications/devices", async (request, reply) => {
      const parsed = parseBody(deviceSchema, request.body);
      if (!parsed.ok) return reply.code(400).send(fail("VALIDATION_ERROR", parsed.message));
      try {
        return reply.code(201).send(ok(await notificationService.registerDevice(
          request.auth.userId,
          parsed.value.token,
          parsed.value.platform,
        )));
      } catch (err) {
        return handleNotificationError(request, reply, err);
      }
    });
  });
}
