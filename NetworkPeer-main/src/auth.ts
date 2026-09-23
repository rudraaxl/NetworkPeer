import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "./config.js";
import type { UserRole } from "./contracts.js";

/** A normalized authentication error suitable for the API error envelope. */
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

/**
 * Access-token claims used by the API.
 */
export type AccessTokenClaims = {
  sub: string;
  exp: number;
  clientId: string;
  username: string | null;
  groups: string[];
};

export type TokenUser = { id: string; role: UserRole; phone: string; email?: string | null; full_name?: string };

/** Normalized tokens for web and native clients. */
export type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: TokenUser;
  /**
   * NP-11: identifies the local refresh session so it can be revoked. Absent on
   * the Cognito path, where revocation is Cognito's responsibility.
   */
  refresh_jti?: string;
  refresh_expires_at?: Date;
};

export type AccessTokenVerifier = {
  verify(token: string): Promise<Record<string, unknown>>;
};

let verifier: AccessTokenVerifier | null = null;
let verifierOverride: AccessTokenVerifier | null = null;

export function assertCognitoConfigured(): void {
  if (!config.COGNITO_USER_POOL_ID || !config.COGNITO_CLIENT_ID || !config.COGNITO_ISSUER) {
    throw new AuthError(
      "AUTH_NOT_CONFIGURED",
      "Amazon Cognito authentication is not configured for this environment",
      503,
    );
  }
}

function accessVerifier(): AccessTokenVerifier {
  assertCognitoConfigured();
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: config.COGNITO_USER_POOL_ID,
      tokenUse: "access",
      clientId: config.COGNITO_CLIENT_ID,
    }) as unknown as AccessTokenVerifier;
  }
  return verifier;
}

/** Generates local signed JWT token pair for passwordless email auth */
export function signTokenPair(user: TokenUser): TokenPair {
  const expiresIn = config.COGNITO_REFRESH_TTL_SECONDS || 86400 * 7;
  const accessExp = Math.floor(Date.now() / 1000) + 86400; // 24h
  const payload = {
    sub: user.id,
    exp: accessExp,
    iat: Math.floor(Date.now() / 1000),
    client_id: "networkpeer-app",
    username: user.phone || user.id,
    "cognito:groups": [user.role],
    phone: user.phone,
    role: user.role,
  };
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", config.JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  const accessToken = `${encodedHeader}.${encodedPayload}.${signature}`;

  const refreshJti = randomBytes(16).toString("hex");
  const refreshExp = Math.floor(Date.now() / 1000) + expiresIn;
  const refreshPayload = {
    sub: user.id,
    type: "refresh",
    role: user.role,
    phone: user.phone,
    exp: refreshExp,
    iat: Math.floor(Date.now() / 1000),
    // NP-11: this was an anonymous "nonce" that nothing recorded. As a jti it
    // names a row in refresh_sessions, which is what makes revocation possible.
    jti: refreshJti,
  };
  const encRefreshPayload = Buffer.from(JSON.stringify(refreshPayload)).toString("base64url");
  const refreshSignature = createHmac("sha256", config.JWT_SECRET)
    .update(`${encodedHeader}.${encRefreshPayload}`)
    .digest("base64url");
  const refreshToken = `${encodedHeader}.${encRefreshPayload}.${refreshSignature}`;

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 86400,
    user,
    refresh_jti: refreshJti,
    refresh_expires_at: new Date(refreshExp * 1000),
  };
}

export function verifyLocalRefreshToken(token: string): { sub: string; role?: UserRole; phone?: string; jti?: string } {
  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("TOKEN_INVALID", "Invalid refresh token format");
  const [headerB64, payloadB64, signature] = parts;
  if (!headerB64 || !payloadB64 || !signature) throw new AuthError("TOKEN_INVALID", "Invalid refresh token format");
  const expectedSig = createHmac("sha256", config.JWT_SECRET)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new AuthError("TOKEN_INVALID", "Invalid refresh token signature");
  }
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  if (payload.exp && payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AuthError("TOKEN_EXPIRED", "Refresh token has expired");
  }
  return { sub: payload.sub, role: payload.role, phone: payload.phone, jti: payload.jti };
}

