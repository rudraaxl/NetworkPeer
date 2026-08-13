import pg from "pg";
import { signAccessToken } from "../src/auth.js";
import { config } from "../src/config.js";
import { closeConnections } from "../src/db.js";
import { buildApp } from "../src/index.js";
import type { MediaStorage, MediaUploadTarget, StoredMediaObject } from "../src/services/media-storage-service.js";

const client = new pg.Client({ connectionString: config.DATABASE_URL });
const SEED_PHONES = ["+10000000201", "+10000000202", "+10000000203"] as const;

type ApiEnvelope = {
  success: boolean;
  data: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
};

class FakeMediaStorage implements MediaStorage {
  private readonly objects = new Map<string, StoredMediaObject>();
  private readonly states = new Map<string, "pending" | "confirmed">();
  lastMaxUploadBytes: number | null = null;

  async createUploadTarget(input: {
    bucket: string;
    key: string;
    mimeType: string;
    checksumSha256Base64: string;
    maxUploadBytes: number;
  }): Promise<MediaUploadTarget> {
    this.lastMaxUploadBytes = input.maxUploadBytes;
    return {
      url: "https://uploads.example.test/networkpeer",
      fields: {
        key: input.key,
        "Content-Type": input.mimeType,
        "Content-Disposition": "attachment",
        "x-amz-checksum-sha256": input.checksumSha256Base64,
        "x-amz-tagging": "networkpeer-evidence-state=pending",
      },
    };
  }

  putObject(key: string, object: StoredMediaObject): void {
    this.objects.set(key, object);
  }

  getObjectState(bucket: string, key: string, versionId: string): "pending" | "confirmed" | null {
    return this.states.get(`${bucket}/${key}/${versionId}`) ?? null;
  }

  async headObject(input: { bucket: string; key: string; versionId?: string }): Promise<StoredMediaObject> {
    const object = this.objects.get(input.key);
    if (!object) {
      const error = Object.assign(new Error(`Object ${input.bucket}/${input.key} not found`), {
        $metadata: { httpStatusCode: 404 },
      });
      throw error;
    }
    return object;
  }

