import { z } from "zod";
import dotenv from "dotenv";
import { isIP } from "node:net";

dotenv.config();

const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/networkpeer";
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_JWT_SECRET = "development-only-jwt-secret-please-change";
const DEFAULT_JWT_REFRESH_SECRET = "development-only-refresh-secret-please-change";

function isPlaceholderSecret(secret: string): boolean {
  const normalized = secret.toLowerCase();
  return ["development", "change", "your-", "example", "placeholder"].some((marker) =>
    normalized.includes(marker),
  );
}

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function databaseUrlUsesTls(value: string): boolean {
  const sslmode = new URL(value).searchParams.get("sslmode");
  return sslmode === "require" || sslmode === "verify-ca" || sslmode === "verify-full";
}

function isAllowedInternalHost(value: string, allowedHosts: readonly string[]): boolean {
  try {
    return allowedHosts.includes(new URL(value).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isValidS3BucketName(value: string): boolean {
  return (
    /^(?=.{3,63}$)(?!\d+\.\d+\.\d+\.\d+$)[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(value) &&
    !value.includes("..") &&
    !value.includes(".-") &&
    !value.includes("-.")
  );
}

function parseCorsOrigins(value: string): string[] {
  return value.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function parseTrustedProxyCidrs(value: string): string[] {
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function isTrustedProxyCidr(value: string): boolean {
  const [address, prefix] = value.split("/");
  if (!address || (value.match(/\//g) ?? []).length > 1) return false;
  const family = isIP(address);
  if (family === 0 || address === "0.0.0.0" || address === "::") return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const parsed = Number(prefix);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= (family === 4 ? 32 : 128);
}

function hasProductionGradeSecret(value: string): boolean {
  if (Buffer.byteLength(value, "utf8") < 32) return false;
  // This rejects trivial repeated strings while allowing secret-manager values
  // encoded as raw text, base64, or hex.
  return new Set(value).size >= 8;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  API_PREFIX: z.string().default("/api/v1"),

  DATABASE_URL: z.string().url().default(DEFAULT_DATABASE_URL),
  // Privileged workflows use isolated DB principals in production. They fall
  // back to DATABASE_URL only for local development and integration tests.
  DATABASE_ADMIN_URL: z.string().url().optional(),
  DATABASE_MEDIA_VERIFIER_URL: z.string().url().optional(),
  DATABASE_FINANCIAL_URL: z.string().url().optional(),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).default(2),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
  // Docker Compose can opt into plaintext only on its private bridge network.
  // Hosted production services must keep this false and use TLS endpoints.
  ALLOW_INSECURE_INTERNAL_TRANSPORT: z.enum(["true", "false"]).default("false"),

  REDIS_URL: z.string().url().default(DEFAULT_REDIS_URL),

  JWT_SECRET: z.string().min(32).default(DEFAULT_JWT_SECRET),
  JWT_REFRESH_SECRET: z.string().min(32).default(DEFAULT_JWT_REFRESH_SECRET),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("7d"),
  JWT_ISSUER: z.string().default("networkpeer-api"),
  JWT_AUDIENCE: z.string().default("networkpeer-mobile"),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  OTP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(3),
  OTP_VERIFY_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_ECHO_IN_RESPONSE: z.enum(["true", "false"]).default("true"),
  OTP_SMS_TEMPLATE: z
    .string()
    .default("Your NetworkPeer OTP is {{code}}. It expires in {{minutes}} minutes."),

  SMS_PROVIDER: z.enum(["console", "twilio"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().default(""),
  TWILIO_AUTH_TOKEN: z.string().default(""),
  TWILIO_FROM_NUMBER: z.string().default(""),
  SMS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(10000),

  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().default(""),
  AWS_SECRET_ACCESS_KEY: z.string().default(""),
  AWS_SESSION_TOKEN: z.string().default(""),
  AWS_S3_BUCKET: z.string().default("networkpeer-media"),
  AWS_S3_PRESIGNED_URL_EXPIRY_SECONDS: z.coerce.number().int().min(60).max(840).default(600),
  MEDIA_MAX_FILE_SIZE_BYTES: z.coerce.number().int().min(1024).max(100 * 1024 * 1024).default(25 * 1024 * 1024),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_CONNECT_CLIENT_ID: z.string().default(""),
  PAYMENT_GATEWAY: z.enum(["stub", "stripe"]).default("stub"),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).default("development-payment-webhook-secret"),
  PAYMENT_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(9_999).default(1_000),
  PAYMENT_DISPATCH_ENABLED: z.enum(["true", "false"]).default("true"),
  PAYMENT_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
  PAYMENT_DISPATCH_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),

  FIREBASE_PROJECT_ID: z.string().default(""),
  FIREBASE_CLIENT_EMAIL: z.string().default(""),
  FIREBASE_PRIVATE_KEY: z.string().default(""),
  PUSH_NOTIFICATIONS_ENABLED: z.enum(["true", "false"]).default("false"),
  PUSH_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  BACKGROUND_QUEUES_ENABLED: z.enum(["true", "false"]).default("true"),
  BACKGROUND_QUEUE_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  BACKGROUND_MEDIA_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(2),
  BACKGROUND_PUSH_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),

  CORS_ORIGINS: z.string().default("http://localhost:3001,http://localhost:5173"),
  TRUST_PROXY_CIDRS: z
    .string()
    .default("")
    .transform(parseTrustedProxyCidrs)
    .refine((entries) => entries.every(isTrustedProxyCidr), "TRUST_PROXY_CIDRS contains an invalid IP/CIDR"),
  REALTIME_ENABLED: z.enum(["true", "false"]).default("true"),
  SYNC_MAX_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(100),

  SENTRY_DSN: z.union([z.literal(""), z.string().url()]).default(""),
  SENTRY_ENVIRONMENT: z.string().trim().max(64).default(""),
  SENTRY_RELEASE: z.string().trim().max(200).default(""),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  MAX_REQUEST_BODY_BYTES: z.coerce.number().int().min(1024).max(10 * 1024 * 1024).default(1024 * 1024),
  WORKER_NEARBY_MAX_RADIUS_KM: z.coerce.number().int().min(1).max(500).default(100),

  LOG_LEVEL: z.string().default("info"),
  LOG_PRETTY: z.enum(["true", "false"]).default("true"),
}).superRefine((env, ctx) => {
  if (env.DATABASE_POOL_MIN > env.DATABASE_POOL_MAX) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_POOL_MIN"],
      message: "DATABASE_POOL_MIN cannot exceed DATABASE_POOL_MAX",
    });
  }

  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_REFRESH_SECRET"],
      message: "JWT_REFRESH_SECRET must differ from JWT_SECRET",
    });
  }

  if (Boolean(env.AWS_ACCESS_KEY_ID) !== Boolean(env.AWS_SECRET_ACCESS_KEY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AWS_ACCESS_KEY_ID"],
      message: "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together",
    });
  }
  if (env.AWS_SESSION_TOKEN && !env.AWS_ACCESS_KEY_ID) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AWS_SESSION_TOKEN"],
      message: "AWS_SESSION_TOKEN requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY",
    });
  }

  if (parseCorsOrigins(env.CORS_ORIGINS).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CORS_ORIGINS"],
      message: "CORS_ORIGINS must contain at least one origin",
    });
  }

  if (env.PUSH_NOTIFICATIONS_ENABLED === "true") {
    for (const key of ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when PUSH_NOTIFICATIONS_ENABLED=true`,
        });
      }
    }
  }

  if (env.SMS_PROVIDER === "twilio") {
    for (const key of ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] as const) {
      if (!env[key]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is required when SMS_PROVIDER=twilio`,
        });
      }
    }
    if (!/^\+[1-9]\d{1,14}$/.test(env.TWILIO_FROM_NUMBER)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TWILIO_FROM_NUMBER"],
        message: "TWILIO_FROM_NUMBER must be an E.164 phone number",
      });
    }
    if (env.OTP_ECHO_IN_RESPONSE === "true") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OTP_ECHO_IN_RESPONSE"],
        message: "OTP_ECHO_IN_RESPONSE must be disabled when SMS_PROVIDER=twilio",
      });
    }
  }

  if (env.NODE_ENV !== "production") return;

  const allowInsecureInternalTransport = env.ALLOW_INSECURE_INTERNAL_TRANSPORT === "true";
  if (allowInsecureInternalTransport) {
    const databaseUrls = [
      env.DATABASE_URL,
      env.DATABASE_ADMIN_URL,
      env.DATABASE_MEDIA_VERIFIER_URL,
      env.DATABASE_FINANCIAL_URL,
    ].filter((value): value is string => Boolean(value));
    if (!databaseUrls.every((value) => isAllowedInternalHost(value, ["postgres", "postgis"]))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALLOW_INSECURE_INTERNAL_TRANSPORT"],
        message: "ALLOW_INSECURE_INTERNAL_TRANSPORT is limited to private Docker postgres/postgis hosts",
      });
    }
    if (!isAllowedInternalHost(env.REDIS_URL, ["redis"])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ALLOW_INSECURE_INTERNAL_TRANSPORT"],
        message: "ALLOW_INSECURE_INTERNAL_TRANSPORT is limited to the private Docker redis host",
      });
    }
  }

  if (env.DATABASE_URL === DEFAULT_DATABASE_URL || isLoopbackUrl(env.DATABASE_URL)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_URL"],
      message: "Production DATABASE_URL must be explicitly configured",
    });
  }

  const databaseUrl = new URL(env.DATABASE_URL);
  if (databaseUrl.username.toLowerCase() === "postgres") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_URL"],
      message: "Production DATABASE_URL must use a dedicated non-superuser application role",
    });
  }
  if (!databaseUrlUsesTls(env.DATABASE_URL) && !allowInsecureInternalTransport) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DATABASE_URL"],
      message: "Production DATABASE_URL must require TLS using sslmode=require or stronger",
    });
  }

  for (const key of ["DATABASE_ADMIN_URL", "DATABASE_MEDIA_VERIFIER_URL", "DATABASE_FINANCIAL_URL"] as const) {
    const value = env[key];
    if (!value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} is required in production for privileged database workflows`,
      });
      continue;
    }
    const url = new URL(value);
    if (value === env.DATABASE_URL || url.username === databaseUrl.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must use a dedicated database principal`,
      });
    }
    if (url.username.toLowerCase() === "postgres") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must use a non-superuser role`,
      });
    }
    if (!databaseUrlUsesTls(value) && !allowInsecureInternalTransport) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `${key} must use sslmode=require or stronger`,
      });
    }
  }

  if (env.PAYMENT_GATEWAY === "stub") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PAYMENT_GATEWAY"],
      message: "PAYMENT_GATEWAY=stub is not allowed in production",
    });
  }
  if (env.PAYMENT_DISPATCH_ENABLED !== "true") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PAYMENT_DISPATCH_ENABLED"],
      message: "PAYMENT_DISPATCH_ENABLED must be enabled in production",
    });
  }
  if (!env.STRIPE_SECRET_KEY || isPlaceholderSecret(env.STRIPE_SECRET_KEY)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STRIPE_SECRET_KEY"],
      message: "STRIPE_SECRET_KEY is required for production payments",
    });
  }
  if (!env.STRIPE_WEBHOOK_SECRET || isPlaceholderSecret(env.STRIPE_WEBHOOK_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STRIPE_WEBHOOK_SECRET"],
      message: "STRIPE_WEBHOOK_SECRET is required for production payments",
    });
  }
  if (isPlaceholderSecret(env.PAYMENT_WEBHOOK_SECRET) || !hasProductionGradeSecret(env.PAYMENT_WEBHOOK_SECRET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PAYMENT_WEBHOOK_SECRET"],
      message: "PAYMENT_WEBHOOK_SECRET must be a production-grade secret",
    });
  }

  if (env.REDIS_URL === DEFAULT_REDIS_URL || isLoopbackUrl(env.REDIS_URL)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["REDIS_URL"],
      message: "Production REDIS_URL must be explicitly configured",
    });
  }
  if (new URL(env.REDIS_URL).protocol !== "rediss:" && !allowInsecureInternalTransport) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["REDIS_URL"],
      message: "Production REDIS_URL must use TLS (rediss://)",
    });
  }

  if (
    env.JWT_SECRET === DEFAULT_JWT_SECRET
    || isPlaceholderSecret(env.JWT_SECRET)
    || !hasProductionGradeSecret(env.JWT_SECRET)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_SECRET"],
      message: "Production JWT_SECRET must be a real secret, not a default placeholder",
    });
  }

  if (
    env.JWT_REFRESH_SECRET === DEFAULT_JWT_REFRESH_SECRET ||
    isPlaceholderSecret(env.JWT_REFRESH_SECRET) ||
    !hasProductionGradeSecret(env.JWT_REFRESH_SECRET)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["JWT_REFRESH_SECRET"],
      message: "Production JWT_REFRESH_SECRET must be a real secret, not a default placeholder",
    });
  }

  if (env.SMS_PROVIDER === "console") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SMS_PROVIDER"],
      message: "SMS_PROVIDER=console is not allowed in production because it logs OTPs",
    });
  }

  if (env.OTP_ECHO_IN_RESPONSE === "true") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OTP_ECHO_IN_RESPONSE"],
      message: "OTP_ECHO_IN_RESPONSE must be disabled in production",
    });
  }

  if (env.LOG_PRETTY === "true") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["LOG_PRETTY"],
      message: "LOG_PRETTY must be disabled in production (pino-pretty is dev-only)",
    });
  }

  if (env.AWS_S3_BUCKET === "networkpeer-media" || !isValidS3BucketName(env.AWS_S3_BUCKET)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AWS_S3_BUCKET"],
      message: "Production AWS_S3_BUCKET must be explicitly configured",
    });
  }

  for (const origin of parseCorsOrigins(env.CORS_ORIGINS)) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:") {
        throw new Error("not HTTPS");
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["CORS_ORIGINS"],
        message: "Production CORS_ORIGINS must contain only explicit HTTPS origins",
      });
      break;
    }
  }

});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten());
  process.exit(1);
}

export const config = {
  ...parsed.data,
  DATABASE_ADMIN_URL: parsed.data.DATABASE_ADMIN_URL ?? parsed.data.DATABASE_URL,
  DATABASE_MEDIA_VERIFIER_URL: parsed.data.DATABASE_MEDIA_VERIFIER_URL ?? parsed.data.DATABASE_URL,
  DATABASE_FINANCIAL_URL: parsed.data.DATABASE_FINANCIAL_URL ?? parsed.data.DATABASE_URL,
};

export type Config = typeof config;
