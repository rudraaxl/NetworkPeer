import { config } from "../config.js";
import {
  claimPaymentOperationsForDispatch,
  markPaymentOperationDispatched,
  releasePaymentOperationDispatch,
  settlePaymentWebhook,
  type DispatchablePaymentOperation,
  type PaymentOperationState,
  type PaymentOperationType,
} from "../repository.js";
import { PaymentGatewayError, type PaymentGateway } from "./payment-gateway-service.js";
import { captureException, logger } from "../observability.js";

/**
 * In stub (demo) gateway mode there is no Stripe to fire the completion
 * webhook, so a dispatched operation is settled immediately. Real Stripe
 * deployments skip this entirely and rely on the payment webhook.
 */
export async function autoSettleStubOperation(input: {
  operationId: string;
  operationType: PaymentOperationType;
  providerReference: string | null;
}): Promise<PaymentOperationState | null> {
  if (config.PAYMENT_GATEWAY !== "stub" || !input.providerReference) return null;
  try {
    await settlePaymentWebhook({
      provider: "STUB",
      providerEventId: `evt_stub_auto_${input.operationId}`,
      providerReference: input.providerReference,
      eventType: input.operationType === "FUNDING" ? "payment_intent.succeeded" : "transfer.created",
      outcome: "SUCCEEDED",
      payload: {
        object: {
          id: input.providerReference,
          metadata: { networkpeer_operation_id: input.operationId },
        },
      },
    });
    logger.info(
      { operationId: input.operationId, operationType: input.operationType },
      "stub payment operation auto-settled",
    );
    return { status: "SUCCEEDED", providerReference: input.providerReference };
  } catch (err) {
    logger.warn({ err, operationId: input.operationId }, "stub payment operation auto-settle failed");
    return null;
  }
}

function dispatchFailureCode(err: unknown): string {
  if (err instanceof PaymentGatewayError) return err.code;
  return "PAYMENT_DISPATCH_FAILED";
}

/**
 * Reconciles PostgreSQL's payment-operation outbox. A database lease prevents
 * two API instances from dispatching the same operation concurrently; the
 * provider receives the operation UUID as its idempotency key for recovery
 * after a process crash between the external call and local persistence.
 */
export class PaymentDispatchRuntime {
  private timer: NodeJS.Timeout | null = null;
  private sweepInFlight: Promise<void> | null = null;
  private started = false;

  constructor(private readonly gateway: PaymentGateway) {}

  async start(): Promise<void> {
    if (this.started || config.PAYMENT_DISPATCH_ENABLED !== "true") return;
    this.started = true;
    await this.sweep();
    this.timer = setInterval(() => {
      void this.sweep().catch((err: unknown) => {
        logger.error({ err }, "payment dispatch sweep failed");
        captureException(err, { operation: "payment-dispatch-sweep" });
      });
    }, config.PAYMENT_DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  async kick(): Promise<void> {
    await this.sweep();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.sweepInFlight;
    this.started = false;
  }

  private async sweep(): Promise<void> {
    if (!this.started) return;
    if (this.sweepInFlight) return this.sweepInFlight;
    this.sweepInFlight = this.dispatchClaimedOperations().finally(() => {
      this.sweepInFlight = null;
    });
    return this.sweepInFlight;
  }

  private async dispatchClaimedOperations(): Promise<void> {
    const operations = await claimPaymentOperationsForDispatch(config.PAYMENT_DISPATCH_BATCH_SIZE);
    await Promise.all(operations.map((operation) => this.dispatch(operation)));
  }

  private async dispatch(operation: DispatchablePaymentOperation): Promise<void> {
    logger.info({ operationId: operation.operationId, operationType: operation.operationType }, "payment operation dispatch started");
    try {
      if (operation.provider !== this.gateway.provider) {
        throw new PaymentGatewayError(
          "PAYMENT_GATEWAY_CONFIGURATION_MISMATCH",
          "Payment operation provider does not match the configured gateway",
          503,
        );
      }
      if (operation.operationType === "FUNDING") {
        if (!operation.clientUserId) {
          throw new PaymentGatewayError("PAYMENT_OPERATION_INVALID", "Funding operation is missing its client", 500);
        }
        const result = await this.gateway.createFunding({
          operationId: operation.operationId,
          idempotencyKey: operation.operationId,
          amountCents: operation.amountCents,
          currency: operation.currency,
          clientId: operation.clientUserId,
        });
        await markPaymentOperationDispatched({
          operationId: operation.operationId,
          providerReference: result.providerReference,
          clientSecret: result.clientSecret,
        });
        logger.info({ operationId: operation.operationId, operationType: operation.operationType }, "payment operation dispatched");
        await autoSettleStubOperation({
          operationId: operation.operationId,
          operationType: operation.operationType,
          providerReference: result.providerReference,
        });
        return;
      }

      if (!operation.workerUserId) {
        throw new PaymentGatewayError("PAYMENT_OPERATION_INVALID", "Payout operation is missing its worker", 500);
      }
      const result = await this.gateway.createPayout({
        operationId: operation.operationId,
        idempotencyKey: operation.operationId,
        amountCents: operation.amountCents,
        currency: operation.currency,
        workerId: operation.workerUserId,
        externalAccountId: operation.payoutDestinationReference,
      });
      await markPaymentOperationDispatched({
        operationId: operation.operationId,
        providerReference: result.providerReference,
      });
      logger.info({ operationId: operation.operationId, operationType: operation.operationType }, "payment operation dispatched");
      await autoSettleStubOperation({
        operationId: operation.operationId,
        operationType: operation.operationType,
        providerReference: result.providerReference,
      });
    } catch (err) {
      logger.warn({ err, operationId: operation.operationId, operationType: operation.operationType }, "payment operation dispatch released for retry");
      await releasePaymentOperationDispatch(operation.operationId, dispatchFailureCode(err));
    }
  }
}
