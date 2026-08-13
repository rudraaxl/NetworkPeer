import pg from "pg";
import { io, type Socket } from "socket.io-client";
import { signAccessToken } from "../src/auth.js";
import { config } from "../src/config.js";
import { closeConnections } from "../src/db.js";
import { buildApp } from "../src/index.js";

const client = new pg.Client({ connectionString: config.DATABASE_URL });
const SEED_PHONES = ["+10000000301", "+10000000302"] as const;

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
  if (!condition) throw new Error(`Phase 6 assertion failed: ${name}`);
  pass(name);
}

function parseEnvelope(payload: string): ApiEnvelope {
  return JSON.parse(payload) as ApiEnvelope;
}

function waitForSocket<T>(socket: Socket, eventName: string, predicate: (value: T) => boolean): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for Socket.IO event ${eventName}`));
    }, 5000);
    const onEvent = (value: T) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off(eventName, onEvent);
      resolve(value);
    };
    socket.on(eventName, onEvent);
  });
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
      reject(new Error("Timed out connecting Socket.IO client"));
    }, 5000);
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

async function cleanup(): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE phone_number = ANY($1)`,
    [SEED_PHONES],
  );
  const ids = result.rows.map((row) => row.id);
  if (ids.length === 0) return;
  await client.query(
    `DELETE FROM jobs WHERE client_id = ANY($1::uuid[]) OR worker_id = ANY($1::uuid[])`,
    [ids],
  );
  await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
}

