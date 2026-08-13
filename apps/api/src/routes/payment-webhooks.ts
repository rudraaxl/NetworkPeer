import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fail, ok } from "../contracts.js";
import { LedgerService, LedgerServiceError, ledgerService } from "../services/ledger-service.js";
import {
  PaymentGatewayError,
  normalizePaymentWebhook,
  verifyPaymentWebhookSignature,
} from "../services/payment-gateway-service.js";

declare module "fastify" {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export type PaymentWebhookRoutesOptions = {
  ledger?: LedgerService;
};

function handleWebhookError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof LedgerServiceError || err instanceof PaymentGatewayError) {
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }
  request.log.error({ err }, "payment webhook failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}

export default async function paymentWebhookRoutes(
  app: FastifyInstance,
  options: PaymentWebhookRoutesOptions = {},
): Promise<void> {
  const ledger = options.ledger ?? ledgerService;

  // Parse this plugin's JSON as bytes first. The signature covers exactly these
  // bytes, not a JSON.stringify reconstruction with different whitespace/order.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    const rawBody = body as Buffer;
    request.rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody.toString("utf8")));
    } catch {
      done(new Error("Invalid JSON payment webhook body"));
    }
  });

  app.post("/webhooks/payments", async (request, reply) => {
    try {
      if (!request.rawBody) {
        throw new PaymentGatewayError("WEBHOOK_BODY_MISSING", "Payment webhook body is missing", 400);
      }
      const signature = request.headers["stripe-signature"];
      verifyPaymentWebhookSignature(request.rawBody, Array.isArray(signature) ? signature[0] : signature);
      const event = normalizePaymentWebhook(request.body);
      if (!event) return ok({ ignored: true });
      return ok(await ledger.processWebhook(event));
    } catch (err) {
      return handleWebhookError(request, reply, err);
    }
  });
}
