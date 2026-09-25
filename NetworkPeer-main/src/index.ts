import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import { createHash } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { pool, redis, closeConnections } from "./db.js";
import { fail } from "./contracts.js";
import systemRoutes from "./routes/system.js";
import authRoutes from "./routes/auth.js";
import clientJobsRoutes from "./routes/client-jobs.js";
import workerJobsRoutes from "./routes/worker-jobs.js";
import adminWorkerRoutes from "./routes/admin-workers.js";
import adminRoutes from "./routes/admin.js";
import workRoutes from "./routes/work.js";
import syncRoutes from "./routes/sync.js";
import workerSyncRoutes from "./routes/worker-sync.js";
import notificationRoutes from "./routes/notifications.js";
import financialRoutes from "./routes/financial.js";
import paymentWebhookRoutes from "./routes/payment-webhooks.js";
import { requireAuth } from "./middleware/auth.js";
import { WorkEvidenceService } from "./services/work-evidence-service.js";
import { ClientEvidenceReviewService } from "./services/client-evidence-review-service.js";
import { mediaStorage, type MediaStorage } from "./services/media-storage-service.js";
import { createPushGateway, type PushGateway } from "./services/push-notification-service.js";
import { RealtimeHub } from "./services/realtime-hub.js";
import { LedgerService } from "./services/ledger-service.js";
import { createPaymentGateway, type PaymentGateway } from "./services/payment-gateway-service.js";
import { PaymentDispatchRuntime } from "./services/payment-dispatch-service.js";
import { BackgroundQueueRuntime, type BackgroundRuntime } from "./services/background-queue-service.js";
import {
  captureException,
  flushObservability,
  initializeObservability,
  installProcessErrorHandlers,
  logger,
} from "./observability.js";

function getErrorResponseDetails(err: unknown): {
  code: "BAD_REQUEST" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "INTERNAL_SERVER_ERROR";
  message: string;
  statusCode: number;
} {
  const maybeError = err as { message?: unknown; statusCode?: unknown };
  const statusCode = typeof maybeError.statusCode === "number" && maybeError.statusCode < 500
    ? maybeError.statusCode
    : 500;

  // Never leak raw internal messages (DB details, stack traces) to clients.
  const message = statusCode < 500 && typeof maybeError.message === "string"
    ? maybeError.message
    : "An internal server error occurred";

  const code =
    statusCode === 401 ? "UNAUTHORIZED"
    : statusCode === 403 ? "FORBIDDEN"
    : statusCode === 404 ? "NOT_FOUND"
    : statusCode < 500 ? "BAD_REQUEST"
    : "INTERNAL_SERVER_ERROR";

  return { code, message, statusCode };
}

/**
 * Application bootstrap: plugin registration, route mounting, and graceful
 * shutdown hooks. Routes are declared in src/routes and mounted under
 * config.API_PREFIX.
 */
