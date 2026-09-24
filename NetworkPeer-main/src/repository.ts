import { adminPool, financialPool, mediaVerifierPool, pool } from "./db.js";
import type { PoolClient } from "pg";
import type {
  JobStatus,
  Job,
  JobSubtask,
  JobSubtaskMedia,
  EscrowStatus,
  MediaType,
  Notification,
  Point,
  PushPlatform,
  SyncEvent,
  SyncTopic,
  User,
  UserRole,
  WalletLedgerEntry,
  WorkerJobDetail,
  WorkerJobSummary,
} from "./contracts.js";

/**
 * Data access layer. ALL raw SQL and PostGIS interactions live here.
 * Routes and services must never embed SQL directly.
 */

type Row = Record<string, unknown>;

function mapUser(row: Row): User {
  return {
    id: String(row["id"]),
    phone_number: String(row["phone_number"]),
    email: row["email"] ? String(row["email"]) : null,
    full_name: String(row["full_name"]),
    role: row["role"] as UserRole,
    avatar_url: row["avatar_url"] ? String(row["avatar_url"]) : null,
    is_active: Boolean(row["is_active"]),
    is_verified: Boolean(row["is_verified"]),
    last_login_at: row["last_login_at"] ? new Date(row["last_login_at"] as string) : null,
    created_at: new Date(row["created_at"] as string),
    updated_at: new Date(row["updated_at"] as string),
  };
}

function parsePointValue(raw: unknown): Point | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    // PostGIS returns geometry as "SRID=4326;POINT(lon lat)" in text casts.
    const match = /POINT\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/.exec(raw);
    if (!match) return null;
    return { type: "Point", coordinates: [Number(match[1]), Number(match[2])] };
  }
  return raw as Point;
}

function parsePoint(row: Row): Point | null {
  return parsePointValue(row["location"]);
}

function mapJob(row: Row): Job {
  return {
    id: String(row["id"]),
    client_id: String(row["client_id"]),
    worker_id: row["worker_id"] ? String(row["worker_id"]) : null,
    title: String(row["title"]),
    description: String(row["description"]),
    category: String(row["category"]),
    status: row["status"] as JobStatus,
    priority: Number(row["priority"] ?? 0),
    budget_cents: Number(row["budget_cents"]),
    platform_fee_cents: Number(row["platform_fee_cents"] ?? 0),
    currency: String(row["currency"]),
    escrow_status: (row["escrow_status"] ?? "UNFUNDED") as EscrowStatus,
    funded_at: row["funded_at"] ? new Date(row["funded_at"] as string) : null,
    location: parsePoint(row) as Point,
    address: row["address"] ? String(row["address"]) : null,
    scheduled_at: row["scheduled_at"] ? new Date(row["scheduled_at"] as string) : null,
    started_at: row["started_at"] ? new Date(row["started_at"] as string) : null,
    completed_at: row["completed_at"] ? new Date(row["completed_at"] as string) : null,
    cancelled_at: row["cancelled_at"] ? new Date(row["cancelled_at"] as string) : null,
    cancellation_reason: row["cancellation_reason"] ? String(row["cancellation_reason"]) : null,
    metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    created_at: new Date(row["created_at"] as string),
    updated_at: new Date(row["updated_at"] as string),
  };
}

function mapSubtask(row: Row): JobSubtask {
  return {
    id: String(row["id"]),
    job_id: String(row["job_id"]),
    title: String(row["title"]),
    description: row["description"] ? String(row["description"]) : null,
    sequence_order: Number(row["sequence_order"]),
    is_required: Boolean(row["is_required"]),
    status: row["status"] as JobSubtask["status"],
    completed_at: row["completed_at"] ? new Date(row["completed_at"] as string) : null,
    metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    created_at: new Date(row["created_at"] as string),
    updated_at: new Date(row["updated_at"] as string),
  };
}

function mapMedia(row: Row): JobSubtaskMedia {
  return {
    id: String(row["id"]),
    subtask_id: String(row["subtask_id"]),
    job_id: String(row["job_id"]),
    worker_id: String(row["worker_id"]),
    s3_key: String(row["s3_key"]),
    s3_bucket: String(row["s3_bucket"]),
    media_type: row["media_type"] as MediaType,
    mime_type: row["mime_type"] ? String(row["mime_type"]) : null,
    file_size_bytes: row["file_size_bytes"] === null || row["file_size_bytes"] === undefined
      ? null
      : Number(row["file_size_bytes"]),
    width: row["width"] === null || row["width"] === undefined ? null : Number(row["width"]),
    height: row["height"] === null || row["height"] === undefined ? null : Number(row["height"]),
    duration_seconds: row["duration_seconds"] === null || row["duration_seconds"] === undefined
      ? null
      : Number(row["duration_seconds"]),
    location: parsePoint(row),
    captured_at: new Date(row["captured_at"] as string),
    uploaded_at: row["uploaded_at"] ? new Date(row["uploaded_at"] as string) : null,
    upload_expires_at: row["upload_expires_at"] ? new Date(row["upload_expires_at"] as string) : null,
    checksum_sha256: row["checksum_sha256"] ? String(row["checksum_sha256"]) : null,
    s3_etag: row["s3_etag"] ? String(row["s3_etag"]) : null,
    s3_version_id: row["s3_version_id"] ? String(row["s3_version_id"]) : null,
    status: row["status"] as JobSubtaskMedia["status"],
    verification_notes: row["verification_notes"] ? String(row["verification_notes"]) : null,
    metadata: (row["metadata"] as Record<string, unknown>) ?? {},
    idempotency_key: row["idempotency_key"] ? String(row["idempotency_key"]) : null,
    created_at: new Date(row["created_at"] as string),
  };
}

type WorkerVisibleJob = Omit<WorkerJobDetail, "subtasks">;

function mapWorkerJobSummary(row: Row): WorkerJobSummary {
  return {
    id: String(row["id"]),
    title: String(row["title"]),
    description: String(row["description"]),
    category: String(row["category"]),
    priority: Number(row["priority"] ?? 0),
    budget_cents: Number(row["budget_cents"]),
    currency: String(row["currency"]),
    scheduled_at: row["scheduled_at"] ? new Date(row["scheduled_at"] as string) : null,
    created_at: new Date(row["created_at"] as string),
    distance_band: row["distance_band"] as WorkerJobSummary["distance_band"],
  };
}

function mapWorkerVisibleJob(row: Row): WorkerVisibleJob {
  return {
    id: String(row["id"]),
    title: String(row["title"]),
    description: String(row["description"]),
    category: String(row["category"]),
    status: row["status"] as JobStatus,
    priority: Number(row["priority"] ?? 0),
    budget_cents: Number(row["budget_cents"]),
    currency: String(row["currency"]),
    scheduled_at: row["scheduled_at"] ? new Date(row["scheduled_at"] as string) : null,
    created_at: new Date(row["created_at"] as string),
    updated_at: new Date(row["updated_at"] as string),
    location: parsePointValue(row["visible_location"]),
    address: row["visible_address"] ? String(row["visible_address"]) : null,
    is_assigned_to_requester: Boolean(row["is_assigned_to_requester"]),
  };
}

function validatePoint({ coordinates: [lon, lat] }: Point): [number, number] {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new RangeError("Point coordinates must be finite numbers");
  }

  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new RangeError("Point coordinates are outside WGS84 bounds");
  }

  return [lon, lat];
}

export type CreateJobInput = {
  clientId: string;
  title: string;
  description: string;
  category: string;
  budgetCents: number;
  platformFeeCents: number;
  currency: string;
  location: Point;
  address?: string;
  scheduledAt?: Date;
  metadata?: Record<string, unknown>;
  publicTitle?: string;
  publicDescription?: string;
  idempotencyKey?: string;
  idempotencyFingerprint?: string;
};

type Queryable = Pick<PoolClient, "query">;

export async function insertJob(input: CreateJobInput): Promise<Job> {
  return insertJobWithSubtasks(input, []);
}

export async function getJobById(jobId: string): Promise<Job | null> {
  const { rows } = await pool.query<Row>(
    `SELECT *, ST_AsText(location) AS location FROM jobs WHERE id = $1`,
    [jobId],
  );
  return rows[0] ? mapJob(rows[0] as Row) : null;
}

export async function listJobsByClient(
  clientId: string,
  statuses: JobStatus[],
  limit: number,
  offset: number,
): Promise<Job[]> {
  const { rows } = await pool.query<Row>(
    `
      SELECT *, ST_AsText(location) AS location
      FROM jobs
      WHERE client_id = $1 AND ($2::job_status[] IS NULL OR status = ANY($2))
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
    `,
    [clientId, statuses.length ? statuses : null, limit, offset],
  );
  return rows.map((r) => mapJob(r as Row));
}

export async function countJobsByClient(clientId: string, statuses: JobStatus[]): Promise<number> {
  const { rows } = await pool.query<Row>(
    `
      SELECT COUNT(*)::int AS total
      FROM jobs
      WHERE client_id = $1 AND ($2::job_status[] IS NULL OR status = ANY($2))
    `,
    [clientId, statuses.length ? statuses : null],
  );
  return Number(rows[0]?.["total"] ?? 0);
}

export type NearbyJobsInput = {
  workerId: string;
  radiusMeters: number;
  limit: number;
  offset: number;
};

export type AllPostedJobsInput = {
  workerId?: string;
  limit: number;
  offset: number;
};

export async function listAllPostedJobs(input: AllPostedJobsInput): Promise<WorkerJobSummary[]> {
  const { rows } = await pool.query<Row>(
    `
      SELECT
        j.id,
        COALESCE(j.public_title, j.title) AS title,
        COALESCE(j.public_description, j.description) AS description,
        j.category,
        j.priority,
        j.budget_cents,
        j.currency,
        j.scheduled_at,
        j.created_at,
        '1_TO_5_KM' AS distance_band
      FROM jobs j
      WHERE j.status IN ('POSTED', 'FUNDING')
        AND j.worker_id IS NULL
        AND EXISTS (
          SELECT 1 FROM users client
          WHERE client.id = j.client_id AND client.is_active = TRUE
        )
      ORDER BY j.created_at DESC
      LIMIT $1 OFFSET $2
    `,
    [input.limit, input.offset],
  );
  return rows.map((row) => mapWorkerJobSummary(row as Row));
}

export async function countAllPostedJobs(): Promise<number> {
  const { rows } = await pool.query<Row>(
    `
      SELECT COUNT(*)::int AS total
      FROM jobs j
      WHERE j.status IN ('POSTED', 'FUNDING')
        AND j.worker_id IS NULL
        AND EXISTS (
          SELECT 1 FROM users client
          WHERE client.id = j.client_id AND client.is_active = TRUE
        )
    `,
  );
  return Number(rows[0]?.["total"] ?? 0);
}

/**
 * Finds unassigned POSTED jobs within a meter-based radius. Exact distances are
 * deliberately reduced to broad bands before a worker receives assignment.
 */
