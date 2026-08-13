import { randomUUID } from "node:crypto";
import type { JobStatus, JobSubtaskMedia, MediaType, Point } from "../contracts.js";
import {
  advanceWorkerJobStatus,
  confirmMediaUpload,
  getMediaForWorker,
  getWorkerJobProfile,
  MediaReservationConflictError,
  reserveMediaUpload,
  submitJobWithEvidence,
} from "../repository.js";
import { config } from "../config.js";
import { mediaStorage, type MediaStorage, type StoredMediaObject } from "./media-storage-service.js";

const MIME_TYPES: Readonly<Record<MediaType, readonly string[]>> = {
  IMAGE: ["image/jpeg", "image/png", "image/webp"],
  VIDEO: ["video/mp4", "video/quicktime", "video/webm"],
  AUDIO: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/webm"],
  DOCUMENT: ["application/pdf"],
};
const POST_FORM_OVERHEAD_BYTES = 64 * 1024;

export class WorkEvidenceServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "WorkEvidenceServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type CreateUploadUrlParams = {
  workerId: string;
  jobId: string;
  subtaskId: string;
  mediaType: MediaType;
  mimeType: string;
  fileSizeBytes: number;
  capturedAt: Date;
  location?: Point;
  checksumSha256: string;
  idempotencyKey: string;
};

export type EvidenceSummary = {
  id: string;
  job_id: string;
  subtask_id: string;
  media_type: MediaType;
  mime_type: string | null;
  file_size_bytes: number | null;
  captured_at: Date;
  uploaded_at: Date | null;
  status: JobSubtaskMedia["status"];
};

function databaseErrorCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null || !("code" in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function storageStatusCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("$metadata" in err)) return null;
  const metadata = (err as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  return typeof metadata?.httpStatusCode === "number" ? metadata.httpStatusCode : null;
}

function checksumToBase64(checksumSha256: string): string {
  return Buffer.from(checksumSha256, "hex").toString("base64");
}

function normalizedMimeType(value: string | null): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function matchesStoredObject(media: JobSubtaskMedia, object: StoredMediaObject): boolean {
  return (
    media.file_size_bytes !== null &&
    media.mime_type !== null &&
    media.checksum_sha256 !== null &&
    object.contentLength === media.file_size_bytes &&
    normalizedMimeType(object.contentType) === normalizedMimeType(media.mime_type) &&
    object.checksumSha256Base64 === checksumToBase64(media.checksum_sha256) &&
    typeof object.etag === "string" &&
    object.etag.length > 0 &&
    typeof object.versionId === "string" &&
    object.versionId.length > 0 &&
    object.versionId.toLowerCase() !== "null"
  );
}

function toEvidenceSummary(media: JobSubtaskMedia): EvidenceSummary {
  return {
    id: media.id,
    job_id: media.job_id,
    subtask_id: media.subtask_id,
    media_type: media.media_type,
    mime_type: media.mime_type,
    file_size_bytes: media.file_size_bytes,
    captured_at: media.captured_at,
    uploaded_at: media.uploaded_at,
    status: media.status,
  };
}

export class WorkEvidenceService {
  constructor(
    private readonly storage: MediaStorage = mediaStorage,
    private readonly onEvidenceUploaded?: (mediaId: string) => Promise<void>,
  ) {}

  private async kickMediaProcessing(mediaId: string): Promise<void> {
    // The PostgreSQL outbox is authoritative. A failed immediate kick only
    // delays processing until the periodic queue sweep repairs it.
    await this.onEvidenceUploaded?.(mediaId).catch(() => undefined);
  }

  private async requireVerifiedWorker(workerId: string): Promise<void> {
    const profile = await getWorkerJobProfile(workerId);
    if (!profile || profile.verificationStatus !== "VERIFIED") {
      throw new WorkEvidenceServiceError(
        "WORKER_NOT_VERIFIED",
        "Worker verification is required before submitting evidence",
        403,
      );
    }
  }

  async assertStorageReady(): Promise<void> {
    await this.storage.assertReady?.();
  }

