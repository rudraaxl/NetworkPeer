import * as Sentry from "@sentry/node";
import pino, { type Logger } from "pino";
import { config } from "./config.js";

const redactedPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
  "authorization",
  "access_token",
  "refresh_token",
  "client_secret",
  "password",
  "otp",
];

const transport = config.LOG_PRETTY === "true"
  ? pino.transport({ target: "pino-pretty", options: { colorize: true, singleLine: true } })
  : undefined;

export const logger: Logger = pino(
  {
    level: config.LOG_LEVEL,
    base: {
      service: "networkpeer-api",
      environment: config.NODE_ENV,
    },
    redact: {
      paths: redactedPaths,
      censor: "[REDACTED]",
    },
  },
  transport,
);

let sentryInitialized = false;
let processHandlersInstalled = false;

/** Initialize Sentry only when a real DSN is supplied. Safe to call repeatedly. */
export function initializeObservability(): void {
  if (sentryInitialized || !config.SENTRY_DSN) return;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENVIRONMENT || config.NODE_ENV,
    release: config.SENTRY_RELEASE || undefined,
    tracesSampleRate: config.SENTRY_TRACES_SAMPLE_RATE,
    sendDefaultPii: false,
  });
  sentryInitialized = true;
  logger.info("Sentry error tracking initialized");
}

export function captureException(
  error: unknown,
  context: Record<string, unknown> = {},
): void {
  if (!sentryInitialized) return;
  Sentry.withScope((scope) => {
    scope.setContext("networkpeer", context);
    Sentry.captureException(error);
  });
}

export async function flushObservability(timeoutMs = 2_000): Promise<void> {
  if (!sentryInitialized) return;
  await Sentry.flush(timeoutMs).catch(() => false);
}

/**
 * A process that reaches either handler can no longer be trusted. Capture the
 * fault, flush telemetry briefly, and let the orchestrator replace the process.
 */
export function installProcessErrorHandlers(): void {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;

  const fatal = async (source: "uncaughtException" | "unhandledRejection", error: unknown) => {
    logger.fatal({ err: error, source }, "fatal process error");
    captureException(error, { source });
    await flushObservability();
    process.exit(1);
  };

  process.once("uncaughtException", (error) => {
    void fatal("uncaughtException", error);
  });
  process.once("unhandledRejection", (reason) => {
    void fatal("unhandledRejection", reason);
  });
}
