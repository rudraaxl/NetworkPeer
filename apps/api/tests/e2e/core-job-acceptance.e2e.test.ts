import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import supertest from "supertest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/index.js";
import { closeConnections, pool } from "../../src/db.js";
import { signAccessToken } from "../../src/auth.js";
import { config } from "../../src/config.js";
import { signPaymentWebhook } from "../../src/services/payment-gateway-service.js";
import type { BackgroundRuntime } from "../../src/services/background-queue-service.js";

type SeedUser = { id: string; phone: string; role: "CLIENT" | "WORKER" };
type Envelope<T> = { success: boolean; data: T | null; error: { code: string; message: string } | null };

const runE2e = process.env["RUN_E2E"] === "true";
const noOpBackgroundRuntime: BackgroundRuntime = {
  start: async () => undefined,
  kick: async () => undefined,
  close: async () => undefined,
};

function bearer(user: SeedUser): string {
  return `Bearer ${signAccessToken({ id: user.id, role: user.role, phone: user.phone })}`;
}

function assertSafeE2eDatabase(): void {
  const databaseName = decodeURIComponent(new URL(config.DATABASE_URL).pathname).replace(/^\//, "");
  if (!/(^|[_-])(test|e2e)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      `Refusing to run E2E cleanup against ${databaseName}. Use a database name containing test or e2e.`,
    );
  }
}

async function deleteSeedData(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL networkpeer.maintenance_mode = 'on'");
    await client.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM payment_webhook_events WHERE payment_operation_id IN (SELECT id FROM payment_operations WHERE client_user_id = ANY($1::uuid[]) OR worker_user_id = ANY($1::uuid[]))`, [userIds]);
    await client.query(`DELETE FROM payment_operations WHERE client_user_id = ANY($1::uuid[]) OR worker_user_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`UPDATE jobs SET escrow_ledger_transaction_id = NULL, settlement_ledger_transaction_id = NULL WHERE client_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`UPDATE ledger_transactions SET job_id = NULL WHERE job_id IN (SELECT id FROM jobs WHERE client_id = ANY($1::uuid[]))`, [userIds]);
    await client.query(`DELETE FROM wallet_ledger WHERE user_id = ANY($1::uuid[]) OR job_id IN (SELECT id FROM jobs WHERE client_id = ANY($1::uuid[]))`, [userIds]);
    await client.query(`DELETE FROM ledger_accounts WHERE owner_user_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM jobs WHERE client_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM ledger_transactions WHERE job_id IS NULL AND idempotency_key LIKE 'e2e-%'`);
    await client.query(`DELETE FROM worker_profiles WHERE user_id = ANY($1::uuid[])`, [userIds]);
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe.runIf(runE2e)("E2E: funded client job acceptance", () => {
  let app: FastifyInstance | undefined;
  let users: SeedUser[] = [];

  beforeAll(async () => {
    assertSafeE2eDatabase();
    const seed = `${Date.now()}${randomInt(1_000_000, 10_000_000)}`.slice(-9);
    const { rows } = await pool.query<SeedUser>(
      `
        INSERT INTO users (phone_number, full_name, role, is_active, is_verified)
        VALUES ($1, 'E2E Client', 'CLIENT', TRUE, TRUE),
               ($2, 'E2E Worker One', 'WORKER', TRUE, TRUE),
               ($3, 'E2E Worker Two', 'WORKER', TRUE, TRUE)
        RETURNING id, phone_number AS phone, role
      `,
      [`+1555${seed}1`, `+1666${seed}2`, `+1777${seed}3`],
    );
    users = rows;
    const workers = users.filter((user) => user.role === "WORKER");
    await pool.query(
      `
        INSERT INTO worker_profiles (
          user_id, verification_status, is_available, current_location, last_location_update
        )
        SELECT id, 'VERIFIED', TRUE, ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326), NOW()
        FROM users
        WHERE id = ANY($1::uuid[])
      `,
      [workers.map((worker) => worker.id)],
    );
    app = await buildApp({ realtimeEnabled: false, backgroundRuntime: noOpBackgroundRuntime });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await deleteSeedData(users.map((user) => user.id));
    await closeConnections();
  });

  it("creates, funds, publishes, and atomically assigns a job to exactly one worker", async () => {
    const client = users.find((user) => user.role === "CLIENT");
    const workers = users.filter((user) => user.role === "WORKER");
    if (!client || workers.length !== 2 || !app) throw new Error("E2E users or app were not initialized");
    const api = supertest(app.server);

    const createResponse = await api
      .post("/api/v1/client/jobs")
      .set("authorization", bearer(client))
      .send({
        title: "E2E atomic acceptance inspection",
        description: "Verify a funded field-inspection job is assigned atomically to one worker.",
        category: "INSPECTION",
        budget_cents: 12_500,
        currency: "USD",
        location: { type: "Point", coordinates: [77.5946, 12.9716] },
        idempotency_key: "e2e-create-job-key",
      })
      .expect(201);
    const created = createResponse.body as Envelope<{ id: string; status: string }>;
    expect(created.success).toBe(true);
    expect(created.data?.status).toBe("FUNDING");
    const jobId = created.data?.id;
    if (!jobId) throw new Error("Job creation did not return an id");

    const fundingResponse = await api
      .post(`/api/v1/client/jobs/${jobId}/fund`)
      .set("authorization", bearer(client))
      .send({ idempotency_key: "e2e-funding-job-key" })
      .expect(202);
    const funding = fundingResponse.body as Envelope<{ operationId: string; providerReference: string; status: string }>;
    expect(funding.data?.status).toBe("PENDING");
    if (!funding.data?.operationId || !funding.data.providerReference) {
      throw new Error("Funding did not return dispatch metadata");
    }

    const webhookPayload = JSON.stringify({
      id: `evt_e2e_funding_${randomUUID()}`,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: funding.data.providerReference,
          metadata: { networkpeer_operation_id: funding.data.operationId },
        },
      },
    });
    await api
      .post("/api/v1/webhooks/payments")
      .set("content-type", "application/json")
      .set("stripe-signature", signPaymentWebhook(Buffer.from(webhookPayload)))
      .send(webhookPayload)
      .expect(200);

    const acceptance = await Promise.all(
      workers.map((worker) => api
        .post(`/api/v1/worker/jobs/${jobId}/accept`)
        .set("authorization", bearer(worker))
        .send({})),
    );
    const successfulAcceptances = acceptance.filter((response) => response.status === 200);
    const rejectedAcceptances = acceptance.filter((response) => response.status === 409);
    expect(successfulAcceptances).toHaveLength(1);
    expect(rejectedAcceptances).toHaveLength(1);

    const assigned = await pool.query<{ status: string; worker_id: string | null }>(
      `SELECT status, worker_id::text FROM jobs WHERE id = $1`,
      [jobId],
    );
    expect(assigned.rows[0]).toEqual({
      status: "ASSIGNED",
      worker_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(workers.some((worker) => worker.id === assigned.rows[0]?.worker_id)).toBe(true);
  });
});
