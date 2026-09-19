import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const paymentRepository = vi.hoisted(() => ({
  claimPaymentOperationsForDispatch: vi.fn(),
  markPaymentOperationDispatched: vi.fn(),
  releasePaymentOperationDispatch: vi.fn(),
}));

const observability = vi.hoisted(() => ({
  captureException: vi.fn(),
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../src/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/repository.js")>();
  return { ...actual, ...paymentRepository };
});

vi.mock("../src/observability.js", () => observability);

vi.mock("../src/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/config.js")>();
  return {
    ...actual,
    config: { ...actual.config, PAYMENT_DISPATCH_ENABLED: "true", PAYMENT_DISPATCH_BATCH_SIZE: 10 },
  };
});

import { PaymentDispatchRuntime } from "../src/services/payment-dispatch-service.js";
import { PaymentGatewayError, type PaymentGateway } from "../src/services/payment-gateway-service.js";

function payoutOperation(operationId: string) {
  return {
    operationId,
    operationType: "PAYOUT" as const,
    provider: "stub",
    amountCents: "1000",
    currency: "INR",
    workerUserId: "worker-1",
    clientUserId: null,
    payoutDestinationReference: "acct_1",
  };
}

function gatewayThatFails(): PaymentGateway {
  return {
    provider: "stub",
    createFunding: vi.fn(),
    createPayout: vi.fn().mockRejectedValue(
      new PaymentGatewayError("WORKER_PAYOUT_ACCOUNT_MISSING", "no payout account", 409),
    ),
  } as unknown as PaymentGateway;
}

describe("PaymentDispatchRuntime", () => {
  beforeEach(() => {
    paymentRepository.claimPaymentOperationsForDispatch.mockReset();
    paymentRepository.markPaymentOperationDispatched.mockReset();
    paymentRepository.releasePaymentOperationDispatch.mockReset();
    observability.logger.error.mockReset();
    observability.captureException.mockReset();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it("does not reject the sweep when releasing a failed dispatch itself throws", async () => {
    // Reachable when the gateway call succeeded but its response was lost: the
    // operation is no longer CREATED, so release raises P0002. Rethrowing here
    // would reject the whole sweep.
    paymentRepository.claimPaymentOperationsForDispatch.mockResolvedValue([payoutOperation("op-1")]);
    paymentRepository.releasePaymentOperationDispatch.mockRejectedValue(
      Object.assign(new Error("Dispatchable payment operation not found"), { code: "P0002" }),
    );

    const runtime = new PaymentDispatchRuntime(gatewayThatFails());

    // start() performs the first sweep; sweep() is a no-op until started.
    await expect(runtime.start()).resolves.toBeUndefined();
    expect(paymentRepository.releasePaymentOperationDispatch).toHaveBeenCalledOnce();
    expect(observability.captureException).toHaveBeenCalledOnce();

    await runtime.close();
  });

  it("start() resolves even when the first sweep fails, so boot is never blocked", async () => {
    // index.ts awaits start() inside onReady. A rejection here would stop the
    // server coming up at all.
    paymentRepository.claimPaymentOperationsForDispatch.mockRejectedValue(new Error("database unreachable"));

    const runtime = new PaymentDispatchRuntime(gatewayThatFails());

    await expect(runtime.start()).resolves.toBeUndefined();
    expect(observability.logger.error).toHaveBeenCalled();

    await runtime.close();
  });

  it("one failing operation does not prevent others in the same batch from dispatching", async () => {
    paymentRepository.claimPaymentOperationsForDispatch.mockResolvedValue([
      payoutOperation("op-poison"),
      payoutOperation("op-healthy"),
    ]);
    paymentRepository.releasePaymentOperationDispatch.mockRejectedValue(new Error("P0002"));

    const gateway = {
      provider: "stub",
      createFunding: vi.fn(),
      createPayout: vi
        .fn()
        .mockRejectedValueOnce(new PaymentGatewayError("WORKER_PAYOUT_ACCOUNT_MISSING", "no account", 409))
        .mockResolvedValueOnce({ providerReference: "pay_ok" }),
    } as unknown as PaymentGateway;

    const runtime = new PaymentDispatchRuntime(gateway);

    await expect(runtime.start()).resolves.toBeUndefined();
    expect(paymentRepository.markPaymentOperationDispatched).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-healthy" }),
    );

    await runtime.close();
  });
});
