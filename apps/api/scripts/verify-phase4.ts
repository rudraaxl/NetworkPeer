import pg from "pg";
import { signAccessToken } from "../src/auth.js";
import { closeConnections } from "../src/db.js";
import { buildApp } from "../src/index.js";
import { config } from "../src/config.js";

const client = new pg.Client({ connectionString: config.DATABASE_URL });
const SEED_PHONES = ["+10000000101", "+10000000102", "+10000000103", "+10000000104", "+10000000105"] as const;

type ApiEnvelope = {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
};

function pass(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`  PASS  ${name}`);
}

function assert(condition: unknown, name: string): void {
  if (!condition) {
    throw new Error(`Phase 4 assertion failed: ${name}`);
  }
  pass(name);
}

async function cleanup(): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE phone_number = ANY($1)`,
    [SEED_PHONES],
  );
  const ids = result.rows.map((row) => row.id);
  if (ids.length === 0) return;
  await client.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1::uuid[])`, [ids]);
  await client.query(
    `DELETE FROM jobs WHERE client_id = ANY($1::uuid[]) OR worker_id = ANY($1::uuid[])`,
    [ids],
  );
  await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
}

function parseEnvelope(payload: string): ApiEnvelope {
  return JSON.parse(payload) as ApiEnvelope;
}

