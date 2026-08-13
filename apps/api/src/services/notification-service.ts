import { config } from "../config.js";
import type { Notification, PushPlatform, SyncEvent } from "../contracts.js";
import {
  DevicePushTokenOwnershipError,
  getWorkerJobProfile,
  listLedgerEntriesByIds,
  listNotificationsForUser,
  listSyncEventsForUser,
  listWorkerSyncJobs,
  listWorkerSyncSnapshot,
  markAllNotificationsReadForUser,
  markNotificationReadForUser,
  upsertDevicePushToken,
} from "../repository.js";

export class NotificationServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "NotificationServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function assertCursor(cursor: string): void {
  if (!/^\d+$/.test(cursor) || BigInt(cursor) > 9_223_372_036_854_775_807n) {
    throw new NotificationServiceError("INVALID_CURSOR", "cursor must be a non-negative decimal integer");
  }
}

function page<T>(items: T[], limit: number, cursorFor: (item: T) => string, fallbackCursor: string) {
  const hasMore = items.length > limit;
  const visible = hasMore ? items.slice(0, limit) : items;
  return {
    items: visible,
    has_more: hasMore,
    next_cursor: visible.length ? cursorFor(visible[visible.length - 1] as T) : fallbackCursor,
  };
}

export class NotificationService {
  async sync(userId: string, cursor: string, limit: number): Promise<{
    events: SyncEvent[];
    has_more: boolean;
    next_cursor: string;
  }> {
    assertCursor(cursor);
    const boundedLimit = Math.min(limit, config.SYNC_MAX_PAGE_SIZE);
    const result = page(
      await listSyncEventsForUser(userId, cursor, boundedLimit + 1),
      boundedLimit,
      (event) => event.cursor,
      cursor,
    );
    return { events: result.items, has_more: result.has_more, next_cursor: result.next_cursor };
  }

  async list(userId: string, beforeCursor: string | null, limit: number): Promise<{
    items: Notification[];
    has_more: boolean;
    next_cursor: string | null;
  }> {
    if (beforeCursor !== null) assertCursor(beforeCursor);
    const boundedLimit = Math.min(limit, config.SYNC_MAX_PAGE_SIZE);
    const result = page(
      await listNotificationsForUser(userId, beforeCursor, boundedLimit + 1),
      boundedLimit,
      (notification) => notification.cursor,
      beforeCursor ?? "0",
    );
    return {
      items: result.items,
      has_more: result.has_more,
      next_cursor: result.items.length ? result.next_cursor : null,
    };
  }

  async markRead(userId: string, notificationId: string): Promise<Notification> {
    const notification = await markNotificationReadForUser(notificationId, userId);
    if (!notification) {
      throw new NotificationServiceError("NOTIFICATION_NOT_FOUND", "Notification not found", 404);
    }
    return notification;
  }

  async markAllRead(userId: string): Promise<{ marked_count: number }> {
    return { marked_count: await markAllNotificationsReadForUser(userId) };
  }

  async registerDevice(userId: string, token: string, platform: PushPlatform): Promise<{
    id: string;
    platform: PushPlatform;
    active: boolean;
  }> {
    let device;
    try {
      device = await upsertDevicePushToken({ userId, token, platform });
    } catch (err) {
      if (err instanceof DevicePushTokenOwnershipError) {
        throw new NotificationServiceError("DEVICE_TOKEN_IN_USE", err.message, 409);
      }
      throw err;
    }
    return { id: device.id, platform: device.platform, active: device.isActive };
  }

  async workerSync(userId: string, cursor: string, limit: number): Promise<{
    events: SyncEvent[];
    jobs: Awaited<ReturnType<typeof listWorkerSyncJobs>>;
    snapshot_jobs: Awaited<ReturnType<typeof listWorkerSyncSnapshot>>;
    ledger_entries: Awaited<ReturnType<typeof listLedgerEntriesByIds>>;
    removed_job_ids: string[];
    has_more: boolean;
    next_cursor: string;
  }> {
    const profile = await getWorkerJobProfile(userId);
    if (!profile || profile.verificationStatus !== "VERIFIED") {
      throw new NotificationServiceError(
        "WORKER_NOT_VERIFIED",
        "Worker verification is required before synchronizing work",
        403,
      );
    }
    const synced = await this.sync(userId, cursor, limit);
    const jobIds = [...new Set(
      synced.events
        .filter((event) => event.entity_type === "JOB" && event.entity_id)
        .map((event) => event.entity_id as string),
    )];
    const ledgerIds = [...new Set(
      synced.events
        .filter((event) => event.entity_type === "WALLET_LEDGER" && event.entity_id)
        .map((event) => event.entity_id as string),
    )];
    const removedJobIds = [...new Set(
      synced.events
        .filter((event) => event.entity_type === "JOB" && event.payload["removed"] === true && event.entity_id)
        .map((event) => event.entity_id as string),
    )];
    const [jobs, ledgerEntries, snapshotJobs] = await Promise.all([
      listWorkerSyncJobs(userId, jobIds),
      listLedgerEntriesByIds(userId, ledgerIds),
      cursor === "0" ? listWorkerSyncSnapshot(userId, Math.min(limit, 100)) : Promise.resolve([]),
    ]);
    return {
      ...synced,
      jobs,
      snapshot_jobs: snapshotJobs,
      ledger_entries: ledgerEntries,
      removed_job_ids: removedJobIds,
    };
  }
}

export const notificationService = new NotificationService();
