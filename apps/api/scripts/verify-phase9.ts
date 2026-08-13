import pg from "pg";
import { buildApp } from "../src/index.js";
import { closeConnections, pool } from "../src/db.js";
import { signAccessToken } from "../src/auth.js";
import { config } from "../src/config.js";
import type { MediaStorage, MediaUploadTarget, StoredMediaObject } from "../src/services/media-storage-service.js";
import type { PushGateway, PushGatewayResult } from "../src/services/push-notification-service.js";

const SEED_PHONES = ["+15550000901", "+15550000902"] as const;

function assert(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(`Phase 9 assertion failed: ${name}`);
  // eslint-disable-next-line no-console
  console.log(`  PASS  ${name}`);
}

function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

function checksumBase64(checksum: string): string {
  return Buffer.from(checksum, "hex").toString("base64");
}

function getStringField(fields: Record<string, unknown>, name: string): string {
  const value = fields[name];
  if (typeof value !== "string") throw new Error(`Missing ${name} upload field`);
  return value;
}

async function waitFor(name: string, predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${name}`);
}

class FakeMediaStorage implements MediaStorage {
  private readonly objects = new Map<string, StoredMediaObject>();
  readonly headVersionIds: Array<string | null> = [];

  async createUploadTarget(input: {
    bucket: string;
    key: string;
    mimeType: string;
    checksumSha256Base64: string;
    maxUploadBytes: number;
  }): Promise<MediaUploadTarget> {
    return {
      url: "https://uploads.example.test/networkpeer",
      fields: {
        key: input.key,
        "Content-Type": input.mimeType,
        "x-amz-checksum-sha256": input.checksumSha256Base64,
        "x-amz-tagging": "networkpeer-evidence-state=pending",
      },
    };
  }

  putObject(key: string, object: StoredMediaObject): void {
    this.objects.set(key, object);
  }

  async headObject(input: { bucket: string; key: string; versionId?: string }): Promise<StoredMediaObject> {
    this.headVersionIds.push(input.versionId ?? null);
    const object = this.objects.get(input.key);
    if (!object) {
      throw Object.assign(new Error(`Object ${input.bucket}/${input.key} not found`), {
        $metadata: { httpStatusCode: 404 },
      });
    }
    return object;
  }

  async setObjectState(): Promise<void> {
    // The outbox test only needs the immutable object metadata after confirmation.
  }

  async createDownloadUrl(input: {
    bucket: string;
    key: string;
    versionId?: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    return `https://downloads.example.test/${input.bucket}/${input.key}?versionId=${input.versionId ?? ""}`;
  }
}

class RetryPushGateway implements PushGateway {
  readonly enabled = true;
  readonly sent: Array<{ title: string; data: Record<string, string> }> = [];
  private failuresRemaining = 1;

