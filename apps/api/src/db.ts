import pg from "pg";
import Redis from "ioredis";
import { config } from "./config.js";
import { logger } from "./observability.js";

const { Pool } = pg;

function createPostgresPool(connectionString: string, name: string, min = config.DATABASE_POOL_MIN) {
  const instance = new Pool({
    connectionString,
    min,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  instance.on("error", (err) => {
    logger.error({ err, pool: name }, "unexpected PostgreSQL pool error");
  });
  return instance;
}

/**
 * PostgreSQL pool. PostGIS support is enabled through the `postgis` extension
 * installed on the database (see migrations/001), so no extra client options
 * are required beyond the connection string.
 */
export const pool = createPostgresPool(config.DATABASE_URL, "application");

// These pools intentionally use independent production credentials. A leaked
// request-path role cannot invoke admin, financial, or media-verifier definer
// functions directly.
export const adminPool = createPostgresPool(config.DATABASE_ADMIN_URL, "admin", 0);
export const mediaVerifierPool = createPostgresPool(config.DATABASE_MEDIA_VERIFIER_URL, "media verifier", 0);
export const financialPool = createPostgresPool(config.DATABASE_FINANCIAL_URL, "financial", 0);

function createRedis() {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  client.on("error", () => {
    logger.warn("shared Redis connection error");
  });
  return client;
}

export const redis = createRedis();

/** Disconnect all shared resources during graceful shutdown. */
export async function closeConnections(): Promise<void> {
  await Promise.allSettled([
    pool.end(),
    adminPool.end(),
    mediaVerifierPool.end(),
    financialPool.end(),
    redis.quit(),
  ]);
}