async function main(): Promise<void> {
  await client.connect();
  const app = await buildApp({ realtimeEnabled: true });
  let clientSocket: Socket | null = null;

  try {
    await cleanup();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const created = await client.query<{ id: string; phone_number: string; role: "CLIENT" | "WORKER" }>(
      `
        INSERT INTO users (phone_number, full_name, role, is_verified)
        VALUES
          ($1, 'Phase 6 Client', 'CLIENT', TRUE),
          ($2, 'Phase 6 Worker', 'WORKER', TRUE)
        RETURNING id, phone_number, role
      `,
      [...SEED_PHONES],
    );
    const byPhone = new Map(created.rows.map((row) => [row.phone_number, row]));
    const clientUser = byPhone.get(SEED_PHONES[0]);
    const workerUser = byPhone.get(SEED_PHONES[1]);
    if (!clientUser || !workerUser) throw new Error("Could not create Phase 6 seed users");
    await client.query(
       `INSERT INTO worker_profiles (
          user_id, verification_status, is_available, preferred_radius_km,
          current_location, last_location_update
        )
        VALUES (
          $1, 'VERIFIED', TRUE, 20,
          ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), NOW()
        )`,
      [workerUser.id],
    );
    const jobResult = await client.query<{ id: string }>(
      `
        INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
        VALUES (
          $1, 'Phase 6 realtime job', 'Verify durable sync and realtime delivery.', 'INSPECTION', 8000,
          ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), 'HELD'
        )
        RETURNING id
      `,
      [clientUser.id],
    );
    const jobId = jobResult.rows[0]?.id;
    if (!jobId) throw new Error("Could not create Phase 6 job");

    const clientToken = signAccessToken({ id: clientUser.id, role: "CLIENT", phone: clientUser.phone_number });
    const workerToken = signAccessToken({ id: workerUser.id, role: "WORKER", phone: workerUser.phone_number });
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    clientSocket = await connectSocket(address, clientToken);

    // eslint-disable-next-line no-console
    console.log("\n== Phase 6 API and realtime verification ==");

    const clientEvent = waitForSocket<Record<string, unknown>>(
      clientSocket,
      "sync:event",
      (event) => event["topic"] === "JOB_ASSIGNED" && (event["payload"] as Record<string, unknown> | undefined)?.["job_id"] === jobId,
    );
    let response = await app.inject({
      method: "POST",
      url: `/api/v1/worker/jobs/${jobId}/accept`,
      headers: bearer(workerToken),
    });
    let body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.success, "worker acceptance creates durable job events");
    const received = await clientEvent;
    assert(received["topic"] === "JOB_ASSIGNED", "assigned client receives authenticated Socket.IO sync event");

    response = await app.inject({
      method: "GET",
      url: "/api/v1/sync?cursor=0&limit=50",
      headers: bearer(clientToken),
    });
    body = parseEnvelope(response.body);
    const syncData = body.data as { events?: Array<Record<string, unknown>>; next_cursor?: string } | null;
    const assignedEvent = syncData?.events?.find((event) => event["topic"] === "JOB_ASSIGNED");
    assert(
      response.statusCode === 200 && body.success && typeof assignedEvent?.["cursor"] === "string" && typeof syncData?.next_cursor === "string",
      "cursor sync recovers committed events after realtime delivery",
    );

    response = await app.inject({
      method: "GET",
      url: "/api/v1/sync?cursor=0&limit=50",
      headers: bearer(workerToken),
    });
    body = parseEnvelope(response.body);
    const workerEvents = (body.data as { events?: Array<Record<string, unknown>> } | null)?.events ?? [];
    assert(
      response.statusCode === 200 && workerEvents.every((event) => event["topic"] !== "JOB_CREATED"),
      "sync scopes events to the authenticated recipient",
    );

    const beforeCursorResult = await client.query<{ cursor: string }>(
      `SELECT COALESCE(MAX(id), 0)::text AS cursor FROM sync_events WHERE recipient_user_id = $1`,
      [clientUser.id],
    );
    const beforeCursor = beforeCursorResult.rows[0]?.cursor ?? "0";
    const firstTransaction = new pg.Client({ connectionString: config.DATABASE_URL });
    const secondTransaction = new pg.Client({ connectionString: config.DATABASE_URL });
    await Promise.all([firstTransaction.connect(), secondTransaction.connect()]);
    try {
      await firstTransaction.query("BEGIN");
      const firstEvent = await firstTransaction.query<{ cursor: string }>(
        `SELECT emit_user_sync_event($1, 'SYSTEM', 'TEST', NULL, '{}'::jsonb, 'Ordering test', 'First transaction', FALSE)::text AS cursor`,
        [clientUser.id],
      );
      await secondTransaction.query("BEGIN");
      let secondResolved = false;
      const secondEvent = secondTransaction.query<{ cursor: string }>(
        `SELECT emit_user_sync_event($1, 'SYSTEM', 'TEST', NULL, '{}'::jsonb, 'Ordering test', 'Second transaction', FALSE)::text AS cursor`,
        [clientUser.id],
      ).then((result) => {
        secondResolved = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert(!secondResolved, "same-recipient event allocation waits for the first transaction to commit");
      await firstTransaction.query("COMMIT");
      const secondEventResult = await secondEvent;
      await secondTransaction.query("COMMIT");
      const firstCursor = Number(firstEvent.rows[0]?.cursor ?? 0);
      const secondCursor = Number(secondEventResult.rows[0]?.cursor ?? 0);
      assert(firstCursor < secondCursor, "same-recipient durable cursors are allocated in commit order");
      response = await app.inject({
        method: "GET",
        url: `/api/v1/sync?cursor=${beforeCursor}&limit=50`,
        headers: bearer(clientToken),
      });
      body = parseEnvelope(response.body);
      const orderedEvents = (body.data as { events?: Array<Record<string, unknown>> } | null)?.events ?? [];
      const orderingCursors = orderedEvents
        .filter((event) => event["topic"] === "SYSTEM")
        .map((event) => Number(event["cursor"]));
      assert(
        orderingCursors.includes(firstCursor) && orderingCursors.includes(secondCursor),
        "cursor sync returns both committed ordering-test events without a gap",
      );
    } finally {
      await firstTransaction.query("ROLLBACK").catch(() => undefined);
      await secondTransaction.query("ROLLBACK").catch(() => undefined);
      await Promise.all([firstTransaction.end(), secondTransaction.end()]);
    }

    response = await app.inject({
      method: "GET",
      url: "/api/v1/notifications?limit=50",
      headers: bearer(clientToken),
    });
    body = parseEnvelope(response.body);
    const notificationData = body.data as { items?: Array<Record<string, unknown>> } | null;
    const notification = notificationData?.items?.find((item) => item["topic"] === "JOB_ASSIGNED");
    const notificationId = notification?.["id"];
    assert(response.statusCode === 200 && typeof notificationId === "string", "sync events create persisted in-app notifications");

    response = await app.inject({
      method: "POST",
      url: `/api/v1/notifications/${notificationId}/read`,
      headers: bearer(clientToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.data?.["read_at"] !== null, "owner can mark a notification read");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/devices",
      headers: bearer(clientToken),
      payload: { token: "phase6-test-device-token-abcdefghijklmnopqrstuvwxyz", platform: "WEB" },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 201 && body.data?.["platform"] === "WEB", "authenticated device token registration upserts safely");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/notifications/read-all",
      headers: bearer(clientToken),
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && typeof body.data?.["marked_count"] === "number", "owner can mark all notifications read");

    // eslint-disable-next-line no-console
    console.log("\nPhase 6 verification complete: all checks passed.");
  } finally {
    clientSocket?.disconnect();
    await app.close();
    await cleanup();
    await client.end();
    await closeConnections();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nPhase 6 verification FAILED:", err);
  process.exit(1);
});
