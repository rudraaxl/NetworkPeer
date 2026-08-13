import { config } from "./config.js";
import { closeConnections } from "./db.js";
import { mediaStorage } from "./services/media-storage-service.js";
import { createPushGateway } from "./services/push-notification-service.js";
import { BackgroundQueueRuntime } from "./services/background-queue-service.js";
import { createPaymentGateway } from "./services/payment-gateway-service.js";
import { PaymentDispatchRuntime } from "./services/payment-dispatch-service.js";
import {
  captureException,
  flushObservability,
  initializeObservability,
  installProcessErrorHandlers,
  logger,
} from "./observability.js";

async function start(): Promise<void> {
  initializeObservability();
  installProcessErrorHandlers();
  if (config.NODE_ENV === "production") await mediaStorage.assertReady?.();
  const runtime = new BackgroundQueueRuntime(mediaStorage, createPushGateway());
  const paymentDispatcher = new PaymentDispatchRuntime(createPaymentGateway());
  await Promise.all([runtime.start(), paymentDispatcher.start()]);

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "background worker shutting down");
    await Promise.all([runtime.close(), paymentDispatcher.close()]);
    await closeConnections();
    await flushObservability();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

start().catch(async (err) => {
  logger.fatal({ err }, "background worker failed to start");
  captureException(err, { source: "background-worker-startup" });
  await closeConnections();
  await flushObservability();
  process.exit(1);
});