async function main(): Promise<void> {
  await client.connect();
  const app = await buildApp();

  try {
    await cleanup();
    await app.ready();

    const created = await client.query<{ id: string; phone_number: string; role: "CLIENT" | "WORKER" }>(
      `
        INSERT INTO users (phone_number, full_name, role, is_verified)
        VALUES
          ($1, 'Phase 4 Client', 'CLIENT', TRUE),
          ($2, 'Verified Worker A', 'WORKER', TRUE),
          ($3, 'Verified Worker B', 'WORKER', TRUE),
          ($4, 'Pending Worker', 'WORKER', TRUE),
          ($5, 'Phase 4 Admin', 'ADMIN', TRUE)
        RETURNING id, phone_number, role
      `,
      [...SEED_PHONES],
    );
    const byPhone = new Map(created.rows.map((row) => [row.phone_number, row]));
    const clientUser = byPhone.get(SEED_PHONES[0]);
    const workerA = byPhone.get(SEED_PHONES[1]);
    const workerB = byPhone.get(SEED_PHONES[2]);
    const pendingWorker = byPhone.get(SEED_PHONES[3]);
    const adminUser = byPhone.get(SEED_PHONES[4]);
    if (!clientUser || !workerA || !workerB || !pendingWorker || !adminUser) {
      throw new Error("Could not create Phase 4 seed users");
    }

    await client.query(
      `
        INSERT INTO worker_profiles (
          user_id, verification_status, is_available, preferred_radius_km,
          current_location, last_location_update
        )
        VALUES
          ($1, 'VERIFIED', TRUE, 20, ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW()),
          ($2, 'VERIFIED', TRUE, 20, ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW()),
          ($3, 'PENDING', FALSE, 20, ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW())
      `,
      [workerA.id, workerB.id, pendingWorker.id],
    );

    const nearJob = await client.query<{ id: string }>(
      `
        INSERT INTO jobs (
          client_id, title, description, category, budget_cents, location, address, metadata,
          public_title, public_description, escrow_status
        )
        VALUES (
          $1, 'Private client title', 'Private instructions: call the client at +15550001111 before arrival.', 'INSPECTION', 12500,
          ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), '350 5th Ave, New York, NY',
          '{"client_email":"must never reach workers before assignment"}'::jsonb,
          'Storefront inspection', 'Inspect exterior signage and capture required measurements.', 'HELD'
        )
        RETURNING id
      `,
      [clientUser.id],
    );
    const farJob = await client.query<{ id: string }>(
      `
        INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
        VALUES (
          $1, 'Far-away job', 'This job is outside the verification search radius.', 'INSPECTION', 9000,
          ST_SetSRID(ST_MakePoint(-74.2857, 40.7484), 4326), 'HELD'
        )
        RETURNING id
      `,
      [clientUser.id],
    );
    const nearJobId = nearJob.rows[0]?.id;
    const farJobId = farJob.rows[0]?.id;
    if (!nearJobId || !farJobId) throw new Error("Could not create Phase 4 jobs");

    await client.query(
      `
        INSERT INTO job_subtasks (job_id, title, sequence_order)
        VALUES ($1, 'Measure sign width', 0), ($1, 'Capture storefront photo', 1)
      `,
      [nearJobId],
    );

    const nearbyIndex = await client.query<{
      indisvalid: boolean;
      indisready: boolean;
      access_method: string;
      expression: string | null;
      predicate: string | null;
    }>(
      `
        SELECT
          i.indisvalid,
          i.indisready,
          am.amname AS access_method,
          pg_get_expr(i.indexprs, i.indrelid) AS expression,
          pg_get_expr(i.indpred, i.indrelid) AS predicate
        FROM pg_index i
        JOIN pg_class index_class ON index_class.oid = i.indexrelid
        JOIN pg_class table_class ON table_class.oid = i.indrelid
        JOIN pg_am am ON am.oid = index_class.relam
        WHERE table_class.relname = 'jobs'
          AND index_class.relname = 'idx_jobs_posted_geography'
      `,
    );
    const nearbyIndexRow = nearbyIndex.rows[0];
    assert(
      nearbyIndexRow?.indisvalid === true &&
        nearbyIndexRow.indisready === true &&
        nearbyIndexRow.access_method === "gist" &&
        nearbyIndexRow.expression?.includes("geography") === true &&
        nearbyIndexRow.predicate?.includes("worker_id IS NULL") === true &&
        nearbyIndexRow.predicate?.includes("status = 'POSTED'") === true,
      "nearby geography GiST index is valid and matches the discovery predicate",
    );

    const clientToken = signAccessToken({
      id: clientUser.id,
      role: "CLIENT",
      phone: clientUser.phone_number,
    });
    const workerAToken = signAccessToken({
      id: workerA.id,
      role: "WORKER",
      phone: workerA.phone_number,
    });
    const workerBToken = signAccessToken({
      id: workerB.id,
      role: "WORKER",
      phone: workerB.phone_number,
    });
    const pendingWorkerToken = signAccessToken({
      id: pendingWorker.id,
      role: "WORKER",
      phone: pendingWorker.phone_number,
    });
    const adminToken = signAccessToken({
      id: adminUser.id,
      role: "ADMIN",
      phone: adminUser.phone_number,
    });
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

    // eslint-disable-next-line no-console
    console.log("\n== Phase 4 API verification ==");

    let response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/jobs/nearby?radius_km=5",
      headers: bearer(workerAToken),
    });
    let body = parseEnvelope(response.body);
    const nearbyData = body.data as { items?: Array<Record<string, unknown>>; has_more?: boolean } | null;
    assert(response.statusCode === 200 && body.success, "verified worker can search nearby POSTED jobs");
    assert(
      nearbyData?.items?.length === 1 && nearbyData.items?.[0]?.["id"] === nearJobId && nearbyData.has_more === false,
      "geography radius excludes far jobs",
    );
    assert(
        !("client_id" in (nearbyData?.items?.[0] ?? {})) &&
        !("address" in (nearbyData?.items?.[0] ?? {})) &&
        !("location" in (nearbyData?.items?.[0] ?? {})) &&
        !("distance_meters" in (nearbyData?.items?.[0] ?? {})) &&
        typeof nearbyData?.items?.[0]?.["distance_band"] === "string" &&
        nearbyData?.items?.[0]?.["title"] === "Storefront inspection" &&
        nearbyData.items?.[0]?.["description"] === "Inspect exterior signage and capture required measurements.",
      "nearby projection withholds client identity, exact location, and exact distance",
    );

    response = await app.inject({
      method: "GET",
      url: `/api/v1/worker/jobs/${nearJobId}`,
      headers: bearer(workerAToken),
    });
    body = parseEnvelope(response.body);
    const publicDetail = body.data as { address?: unknown; location?: unknown; subtasks?: unknown[] } | null;
    assert(response.statusCode === 200 && body.success, "worker can view a public job detail");
    assert(publicDetail?.address === null && publicDetail.location === null, "public job detail hides exact address and point");
    assert(publicDetail?.subtasks?.length === 0, "public job detail withholds private checklist items");

    response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/jobs/nearby?radius_km=5",
      headers: bearer(pendingWorkerToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 403 && body.error?.code === "WORKER_NOT_VERIFIED", "unverified worker is blocked");

    response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/jobs/nearby?radius_km=5",
      headers: bearer(clientToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 403 && body.error?.code === "FORBIDDEN", "CLIENT token cannot access worker routes");

    response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/workers/${pendingWorker.id}/verification`,
      headers: bearer(clientToken),
      payload: { verification_status: "VERIFIED", is_available: true, reason: "Verifier authorization check" },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 403 && body.error?.code === "FORBIDDEN", "CLIENT token cannot verify workers");

    response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/workers/${pendingWorker.id}/verification`,
      headers: bearer(adminToken),
      payload: { verification_status: "VERIFIED", is_available: true, reason: "Verified onboarding review" },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.success, "ADMIN can verify and activate a worker");

    response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/jobs/nearby?radius_km=5",
      headers: bearer(pendingWorkerToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.success, "newly verified worker can access discovery");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/worker/location",
      headers: bearer(workerAToken),
      payload: { longitude: 200, latitude: 40.7484 },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 400 && body.error?.code === "VALIDATION_ERROR", "invalid coordinates are rejected");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/worker/jobs/${nearJobId}/accept`,
      headers: bearer(workerAToken),
    });
    body = parseEnvelope(response.body);
    const acceptedDetail = body.data as {
      is_assigned_to_requester?: boolean;
      address?: unknown;
      location?: unknown;
      description?: unknown;
      subtasks?: unknown[];
    } | null;
    assert(response.statusCode === 200 && body.success, "verified worker atomically accepts a POSTED job");
    assert(
        acceptedDetail?.is_assigned_to_requester === true &&
        acceptedDetail.address === "350 5th Ave, New York, NY" &&
        acceptedDetail.location !== null &&
        acceptedDetail.description === "Private instructions: call the client at +15550001111 before arrival." &&
        acceptedDetail.subtasks?.length === 2,
      "assigned worker receives protected job location details",
    );

    response = await app.inject({
      method: "POST",
      url: `/api/v1/worker/jobs/${nearJobId}/accept`,
      headers: bearer(workerAToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.success, "same-worker acceptance retry is idempotent");

    response = await app.inject({
      method: "PATCH",
      url: `/api/v1/admin/workers/${workerA.id}/verification`,
      headers: bearer(adminToken),
      payload: { verification_status: "VERIFIED", is_available: true, reason: "Attempt busy-worker reactivation" },
    });
    body = parseEnvelope(response.body);
    assert(
      response.statusCode === 409 && body.error?.code === "WORKER_HAS_ACTIVE_JOB",
      "ADMIN cannot reactivate a worker with active work",
    );
    const workerAvailability = await client.query<{ is_available: boolean }>(
      `SELECT is_available FROM worker_profiles WHERE user_id = $1`,
      [workerA.id],
    );
    assert(workerAvailability.rows[0]?.is_available === false, "busy worker remains unavailable after rejected activation");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/worker/jobs/${farJobId}/accept`,
      headers: bearer(workerAToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 409 && body.error?.code === "JOB_NOT_AVAILABLE", "busy worker cannot claim another job");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/worker/jobs/${nearJobId}/accept`,
      headers: bearer(workerBToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 409 && body.error?.code === "JOB_NOT_AVAILABLE", "second worker cannot claim assigned job");

    response = await app.inject({
      method: "GET",
      url: `/api/v1/worker/jobs/${nearJobId}`,
      headers: bearer(workerBToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 404 && body.error?.code === "JOB_NOT_FOUND", "other workers cannot view assigned job details");

    response = await app.inject({
      method: "GET",
      url: "/api/v1/worker/jobs/nearby?radius_km=5",
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 401 && body.error?.code === "TOKEN_MISSING", "worker routes require authentication");

    // eslint-disable-next-line no-console
    console.log("\nPhase 4 verification complete: all checks passed.");
  } finally {
    await app.close();
    await cleanup();
    await client.end();
    await closeConnections();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nPhase 4 verification FAILED:", err);
  process.exit(1);
});
