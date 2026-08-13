import pg from "pg";
import { io, type Socket } from "socket.io-client";
import {
  AuthError,
  issueTokenPair,
  rotateRefreshToken,
  signAccessToken,
} from "../src/auth.js";
import { config } from "../src/config.js";
import { closeConnections, redis } from "../src/db.js";
import { buildApp } from "../src/index.js";

const client = new pg.Client({ connectionString: config.DATABASE_URL });
const SEED_PHONES = [
  "+10000000701",
  "+10000000702",
  "+10000000703",
  "+10000000704",
  "+10000000705",
] as const;

type ApiEnvelope = {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
};

function assert(condition: unknown, name: string): void {
  if (!condition) throw new Error(`Phase 7 assertion failed: ${name}`);
  // eslint-disable-next-line no-console
  console.log(`  PASS  ${name}`);
}

function parseEnvelope(payload: string): ApiEnvelope {
  return JSON.parse(payload) as ApiEnvelope;
}

function connectSocket(baseUrl: string, token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      path: `${config.API_PREFIX}/realtime`,
      auth: { token },
      transports: ["websocket"],
      forceNew: true,
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error("Timed out connecting Phase 7 socket"));
    }, 5_000);
    socket.once("sync:ready", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("connect_error", (err) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(err);
    });
  });
}