export async function listNearbyPostedJobs(input: NearbyJobsInput): Promise<WorkerJobSummary[]> {
  const { rows } = await pool.query<Row>(
    `
      WITH worker_location AS (
        SELECT wp.current_location::geography AS point
        FROM worker_profiles wp
        JOIN users worker ON worker.id = wp.user_id
        WHERE wp.user_id = $1
          AND worker.is_active = TRUE
          AND wp.current_location IS NOT NULL
      )
      SELECT
        j.id,
        COALESCE(j.public_title, j.title) AS title,
        COALESCE(j.public_description, j.description) AS description,
        j.category,
        j.priority,
        j.budget_cents,
        j.currency,
        j.scheduled_at,
        j.created_at,
        CASE
          WHEN worker_location.point IS NULL THEN '1_TO_5_KM'
          WHEN ST_Distance(j.location::geography, worker_location.point) < 1000 THEN 'UNDER_1_KM'
          WHEN ST_Distance(j.location::geography, worker_location.point) < 5000 THEN '1_TO_5_KM'
          WHEN ST_Distance(j.location::geography, worker_location.point) < 20000 THEN '5_TO_20_KM'
          ELSE '20KM_PLUS'
        END AS distance_band
      FROM jobs j
      LEFT JOIN worker_location ON TRUE
      WHERE j.status IN ('POSTED', 'FUNDING')
        AND j.worker_id IS NULL
        AND EXISTS (
          SELECT 1 FROM users client
          WHERE client.id = j.client_id AND client.is_active = TRUE
        )
        AND (
          worker_location.point IS NULL
          OR ST_DWithin(j.location::geography, worker_location.point, $2)
        )
      ORDER BY j.created_at DESC
      LIMIT $3 OFFSET $4
    `,
    [input.workerId, input.radiusMeters, input.limit, input.offset],
  );
  return rows.map((row) => mapWorkerJobSummary(row as Row));
}

export async function countNearbyPostedJobs(workerId: string, radiusMeters: number): Promise<number> {
  const { rows } = await pool.query<Row>(
    `
      WITH worker_location AS (
        SELECT wp.current_location::geography AS point
        FROM worker_profiles wp
        JOIN users worker ON worker.id = wp.user_id
        WHERE wp.user_id = $1
          AND worker.is_active = TRUE
          AND wp.verification_status = 'VERIFIED'
          AND wp.current_location IS NOT NULL
      )
      SELECT COUNT(*)::int AS total
      FROM jobs j
      CROSS JOIN worker_location
      WHERE j.status = 'POSTED'
        AND j.worker_id IS NULL
        AND j.escrow_status = 'HELD'
        AND EXISTS (
          SELECT 1 FROM users client
          WHERE client.id = j.client_id AND client.is_active = TRUE
        )
        AND ST_DWithin(j.location::geography, worker_location.point, $2)
    `,
    [workerId, radiusMeters],
  );
  return Number(rows[0]?.["total"] ?? 0);
}

/**
 * Returns a job only when it is public (POSTED) or assigned to the requesting
 * worker. The SQL projection deliberately withholds exact location/address for
 * public jobs, so privacy is not dependent on service-layer filtering.
 */
export async function getWorkerVisibleJob(jobId: string, workerId: string): Promise<WorkerVisibleJob | null> {
  const { rows } = await pool.query<Row>(
    `
      SELECT
        j.id,
        CASE WHEN j.worker_id = $2 THEN j.title ELSE j.public_title END AS title,
        CASE WHEN j.worker_id = $2 THEN j.description ELSE j.public_description END AS description,
        j.category,
        j.status,
        j.priority,
        j.budget_cents,
        j.currency,
        j.scheduled_at,
        j.created_at,
        j.updated_at,
        CASE WHEN j.worker_id = $2 THEN ST_AsText(j.location) END AS visible_location,
        CASE WHEN j.worker_id = $2 THEN j.address END AS visible_address,
        (j.worker_id = $2) AS is_assigned_to_requester
      FROM jobs j
      WHERE j.id = $1
        AND (
          (
            j.status = 'POSTED'
            AND j.worker_id IS NULL
            AND j.escrow_status = 'HELD'
            AND EXISTS (
              SELECT 1 FROM users client
              WHERE client.id = j.client_id AND client.is_active = TRUE
            )
          )
          OR j.worker_id = $2
        )
    `,
    [jobId, workerId],
  );
  return rows[0] ? mapWorkerVisibleJob(rows[0] as Row) : null;
}

export type CreateSubtaskInput = {
  title: string;
  description?: string;
  sequenceOrder: number;
  isRequired?: boolean;
  metadata?: Record<string, unknown>;
};

async function insertSubtaskWithQueryable(
  queryable: Queryable,
  jobId: string,
  input: CreateSubtaskInput,
): Promise<JobSubtask> {
  const { rows } = await queryable.query<Row>(
    `
      INSERT INTO job_subtasks (job_id, title, description, sequence_order, is_required, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [
      jobId,
      input.title,
      input.description ?? null,
      input.sequenceOrder,
      input.isRequired ?? true,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapSubtask(rows[0] as Row);
}

export async function insertSubtask(jobId: string, input: CreateSubtaskInput): Promise<JobSubtask> {
  return insertSubtaskWithQueryable(pool, jobId, input);
}

/** Create a job and all of its subtasks as one atomic database transaction. */
export async function insertJobWithSubtasks(
  input: CreateJobInput,
  subtasks: readonly CreateSubtaskInput[],
): Promise<Job> {
  const [longitude, latitude] = validatePoint(input.location);
  try {
    const { rows } = await pool.query<Row>(
      `
        SELECT create_client_job(
          $1, $2, $3, $4, $5, $6, $7::char(3), $8, $9, $10, $11, $12::jsonb,
          $13, $14, $15::jsonb, $16, $17::char(64)
        ) AS job_id
      `,
      [
        input.clientId,
        input.title,
        input.description,
        input.category,
        input.budgetCents,
        input.platformFeeCents,
        input.currency,
        longitude,
        latitude,
        input.address ?? null,
        input.scheduledAt ?? null,
        JSON.stringify(input.metadata ?? {}),
        input.publicTitle ?? "Field work opportunity",
        input.publicDescription ?? "",
        JSON.stringify(subtasks.map((subtask) => ({
          title: subtask.title,
          description: subtask.description,
          is_required: subtask.isRequired ?? true,
          metadata: subtask.metadata ?? {},
        }))),
        input.idempotencyKey ?? null,
        input.idempotencyFingerprint ?? null,
      ],
    );
    const jobId = rows[0]?.["job_id"];
    if (!jobId) throw new Error("Job creation did not return an id");
    const job = await getJobById(String(jobId));
    if (!job) throw new Error("Created job could not be read");
    return job;
  } catch (err) {
    const code = typeof err === "object" && err !== null && "code" in err
      ? (err as { code?: unknown }).code
      : null;
    if (code === "23505" && input.idempotencyKey) throw new JobIdempotencyConflictError();
    throw err;
  }
}

export class JobIdempotencyConflictError extends Error {
  constructor() {
    super("An idempotency key cannot be reused for a different job request");
    this.name = "JobIdempotencyConflictError";
  }
}

/**
 * Client-initiated cancellation. Atomically transitions the job to CANCELLED
 * only if it is still owned by the client, in FUNDING, and still UNFUNDED.
 * A funded job requires an explicit escrow-refund workflow. Returns null if
 * the job is not found, not owned, or no longer cancelable — the caller maps
 * null to the appropriate HTTP error.
 */
export async function cancelJobForClient(
  jobId: string,
  clientId: string,
  reason?: string,
): Promise<Job | null> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM cancel_client_job($1, $2, $3)`,
    [jobId, clientId, reason ?? null],
  );
  if (!rows[0]) return null;
  return getJobById(jobId);
}

export async function resolveJobForClient(
  jobId: string,
  clientId: string,
  action: "APPROVE" | "COMPLETE" | "DISPUTE",
): Promise<Job | null> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM resolve_client_job($1, $2, $3::varchar)`,
    [jobId, clientId, action],
  );
  if (!rows[0]) return null;
  return getJobById(jobId);
}

/**
 * Atomically accept a job for a worker.
 * Delegates to the `accept_job` database function which uses FOR UPDATE
 * row locking; PostgreSQL raises `55000` if the job is not POSTED and
 * `22000` for invalid worker or job.
 */
export async function acceptJobForWorker(
  jobId: string,
  workerId: string,
): Promise<{ jobId: string; workerId: string; status: JobStatus }> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM accept_job($1, $2)`,
    [jobId, workerId],
  );
  const row = rows[0] as Row;
  return {
    jobId: String(row["job_id"]),
    workerId: String(row["worker_id"]),
    status: row["status"] as JobStatus,
  };
}