  async createUploadUrl(params: CreateUploadUrlParams): Promise<{
    evidence: EvidenceSummary;
    upload: { url: string; fields: Record<string, string>; expires_at: Date } | null;
  }> {
    await this.requireVerifiedWorker(params.workerId);
    if (!MIME_TYPES[params.mediaType].includes(params.mimeType)) {
      throw new WorkEvidenceServiceError("MEDIA_TYPE_NOT_ALLOWED", "MIME type is not allowed for this media type");
    }
    if (params.capturedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new WorkEvidenceServiceError("CAPTURE_TIME_INVALID", "captured_at cannot be in the future");
    }

    const mediaId = randomUUID();
    const expiresAt = new Date(Date.now() + config.AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS * 1000);
    let reservation;
    try {
      reservation = await reserveMediaUpload({
        mediaId,
        workerId: params.workerId,
        jobId: params.jobId,
        subtaskId: params.subtaskId,
        s3Key: `evidence/${mediaId}`,
        s3Bucket: config.AWS_S3_BUCKET,
        mediaType: params.mediaType,
        mimeType: params.mimeType,
        fileSizeBytes: params.fileSizeBytes,
        capturedAt: params.capturedAt,
        location: params.location,
        checksumSha256: params.checksumSha256,
        idempotencyKey: params.idempotencyKey,
        uploadExpiresAt: expiresAt,
      });
    } catch (err) {
      if (err instanceof MediaReservationConflictError) {
        throw new WorkEvidenceServiceError(
          "IDEMPOTENCY_KEY_REUSED",
          "idempotency_key was already used for different evidence",
          409,
        );
      }
      throw err;
    }

    if (!reservation) {
      throw new WorkEvidenceServiceError("WORK_NOT_FOUND", "Job or subtask not found", 404);
    }
    if (!reservation.uploadAllowed) {
      return { evidence: toEvidenceSummary(reservation.media), upload: null };
    }

    const upload = await this.storage.createUploadTarget({
      bucket: reservation.media.s3_bucket,
      key: reservation.media.s3_key,
      mimeType: params.mimeType,
      checksumSha256Base64: checksumToBase64(params.checksumSha256),
      // POST multipart fields add a small request envelope; HeadObject still
      // validates the exact stored object length before confirmation.
      maxUploadBytes: Math.min(
        config.MEDIA_MAX_FILE_SIZE_BYTES + POST_FORM_OVERHEAD_BYTES,
        params.fileSizeBytes + POST_FORM_OVERHEAD_BYTES,
      ),
    });
    return {
      evidence: toEvidenceSummary(reservation.media),
      upload: { ...upload, expires_at: reservation.media.upload_expires_at as Date },
    };
  }

  async confirmEvidence(workerId: string, mediaId: string): Promise<EvidenceSummary> {
    await this.requireVerifiedWorker(workerId);
    const media = await getMediaForWorker(mediaId, workerId);
    if (!media) {
      throw new WorkEvidenceServiceError("EVIDENCE_NOT_FOUND", "Evidence not found", 404);
    }
    if (media.status === "UPLOADED") {
      // A previous database commit may have succeeded while the tag write timed
      // out. Retrying confirmation repairs the lifecycle-protection tag instead
      // of treating an accepted version as pending evidence.
      await this.storage.setObjectState({
        bucket: media.s3_bucket,
        key: media.s3_key,
        versionId: media.s3_version_id as string,
        state: "confirmed",
      });
      await this.kickMediaProcessing(media.id);
      return toEvidenceSummary(media);
    }
    if (media.status !== "PENDING") {
      throw new WorkEvidenceServiceError("EVIDENCE_NOT_ACCEPTING_UPLOAD", "Evidence cannot be confirmed", 409);
    }
    if (!media.upload_expires_at || media.upload_expires_at <= new Date()) {
      throw new WorkEvidenceServiceError("UPLOAD_EXPIRED", "Evidence upload reservation has expired", 409);
    }

    let object: StoredMediaObject;
    try {
      object = await this.storage.headObject({ bucket: media.s3_bucket, key: media.s3_key });
    } catch (err) {
      const status = storageStatusCode(err);
      if (status === 403 || status === 404) {
        throw new WorkEvidenceServiceError("UPLOAD_NOT_FOUND", "Uploaded evidence was not found", 409);
      }
      throw err;
    }
    if (!object.versionId || object.versionId.toLowerCase() === "null") {
      throw new WorkEvidenceServiceError(
        "STORAGE_VERSIONING_REQUIRED",
        "Evidence storage must return an immutable object version",
        409,
      );
    }
    if (!matchesStoredObject(media, object)) {
      throw new WorkEvidenceServiceError(
        "UPLOAD_METADATA_MISMATCH",
        "Uploaded evidence does not match its reservation",
        409,
      );
    }

    let markedConfirmed = false;
    try {
      await this.storage.setObjectState({
        bucket: media.s3_bucket,
        key: media.s3_key,
        versionId: object.versionId,
        state: "confirmed",
      });
      markedConfirmed = true;
      const confirmed = await confirmMediaUpload({
        mediaId,
        workerId,
        fileSizeBytes: object.contentLength as number,
        mimeType: normalizedMimeType(object.contentType) as string,
        checksumSha256: media.checksum_sha256 as string,
        s3Etag: object.etag as string,
        s3VersionId: object.versionId,
      });
      if (!confirmed) {
        throw new WorkEvidenceServiceError("EVIDENCE_NOT_FOUND", "Evidence not found", 404);
      }
      await this.kickMediaProcessing(confirmed.id);
      return toEvidenceSummary(confirmed);
    } catch (err) {
      if (markedConfirmed) {
        // A network error can occur after the database transaction committed.
        // Only restore the pending tag after a durable read proves the media is
        // still pending; otherwise preserve the confirmed tag for retention.
        const persisted = await getMediaForWorker(mediaId, workerId).catch(() => null);
        if (persisted?.status !== "UPLOADED") {
          try {
            await this.storage.setObjectState({
              bucket: media.s3_bucket,
              key: media.s3_key,
              versionId: object.versionId as string,
              state: "pending",
            });
          } catch {
            // The pending tag is already lifecycle-safe when a rollback cannot
            // be confirmed; a later retry will reconcile the final state.
          }
        }
      }
      if (err instanceof WorkEvidenceServiceError) throw err;
      const code = databaseErrorCode(err);
      if (code === "P0002") throw new WorkEvidenceServiceError("EVIDENCE_NOT_FOUND", "Evidence not found", 404);
      if (code === "22023") throw new WorkEvidenceServiceError("UPLOAD_EXPIRED", "Evidence upload reservation has expired", 409);
      if (code === "55000") {
        throw new WorkEvidenceServiceError("EVIDENCE_NOT_ACCEPTING_UPLOAD", "Evidence cannot be confirmed", 409);
      }
      if (code === "23514") {
        throw new WorkEvidenceServiceError(
          "UPLOAD_METADATA_MISMATCH",
          "Uploaded evidence does not match its reservation",
          409,
        );
      }
      throw err;
    }
  }