function waitForDisconnect(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for auth-revoked disconnect")), 5_000);
    socket.once("disconnect", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function cleanup(): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE phone_number = ANY($1)`,
    [SEED_PHONES],
  );
  const ids = result.rows.map((row) => row.id);
  if (ids.length === 0) return;
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL networkpeer.maintenance_mode = 'on'");
    await client.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM wallet_ledger WHERE user_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM jobs WHERE client_id = ANY($1::uuid[]) OR worker_id = ANY($1::uuid[])`, [ids]);
    await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function main(): Promise<void> {
  await client.connect();
  const app = await buildApp({ realtimeEnabled: true });
  let suspendedSocket: Socket | null = null;

  try {
    await cleanup();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const users = await client.query<{
      id: string;
      phone_number: string;
      role: "CLIENT" | "WORKER" | "ADMIN";
    }>(
      `
        INSERT INTO users (phone_number, full_name, role, is_verified)
        VALUES
          ($1, 'Phase 7 Client', 'CLIENT', TRUE),
          ($2, 'Phase 7 Worker A', 'WORKER', TRUE),
          ($3, 'Phase 7 Worker B', 'WORKER', TRUE),
          ($4, 'Phase 7 Suspended Client', 'CLIENT', TRUE),
          ($5, 'Phase 7 Admin', 'ADMIN', TRUE)
        RETURNING id, phone_number, role
      `,
      [...SEED_PHONES],
    );
    const byPhone = new Map(users.rows.map((row) => [row.phone_number, row]));
    const owner = byPhone.get(SEED_PHONES[0]);
    const workerA = byPhone.get(SEED_PHONES[1]);
    const workerB = byPhone.get(SEED_PHONES[2]);
    const suspendedClient = byPhone.get(SEED_PHONES[3]);
    const admin = byPhone.get(SEED_PHONES[4]);
    if (!owner || !workerA || !workerB || !suspendedClient || !admin) {
      throw new Error("Could not create Phase 7 seed users");
    }

    await client.query(
      `
        INSERT INTO worker_profiles (
          user_id, verification_status, is_available, preferred_radius_km,
          current_location, last_location_update
        ) VALUES
          ($1, 'VERIFIED', TRUE, 20, ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW()),
          ($2, 'VERIFIED', TRUE, 20, ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW())
      `,
      [workerA.id, workerB.id],
    );
    const jobs = await client.query<{ id: string }>(
      `
        INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
        VALUES
          ($1, 'Phase 7 reassignment', 'A job used to verify audited administrative reassignment.', 'INSPECTION', 10000,
           ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), 'HELD'),
          ($1, 'Phase 7 cancellation', 'A posted job used to verify administrative cancellation.', 'INSPECTION', 5000,
           ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), 'HELD'),
          ($2, 'Suspended client job', 'This job must disappear from worker discovery after suspension.', 'INSPECTION', 7500,
           ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), 'HELD')
        RETURNING id
      `,
      [owner.id, suspendedClient.id],
    );
    const [reassignJob, cancelJob, suspendedClientJob] = jobs.rows.map((row) => row.id);
    if (!reassignJob || !cancelJob || !suspendedClientJob) throw new Error("Could not create Phase 7 jobs");

    const ownerToken = signAccessToken({ id: owner.id, role: "CLIENT", phone: owner.phone_number });
    const workerAToken = signAccessToken({ id: workerA.id, role: "WORKER", phone: workerA.phone_number });
    const workerBToken = signAccessToken({ id: workerB.id, role: "WORKER", phone: workerB.phone_number });
    const suspendedClientToken = signAccessToken({
      id: suspendedClient.id,
      role: "CLIENT",
      phone: suspendedClient.phone_number,
    });
    const adminToken = signAccessToken({ id: admin.id, role: "ADMIN", phone: admin.phone_number });
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

    // eslint-disable-next-line no-console
    console.log("\n== Phase 7 admin and control verification ==");

    let response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users",
      headers: bearer(ownerToken),
    });
    let body = parseEnvelope(response.body);
    assert(response.statusCode === 403 && body.error?.code === "FORBIDDEN", "non-admin users cannot access admin controls");

    let invalidAuditRejected = false;
    try {
      await client.query(
        `
          INSERT INTO admin_audit_log (
            actor_user_id, action, entity_type, entity_id, reason, before_state, after_state
          ) VALUES (
            $1, 'JOB_STATUS_OVERRIDE', 'JOB', $2, 'Attempted lifecycle bypass',
            '{"status":"POSTED","worker_id":null}'::jsonb,
            '{"status":"COMPLETED","worker_id":null}'::jsonb
          )
        `,
        [admin.id, reassignJob],
      );
    } catch (err) {
      invalidAuditRejected = (err as pg.DatabaseError).code === "23514";
    }
    assert(invalidAuditRejected, "database rejects audit rows that would authorize a lifecycle bypass");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/worker/jobs/${reassignJob}/accept`,
      headers: bearer(workerAToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.success, "worker acceptance prepares an active admin override case");

    try {
      await client.query(`UPDATE jobs SET status = 'COMPLETED' WHERE id = $1`, [reassignJob]);
      throw new Error("Expected unaudited noncanonical job update to fail");
    } catch (err) {
      assert((err as pg.DatabaseError).code === "23514", "unaudited noncanonical job updates remain blocked");
    }

    response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/jobs/${reassignJob}/override`,
      headers: bearer(adminToken),
      payload: {
        action: "REASSIGN",
        worker_id: workerB.id,
        reason: "Original worker is unavailable for the scheduled visit",
      },
    });
    body = parseEnvelope(response.body);
    const reassigned = body.data?.["job"] as Record<string, unknown> | undefined;
    assert(
      response.statusCode === 200 && reassigned?.["worker_id"] === workerB.id && reassigned["status"] === "ASSIGNED",
      "audited admin reassignment updates the assignment atomically",
    );

    const availability = await client.query<{ user_id: string; is_available: boolean }>(
      `SELECT user_id, is_available FROM worker_profiles WHERE user_id = ANY($1::uuid[])`,
      [[workerA.id, workerB.id]],
    );
    const availabilityByUser = new Map(availability.rows.map((row) => [row.user_id, row.is_available]));
    assert(
      availabilityByUser.get(workerA.id) === true && availabilityByUser.get(workerB.id) === false,
      "reassignment releases the old worker and reserves the new worker",
    );

    response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/sync?cursor=0&limit=50",
      headers: bearer(workerBToken),
    });
    body = parseEnvelope(response.body);
    const workerSyncJobs = body.data?.["jobs"] as Array<Record<string, unknown>> | undefined;
    assert(
      response.statusCode === 200 && workerSyncJobs?.some((job) => job["id"] === reassignJob),
      "worker SQLite sync returns assigned job deltas alongside cursor events",
    );

    response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/jobs/${reassignJob}/override`,
      headers: bearer(adminToken),
      payload: {
        action: "STATUS",
        status: "COMPLETED",
        reason: "Manual completion after operational review",
      },
    });
    body = parseEnvelope(response.body);
    assert(
      response.statusCode === 409 && body.error?.code === "ADMIN_OPERATION_CONFLICT",
      "admin cannot force-complete work without the required escrow settlement",
    );

    response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/jobs/${cancelJob}/override`,
      headers: bearer(adminToken),
      payload: {
        action: "CANCEL",
        reason: "Duplicate support request",
        cancellation_reason: "Cancelled by NetworkPeer support.",
      },
    });
    body = parseEnvelope(response.body);
    assert(
      response.statusCode === 409 && body.error?.code === "ADMIN_OPERATION_CONFLICT",
      "admin cannot cancel funded work without an explicit refund",
    );

    response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/jobs/${reassignJob}/override`,
      headers: bearer(adminToken),
      payload: {
        action: "STATUS",
        status: "DISPUTED",
        reason: "Escalated for audited operational review",
      },
    });
    body = parseEnvelope(response.body);
    const disputedJob = body.data?.["job"] as Record<string, unknown> | undefined;
    assert(
      response.statusCode === 200 && disputedJob?.["status"] === "DISPUTED",
      "admin can open an audited dispute without bypassing settlement",
    );

    await client.query(
      `
        INSERT INTO wallet_ledger (
          user_id, job_id, transaction_type, transaction_status, amount_cents,
          balance_after_cents, currency, description
        ) VALUES
          ($1, $2, 'ESCROW_HOLD', 'COMPLETED', -10000, -10000, 'USD', 'Verifier escrow hold'),
          ($1, $2, 'PLATFORM_FEE', 'COMPLETED', 750, -9250, 'USD', 'Verifier platform fee'),
          ($1, $2, 'ESCROW_HOLD', 'PENDING', -999, -10249, 'INR', 'Pending entry excluded from analytics')
      `,
      [owner.id, reassignJob],
    );
    response = await app.inject({ method: "GET", url: "/api/v1/admin/analytics", headers: bearer(adminToken) });
    body = parseEnvelope(response.body);
    const analytics = body.data;
    const escrow = analytics?.["escrow_hold_volume"] as Array<Record<string, unknown>> | undefined;
    const fees = analytics?.["platform_fee_revenue"] as Array<Record<string, unknown>> | undefined;
    assert(
      response.statusCode === 200
      && escrow?.some((entry) => entry["currency"] === "USD" && entry["cents"] === "10000")
      && !escrow?.some((entry) => entry["currency"] === "INR")
      && fees?.some((entry) => entry["currency"] === "USD" && entry["cents"] === "750"),
      "analytics separates currencies and ignores incomplete financial postings",
    );

    response = await app.inject({ method: "GET", url: "/api/v1/admin/users?role=WORKER&per_page=100", headers: bearer(adminToken) });
    body = parseEnvelope(response.body);
    const usersData = body.data as { items?: Array<Record<string, unknown>>; total?: number } | null;
    assert(
      response.statusCode === 200 && usersData?.items?.some((user) => user["id"] === workerB.id),
      "admin users endpoint returns paginated worker management data",
    );

    response = await app.inject({ method: "GET", url: "/api/v1/admin/audit-log?entity_type=JOB&limit=1", headers: bearer(adminToken) });
    body = parseEnvelope(response.body);
    const auditData = body.data as { items?: Array<Record<string, unknown>>; has_more?: boolean; next_before_id?: string | null } | null;
    assert(
      response.statusCode === 200 && auditData?.items?.[0]?.["entityType"] === "JOB" && auditData.has_more === true,
      "global audit log supports keyset pagination and entity filtering",
    );
    if (!auditData?.next_before_id) throw new Error("Expected paged audit cursor");
    response = await app.inject({
      method: "GET",
      url: `/api/v1/admin/audit-log?before_id=${auditData.next_before_id}&limit=100`,
      headers: bearer(adminToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.success, "audit log accepts a bounded pagination cursor");

    const suspendedPair = await issueTokenPair(
      { id: suspendedClient.id, role: "CLIENT", phone: suspendedClient.phone_number },
      signAccessToken,
    );
    suspendedSocket = await connectSocket(address, suspendedClientToken);
    const disconnected = waitForDisconnect(suspendedSocket);
    response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${suspendedClient.id}/suspend`,
      headers: bearer(adminToken),
      payload: { reason: "Confirmed account compromise during verifier run" },
    });
    body = parseEnvelope(response.body);
    assert(
      response.statusCode === 200 && body.data?.["is_active"] === false && body.data?.["refresh_sessions_revoked"] === true,
      "admin suspension atomically deactivates the user and revokes refresh sessions",
    );
    const frozenSuspendedJob = await client.query<{ status: string; escrow_status: string }>(
      `SELECT status, escrow_status FROM jobs WHERE id = $1`,
      [suspendedClientJob],
    );
    assert(
      frozenSuspendedJob.rows[0]?.status === "DISPUTED" && frozenSuspendedJob.rows[0]?.escrow_status === "FROZEN",
      "suspension freezes funded client work for dispute or refund handling",
    );
    await disconnected;
    assert(
      await redis.get(`refresh:user:${suspendedClient.id}:revoked`) === "1",
      "suspension creates a refresh-token revocation marker",
    );
    response = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(suspendedClientToken) });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 401 && body.error?.code === "TOKEN_INVALID", "suspension blocks existing access tokens");
    try {
      await rotateRefreshToken(suspendedPair.refresh_token, signAccessToken);
      throw new Error("Expected suspended refresh token to fail");
    } catch (err) {
      assert(err instanceof AuthError, "suspension blocks refresh-token minting");
    }

    response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/jobs/nearby?radius_km=5",
      headers: bearer(workerBToken),
    });
    body = parseEnvelope(response.body);
    const nearbyItems = (body.data?.["items"] as Array<Record<string, unknown>> | undefined) ?? [];
    assert(
      response.statusCode === 200 && !nearbyItems.some((job) => job["id"] === suspendedClientJob),
      "suspended clients' posted jobs are not discoverable or claimable",
    );

    response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/workers/${workerA.id}/verification`,
      headers: bearer(adminToken),
      payload: { verification_status: "VERIFIED", is_available: true, reason: "Post-reassignment availability review" },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.success, "worker verification updates are now audited admin actions");

    // eslint-disable-next-line no-console
    console.log("\nPhase 7 verification complete: all checks passed.");
  } finally {
    suspendedSocket?.disconnect();
    await app.close();
    await cleanup();
    await client.end();
    await closeConnections();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nPhase 7 verification FAILED:", err);
  process.exit(1);
});