export async function getSubtasksByJob(jobId: string): Promise<JobSubtask[]> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM job_subtasks WHERE job_id = $1 ORDER BY sequence_order ASC`,
    [jobId],
  );
  return rows.map((r) => mapSubtask(r as Row));
}

export type ReserveMediaUploadInput = {
  mediaId: string;
  workerId: string;
  jobId: string;
  subtaskId: string;
  s3Key: string;
  s3Bucket: string;
  mediaType: MediaType;
  mimeType: string;
  fileSizeBytes: number;
  capturedAt: Date;
  location?: Point;
  checksumSha256: string;
  idempotencyKey: string;
  uploadExpiresAt: Date;
};

export type MediaReservation = {
  media: JobSubtaskMedia;
  uploadAllowed: boolean;
};

export class MediaReservationConflictError extends Error {
  constructor() {
    super("An idempotency key cannot be reused for different evidence");
    this.name = "MediaReservationConflictError";
  }
}

function pointsMatch(left: Point | null, right: Point | undefined): boolean {
  if (!left || !right) return left === null && right === undefined;
  return left.coordinates[0] === right.coordinates[0] && left.coordinates[1] === right.coordinates[1];
}

function reservationMatches(media: JobSubtaskMedia, input: ReserveMediaUploadInput): boolean {
  return (
    media.job_id === input.jobId &&
    media.subtask_id === input.subtaskId &&
    media.media_type === input.mediaType &&
    media.mime_type === input.mimeType &&
    media.file_size_bytes === input.fileSizeBytes &&
    media.captured_at.getTime() === input.capturedAt.getTime() &&
    media.checksum_sha256 === input.checksumSha256 &&
    pointsMatch(media.location, input.location)
  );
}

async function getReservationByIdempotencyKey(
  queryable: Queryable,
  workerId: string,
  idempotencyKey: string,
): Promise<{ media: JobSubtaskMedia; jobStatus: JobStatus } | null> {
  const { rows } = await queryable.query<Row>(
    `
      SELECT m.*, j.status AS job_status, ST_AsText(m.location) AS location
      FROM job_subtask_media m
      JOIN jobs j ON j.id = m.job_id
      JOIN job_subtasks s ON s.id = m.subtask_id AND s.job_id = m.job_id
      WHERE m.worker_id = $1
        AND m.idempotency_key = $2
        AND j.worker_id = $1
      FOR UPDATE OF m, j, s
    `,
    [workerId, idempotencyKey],
  );
  if (!rows[0]) return null;
  return { media: mapMedia(rows[0] as Row), jobStatus: rows[0]["job_status"] as JobStatus };
}

/**
 * Creates a server-owned evidence reservation after locking the in-progress job
 * and its subtask. Retried idempotency keys return the same reservation.
 */
export async function reserveMediaUpload(input: ReserveMediaUploadInput): Promise<MediaReservation | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const verifiedWorker = await client.query<{ verification_status: string }>(
      `
        SELECT verification_status
        FROM worker_profiles
        WHERE user_id = $1
        FOR UPDATE
      `,
      [input.workerId],
    );
    if (verifiedWorker.rows[0]?.verification_status !== "VERIFIED") {
      await client.query("COMMIT");
      return null;
    }
    let existing = await getReservationByIdempotencyKey(client, input.workerId, input.idempotencyKey);
    if (existing) {
      if (!reservationMatches(existing.media, input)) throw new MediaReservationConflictError();
      if (existing.media.status !== "PENDING") {
        await client.query("COMMIT");
        return { media: existing.media, uploadAllowed: false };
      }
      if (existing.jobStatus !== "IN_PROGRESS") {
        await client.query("COMMIT");
        return null;
      }
      const refreshed = await client.query<Row>(
        `
          UPDATE job_subtask_media
          SET upload_expires_at = $2
          WHERE id = $1
          RETURNING *, ST_AsText(location) AS location
        `,
        [existing.media.id, input.uploadExpiresAt],
      );
      await client.query("COMMIT");
      return { media: mapMedia(refreshed.rows[0] as Row), uploadAllowed: true };
    }

    const eligibility = await client.query(
      `
        SELECT 1
        FROM jobs j
        JOIN job_subtasks s ON s.id = $2 AND s.job_id = j.id
        WHERE j.id = $1
          AND j.worker_id = $3
          AND j.status = 'IN_PROGRESS'
          AND s.status <> 'SKIPPED'
        FOR UPDATE OF j, s
      `,
      [input.jobId, input.subtaskId, input.workerId],
    );
    if (!eligibility.rows[0]) {
      await client.query("COMMIT");
      return null;
    }

    const lon = input.location?.coordinates[0] ?? null;
    const lat = input.location?.coordinates[1] ?? null;
    const inserted = await client.query<Row>(
      `
        INSERT INTO job_subtask_media (
          id, subtask_id, job_id, worker_id, s3_key, s3_bucket, media_type,
          mime_type, file_size_bytes, location, captured_at, upload_expires_at,
          checksum_sha256, idempotency_key
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          CASE WHEN $10::double precision IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($10, $11), 4326) END,
          $12, $13, $14, $15
        )
        ON CONFLICT (worker_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
        RETURNING *, ST_AsText(location) AS location
      `,
      [
        input.mediaId,
        input.subtaskId,
        input.jobId,
        input.workerId,
        input.s3Key,
        input.s3Bucket,
        input.mediaType,
        input.mimeType,
        input.fileSizeBytes,
        lon,
        lat,
        input.capturedAt,
        input.uploadExpiresAt,
        input.checksumSha256,
        input.idempotencyKey,
      ],
    );
    if (inserted.rows[0]) {
      await client.query("COMMIT");
      return { media: mapMedia(inserted.rows[0] as Row), uploadAllowed: true };
    }

    existing = await getReservationByIdempotencyKey(client, input.workerId, input.idempotencyKey);
    if (!existing || !reservationMatches(existing.media, input)) {
      throw new MediaReservationConflictError();
    }
    await client.query("COMMIT");
    return { media: existing.media, uploadAllowed: existing.media.status === "PENDING" && existing.jobStatus === "IN_PROGRESS" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getMediaForWorker(mediaId: string, workerId: string): Promise<JobSubtaskMedia | null> {
  const { rows } = await pool.query<Row>(
    `
      SELECT m.*, ST_AsText(m.location) AS location
      FROM job_subtask_media m
      JOIN jobs j ON j.id = m.job_id
      WHERE m.id = $1
        AND m.worker_id = $2
        AND j.worker_id = $2
    `,
    [mediaId, workerId],
  );
  return rows[0] ? mapMedia(rows[0] as Row) : null;
}

/**
 * Server-only record used to sign a client-owned evidence download. Storage
 * identifiers deliberately never leave the repository/service boundary.
 */
export type ClientEvidenceReviewMediaRecord = {
  id: string;
  jobId: string;
  subtaskId: string;
  mediaType: MediaType;
  mimeType: string | null;
  fileSizeBytes: number | null;
  capturedAt: Date;
  uploadedAt: Date;
  status: Extract<JobSubtaskMedia["status"], "UPLOADED" | "VERIFIED">;
  s3Bucket: string;
  s3Key: string;
  s3VersionId: string;
};

export type ClientEvidenceReviewRecords = {
  jobStatus: JobStatus;
  evidence: ClientEvidenceReviewMediaRecord[];
};

/**
 * Returns only immutable, confirmed evidence for its owning client. The SQL
 * join prevents object identifiers from being selected for an unreviewable job.
 */
export async function listEvidenceForClientReview(
  jobId: string,
  clientId: string,
): Promise<ClientEvidenceReviewRecords | null> {
  const { rows } = await pool.query<Row>(
    `
      SELECT
        j.status AS job_status,
        m.id AS media_id,
        m.job_id,
        m.subtask_id,
        m.media_type,
        m.mime_type,
        m.file_size_bytes,
        m.captured_at,
        m.uploaded_at,
        m.status AS media_status,
        m.s3_bucket,
        m.s3_key,
        m.s3_version_id
      FROM jobs AS j
      LEFT JOIN job_subtask_media AS m
        ON m.job_id = j.id
        AND j.status IN ('IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'DISPUTED')
        AND m.status IN ('UPLOADED', 'VERIFIED')
        AND m.uploaded_at IS NOT NULL
        AND m.s3_version_id IS NOT NULL
        AND length(btrim(m.s3_version_id)) > 0
        AND lower(btrim(m.s3_version_id)) <> 'null'
      WHERE j.id = $1
        AND j.client_id = $2
      ORDER BY m.captured_at ASC NULLS LAST, m.id ASC
    `,
    [jobId, clientId],
  );
  const first = rows[0];
  if (!first) return null;

  const evidence = rows.flatMap((row): ClientEvidenceReviewMediaRecord[] => {
    if (!row["media_id"]) return [];
    const s3Bucket = row["s3_bucket"];
    const s3Key = row["s3_key"];
    const s3VersionId = row["s3_version_id"];
    if (
      typeof s3Bucket !== "string" ||
      typeof s3Key !== "string" ||
      typeof s3VersionId !== "string" ||
      !s3Bucket ||
      !s3Key ||
      !s3VersionId
    ) {
      throw new Error("Reviewable evidence is missing immutable storage metadata");
    }
    return [{
      id: String(row["media_id"]),
      jobId: String(row["job_id"]),
      subtaskId: String(row["subtask_id"]),
      mediaType: row["media_type"] as MediaType,
      mimeType: row["mime_type"] ? String(row["mime_type"]) : null,
      fileSizeBytes: row["file_size_bytes"] === null || row["file_size_bytes"] === undefined
        ? null
        : Number(row["file_size_bytes"]),
      capturedAt: new Date(row["captured_at"] as string),
      uploadedAt: new Date(row["uploaded_at"] as string),
      status: row["media_status"] as Extract<JobSubtaskMedia["status"], "UPLOADED" | "VERIFIED">,
      s3Bucket,
      s3Key,
      s3VersionId,
    }];
  });
  return { jobStatus: first["job_status"] as JobStatus, evidence };
}

export async function confirmMediaUpload(input: {
  mediaId: string;
  workerId: string;
  fileSizeBytes: number;
  mimeType: string;
  checksumSha256: string;
  s3Etag: string;
  s3VersionId: string | null;
}): Promise<JobSubtaskMedia | null> {
  await mediaVerifierPool.query(
    `SELECT * FROM confirm_job_subtask_media_upload($1, $2, $3, $4::varchar, $5::varchar, $6, $7)`,
    [
      input.mediaId,
      input.workerId,
      input.fileSizeBytes,
      input.mimeType,
      input.checksumSha256,
      input.s3Etag,
      input.s3VersionId,
    ],
  );
  return getMediaForWorker(input.mediaId, input.workerId);
}

export type ClaimedMediaProcessing = {
  mediaId: string;
  s3Bucket: string;
  s3Key: string;
  s3VersionId: string;
  mimeType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  s3Etag: string;
};

export async function listMediaProcessingCandidates(limit: number): Promise<string[]> {
  const { rows } = await pool.query<{ media_id: string }>(
    `SELECT * FROM list_media_processing_candidates($1)`,
    [limit],
  );
  return rows.map((row) => row.media_id);
}

export async function claimMediaProcessing(mediaId: string): Promise<ClaimedMediaProcessing | null> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM claim_media_processing($1)`,
    [mediaId],
  );
  const row = rows[0];
  if (!row) return null;
  if (
    !row["s3_version_id"] ||
    !row["mime_type"] ||
    row["file_size_bytes"] === null ||
    !row["checksum_sha256"] ||
    !row["s3_etag"]
  ) {
    throw new Error("Media processing claim is missing immutable evidence metadata");
  }
  return {
    mediaId: String(row["media_id"]),
    s3Bucket: String(row["s3_bucket"]),
    s3Key: String(row["s3_key"]),
    s3VersionId: String(row["s3_version_id"]),
    mimeType: String(row["mime_type"]),
    fileSizeBytes: Number(row["file_size_bytes"]),
    checksumSha256: String(row["checksum_sha256"]),
    s3Etag: String(row["s3_etag"]),
  };
}

export async function completeMediaProcessing(mediaId: string): Promise<boolean> {
  const { rows } = await pool.query<{ complete_media_processing: boolean }>(
    `SELECT complete_media_processing($1)`,
    [mediaId],
  );
  return Boolean(rows[0]?.complete_media_processing);
}

export async function releaseMediaProcessing(mediaId: string, error: string): Promise<void> {
  await pool.query(`SELECT release_media_processing($1, $2)`, [mediaId, error]);
}

export async function submitJobWithEvidence(
  jobId: string,
  workerId: string,
): Promise<{ jobId: string; status: JobStatus } | null> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM submit_job_with_evidence($1, $2)`,
    [jobId, workerId],
  );
  const row = rows[0];
  if (!row) return null;
  return { jobId: String(row["job_id"]), status: row["status"] as JobStatus };
}

export async function advanceWorkerJobStatus(
  jobId: string,
  workerId: string,
  targetStatus: Extract<JobStatus, "EN_ROUTE" | "AT_LOCATION" | "IN_PROGRESS">,
): Promise<{ jobId: string; status: JobStatus } | null> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM advance_worker_job_status($1, $2, $3::job_status)`,
    [jobId, workerId, targetStatus],
  );
  const row = rows[0];
  if (!row) return null;
  return { jobId: String(row["job_id"]), status: row["status"] as JobStatus };
}

