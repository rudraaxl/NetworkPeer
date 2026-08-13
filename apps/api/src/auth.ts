import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { redis } from "./db.js";
import type { UserRole } from "./contracts.js";
import { getUserById } from "./repository.js";

/**
 * Authentication routines: OTP lifecycle, JWT signing/verification and
 * refresh-token rotation stored in Redis.
 *
 * JWT is implemented directly on top of Node's crypto (HMAC-SHA256) so the
 * algorithm is pinned to HS256 (no "alg: none" confusion), signatures are
 * compared in constant time, and we control issuer/audience/expiry checks.
 * No third-party JWT dependency, so no transitive CVE surface.
 */

export class AuthError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 401) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Duration parsing
// ---------------------------------------------------------------------------

export function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration.trim());
  if (!match) throw new Error(`Invalid duration format: ${duration}`);
  const value = Number(match[1]);
  const unit = match[2] as "ms" | "s" | "m" | "h" | "d";
  const multipliers: Record<typeof unit, number> = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };
  const seconds = Math.floor(value * multipliers[unit]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Invalid duration: ${duration}`);
  }
  return seconds;
}

export const ACCESS_TOKEN_TTL_SECONDS = parseDurationToSeconds(config.JWT_ACCESS_TTL);
export const REFRESH_TOKEN_TTL_SECONDS = parseDurationToSeconds(config.JWT_REFRESH_TTL);

/** Minimal user identity embedded in tokens / returned to clients. */
export type TokenUser = { id: string; role: UserRole; phone: string };

// ---------------------------------------------------------------------------
// JWT primitives (HS256 only)
// ---------------------------------------------------------------------------

type JwtHeader = { alg: "HS256"; typ: "JWT" };
type BaseClaims = { iss: string; aud: string; iat: number; exp: number; jti: string; type: "access" | "refresh" };

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const USER_ROLES: ReadonlySet<UserRole> = new Set(["CLIENT", "WORKER", "ADMIN"]);

export type AccessTokenClaims = BaseClaims & {
  sub: string;
  role: UserRole;
  phone: string;
};

export type RefreshTokenClaims = BaseClaims & {
  sub: string;
  family: string;
};

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function decodeJsonSegment<T extends Record<string, unknown>>(segment: string, label: string): T {
  if (!BASE64URL_RE.test(segment)) {
    throw new AuthError("TOKEN_INVALID", `Token ${label} is malformed`);
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("JWT segment must decode to an object");
    }
    return parsed as T;
  } catch {
    throw new AuthError("TOKEN_INVALID", `Token ${label} is malformed`);
  }
}

function splitToken(token: string): [string, string, string] | null {
  const segments = token.split(".");
  if (segments.length !== 3 || segments.some((segment) => !segment)) return null;
  return segments as [string, string, string];
}

function signToken(
  secret: string,
  header: JwtHeader,
  claims: Record<string, unknown>,
): string {
  const headerSegment = base64UrlEncode(JSON.stringify(header));
  const payloadSegment = base64UrlEncode(JSON.stringify(claims));
  const signature = createHmac("sha256", secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");
  return `${headerSegment}.${payloadSegment}.${signature}`;
}

function verifySignature(secret: string, token: string): boolean {
  const segments = splitToken(token);
  if (!segments) return false;
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!BASE64URL_RE.test(signatureSegment)) return false;

  const expected = createHmac("sha256", secret)
    .update(`${headerSegment}.${payloadSegment}`)
    .digest("base64url");

  // Node's base64url decoder is intentionally permissive. Require the exact
  // canonical HMAC encoding so ignored characters cannot produce aliases for
  // an otherwise valid token.
  if (signatureSegment.length !== expected.length) return false;

  const expectedBuffer = Buffer.from(expected, "base64url");
  const providedBuffer = Buffer.from(signatureSegment, "base64url");
  if (providedBuffer.toString("base64url") !== signatureSegment) return false;
  if (expectedBuffer.length !== providedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function verifyCommonClaims(claims: BaseClaims): void {
  const now = Math.floor(Date.now() / 1000);
  if (
    typeof claims.iss !== "string" ||
    typeof claims.aud !== "string" ||
    typeof claims.iat !== "number" ||
    !Number.isSafeInteger(claims.iat) ||
    typeof claims.exp !== "number" ||
    !Number.isSafeInteger(claims.exp) ||
    typeof claims.jti !== "string" ||
    claims.jti.length === 0 ||
    (claims.type !== "access" && claims.type !== "refresh")
  ) {
    throw new AuthError("TOKEN_INVALID", "Token claims are malformed");
  }
  if (claims.iss !== config.JWT_ISSUER) {
    throw new AuthError("TOKEN_INVALID_ISSUER", "Token has an invalid issuer");
  }
  if (claims.aud !== config.JWT_AUDIENCE) {
    throw new AuthError("TOKEN_INVALID_AUDIENCE", "Token has an invalid audience");
  }
  if (claims.exp <= now) {
    throw new AuthError("TOKEN_EXPIRED", "Token has expired");
  }
  if (claims.exp <= claims.iat) {
    throw new AuthError("TOKEN_INVALID", "Token expiry is invalid");
  }
}

function signAccessToken(user: { id: string; role: UserRole; phone: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: AccessTokenClaims = {
    iss: config.JWT_ISSUER,
    aud: config.JWT_AUDIENCE,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
    type: "access",
    sub: user.id,
    role: user.role,
    phone: user.phone,
  };
  return signToken(config.JWT_SECRET, { alg: "HS256", typ: "JWT" }, claims);
}

function signRefreshToken(payload: { sub: string; family: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: RefreshTokenClaims = {
    iss: config.JWT_ISSUER,
    aud: config.JWT_AUDIENCE,
    iat: now,
    exp: now + REFRESH_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
    type: "refresh",
    sub: payload.sub,
    family: payload.family,
  };
  return signToken(config.JWT_REFRESH_SECRET, { alg: "HS256", typ: "JWT" }, claims);
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  if (!verifySignature(config.JWT_SECRET, token)) {
    throw new AuthError("TOKEN_INVALID", "Token signature is invalid");
  }
  const [headerSegment, payloadSegment] = splitToken(token)!;
  const header = decodeJsonSegment<JwtHeader>(headerSegment, "header");
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new AuthError("TOKEN_INVALID_ALG", "Unsupported token algorithm");
  }
  const claims = decodeJsonSegment<AccessTokenClaims>(payloadSegment, "payload");
  verifyCommonClaims(claims);
  if (claims.type !== "access") {
    throw new AuthError("TOKEN_WRONG_TYPE", "Expected an access token");
  }
  if (
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.role !== "string" ||
    !USER_ROLES.has(claims.role as UserRole) ||
    typeof claims.phone !== "string" ||
    claims.phone.length === 0
  ) {
    throw new AuthError("TOKEN_INVALID", "Token is missing required claims");
  }
  return claims as AccessTokenClaims;
}

export function verifyRefreshToken(token: string): RefreshTokenClaims {
  if (!verifySignature(config.JWT_REFRESH_SECRET, token)) {
    throw new AuthError("TOKEN_INVALID", "Refresh token signature is invalid");
  }
  const [headerSegment, payloadSegment] = splitToken(token)!;
  const header = decodeJsonSegment<JwtHeader>(headerSegment, "header");
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new AuthError("TOKEN_INVALID_ALG", "Unsupported token algorithm");
  }
  const claims = decodeJsonSegment<RefreshTokenClaims>(payloadSegment, "payload");
  verifyCommonClaims(claims);
  if (claims.type !== "refresh") {
    throw new AuthError("TOKEN_WRONG_TYPE", "Expected a refresh token");
  }
  if (
    typeof claims.sub !== "string" ||
    claims.sub.length === 0 ||
    typeof claims.family !== "string" ||
    claims.family.length === 0
  ) {
    throw new AuthError("TOKEN_INVALID", "Refresh token is missing required claims");
  }
  return claims as RefreshTokenClaims;
}

// ---------------------------------------------------------------------------
// OTP primitives
// ---------------------------------------------------------------------------

export function generateOtp(length = config.OTP_LENGTH): string {
  // 10^(length-1) .. 10^length - 1, exclusive upper bound, cryptographically secure.
  const min = 10 ** (length - 1);
  const max = 10 ** length - 1;
  return String(randomInt(min, max + 1)).padStart(length, "0");
}

export function hashOtp(otp: string): string {
  // Hash the OTP before storing so a Redis dump never leaks a usable code.
  return createHash("sha256").update(`${config.JWT_SECRET}:${otp}`).digest("hex");
}

export function otpMatches(provided: string, storedHash: string): boolean {
  const providedHash = Buffer.from(hashOtp(provided), "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");
  if (providedHash.length !== storedBuffer.length) return false;
  return timingSafeEqual(providedHash, storedBuffer);
}

// ---------------------------------------------------------------------------
// Redis rate limiting (atomic)
// ---------------------------------------------------------------------------

export async function isRateLimited(key: string, windowMs: number, max: number): Promise<boolean> {
  const count = await incrementWithTtl(key, windowMs, "PX");
  return count > max;
}

export async function resetRateLimit(key: string): Promise<void> {
  await redis.del(key);
}

// ---------------------------------------------------------------------------
// OTP storage in Redis
// ---------------------------------------------------------------------------

function otpKey(phone: string): string {
  return `otp:${phone}`;
}

export async function storeOtp(phone: string, otp: string, ttlSeconds = config.OTP_TTL_SECONDS): Promise<void> {
  await redis.set(otpKey(phone), hashOtp(otp), "EX", ttlSeconds);
}

export async function getStoredOtpHash(phone: string): Promise<string | null> {
  return redis.get(otpKey(phone));
}

export async function deleteOtp(phone: string): Promise<void> {
  await redis.del(otpKey(phone));
}

/** Consume an OTP only if its hash still matches, preventing concurrent reuse. */
export async function consumeStoredOtp(phone: string, expectedHash: string): Promise<boolean> {
  const result = await redis.eval(
    `
      local stored = redis.call('GET', KEYS[1])
      if not stored or stored ~= ARGV[1] then
        return 0
      end
      redis.call('DEL', KEYS[1])
      return 1
    `,
    1,
    otpKey(phone),
    expectedHash,
  );
  return Number(result) === 1;
}

// ---------------------------------------------------------------------------
// Refresh token sessions in Redis (rotation + family revocation)
// ---------------------------------------------------------------------------

function refreshSessionKey(jti: string): string {
  return `refresh:${jti}`;
}

function refreshFamilyKey(family: string): string {
  return `refresh:family:${family}`;
}

function refreshUserFamiliesKey(userId: string): string {
  return `refresh:user:${userId}:families`;
}

function refreshUserRevokedKey(userId: string): string {
  return `refresh:user:${userId}:revoked`;
}

async function storeRefreshSession(jti: string, sub: string, family: string): Promise<boolean> {
  const result = await redis.eval(
    `
      if redis.call('EXISTS', KEYS[4]) == 1 then
        return 0
      end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
      redis.call('SADD', KEYS[2], ARGV[3])
      redis.call('EXPIRE', KEYS[2], ARGV[2])
      redis.call('SADD', KEYS[3], ARGV[4])
      redis.call('EXPIRE', KEYS[3], ARGV[2])
      return 1
    `,
    4,
    refreshSessionKey(jti),
    refreshFamilyKey(family),
    refreshUserFamiliesKey(sub),
    refreshUserRevokedKey(sub),
    `${sub}|${family}`,
    String(REFRESH_TOKEN_TTL_SECONDS),
    jti,
    family,
  );
  return Number(result) === 1;
}

async function getRefreshSession(jti: string): Promise<{ sub: string; family: string } | null> {
  const value = await redis.get(refreshSessionKey(jti));
  if (!value) return null;
  const [sub, family] = value.split("|");
  if (!sub || !family) return null;
  return { sub, family };
}

async function revokeRefreshFamily(family: string, userId: string): Promise<void> {
  await redis.eval(
    `
      local members = redis.call('SMEMBERS', KEYS[1])
      for _, jti in ipairs(members) do
        redis.call('DEL', ARGV[1] .. jti)
      end
      redis.call('DEL', KEYS[1])
      redis.call('SREM', KEYS[2], ARGV[2])
    `,
    2,
    refreshFamilyKey(family),
    refreshUserFamiliesKey(userId),
    "refresh:",
    family,
  );
}

/** Revokes every indexed refresh family and blocks legacy unindexed sessions. */
export async function revokeAllRefreshTokenFamiliesForUser(userId: string): Promise<void> {
  await redis.eval(
    `
      local families = redis.call('SMEMBERS', KEYS[1])
      for _, family in ipairs(families) do
        local familyKey = ARGV[1] .. family
        local members = redis.call('SMEMBERS', familyKey)
        for _, jti in ipairs(members) do
          redis.call('DEL', ARGV[2] .. jti)
        end
        redis.call('DEL', familyKey)
      end
      redis.call('DEL', KEYS[1])
      redis.call('SET', KEYS[2], '1', 'EX', ARGV[3])
    `,
    2,
    refreshUserFamiliesKey(userId),
    refreshUserRevokedKey(userId),
    "refresh:family:",
    "refresh:",
    String(REFRESH_TOKEN_TTL_SECONDS),
  );
}

async function consumeAndReplaceRefreshSession(
  oldJti: string,
  expectedSession: string,
  newJti: string,
  family: string,
  userId: string,
): Promise<boolean> {
  const result = await redis.eval(
    `
      if redis.call('EXISTS', KEYS[5]) == 1 then
        return 0
      end
      local existing = redis.call('GET', KEYS[1])
      if not existing or existing ~= ARGV[1] then
        return 0
      end
      redis.call('DEL', KEYS[1])
      redis.call('SREM', KEYS[3], ARGV[4])
      redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[3])
      redis.call('SADD', KEYS[3], ARGV[2])
      redis.call('EXPIRE', KEYS[3], ARGV[3])
      redis.call('SADD', KEYS[4], ARGV[5])
      redis.call('EXPIRE', KEYS[4], ARGV[3])
      return 1
    `,
    5,
    refreshSessionKey(oldJti),
    refreshSessionKey(newJti),
    refreshFamilyKey(family),
    refreshUserFamiliesKey(userId),
    refreshUserRevokedKey(userId),
    expectedSession,
    newJti,
    String(REFRESH_TOKEN_TTL_SECONDS),
    oldJti,
    family,
  );
  return Number(result) === 1;
}

/**
 * Rotate a refresh token: the presented token must still be in Redis (single
 * use). If a token that was already rotated is replayed, we assume token theft
 * and revoke the entire refresh-token family.
 */
export async function rotateRefreshToken(
  oldToken: string,
  issueAccess: (user: TokenUser) => string,
): Promise<TokenPair> {
  const claims = verifyRefreshToken(oldToken);
  const session = await getRefreshSession(claims.jti);

  if (!session) {
    // Token already rotated or revoked -> possible theft -> kill the family.
    await revokeRefreshFamily(claims.family, claims.sub);
    throw new AuthError("TOKEN_REUSED", "Refresh token has already been used", 401);
  }

  if (session.sub !== claims.sub || session.family !== claims.family) {
    await revokeRefreshFamily(claims.family, claims.sub);
    throw new AuthError("TOKEN_REUSED", "Refresh token session mismatch", 401);
  }

  const family = session.family;
  const newRefreshToken = signRefreshToken({ sub: session.sub, family });
  const [, payloadSegment] = newRefreshToken.split(".") as [string, string];
  const payload = decodeJsonSegment<RefreshTokenClaims>(payloadSegment, "payload");
  const consumed = await consumeAndReplaceRefreshSession(
    claims.jti,
    `${session.sub}|${session.family}`,
    payload.jti,
    family,
    session.sub,
  );
  if (!consumed) {
    await revokeRefreshFamily(claims.family, claims.sub);
    throw new AuthError("TOKEN_REUSED", "Refresh token has already been used", 401);
  }

  let user: TokenUser;
  try {
    user = await fetchUserForClaims(session.sub);
  } catch (err) {
    await revokeRefreshFamily(family, session.sub);
    throw err;
  }
  const access_token = issueAccess(user);

  return {
    access_token,
    refresh_token: newRefreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    user,
  };
}

/**
 * Issue a brand-new token pair for a user (login / OTP verify).
 */
export async function issueTokenPair(
  user: TokenUser,
  issueAccess: (user: TokenUser) => string,
): Promise<TokenPair> {
  const family = randomUUID();
  const refresh_token = signRefreshToken({ sub: user.id, family });
  const [, payloadSegment] = refresh_token.split(".") as [string, string];
  const payload = decodeJsonSegment<RefreshTokenClaims>(payloadSegment, "payload");
  if (!await storeRefreshSession(payload.jti, user.id, family)) {
    throw new AuthError("USER_NOT_AUTHORIZED", "User is not authorized", 403);
  }
  const access_token = issueAccess(user);
  return { access_token, refresh_token, expires_in: ACCESS_TOKEN_TTL_SECONDS, user };
}

/**
 * Revoke all refresh tokens belonging to a token family (logout, token theft).
 */
export async function revokeRefreshToken(oldToken: string, expectedUserId?: string): Promise<void> {
  const claims = verifyRefreshToken(oldToken);
  if (expectedUserId && claims.sub !== expectedUserId) {
    throw new AuthError("TOKEN_WRONG_SUBJECT", "Refresh token does not belong to this user", 403);
  }
  await revokeRefreshFamily(claims.family, claims.sub);
}

// ---------------------------------------------------------------------------
// Support wiring: Fastify exposes the `issueAccess` callback via middleware.
// ---------------------------------------------------------------------------

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: TokenUser;
};

async function fetchUserForClaims(userId: string): Promise<TokenUser> {
  const user = await getUserById(userId);
  if (!user || !user.is_active || !user.is_verified) {
    throw new AuthError("USER_NOT_FOUND", "User referenced by token no longer exists", 401);
  }
  return { id: user.id, role: user.role, phone: user.phone_number };
}

async function incrementWithTtl(key: string, ttl: number, unit: "EX" | "PX"): Promise<number> {
  const result = await redis.eval(
    `
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then
        redis.call('PEXPIRE', KEYS[1], ARGV[1])
      end
      return count
    `,
    1,
    key,
    unit === "EX" ? String(ttl * 1000) : String(ttl),
  );
  return Number(result);
}

export async function incrementAttempts(key: string, ttlSeconds: number): Promise<number> {
  return incrementWithTtl(key, ttlSeconds, "EX");
}

export { signAccessToken, fetchUserForClaims };