export type BuildAppOptions = {
  mediaStorage?: MediaStorage;
  realtimeEnabled?: boolean;
  pushGateway?: PushGateway;
  paymentGateway?: PaymentGateway;
  backgroundRuntime?: BackgroundRuntime;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  initializeObservability();
  const allowedOrigins = new Set(
    config.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean),
  );
  const app = Fastify({
    bodyLimit: config.MAX_REQUEST_BODY_BYTES,
    // Forwarded client addresses are trusted only from configured proxy CIDRs.
    trustProxy: config.TRUST_PROXY_CIDRS.length ? config.TRUST_PROXY_CIDRS : false,
    loggerInstance: logger as FastifyBaseLogger,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
    hsts: config.NODE_ENV === "production" ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(cors, {
    origin: (origin, callback) => {
      // Non-browser clients do not send Origin. Browser origins must be explicit.
      callback(null, origin === undefined || allowedOrigins.has(origin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key", "Stripe-Signature", "X-Request-Id"],
    exposedHeaders: ["Retry-After", "X-Request-Id"],
    maxAge: 86_400,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    redis,
    nameSpace: "networkpeer:rate-limit:",
    hook: "onRequest",
    max: config.RATE_LIMIT_MAX_REQUESTS,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    // Keyed by session where there is one, falling back to IP.
    //
    // Keying on IP alone meant every worker behind the same NAT shared a
    // single 100-per-minute budget. On mobile networks that is not an edge
    // case -- carrier-grade NAT routinely puts thousands of subscribers
    // behind one address -- so a busy area could rate-limit workers who had
    // sent almost nothing. The limiter runs on the global onRequest hook,
    // before route-level authentication, so request.auth is not populated
    // yet; the bearer token is hashed instead, which separates sessions
    // without the token itself ever becoming a cache key.
    keyGenerator: (request) => {
      const authorization = request.headers.authorization;
      if (authorization?.startsWith("Bearer ")) {
        return `session:${createHash("sha256").update(authorization.slice(7)).digest("hex").slice(0, 32)}`;
      }
      return `ip:${request.ip}`;
    },
    // Liveness must remain dependency-free for container orchestration.
    allowList: (request) => request.url.split("?", 1)[0] === `${config.API_PREFIX}/live`,
    skipOnError: false,
    addHeaders: {
      "x-ratelimit-limit": true,
      "x-ratelimit-remaining": true,
      "x-ratelimit-reset": true,
      "retry-after": true,
    },
    errorResponseBuilder: (_request, context) => fail(
      "RATE_LIMITED",
      `Too many requests. Try again in ${context.after} seconds.`,
    ),
    onExceeded: (request, key) => {
      request.log.warn({ rateLimitKey: key }, "request rate limit exceeded");
    },
  });

  app.register(systemRoutes, { prefix: config.API_PREFIX });
  app.register(authRoutes, { prefix: config.API_PREFIX });
  const selectedMediaStorage = options.mediaStorage ?? mediaStorage;
  const clientEvidenceReviewService = new ClientEvidenceReviewService(selectedMediaStorage);
  app.register(clientJobsRoutes, { prefix: config.API_PREFIX, evidenceReviewService: clientEvidenceReviewService });
  app.register(workerJobsRoutes, { prefix: config.API_PREFIX });
  app.register(adminWorkerRoutes, { prefix: config.API_PREFIX });
  app.register(adminRoutes, { prefix: config.API_PREFIX });
  app.register(syncRoutes, { prefix: config.API_PREFIX });
  app.register(workerSyncRoutes, { prefix: config.API_PREFIX });
  app.register(notificationRoutes, { prefix: config.API_PREFIX });
  const paymentGateway = options.paymentGateway ?? createPaymentGateway();
  const ledger = new LedgerService(paymentGateway);
  const paymentDispatcher = new PaymentDispatchRuntime(paymentGateway);
  app.register(financialRoutes, { prefix: config.API_PREFIX, ledger });
  app.register(paymentWebhookRoutes, { prefix: config.API_PREFIX, ledger });
  const backgroundRuntime = options.backgroundRuntime ?? new BackgroundQueueRuntime(
    selectedMediaStorage,
    options.pushGateway ?? createPushGateway(),
  );
  const evidenceService = new WorkEvidenceService(selectedMediaStorage, () => backgroundRuntime.kick());
  app.register(workRoutes, {
    prefix: config.API_PREFIX,
    evidenceService,
  });
  const realtimeHub = new RealtimeHub(
    app.server,
    options.realtimeEnabled ?? (config.REALTIME_ENABLED === "true"),
  );

  app.addHook("onReady", async () => {
    if (config.NODE_ENV === "production") {
      await evidenceService.assertStorageReady();
    }
    await realtimeHub.start();
    await backgroundRuntime.start();
    await paymentDispatcher.start();
  });
  app.addHook("onClose", async () => {
    await Promise.all([realtimeHub.close(), backgroundRuntime.close(), paymentDispatcher.close()]);
  });

  // Authenticated, role-guarded example to exercise requireAuth + requireRole.
  app.get(
    `${config.API_PREFIX}/protected`,
    { onRequest: [requireAuth] },
    async (request) => {
      return { success: true, data: { user: request.auth }, error: null };
    },
  );

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send(fail("NOT_FOUND", `Route ${request.method} ${request.url} not found`));
  });

  app.setErrorHandler((err, request, reply) => {
    request.log.error({ err }, "unhandled error");
    const { code, message, statusCode } = getErrorResponseDetails(err);
    if (statusCode >= 500) {
      captureException(err, {
        method: request.method,
        requestId: request.id,
        route: request.routeOptions.url,
        statusCode,
      });
    }
    reply.code(statusCode).send(fail(code, message));
  });

  return app;
}

async function start(): Promise<void> {
  initializeObservability();
  installProcessErrorHandlers();
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    await closeConnections();
    await flushObservability();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: config.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error({ err }, "API startup failed");
    captureException(err, { source: "api-startup" });
    await closeConnections();
    await flushObservability();
    process.exit(1);
  }
}

// Only auto-start when executed directly (keeps vitest/supertest imports side-effect free).
if (process.argv[1] && require.main === module) {
  void start();
}

export { pool, redis };
