import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, ok } from "../contracts.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { adminService, AdminServiceError, type AdminOverrideStatus } from "../services/admin-service.js";

const maxCursor = 9_223_372_036_854_775_807n;
function isBigIntCursor(value: string): boolean {
  try {
    return BigInt(value) <= maxCursor;
  } catch {
    return false;
  }
}
const auditQuerySchema = z.object({
  before_id: z.string().regex(/^\d+$/).refine(isBigIntCursor, "before_id exceeds PostgreSQL BIGINT").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  actor_id: z.string().uuid().optional(),
  entity_type: z.string().trim().min(1).max(64).optional(),
  entity_id: z.string().uuid().optional(),
}).strict();

const jobParamsSchema = z.object({ jobId: z.string().uuid() }).strict();
const userParamsSchema = z.object({ userId: z.string().uuid() }).strict();
const overrideBodySchema = z.object({
  action: z.enum(["STATUS", "REASSIGN", "CANCEL"]),
  status: z.enum(["DISPUTED", "APPROVED", "COMPLETED"]).optional(),
  worker_id: z.string().uuid().optional(),
  reason: z.string().trim().min(3).max(2_000),
  cancellation_reason: z.string().trim().min(3).max(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "STATUS" && !value.status) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "status is required for STATUS" });
  }
  if (value.action === "REASSIGN" && !value.worker_id) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["worker_id"], message: "worker_id is required for REASSIGN" });
  }
});
const userQuerySchema = z.object({
  role: z.enum(["CLIENT", "WORKER"]).optional(),
  is_active: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  page: z.coerce.number().int().min(1).max(1_000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
const suspendBodySchema = z.object({
  reason: z.string().trim().min(3).max(2_000),
}).strict();

function handleAdminError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof AdminServiceError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "admin operation failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (child) => {
    child.addHook("onRequest", requireAuth);
    child.addHook("onRequest", requireRole(["ADMIN"]));

    child.get("/admin/audit-log", async (request, reply) => {
      const query = auditQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid audit-log query"));
      try {
        return ok(await adminService.listAudit({
          beforeId: query.data.before_id ?? null,
          actorUserId: query.data.actor_id,
          entityType: query.data.entity_type,
          entityId: query.data.entity_id,
          limit: query.data.limit,
        }));
      } catch (err) {
        return handleAdminError(request, reply, err);
      }
    });

    child.post("/admin/jobs/:jobId/override", async (request, reply) => {
      const params = jobParamsSchema.safeParse(request.params);
      const body = overrideBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid job override request"));
      }
      try {
        return ok(await adminService.overrideJob({
          actorUserId: request.auth.userId,
          jobId: params.data.jobId,
          action: body.data.action,
          targetStatus: body.data.status as AdminOverrideStatus | undefined,
          targetWorkerId: body.data.worker_id,
          reason: body.data.reason,
          cancellationReason: body.data.cancellation_reason,
        }));
      } catch (err) {
        return handleAdminError(request, reply, err);
      }
    });

    child.get("/admin/users", async (request, reply) => {
      const query = userQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid users query"));
      try {
        return ok(await adminService.listUsers({
          role: query.data.role,
          isActive: query.data.is_active,
          page: query.data.page,
          perPage: query.data.per_page,
        }));
      } catch (err) {
        return handleAdminError(request, reply, err);
      }
    });

    child.post("/admin/users/:userId/suspend", async (request, reply) => {
      const params = userParamsSchema.safeParse(request.params);
      const body = suspendBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid user suspension request"));
      }
      try {
        return ok(await adminService.suspendUser({
          actorUserId: request.auth.userId,
          userId: params.data.userId,
          reason: body.data.reason,
        }));
      } catch (err) {
        return handleAdminError(request, reply, err);
      }
    });

    child.get("/admin/analytics", async (request, reply) => {
      try {
        return ok(await adminService.analytics());
      } catch (err) {
        return handleAdminError(request, reply, err);
      }
    });
  });
}
