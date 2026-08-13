import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { config } from "../config.js";
import type { PaymentProvider } from "../repository.js";

export class PaymentGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
    this.name = "PaymentGatewayError";
  }
}

export type GatewayFundingRequest = {
  operationId: string;
  idempotencyKey: string;
  amountCents: string;
  currency: string;
  clientId: string;
};

export type GatewayPayoutRequest = {
  operationId: string;
  idempotencyKey: string;
  amountCents: string;
  currency: string;
  workerId: string;
  externalAccountId: string | null;
};

export type GatewayFundingResult = {
  providerReference: string;
  clientSecret: string | null;
};

export type GatewayPayoutResult = {
  providerReference: string;
};

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  createFunding(input: GatewayFundingRequest): Promise<GatewayFundingResult>;
  createPayout(input: GatewayPayoutRequest): Promise<GatewayPayoutResult>;
}

function parseAmount(value: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new PaymentGatewayError("PAYMENT_AMOUNT_INVALID", "Payment amount is invalid", 400);
  }
  return value;
}

/** Development/test gateway. It never marks funds settled; a signed webhook is
 * still required to exercise exactly the same ACID settlement path as Stripe. */
export class StubPaymentGateway implements PaymentGateway {
  readonly provider = "STUB" as const;

  async createFunding(input: GatewayFundingRequest): Promise<GatewayFundingResult> {
    parseAmount(input.amountCents);
    return {
      providerReference: `stub_pi_${randomUUID().replaceAll("-", "")}`,
      clientSecret: `stub_secret_${input.operationId}`,
    };
  }

  async createPayout(input: GatewayPayoutRequest): Promise<GatewayPayoutResult> {
    parseAmount(input.amountCents);
    return { providerReference: `stub_po_${randomUUID().replaceAll("-", "")}` };
  }
}

type StripeObject = { id?: unknown; client_secret?: unknown; error?: { message?: unknown } };

/** Minimal Stripe Connect HTTP integration. Card collection stays in Stripe.js;
 * this API only creates server-authorized intents and connected-account transfers. */
export class StripePaymentGateway implements PaymentGateway {
  readonly provider = "STRIPE" as const;