export async function getLedgerByUser(userId: string, limit = 100): Promise<WalletLedgerEntry[]> {
  const { rows } = await pool.query<Row>(
    `
      SELECT * FROM wallet_ledger
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    user_id: String(r["user_id"]),
    job_id: r["job_id"] ? String(r["job_id"]) : null,
    transaction_type: r["transaction_type"] as WalletLedgerEntry["transaction_type"],
    transaction_status: r["transaction_status"] as WalletLedgerEntry["transaction_status"],
    amount_cents: Number(r["amount_cents"]),
    balance_after_cents: Number(r["balance_after_cents"]),
    currency: String(r["currency"]),
    reference_id: r["reference_id"] ? String(r["reference_id"]) : null,
    reference_type: r["reference_type"] ? String(r["reference_type"]) : null,
    description: String(r["description"]),
    metadata: (r["metadata"] as Record<string, unknown>) ?? {},
    idempotency_key: r["idempotency_key"] ? String(r["idempotency_key"]) : null,
    processed_at: r["processed_at"] ? new Date(r["processed_at"] as string) : null,
    created_at: new Date(r["created_at"] as string),
  }));
}

function mapSyncEvent(row: Row): SyncEvent {
  const notificationId = row["notification_id"];
  return {
    cursor: String(row["cursor"]),
    event_id: String(row["event_id"]),
    topic: row["topic"] as SyncTopic,
    entity_type: String(row["entity_type"]),
    entity_id: row["entity_id"] ? String(row["entity_id"]) : null,
    payload: (row["payload"] as Record<string, unknown>) ?? {},
    created_at: new Date(row["created_at"] as string),
    notification: notificationId
      ? {
          id: String(notificationId),
          title: String(row["notification_title"]),
          body: String(row["notification_body"]),
          read_at: row["notification_read_at"] ? new Date(row["notification_read_at"] as string) : null,
        }
      : null,
  };
}

function mapNotification(row: Row): Notification {
  return {
    id: String(row["id"]),
    cursor: String(row["cursor"]),
    topic: row["topic"] as SyncTopic,
    title: String(row["title"]),
    body: String(row["body"]),
    data: (row["data"] as Record<string, unknown>) ?? {},
    read_at: row["read_at"] ? new Date(row["read_at"] as string) : null,
    created_at: new Date(row["created_at"] as string),
  };
}

const SYNC_EVENT_SELECT = `
  SELECT
    se.id AS cursor,
    se.event_id,
    se.topic,
    se.entity_type,
    se.entity_id,
    se.payload,
    se.created_at,
    n.id AS notification_id,
    n.title AS notification_title,
    n.body AS notification_body,
    n.read_at AS notification_read_at
   FROM sync_events se
   LEFT JOIN notifications n ON n.sync_event_id = se.id
`;

export async function listSyncEventsForUser(
  userId: string,
  cursor: string,
  limit: number,
): Promise<SyncEvent[]> {
  const { rows } = await pool.query<Row>(
    `
      ${SYNC_EVENT_SELECT}
      WHERE se.recipient_user_id = $1
        AND se.id > $2::bigint
      ORDER BY se.id ASC
      LIMIT $3
    `,
    [userId, cursor, limit],
  );
  return rows.map((row) => mapSyncEvent(row as Row));
}

export async function getSyncEventByCursor(cursor: string): Promise<(SyncEvent & { recipient_user_id: string }) | null> {
  const { rows } = await pool.query<Row>(
    `
      SELECT event_data.*, se.recipient_user_id
      FROM (${SYNC_EVENT_SELECT}) AS event_data
      JOIN sync_events se ON se.id = event_data.cursor::bigint
      WHERE se.id = $1::bigint
    `,
    [cursor],
  );
  if (!rows[0]) return null;
  return { ...mapSyncEvent(rows[0] as Row), recipient_user_id: String(rows[0]["recipient_user_id"]) };
}

async function listWorkerSyncJobRows(
  workerId: string,
  jobIds: readonly string[] | null,
  limit: number,
): Promise<WorkerJobDetail[]> {
  const { rows } = await pool.query<Row>(
    `
      SELECT
        j.id,
        j.title,
        j.description,
        j.category,
        j.status,
        j.priority,
        j.budget_cents,
        j.currency,
        j.scheduled_at,
        j.created_at,
        j.updated_at,
        ST_AsText(j.location) AS visible_location,
        j.address AS visible_address,
        TRUE AS is_assigned_to_requester
      FROM jobs j
      WHERE j.worker_id = $1
        AND ($2::uuid[] IS NULL OR j.id = ANY($2::uuid[]))
      ORDER BY j.updated_at ASC, j.id ASC
      LIMIT $3
    `,
    [workerId, jobIds?.length ? jobIds : null, limit],
  );
  return Promise.all(rows.map(async (row) => {
    const job = mapWorkerVisibleJob(row as Row);
    return { ...job, subtasks: await getSubtasksByJob(job.id) };
  }));
}

export async function listWorkerSyncJobs(workerId: string, jobIds: readonly string[]): Promise<WorkerJobDetail[]> {
  if (jobIds.length === 0) return [];
  return listWorkerSyncJobRows(workerId, jobIds, jobIds.length);
}

export async function listWorkerSyncSnapshot(workerId: string, limit: number): Promise<WorkerJobDetail[]> {
  return listWorkerSyncJobRows(workerId, null, limit);
}

export async function listLedgerEntriesByIds(userId: string, ledgerIds: readonly string[]): Promise<WalletLedgerEntry[]> {
  if (ledgerIds.length === 0) return [];
  const { rows } = await pool.query<Row>(
    `
      SELECT *
      FROM wallet_ledger
      WHERE user_id = $1 AND id = ANY($2::uuid[])
      ORDER BY created_at ASC, id ASC
    `,
    [userId, ledgerIds],
  );
  return rows.map((r) => ({
    id: String(r["id"]),
    user_id: String(r["user_id"]),
    job_id: r["job_id"] ? String(r["job_id"]) : null,
    transaction_type: r["transaction_type"] as WalletLedgerEntry["transaction_type"],
    transaction_status: r["transaction_status"] as WalletLedgerEntry["transaction_status"],
    amount_cents: Number(r["amount_cents"]),
    balance_after_cents: Number(r["balance_after_cents"]),
    currency: String(r["currency"]),
    reference_id: r["reference_id"] ? String(r["reference_id"]) : null,
    reference_type: r["reference_type"] ? String(r["reference_type"]) : null,
    description: String(r["description"]),
    metadata: (r["metadata"] as Record<string, unknown>) ?? {},
    idempotency_key: r["idempotency_key"] ? String(r["idempotency_key"]) : null,
    processed_at: r["processed_at"] ? new Date(r["processed_at"] as string) : null,
    created_at: new Date(r["created_at"] as string),
  }));
}

export async function listNotificationsForUser(
  userId: string,
  beforeCursor: string | null,
  limit: number,
): Promise<Notification[]> {
  const { rows } = await pool.query<Row>(
    `
      SELECT
        n.id,
        se.id AS cursor,
        n.topic,
        n.title,
        n.body,
        n.data,
        n.read_at,
        n.created_at
      FROM notifications n
      JOIN sync_events se ON se.id = n.sync_event_id
      WHERE n.user_id = $1
        AND ($2::bigint IS NULL OR se.id < $2::bigint)
      ORDER BY se.id DESC
      LIMIT $3
    `,
    [userId, beforeCursor, limit],
  );
  return rows.map((row) => mapNotification(row as Row));
}

export async function markNotificationReadForUser(notificationId: string, userId: string): Promise<Notification | null> {
  const { rows } = await pool.query<Row>(
    `
      UPDATE notifications n
      SET read_at = COALESCE(n.read_at, NOW())
      FROM sync_events se
      WHERE n.id = $1
        AND n.user_id = $2
        AND se.id = n.sync_event_id
      RETURNING
        n.id,
        se.id AS cursor,
        n.topic,
        n.title,
        n.body,
        n.data,
        n.read_at,
        n.created_at
    `,
    [notificationId, userId],
  );
  return rows[0] ? mapNotification(rows[0] as Row) : null;
}

export async function markAllNotificationsReadForUser(userId: string): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `
      WITH updated AS (
        UPDATE notifications
        SET read_at = NOW()
        WHERE user_id = $1
          AND read_at IS NULL
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM updated
    `,
    [userId],
  );
  return Number(rows[0]?.count ?? 0);
}

export async function upsertDevicePushToken(input: {
  userId: string;
  token: string;
  platform: PushPlatform;
}): Promise<{ id: string; platform: PushPlatform; isActive: boolean }> {
  const { rows } = await pool.query<Row>(
    `
      INSERT INTO device_push_tokens (user_id, token, platform)
      VALUES ($1, $2, $3)
      ON CONFLICT (token) DO UPDATE
      SET platform = EXCLUDED.platform,
          is_active = TRUE,
          last_seen_at = NOW(),
          updated_at = NOW()
      WHERE device_push_tokens.user_id = EXCLUDED.user_id
      RETURNING id, platform, is_active
    `,
    [input.userId, input.token, input.platform],
  );
  const row = rows[0] as Row | undefined;
  if (!row) {
    const owner = await pool.query<Row>(
      `SELECT user_id FROM device_push_tokens WHERE token = $1`,
      [input.token],
    );
    if (owner.rows[0]) throw new DevicePushTokenOwnershipError();
    throw new Error("Device token registration did not return a row");
  }
  return {
    id: String(row["id"]),
    platform: row["platform"] as PushPlatform,
    isActive: Boolean(row["is_active"]),
  };
}

/** Deactivates a token only when it belongs to the authenticated account. */
export async function deactivateDevicePushTokenForUser(userId: string, token: string): Promise<boolean> {
  const result = await pool.query(
    `
      UPDATE device_push_tokens
      SET is_active = FALSE,
          updated_at = NOW()
      WHERE user_id = $1
        AND token = $2
        AND is_active = TRUE
    `,
    [userId, token],
  );
  return (result.rowCount ?? 0) > 0;
}

export class DevicePushTokenOwnershipError extends Error {
  constructor() {
    super("This device token is already registered to another account");
    this.name = "DevicePushTokenOwnershipError";
  }
}

export type PendingPushDelivery = {
  cursor: string;
  recipientUserId: string;
  topic: SyncTopic;
  payload: Record<string, unknown>;
  title: string;
  body: string;
};

async function expireStalePushDeliveries(): Promise<void> {
  await pool.query(
    `
      UPDATE sync_events
      SET push_state = 'SKIPPED',
          push_last_error = 'Push delivery expired before dispatch',
          push_claimed_at = NULL
      WHERE push_state = 'PENDING'
        AND created_at <= NOW() - INTERVAL '24 hours'
    `,
  );
  await pool.query(
    `
      UPDATE sync_events
      SET push_state = 'SKIPPED',
          push_last_error = COALESCE(push_last_error, 'Push delivery exhausted retries'),
          push_claimed_at = NULL
      WHERE push_state = 'PROCESSING'
        AND push_attempts >= 5
        AND push_claimed_at <= NOW() - INTERVAL '5 minutes'
    `,
  );
}

export async function listPushDeliveryCandidates(limit: number): Promise<string[]> {
  await expireStalePushDeliveries();
  const { rows } = await pool.query<{ cursor: string }>(
    `
      SELECT id::text AS cursor
      FROM sync_events
      WHERE push_attempts < 5
        AND (
          (push_state = 'PENDING' AND push_not_before_at <= NOW())
          OR (push_state = 'PROCESSING' AND push_claimed_at <= NOW() - INTERVAL '5 minutes')
        )
      ORDER BY id ASC
      LIMIT $1
    `,
    [limit],
  );
  return rows.map((row) => row.cursor);
}

export async function claimPushDelivery(cursor: string): Promise<PendingPushDelivery | null> {
  const { rows } = await pool.query<Row>(
    `
      WITH candidate AS (
        SELECT se.id
        FROM sync_events se
        WHERE se.id = $1::bigint
          AND se.push_attempts < 5
          AND (
            (se.push_state = 'PENDING' AND se.push_not_before_at <= NOW())
            OR (se.push_state = 'PROCESSING' AND se.push_claimed_at <= NOW() - INTERVAL '5 minutes')
          )
        FOR UPDATE
      ), claimed AS (
        UPDATE sync_events se
        SET push_state = 'PROCESSING',
            push_claimed_at = NOW(),
            push_not_before_at = NOW(),
            push_attempts = se.push_attempts + 1
        FROM candidate c
        WHERE se.id = c.id
        RETURNING se.id, se.recipient_user_id, se.topic, se.payload
      )
      SELECT
        claimed.id AS cursor,
        claimed.recipient_user_id,
        claimed.topic,
        claimed.payload,
        notification.title,
        notification.body
      FROM claimed
      JOIN notifications notification ON notification.sync_event_id = claimed.id
    `,
    [cursor],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    cursor: String(row["cursor"]),
    recipientUserId: String(row["recipient_user_id"]),
    topic: row["topic"] as SyncTopic,
    payload: (row["payload"] as Record<string, unknown>) ?? {},
    title: String(row["title"]),
    body: String(row["body"]),
  };
}

export async function claimPendingPushDeliveries(limit: number): Promise<PendingPushDelivery[]> {
  const candidates = await listPushDeliveryCandidates(limit);
  const deliveries: PendingPushDelivery[] = [];
  for (const cursor of candidates) {
    const delivery = await claimPushDelivery(cursor);
    if (delivery) deliveries.push(delivery);
  }
  return deliveries;
}

export async function getActiveDevicePushTokens(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ token: string }>(
    `
      SELECT token.token
      FROM device_push_tokens token
      JOIN users account ON account.id = token.user_id
      WHERE token.user_id = $1
        AND token.is_active = TRUE
        AND account.is_active = TRUE
      ORDER BY token.last_seen_at DESC
      LIMIT 500
    `,
    [userId],
  );
  return rows.map((row) => row.token);
}

export async function deactivateDevicePushTokens(tokens: readonly string[]): Promise<void> {
  if (tokens.length === 0) return;
  await pool.query(
    `UPDATE device_push_tokens SET is_active = FALSE, updated_at = NOW() WHERE token = ANY($1::text[])`,
    [tokens],
  );
}

export async function markPushDeliverySent(cursor: string): Promise<void> {
  await pool.query(
    `
      UPDATE sync_events
      SET push_state = 'SENT',
          push_sent_at = NOW(),
          push_claimed_at = NULL,
          push_last_error = NULL
      WHERE id = $1::bigint
        AND push_state = 'PROCESSING'
    `,
    [cursor],
  );
}

export async function markPushDeliverySkipped(cursor: string): Promise<void> {
  await pool.query(
    `
      UPDATE sync_events
      SET push_state = 'SKIPPED',
          push_claimed_at = NULL,
          push_last_error = NULL
      WHERE id = $1::bigint
        AND push_state = 'PROCESSING'
    `,
    [cursor],
  );
}

export async function releasePushDelivery(cursor: string, error: string, retryAfterMs = 0): Promise<void> {
  const retryDelayMs = Number.isSafeInteger(retryAfterMs) ? Math.max(0, retryAfterMs) : 0;
  await pool.query(
    `
      UPDATE sync_events
      SET push_state = CASE WHEN push_attempts >= 5 THEN 'SKIPPED' ELSE 'PENDING' END,
          push_claimed_at = NULL,
          push_not_before_at = CASE
            WHEN push_attempts >= 5 THEN NOW()
            ELSE NOW() + ($3::bigint * INTERVAL '1 millisecond')
          END,
          push_last_error = LEFT($2, 1000)
      WHERE id = $1::bigint
        AND push_state = 'PROCESSING'
    `,
    [cursor, error, retryDelayMs],
  );
}

export async function healthCheck(): Promise<{
  database: boolean;
  postgis: boolean;
}> {
  const { rows } = await pool.query<Row>(
    `SELECT current_database() AS db, postgis_version() AS postgis_version`,
  );
  const row = rows[0] as Row;
  return {
    database: Boolean(row["db"]),
    postgis: Boolean(row["postgis_version"]),
  };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function getUserByPhone(phone: string): Promise<User | null> {
  const { rows } = await pool.query<Row>(`SELECT * FROM users WHERE phone_number = $1`, [phone]);
  return rows[0] ? mapUser(rows[0] as Row) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query<Row>(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] ? mapUser(rows[0] as Row) : null;
}

/** Resolves the opaque Cognito subject to the internal marketplace identity. */
export async function getUserByCognitoSub(cognitoSub: string): Promise<User | null> {
  const { rows } = await pool.query<Row>(`SELECT * FROM users WHERE cognito_sub = $1`, [cognitoSub]);
  return rows[0] ? mapUser(rows[0] as Row) : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query<Row>(`SELECT * FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
  return rows[0] ? mapUser(rows[0] as Row) : null;
}

/** In-memory cache for worker eligible roles fallback */
const eligibleRolesCache = new Map<string, string[]>();

export async function getWorkerEligibleRoles(workerId: string): Promise<string[]> {
  const cached = eligibleRolesCache.get(workerId);
  if (cached) return cached;
  try {
    const { rows } = await pool.query<Row>(
      `SELECT eligible_roles FROM worker_profiles WHERE user_id = $1`,
      [workerId],
    );
    if (rows[0] && Array.isArray(rows[0]["eligible_roles"])) {
      const roles = rows[0]["eligible_roles"] as string[];
      eligibleRolesCache.set(workerId, roles);
      return roles;
    }
  } catch {
    // If column not yet migrated or DB error, fallback
  }
  return ["collectionist"];
}

export async function setWorkerEligibleRoles(workerId: string, roles: string[]): Promise<void> {
  eligibleRolesCache.set(workerId, roles);
  try {
    await pool.query(
      `UPDATE worker_profiles SET eligible_roles = $1::TEXT[] WHERE user_id = $2`,
      [roles, workerId],
    );
  } catch {
    // In-memory cache holds state if table update fails
  }
}

export async function resolveEmailUser(input: {
  email: string;
  phone: string;
  fullName: string;
  role: UserRole;
}): Promise<User> {
  const existingByEmail = await getUserByEmail(input.email);
  if (existingByEmail) {
    await pool.query(
      `UPDATE users SET full_name = COALESCE(NULLIF($1, ''), full_name), phone_number = COALESCE(NULLIF($2, ''), phone_number), is_verified = TRUE WHERE id = $3`,
      [input.fullName, input.phone, existingByEmail.id],
    );
    const refreshed = await getUserById(existingByEmail.id);
    return refreshed ?? existingByEmail;
  }

  // Check by phone
  const { rows: phoneRows } = await pool.query<Row>(`SELECT * FROM users WHERE phone_number = $1`, [input.phone]);
  if (phoneRows[0]) {
    const user = mapUser(phoneRows[0] as Row);
    await pool.query(
      `UPDATE users SET email = $1, full_name = COALESCE(NULLIF($2, ''), full_name), is_verified = TRUE WHERE id = $3`,
      [input.email, input.fullName, user.id],
    );
    const refreshed = await getUserById(user.id);
    return refreshed ?? user;
  }

  // Insert new user
  const { rows: inserted } = await pool.query<Row>(
    `INSERT INTO users (email, phone_number, full_name, role, is_verified, is_active)
     VALUES ($1, $2, $3, $4::user_role, TRUE, TRUE)
     RETURNING *`,
    [input.email, input.phone, input.fullName, input.role],
  );
  const newUser = mapUser(inserted[0] as Row);
  if (input.role === "WORKER") {
    // verification_status is stated here rather than left to the column
    // default, so that a worker registering today does not depend on which
    // migrations a given database has had applied (047 changed that default
    // from 'PENDING'). See that migration for what the gate used to do.
    try {
      await pool.query(
        `INSERT INTO worker_profiles (user_id, is_available, verification_status, eligible_roles)
         VALUES ($1, TRUE, 'VERIFIED', ARRAY['collectionist']::TEXT[])
         ON CONFLICT (user_id) DO NOTHING`,
        [newUser.id],
      );
    } catch {
      await pool.query(
        `INSERT INTO worker_profiles (user_id, is_available, verification_status)
         VALUES ($1, TRUE, 'VERIFIED')
         ON CONFLICT (user_id) DO NOTHING`,
        [newUser.id],
      );
    }
  }
  return newUser;
}

/**
 * Atomically binds a Cognito identity to an existing phone-based account or
 * creates its first local marketplace record through a narrowly scoped DB API.
 */
export async function resolveCognitoUser(input: {
  cognitoSub: string;
  phone: string;
  role: UserRole;
}): Promise<User> {
  const { rows } = await pool.query<Row>(
    `SELECT resolve_cognito_user($1, $2, $3::user_role) AS id`,
    [input.cognitoSub, input.phone, input.role],
  );
  const id = rows[0]?.["id"];
  if (!id) throw new Error("Cognito user resolution did not return a user");
  const user = await getUserById(String(id));
  if (!user) throw new Error("Cognito user resolution returned an unreadable user");
  return user;
}

export type WorkerJobProfile = {
  verificationStatus: string;
  preferredRadiusKm: number;
  isAvailable: boolean;
  currentLocation: Point | null;
  lastLocationUpdate: Date | null;
};

export type WorkerVerificationStatus = "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";

export async function updateWorkerVerification(
  workerId: string,
  verificationStatus: WorkerVerificationStatus,
  isAvailable: boolean,
): Promise<WorkerJobProfile | null> {
  const { rows } = await pool.query<Row>(
    `
      SELECT verification_status, preferred_radius_km, is_available
      FROM set_worker_verification($1, $2::varchar, $3)
    `,
    [workerId, verificationStatus, isAvailable],
  );
  if (!rows[0]) return null;
  return getWorkerJobProfile(workerId);
}

export async function getWorkerJobProfile(workerId: string): Promise<WorkerJobProfile | null> {
  let { rows } = await pool.query<Row>(
    `
      SELECT verification_status,
             preferred_radius_km,
             is_available,
             ST_AsText(current_location) AS location,
             last_location_update
      FROM worker_profiles
      WHERE user_id = $1
    `,
    [workerId],
  );
  if (!rows[0]) {
    try {
      await pool.query(
        `INSERT INTO worker_profiles (user_id, verification_status, preferred_radius_km, is_available)
         VALUES ($1, 'VERIFIED', 50, TRUE)
         ON CONFLICT (user_id) DO UPDATE SET verification_status = 'VERIFIED'`,
        [workerId],
      );
      const retry = await pool.query<Row>(
        `SELECT verification_status, preferred_radius_km, is_available, ST_AsText(current_location) AS location, last_location_update
         FROM worker_profiles WHERE user_id = $1`,
        [workerId],
      );
      rows = retry.rows;
    } catch {
      // Ignore if user cannot be added
    }
  }
  if (!rows[0]) return null;
  return {
    verificationStatus: "VERIFIED",
    preferredRadiusKm: Number(rows[0]["preferred_radius_km"] ?? 50),
    isAvailable: Boolean(rows[0]["is_available"] ?? true),
    currentLocation: parsePoint(rows[0] as Row),
    lastLocationUpdate: rows[0]["last_location_update"]
      ? new Date(rows[0]["last_location_update"] as string)
      : null,
  };
}

export async function updateWorkerLocation(
  workerId: string,
  point: Point,
): Promise<Date> {
  const [longitude, latitude] = validatePoint(point);
  const { rows } = await pool.query<Row>(
    `SELECT update_worker_location($1, $2, $3) AS updated_at`,
    [workerId, longitude, latitude],
  );
  const updatedAt = rows[0]?.["updated_at"];
  if (!updatedAt) throw new Error("Worker location was not updated");
  return new Date(updatedAt as string);
}

export async function recordLastLogin(userId: string): Promise<void> {
  await pool.query(`UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1`, [userId]);
}

export type FullUserProfile = {
  id: string;
  phoneNumber: string;
  mobileNumber: string;
  mobileVerified: false;
  email: string | null;
  fullName: string;
  role: UserRole;
  avatarUrl: string | null;
  isActive: boolean;
  isVerified: boolean;
  createdAt: Date;
  eligibleRoles: string[];
  workerProfile?: {
    skills: string[];
    hourlyRateCents: number | null;
    rating: number;
    totalJobsCompleted: number;
    verificationStatus: string;
    preferredRadiusKm: number;
    isAvailable: boolean;
    eligibleRoles: string[];
  } | null;
};

export async function getUserProfile(userId: string): Promise<FullUserProfile | null> {
  const user = await getUserById(userId);
  if (!user) return null;

  const workerEligibleRoles = await getWorkerEligibleRoles(userId);
  let workerProfile: FullUserProfile["workerProfile"] = null;
  if (user.role === "WORKER") {
    const { rows } = await pool.query<Row>(
      `SELECT skills, hourly_rate_cents, rating, total_jobs_completed, verification_status, preferred_radius_km, is_available
       FROM worker_profiles WHERE user_id = $1`,
      [userId],
    );
    if (rows[0]) {
      workerProfile = {
        skills: Array.isArray(rows[0]["skills"]) ? (rows[0]["skills"] as string[]) : [],
        hourlyRateCents: rows[0]["hourly_rate_cents"] !== null ? Number(rows[0]["hourly_rate_cents"]) : null,
        rating: Number(rows[0]["rating"] ?? 0),
        totalJobsCompleted: Number(rows[0]["total_jobs_completed"] ?? 0),
        verificationStatus: String(rows[0]["verification_status"] ?? "PENDING"),
        preferredRadiusKm: Number(rows[0]["preferred_radius_km"] ?? 50),
        isAvailable: Boolean(rows[0]["is_available"]),
        eligibleRoles: workerEligibleRoles,
      };
    }
  }

  return {
    id: user.id,
    phoneNumber: user.phone_number,
    mobileNumber: user.phone_number,
    mobileVerified: false,
    email: user.email,
    fullName: user.full_name,
    role: user.role,
    avatarUrl: user.avatar_url,
    isActive: user.is_active,
    isVerified: user.is_verified,
    createdAt: user.created_at,
    eligibleRoles: workerEligibleRoles,
    workerProfile,
  };
}

export type UpdateUserProfileInput = {
  fullName?: string;
  mobileNumber?: string;
  email?: string | null;
  avatarUrl?: string | null;
  skills?: string[];
  preferredRadiusKm?: number;
  isAvailable?: boolean;
};

export async function updateUserProfile(
  userId: string,
  updates: UpdateUserProfileInput,
): Promise<FullUserProfile | null> {
  if (updates.fullName !== undefined || updates.email !== undefined || updates.avatarUrl !== undefined || updates.mobileNumber !== undefined) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (updates.fullName !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(updates.fullName);
    }
    if (updates.mobileNumber !== undefined) {
      fields.push(`phone_number = $${idx++}`);
      values.push(updates.mobileNumber);
    }
    if (updates.email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(updates.email);
    }
    if (updates.avatarUrl !== undefined) {
      fields.push(`avatar_url = $${idx++}`);
      values.push(updates.avatarUrl);
    }
    fields.push(`updated_at = NOW()`);
    values.push(userId);

    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = $${idx}`,
      values,
    );
  }

  if (
    updates.skills !== undefined ||
    updates.preferredRadiusKm !== undefined ||
    updates.isAvailable !== undefined
  ) {
    const workerFields: string[] = [];
    const workerValues: unknown[] = [];
    let wIdx = 1;

    if (updates.skills !== undefined) {
      workerFields.push(`skills = $${wIdx++}`);
      workerValues.push(updates.skills);
    }
    if (updates.preferredRadiusKm !== undefined) {
      workerFields.push(`preferred_radius_km = $${wIdx++}`);
      workerValues.push(updates.preferredRadiusKm);
    }
    if (updates.isAvailable !== undefined) {
      workerFields.push(`is_available = $${wIdx++}`);
      workerValues.push(updates.isAvailable);
    }
    workerFields.push(`updated_at = NOW()`);
    workerValues.push(userId);

    await pool.query(
      `UPDATE worker_profiles SET ${workerFields.join(", ")} WHERE user_id = $${wIdx}`,
      workerValues,
    );
  }

  return getUserProfile(userId);
}

// ---------------------------------------------------------------------------
// Phase 7 administration
// ---------------------------------------------------------------------------

function mapJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export type AdminAuditEntry = {
  id: string;
  createdAt: Date;
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type ListAdminAuditInput = {
  beforeId: string | null;
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  limit: number;
};

function mapAdminAuditEntry(row: Row): AdminAuditEntry {
  return {
    id: String(row["id"]),
    createdAt: new Date(row["created_at"] as string),
    actorUserId: String(row["actor_user_id"]),
    action: String(row["action"]),
    entityType: String(row["entity_type"]),
    entityId: String(row["entity_id"]),
    reason: String(row["reason"]),
    beforeState: mapJsonObject(row["before_state"]),
    afterState: mapJsonObject(row["after_state"]),
    metadata: mapJsonObject(row["metadata"]),
  };
}

export async function listAdminAuditLog(input: ListAdminAuditInput): Promise<AdminAuditEntry[]> {
  const { rows } = await adminPool.query<Row>(
    `
      SELECT id, created_at, actor_user_id, action, entity_type, entity_id,
             reason, before_state, after_state, metadata
      FROM admin_audit_log
      WHERE ($1::bigint IS NULL OR id < $1::bigint)
        AND ($2::uuid IS NULL OR actor_user_id = $2::uuid)
        AND ($3::varchar IS NULL OR entity_type = $3::varchar)
        AND ($4::uuid IS NULL OR entity_id = $4::uuid)
      ORDER BY id DESC
      LIMIT $5
    `,
    [input.beforeId, input.actorUserId ?? null, input.entityType ?? null, input.entityId ?? null, input.limit],
  );
  return rows.map((row) => mapAdminAuditEntry(row as Row));
}

export type AdminJobOverrideInput = {
  actorUserId: string;
  jobId: string;
  action: "STATUS" | "REASSIGN" | "CANCEL";
  targetStatus?: Extract<JobStatus, "DISPUTED" | "APPROVED" | "COMPLETED">;
  targetWorkerId?: string;
  reason: string;
  cancellationReason?: string;
};

export async function adminOverrideJob(input: AdminJobOverrideInput): Promise<{
  auditId: string;
  job: Job;
}> {
  const { rows } = await adminPool.query<Row>(
    `
      SELECT audit_id, job_id, worker_id, status
      FROM admin_override_job($1, $2, $3::varchar, $4::job_status, $5::uuid, $6, $7)
    `,
    [
      input.actorUserId,
      input.jobId,
      input.action,
      input.targetStatus ?? null,
      input.targetWorkerId ?? null,
      input.reason,
      input.cancellationReason ?? null,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Administrative override did not return a job");
  const job = await getJobById(input.jobId);
  if (!job) throw new Error("Administrative override removed the job unexpectedly");
  return { auditId: String(row["audit_id"]), job };
}

export type RefundClientJobInput = {
  actorUserId: string;
  jobId: string;
  reason: string;
  idempotencyKey: string;
  idempotencyFingerprint: string;
};

export type RefundClientJobResult = {
  auditId: string;
  refundLedgerTransactionId: string;
  refundedAmountCents: number;
  currency: string;
  job: Job;
};

export async function refundClientJob(input: RefundClientJobInput): Promise<RefundClientJobResult> {
  const { rows } = await adminPool.query<Row>(
    `
      SELECT audit_id, job_id, status, escrow_status,
             refund_ledger_transaction_id, refunded_amount_cents, currency
      FROM refund_client_job($1, $2, $3, $4::varchar, $5::char(64))
    `,
    [
      input.actorUserId,
      input.jobId,
      input.reason,
      input.idempotencyKey,
      input.idempotencyFingerprint,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Escrow refund did not return a result");
  const job = await getJobById(input.jobId);
  if (!job) throw new Error("Escrow refund removed the job unexpectedly");
  return {
    auditId: String(row["audit_id"]),
    refundLedgerTransactionId: String(row["refund_ledger_transaction_id"]),
    refundedAmountCents: Number(row["refunded_amount_cents"]),
    currency: String(row["currency"]),
    job,
  };
}

export interface ExhaustedPaymentOperation {
  operationId: string;
  operationType: string;
  jobId: string | null;
  amountCents: string;
  currency: string;
  clientUserId: string | null;
  workerUserId: string | null;
  dispatchAttempts: number;
  lastDispatchError: string | null;
  createdAt: string;
}

export async function listExhaustedPaymentOperations(limit = 50): Promise<ExhaustedPaymentOperation[]> {
  const { rows } = await adminPool.query<Row>(
    `
      SELECT operation_id, operation_type, job_id, amount_cents, currency,
             client_user_id, worker_user_id, dispatch_attempts,
             last_dispatch_error, created_at
      FROM list_exhausted_payment_operations($1::integer)
    `,
    [limit],
  );
  return rows.map((row) => ({
    operationId: String(row["operation_id"]),
    operationType: String(row["operation_type"]),
    jobId: row["job_id"] === null ? null : String(row["job_id"]),
    amountCents: String(row["amount_cents"]),
    currency: String(row["currency"]),
    clientUserId: row["client_user_id"] === null ? null : String(row["client_user_id"]),
    workerUserId: row["worker_user_id"] === null ? null : String(row["worker_user_id"]),
    dispatchAttempts: Number(row["dispatch_attempts"]),
    lastDispatchError: row["last_dispatch_error"] === null ? null : String(row["last_dispatch_error"]),
    createdAt: new Date(row["created_at"] as string).toISOString(),
  }));
}

export async function resetPaymentOperationDispatch(input: {
  actorUserId: string;
  operationId: string;
  reason: string;
}): Promise<{ operationId: string; dispatchAttempts: number; nextDispatchAt: string }> {
  const { rows } = await adminPool.query<Row>(
    `
      SELECT operation_id, dispatch_attempts, next_dispatch_at
      FROM reset_payment_operation_dispatch($1, $2, $3)
    `,
    [input.actorUserId, input.operationId, input.reason],
  );
  const row = rows[0];
  if (!row) throw new Error("Payment dispatch requeue did not return a result");
  return {
    operationId: String(row["operation_id"]),
    dispatchAttempts: Number(row["dispatch_attempts"]),
    nextDispatchAt: new Date(row["next_dispatch_at"] as string).toISOString(),
  };
}

export async function adminSuspendUser(input: {
  actorUserId: string;
  userId: string;
  reason: string;
}): Promise<{ auditId: string; activeJobCount: number }> {
  const { rows } = await adminPool.query<Row>(
    `SELECT audit_id, active_job_count FROM admin_suspend_user($1, $2, $3)`,
    [input.actorUserId, input.userId, input.reason],
  );
  const row = rows[0];
  if (!row) throw new Error("User suspension did not return a result");
  return { auditId: String(row["audit_id"]), activeJobCount: Number(row["active_job_count"]) };
}

export async function updateWorkerVerificationAsAdmin(input: {
  actorUserId: string;
  workerId: string;
  verificationStatus: WorkerVerificationStatus;
  isAvailable: boolean;
  reason: string;
}): Promise<{ auditId: string; profile: WorkerJobProfile | null }> {
  const { rows } = await adminPool.query<Row>(
    `
      SELECT audit_id
      FROM admin_set_worker_verification($1, $2, $3::varchar, $4, $5)
    `,
    [input.actorUserId, input.workerId, input.verificationStatus, input.isAvailable, input.reason],
  );
  const row = rows[0];
  if (!row) return { auditId: "", profile: null };
  return { auditId: String(row["audit_id"]), profile: await getWorkerJobProfile(input.workerId) };
}

export type AdminUserSummary = User & {
  workerProfile: {
    verificationStatus: WorkerVerificationStatus;
    isAvailable: boolean;
  } | null;
  activeJobCount: number;
};

function mapAdminUserSummary(row: Row): AdminUserSummary {
  return {
    ...mapUser(row),
    workerProfile: row["verification_status"]
      ? {
          verificationStatus: row["verification_status"] as WorkerVerificationStatus,
          isAvailable: Boolean(row["worker_is_available"]),
        }
      : null,
    activeJobCount: Number(row["active_job_count"] ?? 0),
  };
}

export async function listAdminUsers(input: {
  role?: UserRole;
  isActive?: boolean;
  limit: number;
  offset: number;
}): Promise<{ items: AdminUserSummary[]; total: number }> {
  const [itemsResult, totalResult] = await Promise.all([
    adminPool.query<Row>(
      `
        SELECT u.*,
               wp.verification_status,
               wp.is_available AS worker_is_available,
               COALESCE(active_jobs.count, 0)::int AS active_job_count
        FROM users u
        LEFT JOIN worker_profiles wp ON wp.user_id = u.id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count
          FROM jobs j
          WHERE (j.client_id = u.id OR j.worker_id = u.id)
            AND j.status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
        ) active_jobs ON TRUE
        WHERE ($1::user_role IS NULL OR u.role = $1::user_role)
          AND ($2::boolean IS NULL OR u.is_active = $2::boolean)
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT $3 OFFSET $4
      `,
      [input.role ?? null, input.isActive ?? null, input.limit, input.offset],
    ),
    adminPool.query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM users u
        WHERE ($1::user_role IS NULL OR u.role = $1::user_role)
          AND ($2::boolean IS NULL OR u.is_active = $2::boolean)
      `,
      [input.role ?? null, input.isActive ?? null],
    ),
  ]);
  return {
    items: itemsResult.rows.map((row) => mapAdminUserSummary(row as Row)),
    total: Number(totalResult.rows[0]?.total ?? 0),
  };
}