  async submit(workerId: string, jobId: string): Promise<{ job_id: string; status: "SUBMITTED" }> {
    await this.requireVerifiedWorker(workerId);
    try {
      const submitted = await submitJobWithEvidence(jobId, workerId);
      if (!submitted) throw new WorkEvidenceServiceError("JOB_NOT_FOUND", "Job not found", 404);
      return { job_id: submitted.jobId, status: submitted.status as "SUBMITTED" };
    } catch (err) {
      if (err instanceof WorkEvidenceServiceError) throw err;
      const code = databaseErrorCode(err);
      if (code === "P0002") throw new WorkEvidenceServiceError("JOB_NOT_FOUND", "Job not found", 404);
      if (code === "23514") {
        throw new WorkEvidenceServiceError(
          "REQUIRED_EVIDENCE_INCOMPLETE",
          "Required subtask evidence is incomplete",
          409,
        );
      }
      if (code === "55000") {
        throw new WorkEvidenceServiceError("JOB_NOT_READY_FOR_SUBMISSION", "Job cannot be submitted", 409);
      }
      throw err;
    }
  }

  async advanceStatus(
    workerId: string,
    jobId: string,
    targetStatus: Extract<JobStatus, "EN_ROUTE" | "AT_LOCATION" | "IN_PROGRESS">,
  ): Promise<{ job_id: string; status: "EN_ROUTE" | "AT_LOCATION" | "IN_PROGRESS" }> {
    await this.requireVerifiedWorker(workerId);
    try {
      const advanced = await advanceWorkerJobStatus(jobId, workerId, targetStatus);
      if (!advanced) throw new WorkEvidenceServiceError("JOB_NOT_FOUND", "Job not found", 404);
      return {
        job_id: advanced.jobId,
        status: advanced.status as "EN_ROUTE" | "AT_LOCATION" | "IN_PROGRESS",
      };
    } catch (err) {
      if (err instanceof WorkEvidenceServiceError) throw err;
      const code = databaseErrorCode(err);
      if (code === "P0002") throw new WorkEvidenceServiceError("JOB_NOT_FOUND", "Job not found", 404);
      if (code === "55000" || code === "23514") {
        throw new WorkEvidenceServiceError("JOB_STATUS_NOT_ALLOWED", "Job cannot advance to the requested status", 409);
      }
      throw err;
    }
  }
}

export const workEvidenceService = new WorkEvidenceService();
