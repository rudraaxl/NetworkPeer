import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { fail, ok } from "../contracts.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { LedgerService, LedgerServiceError, ledgerService } from "../services/ledger-service.js";
import { PaymentGatewayError } from "../services/payment-gateway-service.js";
import { parseBody } from "../utils/validation.js";

const jobParamsSchema = z.object({ jobId: z.string().uuid() }).strict();
const idempotencySchema = z.object({
  idempotency_key: z.string().trim().min(8).max(180),
}).strict();

export type FinancialRoutesOptions = {
  ledger?: LedgerService;
};

function handleFinancialError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof LedgerServiceError || err instanceof PaymentGatewayError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "financial request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function financialRoutes(app: FastifyInstance, options: FinancialRoutesOptions = {}): Promise<void> {
  const ledger = options.ledger ?? ledgerService;

  app.register(async (client) => {
    client.addHook("onRequest", requireAuth);
    client.addHook("onRequest", requireRole(["CLIENT"]));

    client.post("/client/jobs/:jobId/fund", async (request, reply) => {
      const params = jobParamsSchema.safeParse(request.params);
      const body = parseBody(idempotencySchema, request.body);
      if (!params.success || !body.ok) {
        return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid escrow funding request"));
      }
      try {
        const funding = await ledger.fundJob({
          clientId: request.auth.userId,
          jobId: params.data.jobId,
          idempotencyKey: body.value.idempotency_key,
        });
        return reply.code(202).send(ok(funding));
      } catch (err) {
        return handleFinancialError(request, reply, err);
      }
    });

    client.post("/client/jobs/:jobId/approve", async (request, reply) => {
      const params = jobParamsSchema.safeParse(request.params);
      const body = parseBody(idempotencySchema, request.body);
      if (!params.success || !body.ok) {
        return reply.code(400).send(fail("VALIDATION_ERROR", "Invalid approval settlement request"));
      }
      try {
        return ok(await ledger.approveJob({
          clientId: request.auth.userId,
          jobId: params.data.jobId,
          idempotencyKey: body.value.idempotency_key,
        }));
      } catch (err) {
        return handleFinancialError(request, reply, err);
      }
    });

    client.get("/client/wallet", async (request, reply) => {
      try {
        return ok({ balances: await ledger.getWallet(request.auth.userId) });
      } catch (err) {
        return handleFinancialError(request, reply, err);
      }
    });
  });

  app.register(async (worker) => {
    worker.addHook("onRequest", requireAuth);
    worker.addHook("onRequest", requireRole(["WORKER"]));
    worker.get("/worker/wallet", async (request, reply) => {
      try {
        return ok({ balances: await ledger.getWallet(request.auth.userId) });
      } catch (err) {
        return handleFinancialError(request, reply, err);
      }
    });
  });
}