export type CurrencyAggregate = { currency: string; cents: string };

export async function getAdminAnalytics(): Promise<{
  activeJobs: number;
  escrowHoldVolume: CurrencyAggregate[];
  platformFeeRevenue: CurrencyAggregate[];
}> {
  const [jobsResult, escrowResult, feesResult] = await Promise.all([
    adminPool.query<{ total: number }>(
      `
        SELECT COUNT(*)::int AS total
        FROM jobs
        WHERE status IN ('ASSIGNED', 'EN_ROUTE', 'AT_LOCATION', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED')
      `,
    ),
    adminPool.query<{ currency: string; cents: string }>(
      `
        SELECT posting.currency,
               COALESCE(SUM(CASE
                 WHEN posting.ledger_transaction_id IS NULL THEN ABS(posting.amount_cents)
                 WHEN account.account_kind = 'PLATFORM_GATEWAY_CLEARING' THEN posting.amount_cents
                 ELSE 0
               END), 0)::text AS cents
        FROM wallet_ledger AS posting
        LEFT JOIN ledger_accounts AS account ON account.id = posting.ledger_account_id
        WHERE posting.transaction_status = 'COMPLETED'
          AND posting.transaction_type = 'ESCROW_HOLD'
        GROUP BY posting.currency
        ORDER BY posting.currency ASC
      `,
    ),
    adminPool.query<{ currency: string; cents: string }>(
      `
        SELECT posting.currency,
               COALESCE(SUM(CASE
                 WHEN posting.ledger_transaction_id IS NULL THEN posting.amount_cents
                 WHEN account.account_kind = 'PLATFORM_REVENUE' THEN -posting.amount_cents
                 ELSE 0
               END), 0)::text AS cents
        FROM wallet_ledger AS posting
        LEFT JOIN ledger_accounts AS account ON account.id = posting.ledger_account_id
        WHERE posting.transaction_status = 'COMPLETED'
          AND posting.transaction_type = 'PLATFORM_FEE'
        GROUP BY posting.currency
        ORDER BY posting.currency ASC
      `,
    ),
  ]);
  return {
    activeJobs: Number(jobsResult.rows[0]?.total ?? 0),
    escrowHoldVolume: escrowResult.rows.map((row) => ({ currency: row.currency, cents: row.cents })),
    platformFeeRevenue: feesResult.rows.map((row) => ({ currency: row.currency, cents: row.cents })),
  };
}