/** A marketplace principal must belong to exactly one trusted Cognito role group. */
export function roleFromCognitoGroups(groups: readonly string[]): UserRole {
  const roles = groups.filter(
    (group): group is UserRole => group === "CLIENT" || group === "WORKER" || group === "ADMIN",
  );
  if (roles.length !== 1) {
    throw new AuthError("TOKEN_INVALID", "Token has an invalid role assignment");
  }
  return roles[0]!;
}

function requiredString(value: unknown, claim: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthError("TOKEN_INVALID", `Token is missing ${claim}`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, claim: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new AuthError("TOKEN_INVALID", `Token has an invalid ${claim}`);
  }
  return value;
}

/**
 * Verifies local HS256 JWTs or Cognito RS256 access tokens.
 */
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  if (!token || token.length > 16_384) {
    throw new AuthError("TOKEN_INVALID", "Bearer token is malformed");
  }

  // NP-03: the "demo-" prefix used to mint a fully authenticated principal --
  // including ADMIN -- from an attacker-supplied string. Every token now has to
  // survive real signature verification below.

  // Check local HS256 JWT
  const parts = token.split(".");
  if (parts.length === 3) {
    try {
      const [headerB64, payloadB64, signature] = parts;
      if (headerB64 && payloadB64 && signature) {
        const expectedSig = createHmac("sha256", config.JWT_SECRET)
          .update(`${headerB64}.${payloadB64}`)
          .digest("base64url");
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
          const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
          const exp = requiredPositiveInteger(payload["exp"], "expiry");
          if (exp <= Math.floor(Date.now() / 1000)) {
            throw new AuthError("TOKEN_EXPIRED", "Token has expired");
          }
          const groups = Array.isArray(payload["cognito:groups"])
            ? payload["cognito:groups"].filter((group): group is string => typeof group === "string")
            : [String(payload["role"] || "CLIENT")];
          return {
            sub: requiredString(payload["sub"], "subject"),
            exp,
            clientId: typeof payload["client_id"] === "string" ? payload["client_id"] : "networkpeer-app",
            username: typeof payload["username"] === "string" ? payload["username"] : null,
            groups,
          };
        }
      }
    } catch (e) {
      if (e instanceof AuthError) throw e;
    }
  }

  // Fallback to Cognito if configured
  if (config.COGNITO_USER_POOL_ID && config.COGNITO_CLIENT_ID) {
    try {
      const payload = await (verifierOverride ?? accessVerifier()).verify(token);
      const exp = requiredPositiveInteger(payload["exp"], "expiry");
      if (exp <= Math.floor(Date.now() / 1000)) {
        throw new AuthError("TOKEN_EXPIRED", "Token has expired");
      }
      const groups = Array.isArray(payload["cognito:groups"])
        ? payload["cognito:groups"].filter((group): group is string => typeof group === "string")
        : [];
      return {
        sub: requiredString(payload["sub"], "subject"),
        exp,
        clientId: requiredString(payload["client_id"], "client ID"),
        username: typeof payload["username"] === "string" ? payload["username"] : null,
        groups,
      };
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError("TOKEN_INVALID", "Cognito token verification failed");
    }
  }

  throw new AuthError("TOKEN_INVALID", "Invalid or unrecognized authentication token");
}

/** Test-only verifier injection; production cannot mint or bypass Cognito JWTs. */
export function setAccessTokenVerifierForTests(next: AccessTokenVerifier | null): void {
  if (process.env["NODE_ENV"] !== "test") {
    throw new Error("Test Cognito verifier injection is only available in NODE_ENV=test");
  }
  verifierOverride = next;
}

