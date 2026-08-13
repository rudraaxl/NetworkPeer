import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, ok } from "../contracts.js";
import { requireAuth } from "../middleware/auth.js";
import { complianceService, ComplianceServiceError } from "../services/compliance-service.js";
import { parseBody } from "../utils/validation.js";

const consentSchema = z.object({
  purpose: z.string().trim().min(3).max(64),
}).strict();

const disputeSchema = z.object({
  job_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(2000),
}).strict();

const resolveSchema = z.object({
  dispute_id: z.string().uuid(),
  resolution: z.enum(["RESOLVED_REFUND", "RESOLVED_RELEASE"]),
  resolution_text: z.string().trim().min(3).max(2000),
}).strict();

function handleComplianceError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof ComplianceServiceError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "compliance request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function complianceRoutes(app: FastifyInstance): Promise<void> {
  app.register(async (child) => {
    child.addHook("onRequest", requireAuth);

    child.post("/consent", async (request, reply) => {
      const body = parseBody(consentSchema, request.body);
      if (!body.ok) return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
      try {
        await complianceService.grantConsent(request.auth.userId, body.value.purpose);
        return ok({ granted: true });
      } catch (err) {
        return handleComplianceError(request, reply, err);
      }
    });

    child.post("/consent/withdraw", async (request, reply) => {
      const body = parseBody(consentSchema, request.body);
      if (!body.ok) return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
      try {
        await complianceService.withdraw(request.auth.userId, body.value.purpose);
        return ok({ withdrawn: true });
      } catch (err) {
        return handleComplianceError(request, reply, err);
      }
    });

    child.post("/data/delete", async (request, reply) => {
      try {
        await complianceService.deleteUserData(request.auth.userId);
        return ok({ deleted: true });
      } catch (err) {
        return handleComplianceError(request, reply, err);
      }
    });

    child.post("/disputes", async (request, reply) => {
      const body = parseBody(disputeSchema, request.body);
      if (!body.ok) return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
      try {
        return ok(await complianceService.openDispute(request.auth.userId, body.value.job_id, body.value.reason));
      } catch (err) {
        return handleComplianceError(request, reply, err);
      }
    });

    child.post("/admin/disputes/resolve", async (request, reply) => {
      const body = parseBody(resolveSchema, request.body);
      if (!body.ok) return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
      try {
        return ok(await complianceService.resolve(
          request.auth.userId,
          body.value.dispute_id,
          body.value.resolution,
          body.value.resolution_text,
        ));
      } catch (err) {
        return handleComplianceError(request, reply, err);
      }
    });
  });
}