  async send(input: {
    tokens: readonly string[];
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<PushGatewayResult> {
    this.sent.push({ title: input.title, data: input.data });
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw new Error("Transient push gateway failure");
    }
    return { invalidTokens: [] };
  }
}

async function cleanup(): Promise<void> {
  const users = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE phone_number = ANY($1)`,
    [SEED_PHONES],
  );
  const ids = users.rows.map((row) => row.id);
  if (ids.length === 0) return;
  await pool.query(`DELETE FROM jobs WHERE client_id = ANY($1::uuid[]) OR worker_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
}

async function main(): Promise<void> {
  const originalPollInterval = config.BACKGROUND_QUEUE_POLL_INTERVAL_MS;
  config.BACKGROUND_QUEUE_POLL_INTERVAL_MS = 1_000;
  const storage = new FakeMediaStorage();
  const pushGateway = new RetryPushGateway();
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  const app = await buildApp({ mediaStorage: storage, pushGateway, realtimeEnabled: false });

  try {
    await cleanup();
    await app.ready();
    // eslint-disable-next-line no-console
    console.log("\n== Phase 9 background queue verification ==");

    const users = await client.query<{ id: string; phone_number: string; role: "CLIENT" | "WORKER" }>(
      `
        INSERT INTO users (phone_number, full_name, role, is_active, is_verified)
        VALUES ($1, 'Phase 9 Client', 'CLIENT', TRUE, TRUE),
               ($2, 'Phase 9 Worker', 'WORKER', TRUE, TRUE)
        RETURNING id, phone_number, role
      `,
      [...SEED_PHONES],
    );
    const clientUser = users.rows.find((row) => row.role === "CLIENT");
    const workerUser = users.rows.find((row) => row.role === "WORKER");
    if (!clientUser || !workerUser) throw new Error("Could not seed Phase 9 users");
    await client.query(
      `
        INSERT INTO worker_profiles (
          user_id, verification_status, is_available, current_location, last_location_update
        ) VALUES (
          $1, 'VERIFIED', FALSE, ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326), NOW()
        )
      `,
      [workerUser.id],
    );
    const job = await client.query<{ id: string }>(
      `
        INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
        VALUES ($1, 'Phase 9 evidence job', 'Confirm a pinned object before background processing.', 'INSPECTION', 5000,
                ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326), 'HELD')
        RETURNING id
      `,
      [clientUser.id],
    );
    const jobId = job.rows[0]?.id;
    if (!jobId) throw new Error("Could not seed Phase 9 job");
    const subtask = await client.query<{ id: string }>(
      `INSERT INTO job_subtasks (job_id, title, sequence_order) VALUES ($1, 'Pinned evidence', 0) RETURNING id`,
      [jobId],
    );
    const subtaskId = subtask.rows[0]?.id;
    if (!subtaskId) throw new Error("Could not seed Phase 9 subtask");
    await client.query(`UPDATE jobs SET status = 'ASSIGNED', worker_id = $2 WHERE id = $1`, [jobId, workerUser.id]);

    const workerToken = signAccessToken({ id: workerUser.id, role: "WORKER", phone: workerUser.phone_number });
    for (const status of ["EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/work/status",
        headers: bearer(workerToken),
        payload: { job_id: jobId, status },
      });
      assert(response.statusCode === 200, `worker advances evidence job to ${status}`);
    }

    const checksum = "c".repeat(64);
    let response = await app.inject({
      method: "POST",
      url: "/api/v1/work/upload-url",
      headers: bearer(workerToken),
      payload: {
        job_id: jobId,
        subtask_id: subtaskId,
        media_type: "IMAGE",
        mime_type: "image/jpeg",
        file_size_bytes: 1024,
        captured_at: new Date().toISOString(),
        checksum_sha256: checksum,
        idempotency_key: "phase9-media-upload-key",
      },
    });
    const reservation = response.json<{ data: { evidence: { id: string }; upload: { fields: Record<string, unknown> } } }>().data;
    assert(response.statusCode === 201, "worker reserves evidence for background processing");
    const mediaId = reservation.evidence.id;
    const mediaKey = getStringField(reservation.upload.fields, "key");
    storage.putObject(mediaKey, {
      contentLength: 1024,
      contentType: "image/jpeg",
      checksumSha256Base64: checksumBase64(checksum),
      etag: '"phase9-etag"',
      versionId: "phase9-version",
    });
    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerToken),
      payload: { media_id: mediaId },
    });
    assert(response.statusCode === 200, "evidence confirmation creates a durable media processing outbox row");

    await waitFor("media processing completion", async () => {
      const state = await client.query<{ processing_state: string; processing_attempts: number }>(
        `SELECT processing_state, processing_attempts FROM media_processing_outbox WHERE media_id = $1`,
        [mediaId],
      );
      return state.rows[0]?.processing_state === "COMPLETED" && state.rows[0]?.processing_attempts === 1;
    });
    const processedMedia = await client.query<{ processing_state: string; processing_attempts: number }>(
      `SELECT processing_state, processing_attempts FROM media_processing_outbox WHERE media_id = $1`,
      [mediaId],
    );
    assert(
      processedMedia.rows[0]?.processing_state === "COMPLETED" && processedMedia.rows[0]?.processing_attempts === 1,
      "media queue completes the durable outbox record exactly once",
    );
    assert(storage.headVersionIds.includes("phase9-version"), "media worker re-reads the exact accepted S3 version");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerToken),
      payload: { media_id: mediaId },
    });
    assert(response.statusCode === 200, "evidence confirmation retry remains idempotent");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const mediaAttempts = await client.query<{ processing_attempts: number }>(
      `SELECT processing_attempts FROM media_processing_outbox WHERE media_id = $1`,
      [mediaId],
    );
    assert(mediaAttempts.rows[0]?.processing_attempts === 1, "completed media is never processed twice by a retry");

    await waitFor("pre-device push drain", async () => {
      const pending = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM sync_events WHERE recipient_user_id = $1 AND push_state = 'PENDING'`,
        [clientUser.id],
      );
      return pending.rows[0]?.count === "0";
    });
    await client.query(
      `INSERT INTO device_push_tokens (user_id, token, platform) VALUES ($1, 'phase9-device-token-abcdefghijklmnopqrstuvwxyz', 'WEB')`,
      [clientUser.id],
    );
    const event = await client.query<{ cursor: string }>(
      `
        SELECT emit_user_sync_event(
          $1, 'SYSTEM', 'PHASE9', NULL, '{}'::jsonb,
          'Phase 9 queued notification', 'Queue retry verification', TRUE
        )::text AS cursor
      `,
      [clientUser.id],
    );
    const cursor = event.rows[0]?.cursor;
    if (!cursor) throw new Error("Could not create Phase 9 push event");
    await waitFor("retry-safe push delivery", async () => {
      const state = await client.query<{ push_state: string; push_attempts: number }>(
        `SELECT push_state, push_attempts FROM sync_events WHERE id = $1::bigint`,
        [cursor],
      );
      return state.rows[0]?.push_state === "SENT" && state.rows[0]?.push_attempts === 2;
    });
    assert(
      pushGateway.sent.filter((delivery) => delivery.title === "Phase 9 queued notification").length === 2,
      "push worker releases a failed claim and BullMQ retries the same durable cursor",
    );

    // eslint-disable-next-line no-console
    console.log("\nPhase 9 verification complete: all checks passed.");
  } finally {
    config.BACKGROUND_QUEUE_POLL_INTERVAL_MS = originalPollInterval;
    await app.close();
    await cleanup();
    await client.end();
    await closeConnections();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nPhase 9 verification FAILED:", err);
  process.exit(1);
});
