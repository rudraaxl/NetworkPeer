import { createSign } from "node:crypto";
import { config } from "../config.js";
import {
  claimPushDelivery,
  deactivateDevicePushTokens,
  getActiveDevicePushTokens,
  listPushDeliveryCandidates,
  markPushDeliverySent,
  markPushDeliverySkipped,
  releasePushDelivery,
  type PendingPushDelivery,
} from "../repository.js";
import { captureException, logger } from "../observability.js";

export type PushGatewayResult = { invalidTokens: string[] };

export interface PushGateway {
  readonly enabled: boolean;
  send(input: {
    tokens: readonly string[];
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<PushGatewayResult>;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
}

function toPushData(delivery: PendingPushDelivery): Record<string, string> {
  const data: Record<string, string> = {
    cursor: delivery.cursor,
    topic: delivery.topic,
  };
  for (const [key, value] of Object.entries(delivery.payload)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      data[key] = String(value);
    }
  }
  return data;
}

/** FCM HTTP v1 gateway using built-in crypto instead of a large admin SDK. */
export class FcmHttpV1Gateway implements PushGateway {
  readonly enabled = true;
  private accessToken: { value: string; expiresAt: number } | null = null;

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }

    const issuedAt = Math.floor(Date.now() / 1000);
    const signed = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
      JSON.stringify({
        iss: config.FIREBASE_CLIENT_EMAIL,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    )}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signed);
    signer.end();
    const assertion = `${signed}.${signer.sign(config.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"), "base64url")}`;

    const response = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const payload = await response.json() as { access_token?: unknown; expires_in?: unknown; error?: unknown };
    if (!response.ok || typeof payload.access_token !== "string") {
      throw new Error(`FCM OAuth token request failed: ${String(payload.error ?? response.status)}`);
    }
    const expiresInSeconds = typeof payload.expires_in === "number" ? payload.expires_in : 3000;
    this.accessToken = { value: payload.access_token, expiresAt: Date.now() + expiresInSeconds * 1000 };
    return this.accessToken.value;
  }

  async send(input: {
    tokens: readonly string[];
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<PushGatewayResult> {
    const accessToken = await this.getAccessToken();
    const invalidTokens: string[] = [];
    for (const token of input.tokens) {
      const response = await fetchWithTimeout(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(config.FIREBASE_PROJECT_ID)}/messages:send`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: input.title, body: input.body },
              data: input.data,
            },
          }),
        },
      );
      if (response.ok) continue;
      const payload = await response.json().catch(() => null) as {
        error?: { status?: unknown; message?: unknown };
      } | null;
      if (response.status === 404 && payload?.error?.status === "UNREGISTERED") {
        invalidTokens.push(token);
        continue;
      }
      throw new Error(`FCM send failed: ${response.status} ${String(payload?.error?.message ?? "")}`.trim());
    }
    return { invalidTokens };
  }
}

export class DisabledPushGateway implements PushGateway {
  readonly enabled = false;

  async send(): Promise<PushGatewayResult> {
    return { invalidTokens: [] };
  }
}

export function createPushGateway(): PushGateway {
  return config.PUSH_NOTIFICATIONS_ENABLED === "true" ? new FcmHttpV1Gateway() : new DisabledPushGateway();
}

export class PushDeliveryDispatcher {
  private timer: NodeJS.Timeout | null = null;
  private flushInFlight: Promise<void> | null = null;

  constructor(private readonly gateway: PushGateway) {}

  get enabled(): boolean {
    return this.gateway.enabled;
  }

  start(): void {
    if (!this.gateway.enabled || this.timer) return;
    this.scheduleFlush();
    this.timer = setInterval(() => this.scheduleFlush(), config.PUSH_DISPATCH_INTERVAL_MS);
    this.timer.unref();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flushInFlight;
  }

  async flush(): Promise<void> {
    if (!this.gateway.enabled) return;
    if (this.flushInFlight) return this.flushInFlight;
    this.flushInFlight = this.runFlush().finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  private scheduleFlush(): void {
    void this.flush().catch((err: unknown) => {
      logger.error({ err }, "push delivery flush failed");
      captureException(err, { operation: "legacy-push-flush" });
    });
  }

  private async runFlush(): Promise<void> {
    const cursors = await listPushDeliveryCandidates(25);
    for (const cursor of cursors) {
      try {
        await this.process(cursor);
      } catch {
        // process() already releases its durable claim before propagating.
      }
    }
  }

  async process(cursor: string): Promise<void> {
    if (!this.gateway.enabled) return;
    const delivery = await claimPushDelivery(cursor);
    if (!delivery) return;
    logger.info({ cursor: delivery.cursor, recipientUserId: delivery.recipientUserId }, "push delivery started");
    try {
      const tokens = await getActiveDevicePushTokens(delivery.recipientUserId);
      if (tokens.length === 0) {
        await markPushDeliverySkipped(delivery.cursor);
        return;
      }
      const result = await this.gateway.send({
        tokens,
        title: delivery.title,
        body: delivery.body,
        data: toPushData(delivery),
      });
      await markPushDeliverySent(delivery.cursor);
      await deactivateDevicePushTokens(result.invalidTokens).catch(() => undefined);
      logger.info({ cursor: delivery.cursor, invalidTokenCount: result.invalidTokens.length }, "push delivery completed");
    } catch (err) {
      logger.warn({ err, cursor: delivery.cursor }, "push delivery released for retry");
      await releasePushDelivery(delivery.cursor, err instanceof Error ? err.message : "Push delivery failed");
      throw err;
    }
  }
}