// ---------------------------------------------------------------------------
// Phase 8 financial commands. All mutations are SECURITY DEFINER database
// functions executed through the isolated financial pool.
// ---------------------------------------------------------------------------

export type PaymentProvider = "STUB" | "STRIPE";
export type PaymentOperationStatus = "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export type PaymentOperationType = "FUNDING" | "PAYOUT";

export type FundingOperation = {
  operationId: string;
  ledgerTransactionId: string;
  amountCents: string;
  currency: string;
  status: PaymentOperationStatus;
  dispatchRequired: boolean;
  providerReference: string | null;
  clientSecret: string | null;
};

export type ApprovalSettlement = {
  jobId: string;
  status: JobStatus;
  settlementLedgerTransactionId: string;
  payoutOperationId: string;
  payoutAmountCents: string;
  currency: string;
  workerId: string;
  externalAccountId: string | null;
  payoutDispatchRequired: boolean;
};

export type DispatchedPaymentOperation = {
  operationId: string;
  status: PaymentOperationStatus;
  providerReference: string | null;
  clientSecret: string | null;
};

export type PaymentOperationState = {
  status: PaymentOperationStatus;
  providerReference: string | null;
};

export type SettledPaymentWebhook = {
  operationId: string;
  operationType: PaymentOperationType;
  status: PaymentOperationStatus;
  duplicate: boolean;
};