  private async request(path: string, form: URLSearchParams): Promise<StripeObject> {
    let response: Response;
    try {
      response = await fetch(`https://api.stripe.com${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": form.get("metadata[networkpeer_operation_id]") ?? "",
        },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new PaymentGatewayError("PAYMENT_GATEWAY_UNAVAILABLE", "Payment gateway is temporarily unavailable", 503);
    }
    const body = await response.json().catch(() => ({})) as StripeObject;
    if (!response.ok) {
      const detail = typeof body.error?.message === "string" ? body.error.message : "Stripe request failed";
      throw new PaymentGatewayError("PAYMENT_GATEWAY_REJECTED", detail, 502);
    }
    if (typeof body.id !== "string" || body.id.length === 0) {
      throw new PaymentGatewayError("PAYMENT_GATEWAY_INVALID_RESPONSE", "Payment gateway returned an invalid response", 502);
    }
    return body;
  }

  async createFunding(input: GatewayFundingRequest): Promise<GatewayFundingResult> {
    const form = new URLSearchParams({
      amount: parseAmount(input.amountCents),
      currency: input.currency.toLowerCase(),
      "automatic_payment_methods[enabled]": "true",
      "metadata[networkpeer_operation_id]": input.operationId,
      "metadata[networkpeer_client_id]": input.clientId,
    });
    const result = await this.request("/v1/payment_intents", form);
    return {
      providerReference: result.id as string,
      clientSecret: typeof result.client_secret === "string" ? result.client_secret : null,
    };
  }

  async createPayout(input: GatewayPayoutRequest): Promise<GatewayPayoutResult> {
    if (!input.externalAccountId) {
      throw new PaymentGatewayError(
        "WORKER_PAYOUT_ACCOUNT_MISSING",
        "The worker does not have an active connected payout account",
        409,
      );
    }
    const form = new URLSearchParams({
      amount: parseAmount(input.amountCents),
      currency: input.currency.toLowerCase(),
      destination: input.externalAccountId,
      "metadata[networkpeer_operation_id]": input.operationId,
      "metadata[networkpeer_worker_id]": input.workerId,
    });
    const result = await this.request("/v1/transfers", form);
    return { providerReference: result.id as string };
  }
}

export function createPaymentGateway(): PaymentGateway {
  return config.PAYMENT_GATEWAY === "stripe" ? new StripePaymentGateway() : new StubPaymentGateway();
}

function webhookSecret(): string {
  return config.PAYMENT_GATEWAY === "stripe" ? config.STRIPE_WEBHOOK_SECRET : config.PAYMENT_WEBHOOK_SECRET;
}

function equalHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(left) || !/^[0-9a-f]{64}$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

/** Verifies Stripe's timestamped `t=...,v1=...` signature format against the
 * original request bytes, never a parsed/re-serialized JSON body. */
export function verifyPaymentWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): void {
  if (!signatureHeader) {
    throw new PaymentGatewayError("WEBHOOK_SIGNATURE_MISSING", "Missing payment webhook signature", 400);
  }
  const values = signatureHeader.split(",").reduce<{ timestamp?: string; signatures: string[] }>((result, part) => {
    const [key, value] = part.trim().split("=", 2);
    if (key === "t") result.timestamp = value;
    if (key === "v1" && value) result.signatures.push(value);
    return result;
  }, { signatures: [] });
  if (!values.timestamp || !/^\d+$/.test(values.timestamp) || values.signatures.length === 0) {
    throw new PaymentGatewayError("WEBHOOK_SIGNATURE_INVALID", "Invalid payment webhook signature", 400);
  }
  const timestamp = Number(values.timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > config.PAYMENT_WEBHOOK_TOLERANCE_SECONDS) {
    throw new PaymentGatewayError("WEBHOOK_SIGNATURE_EXPIRED", "Payment webhook signature has expired", 400);
  }
  const expected = createHmac("sha256", webhookSecret())
    .update(`${values.timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  if (!values.signatures.some((signature) => equalHex(expected, signature))) {
    throw new PaymentGatewayError("WEBHOOK_SIGNATURE_INVALID", "Invalid payment webhook signature", 400);
  }
}

export function signPaymentWebhook(rawBody: Buffer, timestamp = Math.floor(Date.now() / 1000)): string {
  const signature = createHmac("sha256", webhookSecret())
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

const webhookPayloadSchema = z.object({
  id: z.string().trim().min(1).max(255),
  type: z.string().trim().min(1).max(128),
  data: z.object({
    object: z.object({
      id: z.string().trim().min(1).max(255),
      metadata: z.object({
        networkpeer_operation_id: z.string().uuid(),
      }).passthrough(),
    }).passthrough(),
  }).strict(),
}).passthrough();

type NormalizedPaymentWebhookBase = {
  provider: PaymentProvider;
  eventId: string;
  eventType: string;
  providerReference: string;
  operationId: string;
  payload: Record<string, unknown>;
};

export type NormalizedPaymentWebhook =
  | (NormalizedPaymentWebhookBase & {
    outcome: "SUCCEEDED" | "FAILED";
  })
  | (Omit<NormalizedPaymentWebhookBase, "provider"> & {
    provider: "STRIPE";
    outcome: "REVERSAL";
    cumulativeReversedAmountCents: string;
  });

function parseCumulativeReversalAmount(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PaymentGatewayError(
      "WEBHOOK_PAYLOAD_INVALID",
      "Stripe transfer reversal is missing a valid cumulative amount",
      400,
    );
  }
  return String(value);
}

export function normalizePaymentWebhook(payload: unknown): NormalizedPaymentWebhook | null {
  const parsed = webhookPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new PaymentGatewayError("WEBHOOK_PAYLOAD_INVALID", "Invalid payment webhook payload", 400);
  }
  const eventType = parsed.data.type;
  const stripe = config.PAYMENT_GATEWAY === "stripe";
  if (stripe && eventType === "transfer.reversed") {
    return {
      provider: "STRIPE",
      eventId: parsed.data.id,
      eventType,
      providerReference: parsed.data.data.object.id,
      operationId: parsed.data.data.object.metadata.networkpeer_operation_id,
      outcome: "REVERSAL",
      cumulativeReversedAmountCents: parseCumulativeReversalAmount(parsed.data.data.object["amount_reversed"]),
      payload: parsed.data as Record<string, unknown>,
    };
  }
  const outcome = (stripe
    ? ["payment_intent.succeeded", "transfer.created"].includes(eventType)
      ? "SUCCEEDED"
      : ["payment_intent.canceled"].includes(eventType)
        ? "FAILED"
        : null
    : ["funding.succeeded", "payout.succeeded", "payout.paid", "payment_intent.succeeded"].includes(eventType)
      ? "SUCCEEDED"
      : ["funding.failed", "payout.failed", "payment_intent.payment_failed"].includes(eventType)
        ? "FAILED"
        : null) as "SUCCEEDED" | "FAILED" | null;
  // Stripe sends nonterminal PaymentIntent attempt failures and many unrelated
  // Connect events. Only terminal events are passed to ledger settlement.
  if (!outcome) return null;
  return {
    provider: stripe ? "STRIPE" : "STUB",
    eventId: parsed.data.id,
    eventType,
    providerReference: parsed.data.data.object.id,
    operationId: parsed.data.data.object.metadata.networkpeer_operation_id,
    outcome,
    payload: parsed.data as Record<string, unknown>,
  };
}