  async setObjectState(input: {
    bucket: string;
    key: string;
    versionId: string;
    state: "pending" | "confirmed";
  }): Promise<void> {
    this.states.set(`${input.bucket}/${input.key}/${input.versionId}`, input.state);
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

function pass(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`  PASS  ${name}`);
}

function assert(condition: unknown, name: string): void {
  if (!condition) throw new Error(`Phase 5 assertion failed: ${name}`);
  pass(name);
}

function parseEnvelope(payload: string): ApiEnvelope {
  return JSON.parse(payload) as ApiEnvelope;
}

function checksumBase64(checksum: string): string {
  return Buffer.from(checksum, "hex").toString("base64");
}

function getStringField(fields: Record<string, unknown>, name: string): string {
  const value = fields[name];
  if (typeof value !== "string") throw new Error(`Missing ${name} in Phase 5 response`);
  return value;
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
  const storage = new FakeMediaStorage();
  await client.connect();
  const app = await buildApp({ mediaStorage: storage });

  try {
    await cleanup();
    await app.ready();
    const created = await client.query<{ id: string; phone_number: string; role: "CLIENT" | "WORKER" }>(
      `
        INSERT INTO users (phone_number, full_name, role, is_verified)
        VALUES
          ($1, 'Phase 5 Client', 'CLIENT', TRUE),
          ($2, 'Phase 5 Worker A', 'WORKER', TRUE),
          ($3, 'Phase 5 Worker B', 'WORKER', TRUE)
        RETURNING id, phone_number, role
      `,
      [...SEED_PHONES],
    );
    const byPhone = new Map(created.rows.map((row) => [row.phone_number, row]));
    const clientUser = byPhone.get(SEED_PHONES[0]);
    const workerA = byPhone.get(SEED_PHONES[1]);
    const workerB = byPhone.get(SEED_PHONES[2]);
    if (!clientUser || !workerA || !workerB) throw new Error("Could not create Phase 5 seed users");

    await client.query(
      `
        INSERT INTO worker_profiles (user_id, verification_status, is_available, preferred_radius_km)
        VALUES ($1, 'VERIFIED', FALSE, 20), ($2, 'VERIFIED', TRUE, 20)
      `,
      [workerA.id, workerB.id],
    );
    const jobResult = await client.query<{ id: string }>(
      `
        INSERT INTO jobs (client_id, title, description, category, budget_cents, location, escrow_status)
        VALUES (
          $1, 'Evidence verification job', 'Capture two required pieces of field evidence.', 'INSPECTION', 10000,
          ST_SetSRID(ST_MakePoint(-73.9857, 40.7484), 4326), 'HELD'
        )
        RETURNING id
      `,
      [clientUser.id],
    );
    const jobId = jobResult.rows[0]?.id;
    if (!jobId) throw new Error("Could not create Phase 5 job");
    const subtasks = await client.query<{ id: string }>(
      `
        INSERT INTO job_subtasks (job_id, title, sequence_order, is_required)
        VALUES ($1, 'Required photo', 0, TRUE), ($1, 'Required document', 1, TRUE)
        RETURNING id
      `,
      [jobId],
    );
    const firstSubtaskId = subtasks.rows[0]?.id;
    const secondSubtaskId = subtasks.rows[1]?.id;
    if (!firstSubtaskId || !secondSubtaskId) throw new Error("Could not create Phase 5 subtasks");

    await client.query(`UPDATE jobs SET worker_id = $2, status = 'ASSIGNED' WHERE id = $1`, [jobId, workerA.id]);

    const clientToken = signAccessToken({ id: clientUser.id, role: "CLIENT", phone: clientUser.phone_number });
    const workerAToken = signAccessToken({ id: workerA.id, role: "WORKER", phone: workerA.phone_number });
    const workerBToken = signAccessToken({ id: workerB.id, role: "WORKER", phone: workerB.phone_number });
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    const checksum = "a".repeat(64);
    const capturedAt = new Date().toISOString();
    const firstPayload = {
      job_id: jobId,
      subtask_id: firstSubtaskId,
      media_type: "IMAGE",
      mime_type: "image/jpeg",
      file_size_bytes: 1024,
      captured_at: capturedAt,
      location: { latitude: 40.7484, longitude: -73.9857 },
      checksum_sha256: checksum,
      idempotency_key: "phase5-photo-evidence-001",
    };

    // eslint-disable-next-line no-console
    console.log("\n== Phase 5 API verification ==");

    let response = await app.inject({
      method: "POST",
      url: "/api/v1/work/status",
      headers: bearer(workerAToken),
      payload: { job_id: jobId, status: "EN_ROUTE" },
    });
    let body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.data?.["status"] === "EN_ROUTE", "worker can advance assigned work to EN_ROUTE");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/status",
      headers: bearer(workerAToken),
      payload: { job_id: jobId, status: "AT_LOCATION" },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.data?.["status"] === "AT_LOCATION", "worker can advance work to AT_LOCATION");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/status",
      headers: bearer(workerAToken),
      payload: { job_id: jobId, status: "IN_PROGRESS" },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.data?.["status"] === "IN_PROGRESS", "worker can advance work to IN_PROGRESS");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/upload-url",
      headers: bearer(clientToken),
      payload: firstPayload,
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 403 && body.error?.code === "FORBIDDEN", "CLIENT cannot reserve evidence uploads");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/upload-url",
      headers: bearer(workerBToken),
      payload: firstPayload,
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 404 && body.error?.code === "WORK_NOT_FOUND", "other workers cannot reserve evidence");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/upload-url",
      headers: bearer(workerAToken),
      payload: firstPayload,
    });
    body = parseEnvelope(response.body);
    const firstUpload = body.data as {
      evidence?: { id?: string; status?: string; uploaded_at?: unknown };
      upload?: { url?: string; fields?: Record<string, unknown>; expires_at?: string } | null;
    } | null;
    const firstMediaId = firstUpload?.evidence?.id;
    const firstKey = firstUpload?.upload?.fields ? getStringField(firstUpload.upload.fields, "key") : null;
    assert(response.statusCode === 201 && body.success && firstUpload?.evidence?.status === "PENDING", "assigned worker receives a pending evidence reservation");
    assert(
      typeof firstMediaId === "string" &&
        firstUpload?.evidence?.uploaded_at === null &&
        typeof firstUpload?.upload?.url === "string" &&
        typeof firstKey === "string" &&
        firstUpload?.upload?.fields?.["x-amz-tagging"] === "networkpeer-evidence-state=pending" &&
        storage.lastMaxUploadBytes === 1024 + 64 * 1024 &&
        !Object.prototype.hasOwnProperty.call(firstUpload?.evidence ?? {}, "s3_key"),
      "upload response has an expiring pending tag and a reservation-bounded size ceiling",
    );
    if (!firstMediaId || !firstKey) throw new Error("Could not read first evidence reservation");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/upload-url",
      headers: bearer(workerAToken),
      payload: firstPayload,
    });
    body = parseEnvelope(response.body);
    const retryData = body.data as { evidence?: { id?: string } } | null;
    assert(response.statusCode === 201 && retryData?.evidence?.id === firstMediaId, "idempotency key returns the same reservation");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/submit",
      headers: bearer(workerAToken),
      payload: { job_id: jobId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 409 && body.error?.code === "REQUIRED_EVIDENCE_INCOMPLETE", "submission rejects pending evidence");

    let directSubmitBlocked = false;
    try {
      await client.query(`UPDATE jobs SET status = 'SUBMITTED' WHERE id = $1`, [jobId]);
    } catch (err) {
      directSubmitBlocked = (err as { code?: unknown }).code === "23514";
    }
    assert(directSubmitBlocked, "database trigger blocks direct incomplete submission");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerAToken),
      payload: { media_id: firstMediaId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 409 && body.error?.code === "UPLOAD_NOT_FOUND", "evidence requires an object-store upload");

    storage.putObject(firstKey, {
      contentLength: 1000,
      contentType: "image/jpeg",
      checksumSha256Base64: checksumBase64(checksum),
      etag: '"wrong-size"',
      versionId: "version-1",
    });
    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerAToken),
      payload: { media_id: firstMediaId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 409 && body.error?.code === "UPLOAD_METADATA_MISMATCH", "evidence validates object metadata");

    storage.putObject(firstKey, {
      contentLength: 1024,
      contentType: "image/jpeg; charset=binary",
      checksumSha256Base64: checksumBase64(checksum),
      etag: '"photo-etag"',
      versionId: null,
    });
    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerAToken),
      payload: { media_id: firstMediaId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 409 && body.error?.code === "STORAGE_VERSIONING_REQUIRED", "evidence requires a versioned S3 object");

    storage.putObject(firstKey, {
      contentLength: 1024,
      contentType: "image/jpeg; charset=binary",
      checksumSha256Base64: checksumBase64(checksum),
      etag: '"photo-etag"',
      versionId: "null",
    });
    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerAToken),
      payload: { media_id: firstMediaId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 409 && body.error?.code === "STORAGE_VERSIONING_REQUIRED", "evidence rejects S3's mutable null version");

    storage.putObject(firstKey, {
      contentLength: 1024,
      contentType: "image/jpeg; charset=binary",
      checksumSha256Base64: checksumBase64(checksum),
      etag: '"photo-etag"',
      versionId: "version-2",
    });
    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerAToken),
      payload: { media_id: firstMediaId },
    });
    body = parseEnvelope(response.body);
    assert(
      response.statusCode === 200 &&
        body.success &&
        body.data?.["status"] === "UPLOADED" &&
        storage.getObjectState(config.AWS_S3_BUCKET, firstKey, "version-2") === "confirmed",
      "stored object confirmation uploads evidence atomically and marks its version confirmed",
    );

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerAToken),
      payload: { media_id: firstMediaId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.data?.["status"] === "UPLOADED", "evidence confirmation is idempotent");

    const secondChecksum = "b".repeat(64);
    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/upload-url",
      headers: bearer(workerAToken),
      payload: {
        job_id: jobId,
        subtask_id: secondSubtaskId,
        media_type: "DOCUMENT",
        mime_type: "application/pdf",
        file_size_bytes: 2048,
        captured_at: capturedAt,
        checksum_sha256: secondChecksum,
        idempotency_key: "phase5-document-evidence-001",
      },
    });
    body = parseEnvelope(response.body);
    const secondUpload = body.data as {
      evidence?: { id?: string };
      upload?: { fields?: Record<string, unknown> } | null;
    } | null;
    const secondMediaId = secondUpload?.evidence?.id;
    const secondKey = secondUpload?.upload?.fields ? getStringField(secondUpload.upload.fields, "key") : null;
    assert(response.statusCode === 201 && typeof secondMediaId === "string" && typeof secondKey === "string", "second required evidence can be reserved");
    if (!secondMediaId || !secondKey) throw new Error("Could not read second evidence reservation");

    storage.putObject(secondKey, {
      contentLength: 2048,
      contentType: "application/pdf",
      checksumSha256Base64: checksumBase64(secondChecksum),
      etag: '"document-etag"',
      versionId: "version-3",
    });
    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/evidence",
      headers: bearer(workerAToken),
      payload: { media_id: secondMediaId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.data?.["status"] === "UPLOADED", "second required evidence is confirmed");

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/submit",
      headers: bearer(workerAToken),
      payload: { job_id: jobId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.data?.["status"] === "SUBMITTED", "all required evidence permits submission");
    const persisted = await client.query<{ status: string; completed_subtasks: string }>(
      `
        SELECT
          j.status,
          COUNT(*) FILTER (WHERE s.status = 'COMPLETED')::text AS completed_subtasks
        FROM jobs j
        JOIN job_subtasks s ON s.job_id = j.id
        WHERE j.id = $1
        GROUP BY j.status
      `,
      [jobId],
    );
    assert(
      persisted.rows[0]?.status === "SUBMITTED" && persisted.rows[0]?.completed_subtasks === "2",
      "submission persists completed subtasks and submitted job state",
    );

    response = await app.inject({
      method: "POST",
      url: "/api/v1/work/submit",
      headers: bearer(workerAToken),
      payload: { job_id: jobId },
    });
    body = parseEnvelope(response.body);
    assert(response.statusCode === 200 && body.data?.["status"] === "SUBMITTED", "submitted work retries idempotently");

    // eslint-disable-next-line no-console
    console.log("\nPhase 5 verification complete: all checks passed.");
  } finally {
    await app.close();
    await cleanup();
    await client.end();
    await closeConnections();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nPhase 5 verification FAILED:", err);
  process.exit(1);
});