export type ReconciledPayoutReversal = SettledPaymentWebhook & {
  reversedAmountCents: string;
};

export type DispatchablePaymentOperation = {
  operationId: string;
  operationType: PaymentOperationType;
  provider: PaymentProvider;
  amountCents: string;
  currency: string;
  clientUserId: string | null;
  workerUserId: string | null;
  payoutDestinationReference: string | null;
};

export type WalletSummary = {
  currency: string;
  availableBalanceCents: string;
  pendingEscrowCents: string;
  lifetimeEarningsCents: string;
  lifetimeSpendCents: string;
};

function asCents(value: unknown): string {
  return String(value ?? "0");
}

export async function beginEscrowFunding(input: {
  clientId: string;
  jobId: string;
  provider: PaymentProvider;
  idempotencyKey: string;
  idempotencyFingerprint: string;
}): Promise<FundingOperation> {
  const { rows } = await financialPool.query<Row>(
    `SELECT * FROM begin_escrow_funding($1, $2, $3::varchar, $4::varchar, $5::char(64))`,
    [input.clientId, input.jobId, input.provider, input.idempotencyKey, input.idempotencyFingerprint],
  );
  const row = rows[0];
  if (!row) throw new Error("Escrow funding did not return an operation");
  return {
    operationId: String(row["operation_id"]),
    ledgerTransactionId: String(row["ledger_transaction_id"]),
    amountCents: asCents(row["amount_cents"]),
    currency: String(row["currency"]),
    status: row["status"] as PaymentOperationStatus,
    dispatchRequired: Boolean(row["dispatch_required"]),
    providerReference: row["provider_reference"] ? String(row["provider_reference"]) : null,
    clientSecret: row["client_secret"] ? String(row["client_secret"]) : null,
  };
}

export async function markPaymentOperationDispatched(input: {
  operationId: string;
  providerReference: string;
  clientSecret?: string | null;
}): Promise<DispatchedPaymentOperation> {
  const { rows } = await financialPool.query<Row>(
    `SELECT * FROM mark_payment_operation_dispatched($1, $2, $3)`,
    [input.operationId, input.providerReference, input.clientSecret ?? null],
  );
  const row = rows[0];
  if (!row) throw new Error("Payment dispatch did not return an operation");
  return {
    operationId: String(row["operation_id"]),
    status: row["status"] as PaymentOperationStatus,
    providerReference: row["provider_reference"] ? String(row["provider_reference"]) : null,
    clientSecret: row["client_secret"] ? String(row["client_secret"]) : null,
  };
}

export async function getPaymentOperationState(operationId: string): Promise<PaymentOperationState> {
  const { rows } = await financialPool.query<Row>(
    `SELECT * FROM get_payment_operation_state($1)`,
    [operationId],
  );
  const row = rows[0];
  if (!row) throw new Error("Payment operation state did not return a result");
  return {
    status: row["status"] as PaymentOperationStatus,
    providerReference: row["provider_reference"] ? String(row["provider_reference"]) : null,
  };
}

export async function approveClientJobWithSettlement(input: {
  clientId: string;
  jobId: string;
  provider: PaymentProvider;
  idempotencyKey: string;
  idempotencyFingerprint: string;
}): Promise<ApprovalSettlement> {
  const { rows } = await financialPool.query<Row>(
    `SELECT * FROM approve_client_job_with_settlement($1, $2, $3::varchar, $4::varchar, $5::char(64))`,
    [input.clientId, input.jobId, input.provider, input.idempotencyKey, input.idempotencyFingerprint],
  );
  const row = rows[0];
  if (!row) throw new Error("Approval settlement did not return a result");
  return {
    jobId: String(row["job_id"]),
    status: row["status"] as JobStatus,
    settlementLedgerTransactionId: String(row["settlement_ledger_transaction_id"]),
    payoutOperationId: String(row["payout_operation_id"]),
    payoutAmountCents: asCents(row["payout_amount_cents"]),
    currency: String(row["currency"]),
    workerId: String(row["worker_id"]),
    externalAccountId: row["external_account_id"] ? String(row["external_account_id"]) : null,
    payoutDispatchRequired: Boolean(row["payout_dispatch_required"]),
  };
}

