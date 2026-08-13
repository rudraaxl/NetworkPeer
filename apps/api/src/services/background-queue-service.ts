import { Queue, Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { config } from "../config.js";
import {
  claimMediaProcessing,
  completeMediaProcessing,
  findPerceptualDuplicates,
  listMediaProcessingCandidates,
  listPushDeliveryCandidates,
  recordPerceptualHash,
  releaseMediaProcessing,
  setMediaPhash,
} from "../repository.js";
import type { MediaStorage, StoredMediaObject } from "./media-storage-service.js";
import { PushDeliveryDispatcher, type PushGateway } from "./push-notification-service.js";
import { computePerceptualHash } from "./perceptual-hash-service.js";
import { captureException, logger } from "../observability.js";

const MEDIA_QUEUE = "networkpeer-media-processing";
const PUSH_QUEUE = "networkpeer-push-delivery";
const JOB_ATTEMPTS = 5;

type MediaJobData = { mediaId: string };
type PushJobData = { cursor: string };

export interface BackgroundRuntime {
  start(): Promise<void>;
  kick(): Promise<void>;
  close(): Promise<void>;
}

function createQueueRedis(): Redis {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  client.on("error", (err) => {
    logger.error({ err, component: "background-queue" }, "BullMQ Redis connection error");
  });
  return client;
}

function checksumToBase64(checksumSha256: string): string {
  return Buffer.from(checksumSha256, "hex").toString("base64");
}

function normalizedMimeType(value: string | null): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function isFinalQueueAttempt(job: Job<unknown> | undefined): boolean {
  return !job || job.attemptsMade >= (job.opts.attempts ?? 1);
}

function matchesPinnedObject(
  expected: {
    s3VersionId: string;
    mimeType: string;
    fileSizeBytes: number;
    checksumSha256: string;
    s3Etag: string;
  },
  object: StoredMediaObject,
): boolean {
  return (
    object.versionId === expected.s3VersionId &&
    object.contentLength === expected.fileSizeBytes &&
    normalizedMimeType(object.contentType) === normalizedMimeType(expected.mimeType) &&
    object.checksumSha256Base64 === checksumToBase64(expected.checksumSha256) &&
    object.etag === expected.s3Etag
  );
}

/**
 * Co-located BullMQ runtime. PostgreSQL outboxes are always reconciled by the
 * sweep, so Redis job loss or a missed notification only delays processing.
 */
export class BackgroundQueueRuntime implements BackgroundRuntime {
  private publisher: Redis | null = null;
  private mediaWorkerConnection: Redis | null = null;
  private pushWorkerConnection: Redis | null = null;
  private mediaQueue: Queue<MediaJobData> | null = null;
  private pushQueue: Queue<PushJobData> | null = null;
  private mediaWorker: Worker<MediaJobData> | null = null;
  private pushWorker: Worker<PushJobData> | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweepInFlight: Promise<void> | null = null;
  private started = false;
  private readonly pushDispatcher: PushDeliveryDispatcher;

  constructor(
    private readonly mediaStorage: MediaStorage,
    pushGateway: PushGateway,
  ) {
    this.pushDispatcher = new PushDeliveryDispatcher(pushGateway);
  }

  async start(): Promise<void> {
    if (this.started || config.BACKGROUND_QUEUES_ENABLED !== "true") return;
    this.publisher = createQueueRedis();
    this.mediaWorkerConnection = createQueueRedis();
    this.pushWorkerConnection = createQueueRedis();
    this.mediaQueue = new Queue<MediaJobData>(MEDIA_QUEUE, { connection: this.publisher });
    this.pushQueue = new Queue<PushJobData>(PUSH_QUEUE, { connection: this.publisher });
    this.mediaWorker = new Worker<MediaJobData>(
      MEDIA_QUEUE,
      async (job) => this.processMedia(job),
      { connection: this.mediaWorkerConnection, concurrency: config.BACKGROUND_MEDIA_CONCURRENCY },
    );
    this.pushWorker = new Worker<PushJobData>(
      PUSH_QUEUE,
      async (job) => this.processPush(job),
      { connection: this.pushWorkerConnection, concurrency: config.BACKGROUND_PUSH_CONCURRENCY },
    );
    this.mediaWorker.on("error", (err) => {
      logger.error({ err, queue: MEDIA_QUEUE }, "media processing worker error");
      captureException(err, { queue: MEDIA_QUEUE, operation: "worker-error" });
    });
    this.pushWorker.on("error", (err) => {
      logger.error({ err, queue: PUSH_QUEUE }, "push delivery worker error");
      captureException(err, { queue: PUSH_QUEUE, operation: "worker-error" });
    });
    this.mediaWorker.on("completed", (job) => {
      logger.info({ queue: MEDIA_QUEUE, jobId: job.id, mediaId: job.data.mediaId }, "background job completed");
    });
    this.mediaWorker.on("failed", (job, err) => {
      const details = { err, queue: MEDIA_QUEUE, jobId: job?.id, mediaId: job?.data.mediaId };
      if (isFinalQueueAttempt(job)) {
        logger.error(details, "background job exhausted retries");
        captureException(err, { queue: MEDIA_QUEUE, jobId: job?.id, operation: "job-exhausted" });
      } else {
        logger.warn(details, "background job will retry");
      }
    });
    this.pushWorker.on("completed", (job) => {
      logger.info({ queue: PUSH_QUEUE, jobId: job.id, cursor: job.data.cursor }, "background job completed");
    });
    this.pushWorker.on("failed", (job, err) => {
      const details = { err, queue: PUSH_QUEUE, jobId: job?.id, cursor: job?.data.cursor };
      if (isFinalQueueAttempt(job)) {
        logger.error(details, "background job exhausted retries");
        captureException(err, { queue: PUSH_QUEUE, jobId: job?.id, operation: "job-exhausted" });
      } else {
        logger.warn(details, "background job will retry");
      }
    });
    this.started = true;
    await this.sweep();
    this.sweepTimer = setInterval(() => {
      void this.sweep().catch((err: unknown) => {
        logger.error({ err }, "background queue outbox sweep failed");
        captureException(err, { operation: "outbox-sweep" });
      });
    }, config.BACKGROUND_QUEUE_POLL_INTERVAL_MS);
    this.sweepTimer.unref();
  }

  async close(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    this.sweepTimer = null;
    await this.sweepInFlight;
    this.started = false;
    const resources = [
      this.mediaWorker?.close(),
      this.pushWorker?.close(),
      this.mediaQueue?.close(),
      this.pushQueue?.close(),
      this.publisher?.quit(),
      this.mediaWorkerConnection?.quit(),
      this.pushWorkerConnection?.quit(),
    ];
    await Promise.allSettled(resources);
    this.publisher = null;
    this.mediaWorkerConnection = null;
    this.pushWorkerConnection = null;
    this.mediaQueue = null;
    this.pushQueue = null;
    this.mediaWorker = null;
    this.pushWorker = null;
  }

  async kick(): Promise<void> {
    await this.sweep();
  }

  private async sweep(): Promise<void> {
    if (!this.started || !this.mediaQueue || !this.pushQueue) return;
    if (this.sweepInFlight) return this.sweepInFlight;
    this.sweepInFlight = this.enqueueOutboxCandidates().finally(() => {
      this.sweepInFlight = null;
    });
    return this.sweepInFlight;
  }

  private async enqueueOutboxCandidates(): Promise<void> {
    const mediaIds = await listMediaProcessingCandidates(100);
    await Promise.all(mediaIds.map((mediaId) =>
      this.mediaQueue?.add("process", { mediaId }, {
        jobId: `media-${mediaId}`,
        attempts: JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400, count: 1_000 },
      }),
    ));
    if (!this.pushDispatcher.enabled) return;
    const cursors = await listPushDeliveryCandidates(100);
    await Promise.all(cursors.map((cursor) =>
      this.pushQueue?.add("deliver", { cursor }, {
        jobId: `push-${cursor}`,
        attempts: JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400, count: 1_000 },
      }),
    ));
  }

  private async processMedia(job: Job<MediaJobData>): Promise<void> {
    logger.info({ queue: MEDIA_QUEUE, jobId: job.id, mediaId: job.data.mediaId }, "background job started");
    const media = await claimMediaProcessing(job.data.mediaId);
    if (!media) return;
    try {
      const object = await this.mediaStorage.headObject({
        bucket: media.s3Bucket,
        key: media.s3Key,
        versionId: media.s3VersionId,
      });
      if (!matchesPinnedObject(media, object)) {
        throw new Error("Pinned evidence object no longer matches its accepted metadata");
      }

      if (media.mimeType === "image/jpeg" || media.mimeType === "image/png" || media.mimeType === "image/webp") {
        try {
          const image = await this.mediaStorage.getObjectBytes?.({
            bucket: media.s3Bucket,
            key: media.s3Key,
            versionId: media.s3VersionId,
          });
          if (image) {
            const phash = await computePerceptualHash(image);
            await recordPerceptualHash(media.mediaId, "PHASH", phash.hash);
            await setMediaPhash(media.mediaId, phash.hash);
            const duplicates = await findPerceptualDuplicates(phash.hash, media.mediaId, 12);
            if (duplicates.length > 0) {
              logger.warn(
                { mediaId: media.mediaId, duplicates: duplicates.length, phash: phash.hash },
                "possible duplicate evidence detected",
              );
            }
          }
        } catch (hashError) {
          // Perceptual hashing is a trust signal, not a gating check. A
          // hash failure must not fail evidence processing.
          logger.warn({ err: hashError, mediaId: media.mediaId }, "perceptual hash computation failed");
        }
      }

      await completeMediaProcessing(media.mediaId);
    } catch (err) {
      await releaseMediaProcessing(media.mediaId, err instanceof Error ? err.message : "Media processing failed");
      throw err;
    }
  }

  private async processPush(job: Job<PushJobData>): Promise<void> {
    logger.info({ queue: PUSH_QUEUE, jobId: job.id, cursor: job.data.cursor }, "background job started");
    await this.pushDispatcher.process(job.data.cursor);
  }
}
