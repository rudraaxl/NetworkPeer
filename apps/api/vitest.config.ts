import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    isolate: true,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    env: {
      NODE_ENV: "test",
      PAYMENT_GATEWAY: "stub",
      PAYMENT_WEBHOOK_SECRET: "ci-payment-webhook-secret-1234567890",
      PAYMENT_DISPATCH_ENABLED: "false",
      BACKGROUND_QUEUES_ENABLED: "false",
      LOG_PRETTY: "false",
    },
  },
});