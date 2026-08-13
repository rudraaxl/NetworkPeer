import { createHash } from "node:crypto";
import {
  approveClientJobWithSettlement,
  beginEscrowFunding,
  claimPaymentOperationForDispatch,
  getPaymentOperationState,
  getWalletSummary,
  markPaymentOperationDispatched,
  reconcilePayoutReversalWebhook,
  releasePaymentOperationDispatch,
  settlePaymentWebhook,
  type ApprovalSettlement,
  type FundingOperation,
  type PaymentOperationStatus,
  type WalletSummary,
} from "../repository.js";
import {
  PaymentGatewayError,
  createPaymentGateway,
  type PaymentGateway,
  type NormalizedPaymentWebhook,
} from "./payment-gateway-service.js";

export class LedgerServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "LedgerServiceError";
  }
}

function fingerprint(value: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function databaseErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function mapDatabaseError(err: unknown): never {
  if (err instanceof LedgerServiceError || err instanceof PaymentGatewayError) throw err;
  const code = databaseErrorCode(err);
  if (code === "P0002") throw new LedgerServiceError("NOT_FOUND", "The requested record was not found", 404);
  if (code === "42501") throw new LedgerServiceError("FORBIDDEN", "The requested operation is not allowed", 403);
  if (code === "23505") throw new LedgerServiceError("IDEMPOTENCY_KEY_REUSED", "The idempotency key was reused with different input", 409);
  if (code === "55000" || code === "23514" || code === "40001") {
    throw new LedgerServiceError("FINANCIAL_OPERATION_CONFLICT", "The requested financial operation is not allowed in the current state", 409);
  }
  if (code === "22023") throw new LedgerServiceError("VALIDATION_ERROR", "The financial request is invalid", 400);
  throw err;
}

export type FundingResult = FundingOperation & {
  providerReference: string | null;
  clientSecret: string | null;
};

export type ApprovalResult = ApprovalSettlement & {
  payoutStatus: PaymentOperationStatus;
  payoutProviderReference: string | null;
  payoutDispatchPending: boolean;
};

export class LedgerService {
  constructor(private readonly gateway: PaymentGateway = createPaymentGateway()) {}

  async fundJob(input: {
    clientId: string;
    jobId: string;
    idempotencyKey: string;
  }): Promise<FundingResult> {
    const idempotencyFingerprint = fingerprint({
      operation: "FUNDING",
      clientId: input.clientId,
      jobId: input.jobId,
      provider: this.gateway.provider,
    });
    let operation: FundingOperation;
    try {
      operation = await beginEscrowFunding({
        clientId: input.clientId,
        jobId: input.jobId,
        provider: this.gateway.provider,
        idempotencyKey: input.idempotencyKey,
        idempotencyFingerprint,
      });
    } catch (err) {
      return mapDatabaseError(err);
    }

    if (!operation.dispatchRequired) {
      return operation;
    }
    const claimedOperation = await claimPaymentOperationForDispatch(operation.operationId);
    if (!claimedOperation) {
      const current = await getPaymentOperationState(operation.operationId);
      return {
        ...operation,
        status: current.status,
        providerReference: current.providerReference,
      };
    }
    try {
      if (claimedOperation.provider !== this.gateway.provider || !claimedOperation.clientUserId) {
        throw new PaymentGatewayError("PAYMENT_OPERATION_INVALID", "Funding operation is not dispatchable", 500);
      }
      const gatewayResult = await this.gateway.createFunding({
        operationId: claimedOperation.operationId,
        idempotencyKey: claimedOperation.operationId,
        amountCents: claimedOperation.amountCents,
        currency: claimedOperation.currency,
        clientId: claimedOperation.clientUserId,
      });
      const dispatched = await markPaymentOperationDispatched({
        operationId: claimedOperation.operationId,
        providerReference: gatewayResult.providerReference,
        clientSecret: gatewayResult.clientSecret,
      });
      return {
        ...operation,
        status: dispatched.status,
        providerReference: dispatched.providerReference,
        clientSecret: dispatched.clientSecret,
      };
    } catch (err) {
      await releasePaymentOperationDispatch(operation.operationId, err instanceof PaymentGatewayError ? err.code : "PAYMENT_DISPATCH_FAILED")
        .catch(() => undefined);
      if (err instanceof PaymentGatewayError) throw err;
      return mapDatabaseError(err);
    }
  }

  async approveJob(input: {
    clientId: string;
    jobId: string;
    idempotencyKey: string;
  }): Promise<ApprovalResult> {
    const idempotencyFingerprint = fingerprint({
      operation: "APPROVAL_SETTLEMENT",
      clientId: input.clientId,
      jobId: input.jobId,
      provider: this.gateway.provider,
    });
    let settlement: ApprovalSettlement;
    try {
      settlement = await approveClientJobWithSettlement({
        clientId: input.clientId,
        jobId: input.jobId,
        provider: this.gateway.provider,
        idempotencyKey: input.idempotencyKey,
        idempotencyFingerprint,
      });
    } catch (err) {
      return mapDatabaseError(err);
    }

    if (!settlement.payoutDispatchRequired) {
      try {
        const payout = await getPaymentOperationState(settlement.payoutOperationId);
        return {
          ...settlement,
          payoutStatus: payout.status,
          payoutProviderReference: payout.providerReference,
          payoutDispatchPending: false,
        };
      } catch (err) {
        return mapDatabaseError(err);
      }
    }

    const claimedOperation = await claimPaymentOperationForDispatch(settlement.payoutOperationId);
    if (!claimedOperation) {
      try {
        const payout = await getPaymentOperationState(settlement.payoutOperationId);
        return {
          ...settlement,
          payoutStatus: payout.status,
          payoutProviderReference: payout.providerReference,
          payoutDispatchPending: payout.status === "CREATED",
        };
      } catch (err) {
        return mapDatabaseError(err);
      }
    }

    try {
      if (claimedOperation.provider !== this.gateway.provider || !claimedOperation.workerUserId) {
        throw new PaymentGatewayError("PAYMENT_OPERATION_INVALID", "Payout operation is not dispatchable", 500);
      }
      const gatewayResult = await this.gateway.createPayout({
        operationId: claimedOperation.operationId,
        idempotencyKey: claimedOperation.operationId,
        amountCents: claimedOperation.amountCents,
        currency: claimedOperation.currency,
        workerId: claimedOperation.workerUserId,
        externalAccountId: claimedOperation.payoutDestinationReference,
      });
      const dispatched = await markPaymentOperationDispatched({
        operationId: claimedOperation.operationId,
        providerReference: gatewayResult.providerReference,
      });
      return {
        ...settlement,
        payoutStatus: dispatched.status,
        payoutProviderReference: dispatched.providerReference,
        payoutDispatchPending: false,
      };
    } catch (err) {
      // Approval and its balanced release journal are already committed. Stripe
      // receives the operation UUID as its idempotency key, so retrying this
      // endpoint is safe after a transport-level uncertainty.
      if (err instanceof PaymentGatewayError) {
        await releasePaymentOperationDispatch(settlement.payoutOperationId, err.code).catch(() => undefined);
        return {
          ...settlement,
          payoutStatus: "CREATED",
          payoutProviderReference: null,
          payoutDispatchPending: true,
        };
      }
      return mapDatabaseError(err);
    }
  }

  async processWebhook(event: NormalizedPaymentWebhook) {
    try {
      if (event.outcome === "REVERSAL") {
        return await reconcilePayoutReversalWebhook({
          provider: event.provider,
          providerEventId: event.eventId,
          providerReference: event.providerReference,
          cumulativeReversedAmountCents: event.cumulativeReversedAmountCents,
          payload: event.payload,
        });
      }
      return await settlePaymentWebhook({
        provider: event.provider,
        providerEventId: event.eventId,
        providerReference: event.providerReference,
        eventType: event.eventType,
        outcome: event.outcome,
        payload: event.payload,
      });
    } catch (err) {
      return mapDatabaseError(err);
    }
  }

  async getWallet(userId: string): Promise<WalletSummary[]> {
    try {
      return await getWalletSummary(userId);
    } catch (err) {
      return mapDatabaseError(err);
    }
  }
}

export const ledgerService = new LedgerService();
