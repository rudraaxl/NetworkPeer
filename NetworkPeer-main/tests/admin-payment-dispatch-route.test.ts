import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { issueTestCognitoAccessToken, resetTestCognitoVerifier } from "../src/testing/cognito-test-verifier.js";

const listExhaustedPaymentOperations = vi.hoisted(() => vi.fn());
const resetPaymentOperationDispatch = vi.hoisted(() => vi.fn());
const getUserByCognitoSub = vi.hoisted(() => vi.fn());
const refundClientJob = vi.hoisted(() => vi.fn());
const adminOverrideJob = vi.hoisted(() => vi.fn());
const adminSuspendUser = vi.hoisted(() => vi.fn());
const getUserById = vi.hoisted(() => vi.fn());
const getAdminAnalytics = vi.hoisted(() => vi.fn());
const listAdminAuditLog = vi.hoisted(() => vi.fn());
const listAdminUsers = vi.hoisted(() => vi.fn());
const updateWorkerVerificationAsAdmin = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", () => ({
  listExhaustedPaymentOperations,
  resetPaymentOperationDispatch,
  getUserByCognitoSub,
  refundClientJob,
  adminOverrideJob,
  adminSuspendUser,
  getUserById,
  getAdminAnalytics,
  listAdminAuditLog,
  listAdminUsers,
  updateWorkerVerificationAsAdmin,
}));

import adminRoutes from "../src/routes/admin.js";
import { config } from "../src/config.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const WORKER_ID = "00000000-0000-4000-8000-000000000003";
const OPERATION_ID = "00000000-0000-4000-8000-0000000000cc";

let app: ReturnType<typeof Fastify> | undefined;

function pgError(code: string, message = "database rejected the operation"): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function stuckPayout() {
  return {
    operationId: OPERATION_ID,
    operationType: "PAYOUT",
    jobId: null,
    amountCents: "45000",
    currency: "INR",
    clientUserId: null,
    workerUserId: WORKER_ID,
    dispatchAttempts: 12,
    lastDispatchError: "WORKER_PAYOUT_ACCOUNT_MISSING",
    createdAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
  };
}

async function buildTestApp() {
  const testApp = Fastify();
  await testApp.register(cookie);
  await testApp.register(adminRoutes, { prefix: config.API_PREFIX });
  await testApp.ready();
  return testApp;
}

function adminToken(): string {
  return issueTestCognitoAccessToken({ id: ADMIN_ID, phone: "+15550000001", role: "ADMIN" });
}

/** Issues a worker token and points the sub lookup at that worker, so the request
 *  authenticates and is then refused on role rather than failing as unauthenticated. */
function workerToken(): string {
  getUserByCognitoSub.mockResolvedValue({
    id: WORKER_ID,
    phone_number: "+15550000003",
    email: "worker@example.com",
    full_name: "Field Worker",
    role: "WORKER",
    avatar_url: null,
    is_active: true,
    is_verified: true,
    last_login_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return issueTestCognitoAccessToken({ id: WORKER_ID, phone: "+15550000003", role: "WORKER" });
}

beforeEach(() => {
  getUserByCognitoSub.mockResolvedValue({
    id: ADMIN_ID,
    phone_number: "+15550000001",
    email: "admin@example.com",
    full_name: "Platform Admin",
    role: "ADMIN",
    avatar_url: null,
    is_active: true,
    is_verified: true,
    last_login_at: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  listExhaustedPaymentOperations.mockReset();
  resetPaymentOperationDispatch.mockReset();
  getUserByCognitoSub.mockReset();
  resetTestCognitoVerifier();
});

describe("GET /admin/payments/stuck", () => {
  it("lists operations that exhausted their dispatch attempts", async () => {
    app = await buildTestApp();
    listExhaustedPaymentOperations.mockResolvedValue([stuckPayout()]);

    const response = await app.inject({
      method: "GET",
      url: `${config.API_PREFIX}/admin/payments/stuck`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].operationId).toBe(OPERATION_ID);
    // The reason it stopped retrying has to reach the operator; it is the only
    // signal distinguishing a transient outage from a permanently broken payout.
    expect(body.data.items[0].lastDispatchError).toBe("WORKER_PAYOUT_ACCOUNT_MISSING");
  });

  it("rejects a non-admin caller", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: `${config.API_PREFIX}/admin/payments/stuck`,
      headers: { authorization: `Bearer ${workerToken()}` },
    });

    expect(response.statusCode).toBe(403);
    expect(listExhaustedPaymentOperations).not.toHaveBeenCalled();
  });

  it("rejects an out-of-range limit", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "GET",
      url: `${config.API_PREFIX}/admin/payments/stuck?limit=500`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });

    expect(response.statusCode).toBe(400);
    expect(listExhaustedPaymentOperations).not.toHaveBeenCalled();
  });
});

describe("POST /admin/payments/:operationId/requeue", () => {
  it("requeues an exhausted operation and resets its attempt count", async () => {
    app = await buildTestApp();
    resetPaymentOperationDispatch.mockResolvedValue({
      operationId: OPERATION_ID,
      dispatchAttempts: 0,
      nextDispatchAt: new Date("2026-09-19T00:00:00.000Z").toISOString(),
    });

    const response = await app.inject({
      method: "POST",
      url: `${config.API_PREFIX}/admin/payments/${OPERATION_ID}/requeue`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { reason: "Worker payout account added" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.dispatch_attempts).toBe(0);
    expect(resetPaymentOperationDispatch).toHaveBeenCalledWith({
      actorUserId: ADMIN_ID,
      operationId: OPERATION_ID,
      reason: "Worker payout account added",
    });
  });

  it("rejects a non-admin caller", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: `${config.API_PREFIX}/admin/payments/${OPERATION_ID}/requeue`,
      headers: { authorization: `Bearer ${workerToken()}` },
      payload: { reason: "let me pay myself" },
    });

    expect(response.statusCode).toBe(403);
    expect(resetPaymentOperationDispatch).not.toHaveBeenCalled();
  });

  it("requires a reason, because the requeue is audited", async () => {
    app = await buildTestApp();

    const response = await app.inject({
      method: "POST",
      url: `${config.API_PREFIX}/admin/payments/${OPERATION_ID}/requeue`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { reason: "x" },
    });

    expect(response.statusCode).toBe(400);
    expect(resetPaymentOperationDispatch).not.toHaveBeenCalled();
  });

  it("maps a still-dispatchable operation to 409 rather than 500", async () => {
    // 55000 is what reset_payment_operation_dispatch raises when the operation
    // has not exhausted its attempts, or is no longer CREATED.
    app = await buildTestApp();
    resetPaymentOperationDispatch.mockRejectedValue(pgError("55000"));

    const response = await app.inject({
      method: "POST",
      url: `${config.API_PREFIX}/admin/payments/${OPERATION_ID}/requeue`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { reason: "Premature requeue attempt" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ADMIN_OPERATION_CONFLICT");
  });

  it("maps a missing operation to 404", async () => {
    app = await buildTestApp();
    resetPaymentOperationDispatch.mockRejectedValue(pgError("P0002"));

    const response = await app.inject({
      method: "POST",
      url: `${config.API_PREFIX}/admin/payments/${OPERATION_ID}/requeue`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { reason: "Requeue a vanished operation" },
    });

    expect(response.statusCode).toBe(404);
  });
});