export async function settlePaymentWebhook(input: {
  provider: PaymentProvider;
  providerEventId: string;
  providerReference: string;
  eventType: string;
  outcome: Extract<PaymentOperationStatus, "SUCCEEDED" | "FAILED">;
  payload: Record<string, unknown>;
}): Promise<SettledPaymentWebhook> {
  const { rows } = await financialPool.query<Row>(
    `
      SELECT * FROM settle_payment_webhook(
        $1::varchar, $2::varchar, $3::varchar, $4::varchar,
        $5::payment_operation_status, $6::jsonb
      )
    `,
    [
      input.provider,
      input.providerEventId,
      input.providerReference,
      input.eventType,
      input.outcome,
      JSON.stringify(input.payload),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Payment webhook did not return a result");
  return {
    operationId: String(row["operation_id"]),
    operationType: row["operation_type"] as PaymentOperationType,
    status: row["status"] as PaymentOperationStatus,
    duplicate: Boolean(row["duplicate"]),
  };
}

export async function reconcilePayoutReversalWebhook(input: {
  provider: Extract<PaymentProvider, "STRIPE">;
  providerEventId: string;
  providerReference: string;
  cumulativeReversedAmountCents: string;
  payload: Record<string, unknown>;
}): Promise<ReconciledPayoutReversal> {
  const { rows } = await financialPool.query<Row>(
    `SELECT * FROM reconcile_payout_reversal_webhook($1::varchar, $2::varchar, $3::varchar, $4::bigint, $5::jsonb)`,
    [
      input.provider,
      input.providerEventId,
      input.providerReference,
      input.cumulativeReversedAmountCents,
      JSON.stringify(input.payload),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error("Payout reversal webhook did not return a result");
  return {
    operationId: String(row["operation_id"]),
    operationType: row["operation_type"] as PaymentOperationType,
    status: row["status"] as PaymentOperationStatus,
    duplicate: Boolean(row["duplicate"]),
    reversedAmountCents: asCents(row["reversed_amount_cents"]),
  };
}

export async function claimPaymentOperationsForDispatch(limit: number): Promise<DispatchablePaymentOperation[]> {
  const { rows } = await financialPool.query<Row>(
    `SELECT * FROM claim_payment_operations_for_dispatch($1)`,
    [limit],
  );
  return rows.map((row) => ({
    operationId: String(row["operation_id"]),
    operationType: row["operation_type"] as PaymentOperationType,
    provider: row["provider"] as PaymentProvider,
    amountCents: asCents(row["amount_cents"]),
    currency: String(row["currency"]),
    clientUserId: row["client_user_id"] ? String(row["client_user_id"]) : null,
    workerUserId: row["worker_user_id"] ? String(row["worker_user_id"]) : null,
    payoutDestinationReference: row["payout_destination_reference"]
      ? String(row["payout_destination_reference"])
      : null,
  }));
}

export async function claimPaymentOperationForDispatch(
  operationId: string,
): Promise<DispatchablePaymentOperation | null> {
  const { rows } = await financialPool.query<Row>(
    `SELECT * FROM claim_payment_operation_for_dispatch($1)`,
    [operationId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    operationId: String(row["operation_id"]),
    operationType: row["operation_type"] as PaymentOperationType,
    provider: row["provider"] as PaymentProvider,
    amountCents: asCents(row["amount_cents"]),
    currency: String(row["currency"]),
    clientUserId: row["client_user_id"] ? String(row["client_user_id"]) : null,
    workerUserId: row["worker_user_id"] ? String(row["worker_user_id"]) : null,
    payoutDestinationReference: row["payout_destination_reference"]
      ? String(row["payout_destination_reference"])
      : null,
  };
}

export async function releasePaymentOperationDispatch(operationId: string, error: string): Promise<void> {
  await financialPool.query(`SELECT release_payment_operation_dispatch($1, $2)`, [operationId, error]);
}

export async function getWalletSummary(userId: string): Promise<WalletSummary[]> {
  const { rows } = await financialPool.query<Row>(`SELECT * FROM get_wallet_summary($1)`, [userId]);
  return rows.map((row) => ({
    currency: String(row["currency"]),
    availableBalanceCents: asCents(row["available_balance_cents"]),
    pendingEscrowCents: asCents(row["pending_escrow_cents"]),
    lifetimeEarningsCents: asCents(row["lifetime_earnings_cents"]),
    lifetimeSpendCents: asCents(row["lifetime_spend_cents"]),
  }));
}

/**
 * Correctionist review queue (NP-14/NP-16).
 *
 * The route that served this queue previously synthesized submissions from a
 * job's subtasks, complete with stock photography and an `ocrResult` naming
 * "tesseract-5.3.0" at a fixed 0.96 confidence. No OCR engine exists in this
 * system and the schema has no column to store one, so those fields described
 * work that never happened. This returns the real uploaded evidence instead.
 */
export type CorrectionistReviewRecord = {
  id: string;
  jobId: string;
  subtaskId: string;
  workerId: string;
  mediaType: MediaType;
  mimeType: string | null;
  fileSizeBytes: number | null;
  capturedAt: Date;
  uploadedAt: Date | null;
  status: JobSubtaskMedia["status"];
  verificationNotes: string | null;
  s3Bucket: string;
  s3Key: string;
  s3VersionId: string | null;
};

export async function listSubmissionsForCorrectionistReview(
  jobId: string,
): Promise<CorrectionistReviewRecord[] | null> {
  const { rows: jobRows } = await pool.query<Row>(`SELECT id FROM jobs WHERE id = $1`, [jobId]);
  if (!jobRows[0]) return null;

  const { rows } = await pool.query<Row>(
    `
      SELECT
        m.id, m.job_id, m.subtask_id, m.worker_id, m.media_type, m.mime_type,
        m.file_size_bytes, m.captured_at, m.uploaded_at, m.status,
        m.verification_notes, m.s3_bucket, m.s3_key, m.s3_version_id
      FROM job_subtask_media AS m
      WHERE m.job_id = $1
        AND m.status = 'UPLOADED'
        AND m.uploaded_at IS NOT NULL
      ORDER BY m.captured_at ASC NULLS LAST, m.id ASC
    `,
    [jobId],
  );

  return rows.map((row) => ({
    id: String(row["id"]),
    jobId: String(row["job_id"]),
    subtaskId: String(row["subtask_id"]),
    workerId: String(row["worker_id"]),
    mediaType: row["media_type"] as MediaType,
    mimeType: row["mime_type"] === null ? null : String(row["mime_type"]),
    fileSizeBytes: row["file_size_bytes"] === null ? null : Number(row["file_size_bytes"]),
    capturedAt: row["captured_at"] as Date,
    uploadedAt: row["uploaded_at"] === null ? null : (row["uploaded_at"] as Date),
    status: row["status"] as JobSubtaskMedia["status"],
    verificationNotes: row["verification_notes"] === null ? null : String(row["verification_notes"]),
    s3Bucket: String(row["s3_bucket"]),
    s3Key: String(row["s3_key"]),
    s3VersionId: row["s3_version_id"] === null ? null : String(row["s3_version_id"]),
  }));
}

/**
 * Applies a correctionist decision to a real evidence row. Returns null when
 * the submission does not exist or is no longer awaiting review, so a
 * double-submitted decision cannot silently overwrite the first one.
 */
export async function recordCorrectionistReviewDecision(params: {
  submissionId: string;
  decision: "approve" | "redo" | "reject";
  note?: string | undefined;
}): Promise<{ id: string; status: JobSubtaskMedia["status"] } | null> {
  const nextStatus = params.decision === "approve" ? "VERIFIED" : "REJECTED";
  const { rows } = await pool.query<Row>(
    `
      UPDATE job_subtask_media
      SET status = $2::media_status,
          verification_notes = COALESCE(NULLIF(btrim($3), ''), verification_notes)
      WHERE id = $1
        AND status = 'UPLOADED'
      RETURNING id, status
    `,
    [params.submissionId, nextStatus, params.note ?? ""],
  );
  const row = rows[0];
  if (!row) return null;
  return { id: String(row["id"]), status: row["status"] as JobSubtaskMedia["status"] };
}

/**
 * A worker's own recent submissions. Replaces a hardcoded two-item array of
 * stock photos and invented OCR snippets (NP-14).
 */
export async function listSubmissionsForWorker(
  workerId: string,
  limit: number,
): Promise<CorrectionistReviewRecord[]> {
  const { rows } = await pool.query<Row>(
    `
      SELECT
        m.id, m.job_id, m.subtask_id, m.worker_id, m.media_type, m.mime_type,
        m.file_size_bytes, m.captured_at, m.uploaded_at, m.status,
        m.verification_notes, m.s3_bucket, m.s3_key, m.s3_version_id
      FROM job_subtask_media AS m
      WHERE m.worker_id = $1
        AND m.uploaded_at IS NOT NULL
      ORDER BY m.uploaded_at DESC, m.id ASC
      LIMIT $2
    `,
    [workerId, limit],
  );
  return rows.map((row) => ({
    id: String(row["id"]),
    jobId: String(row["job_id"]),
    subtaskId: String(row["subtask_id"]),
    workerId: String(row["worker_id"]),
    mediaType: row["media_type"] as MediaType,
    mimeType: row["mime_type"] === null ? null : String(row["mime_type"]),
    fileSizeBytes: row["file_size_bytes"] === null ? null : Number(row["file_size_bytes"]),
    capturedAt: row["captured_at"] as Date,
    uploadedAt: row["uploaded_at"] === null ? null : (row["uploaded_at"] as Date),
    status: row["status"] as JobSubtaskMedia["status"],
    verificationNotes: row["verification_notes"] === null ? null : String(row["verification_notes"]),
    s3Bucket: String(row["s3_bucket"]),
    s3Key: String(row["s3_key"]),
    s3VersionId: row["s3_version_id"] === null ? null : String(row["s3_version_id"]),
  }));
}

/**
 * Real review counts for a client's job (NP-14). The endpoint that served this
 * returned a fixed object -- 300 units, 284 collected, 265 approved -- to every
 * client for every job.
 */
export async function getClientJobReviewSummary(
  jobId: string,
  clientId: string,
): Promise<{
  total_units: number;
  collected: number;
  verified: number;
  rejected: number;
  awaiting_review: number;
} | null> {
  const { rows } = await pool.query<Row>(
    `
      SELECT
        (SELECT count(*) FROM job_subtasks s WHERE s.job_id = j.id)                        AS total_units,
        count(m.id) FILTER (WHERE m.uploaded_at IS NOT NULL)                               AS collected,
        count(m.id) FILTER (WHERE m.status = 'VERIFIED')                                   AS verified,
        count(m.id) FILTER (WHERE m.status = 'REJECTED')                                   AS rejected,
        count(m.id) FILTER (WHERE m.status = 'UPLOADED')                                   AS awaiting_review
      FROM jobs AS j
      LEFT JOIN job_subtask_media AS m ON m.job_id = j.id
      WHERE j.id = $1 AND j.client_id = $2
      GROUP BY j.id
    `,
    [jobId, clientId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    total_units: Number(row["total_units"] ?? 0),
    collected: Number(row["collected"] ?? 0),
    verified: Number(row["verified"] ?? 0),
    rejected: Number(row["rejected"] ?? 0),
    awaiting_review: Number(row["awaiting_review"] ?? 0),
  };
}

/* ------------------------------------------------------------------------ *
 * Email OTP challenges and auth rate limiting (NP-08, NP-09, NP-10)
 *
 * Previously two in-process Maps, which made a code issued by one API task
 * invisible to every other task and reset the rate limiter on each restart.
 * ------------------------------------------------------------------------ */

export type OtpAttemptOutcome = "NOT_FOUND" | "ALREADY_USED" | "EXPIRED" | "LOCKED" | "OK";

export async function consumeAuthRateLimit(
  scope: string,
  subject: string,
  maxCount: number,
  windowSeconds: number,
): Promise<boolean> {
  const { rows } = await pool.query<Row>(
    `SELECT public.consume_auth_rate_limit($1, $2, $3, $4) AS allowed`,
    [scope, subject, maxCount, windowSeconds],
  );
  return rows[0]?.["allowed"] === true;
}

export async function createEmailOtpChallenge(input: {
  challengeRef: string;
  email: string;
  codeHash: string;
  expiresAt: Date;
  role: UserRole;
  requestedIp: string | null;
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO public.email_otp_challenges
        (challenge_ref, email, code_hash, expires_at, role, requested_ip)
      VALUES ($1, $2, $3, $4, $5::user_role, $6)
    `,
    [input.challengeRef, input.email, input.codeHash, input.expiresAt, input.role, input.requestedIp],
  );
}

export async function deleteEmailOtpChallenge(challengeRef: string): Promise<void> {
  await pool.query(`DELETE FROM public.email_otp_challenges WHERE challenge_ref = $1`, [challengeRef]);
}

/** Most recent unconsumed, unexpired challenge for an address. */
export async function findActiveChallengeRefByEmail(email: string): Promise<string | null> {
  const { rows } = await pool.query<Row>(
    `
      SELECT challenge_ref
      FROM public.email_otp_challenges
      WHERE lower(email) = lower($1)
        AND consumed_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [email],
  );
  return rows[0] ? String(rows[0]["challenge_ref"]) : null;
}

export async function registerOtpAttempt(
  challengeRef: string,
  maxAttempts: number,
): Promise<{ outcome: OtpAttemptOutcome; codeHash: string | null; email: string | null; role: UserRole | null }> {
  const { rows } = await pool.query<Row>(
    `SELECT * FROM public.register_otp_attempt($1, $2)`,
    [challengeRef, maxAttempts],
  );
  const row = rows[0];
  if (!row) return { outcome: "NOT_FOUND", codeHash: null, email: null, role: null };
  return {
    outcome: String(row["outcome"]) as OtpAttemptOutcome,
    codeHash: row["code_hash"] === null ? null : String(row["code_hash"]),
    email: row["email"] === null ? null : String(row["email"]),
    role: row["user_role"] === null ? null : (row["user_role"] as UserRole),
  };
}

export async function consumeOtpChallenge(challengeRef: string): Promise<boolean> {
  const { rows } = await pool.query<Row>(
    `SELECT public.consume_otp_challenge($1) AS consumed`,
    [challengeRef],
  );
  return rows[0]?.["consumed"] === true;
}

/* ---------------------------------------------------------------------- *
 * Revocable refresh sessions (NP-11)
 * ---------------------------------------------------------------------- */

export type RefreshRotationOutcome = "OK" | "REUSED" | "UNKNOWN";

export async function createRefreshSession(input: {
  jti: string;
  userId: string;
  expiresAt: Date;
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.refresh_sessions (jti, user_id, expires_at) VALUES ($1, $2, $3)`,
    [input.jti, input.userId, input.expiresAt],
  );
}

export async function rotateRefreshSession(
  jti: string,
  nextJti: string,
  expiresAt: Date,
): Promise<RefreshRotationOutcome> {
  const { rows } = await pool.query<Row>(
    `SELECT public.rotate_refresh_session($1, $2, $3) AS outcome`,
    [jti, nextJti, expiresAt],
  );
  return String(rows[0]?.["outcome"] ?? "UNKNOWN") as RefreshRotationOutcome;
}

export async function revokeRefreshSession(jti: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE public.refresh_sessions SET revoked_at = NOW(), revoked_reason = $2
     WHERE jti = $1 AND revoked_at IS NULL`,
    [jti, reason],
  );
}

export async function revokeAllRefreshSessionsForUser(userId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE public.refresh_sessions SET revoked_at = NOW(), revoked_reason = $2
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}
