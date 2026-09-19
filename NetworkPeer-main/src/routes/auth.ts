import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authService } from "../services/auth-service.js";
import { AuthError, signTokenPair, verifyLocalRefreshToken, type TokenPair } from "../auth.js";
import { requireAuth } from "../middleware/auth.js";
import { ok, fail } from "../contracts.js";
import { parseBody } from "../utils/validation.js";
import { config } from "../config.js";
import {
  getUserProfile,
  updateUserProfile,
  getUserById,
  getUserByEmail,
  resolveEmailUser,
} from "../repository.js";
import { emailService } from "../services/email-service.js";

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, "Phone number must be in E.164 format, e.g. +1234567890");

const transportSchema = z.enum(["browser", "native"]);

const requestEmailOtpSchema = z.object({
  email: z.string().trim().email("Valid email address is required"),
  role: z.enum(["CLIENT", "WORKER"]).default("CLIENT"),
}).strict();

const verifyEmailOtpSchema = z.object({
  email: z.string().trim().email("Valid email address is required"),
  otp: z.string().trim().regex(/^\d{4,8}$/, "OTP must be 4-8 digits"),
  challenge_id: z.string().optional(),
  transport: transportSchema.default("native"),
  full_name: z.string().trim().optional(),
  mobile_number: phoneSchema.optional(),
}).strict();

const refreshSchema = z.object({
  refresh_token: z.string().min(1).optional(),
}).strict().default({});

const refreshCookieName = config.WEB_SESSION_COOKIE_NAME;

function cookieOptions() {
  const options = {
    httpOnly: true,
    maxAge: config.COGNITO_REFRESH_TTL_SECONDS,
    path: `${config.API_PREFIX}/auth`,
    sameSite: config.WEB_SESSION_COOKIE_SAME_SITE as "lax" | "none" | "strict",
    secure: config.WEB_SESSION_COOKIE_SECURE === "true",
  };
  return config.WEB_SESSION_COOKIE_DOMAIN ? { ...options, domain: config.WEB_SESSION_COOKIE_DOMAIN } : options;
}

function allowedBrowserOrigins(): Set<string> {
  return new Set(config.CORS_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean));
}

function requireAllowedBrowserOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin) {
    if (config.NODE_ENV === "production") {
      throw new AuthError("CSRF_ORIGIN_REQUIRED", "Browser authentication requests must include an Origin header", 403);
    }
    return;
  }
  if (!allowedBrowserOrigins().has(origin)) {
    throw new AuthError("CSRF_ORIGIN_INVALID", "Browser authentication request origin is not allowed", 403);
  }
}

function browserTokenResponse(tokens: TokenPair) {
  return {
    access_token: tokens.access_token,
    expires_in: tokens.expires_in,
    user: tokens.user,
  };
}

function refreshTokenFromRequest(
  request: FastifyRequest,
  body: { refresh_token?: string },
): { token: string; browser: boolean } {
  const cookieToken = request.cookies?.[refreshCookieName];
  if (cookieToken) {
    requireAllowedBrowserOrigin(request);
    return { token: cookieToken, browser: true };
  }
  if (!body.refresh_token) {
    throw new AuthError("REFRESH_TOKEN_MISSING", "A refresh token is required", 400);
  }
  return { token: body.refresh_token, browser: false };
}

interface StoredEmailChallenge {
  id: string;
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  consumed: boolean;
  role: "CLIENT" | "WORKER";
}

const emailChallengeMap = new Map<string, StoredEmailChallenge>();
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxCount = 5, windowMs = 600_000): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxCount) {
    return false;
  }
  entry.count++;
  return true;
}

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  // Passwordless Email OTP Request Endpoint (§12, §21)
  app.post("/auth/email-otp/request", async (request, reply) => {
    const body = parseBody(requestEmailOtpSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }

    const email = body.value.email.toLowerCase();
    const clientIp = request.ip || "unknown-ip";

    if (!checkRateLimit(`email:${email}`, 5, 600_000) || !checkRateLimit(`ip:${clientIp}`, 15, 600_000)) {
      reply.header("Retry-After", "60");
      return reply.code(429).send(fail("RATE_LIMITED", "Too many authentication attempts. Please try again shortly."));
    }

    // Generate 6-digit code
    const rawCode = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const codeHash = createHash("sha256").update(rawCode).digest("hex");
    const challengeId = `chn_${randomBytes(16).toString("hex")}`;
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    const challenge: StoredEmailChallenge = {
      id: challengeId,
      email,
      codeHash,
      expiresAt,
      attempts: 0,
      consumed: false,
      role: body.value.role,
    };

    emailChallengeMap.set(challengeId, challenge);
    emailChallengeMap.set(`email:${email}`, challenge);

    request.log.info({ email, challengeId }, "[Email-OTP] Code issued (Hash stored)");

    // Dispatch via configured production email provider (Resend, SES, SMTP, or Log)
    await emailService.sendOtpEmail({
      to: email,
      code: rawCode,
      clientIp,
      role: body.value.role,
    });

    return ok({
      challenge_id: challengeId,
      expires_in_seconds: 600,
      otp_length: 6,
      delivery: { transport: "email" },
      development_otp: config.NODE_ENV !== "production" ? rawCode : undefined,
    });
  });

  // Passwordless Email OTP Verify Endpoint (§12, §21)
  app.post("/auth/email-otp/verify", async (request, reply) => {
    const body = parseBody(verifyEmailOtpSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }

    if (body.value.transport === "browser") requireAllowedBrowserOrigin(request);

    const email = body.value.email.toLowerCase();
    const challenge = (body.value.challenge_id ? emailChallengeMap.get(body.value.challenge_id) : null)
      ?? emailChallengeMap.get(`email:${email}`);

    if (!challenge) {
      return reply.code(400).send(fail("OTP_INVALID", "No active verification challenge found. Please request a new code."));
    }
    if (challenge.consumed) {
      return reply.code(400).send(fail("OTP_ALREADY_USED", "The verification code has already been used."));
    }
    if (Date.now() > challenge.expiresAt) {
      return reply.code(400).send(fail("OTP_EXPIRED", "The verification code has expired."));
    }
    if (challenge.attempts >= 5) {
      return reply.code(429).send(fail("OTP_LOCKED", "Too many incorrect attempts. Please request a fresh code."));
    }

    const inputHash = createHash("sha256").update(body.value.otp).digest("hex");
    const expectedHash = Buffer.from(challenge.codeHash, "hex");
    const providedHash = Buffer.from(inputHash, "hex");
    const isValid = expectedHash.length === providedHash.length
      && timingSafeEqual(expectedHash, providedHash);

    if (!isValid) {
      challenge.attempts++;
      return reply.code(400).send(fail("OTP_INVALID", "The verification code is incorrect."));
    }

    challenge.consumed = true;

    // Check user existence
    let existingUser = await getUserByEmail(email);
    let isNewAccount = false;

    if (!existingUser) {
      // §21: Full Name and Mobile Number are MANDATORY on registration / account setup
      const fullName = body.value.full_name?.trim();
      const mobileNumber = body.value.mobile_number?.trim();

      if (!fullName || fullName.length < 2) {
        return reply.code(400).send(fail("VALIDATION_ERROR", "Full name is required (minimum 2 characters)"));
      }

      if (!mobileNumber || !/^\+?[1-9]\d{6,14}$/.test(mobileNumber)) {
        return reply.code(400).send(fail("VALIDATION_ERROR", "A valid mobile number is required"));
      }

      const role = challenge?.role ?? "CLIENT";
      existingUser = await resolveEmailUser({
        email,
        phone: mobileNumber.startsWith("+") ? mobileNumber : `+${mobileNumber}`,
        fullName,
        role,
      });
      isNewAccount = true;
    } else {
      // If user exists but is missing name, update if provided
      if (body.value.full_name && body.value.full_name.trim().length >= 2) {
        await updateUserProfile(existingUser.id, { fullName: body.value.full_name.trim() });
        existingUser = await getUserById(existingUser.id) ?? existingUser;
      }
    }

    const tokenUser = {
      id: existingUser.id,
      role: existingUser.role,
      phone: existingUser.phone_number,
      email: existingUser.email,
      full_name: existingUser.full_name,
    };

    const tokens = signTokenPair(tokenUser);

    if (body.value.transport === "browser") {
      reply.setCookie(refreshCookieName, tokens.refresh_token, cookieOptions());
      return ok({ ...browserTokenResponse(tokens), is_new_account: isNewAccount });
    }

    return ok({ ...tokens, is_new_account: isNewAccount });
  });

  app.post("/auth/refresh", async (request, reply) => {
    const body = parseBody(refreshSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }
    try {
      const refresh = refreshTokenFromRequest(request, body.value);

      // Check if local token
      try {
        const decoded = verifyLocalRefreshToken(refresh.token);
        const user = await getUserById(decoded.sub);
        if (user && user.is_active) {
          const freshTokens = signTokenPair({
            id: user.id,
            role: user.role,
            phone: user.phone_number,
            email: user.email,
            full_name: user.full_name,
          });
          if (refresh.browser) {
            reply.setCookie(refreshCookieName, freshTokens.refresh_token, cookieOptions());
            return ok(browserTokenResponse(freshTokens));
          }
          return ok(freshTokens);
        }
      } catch {
        // Fallback to Cognito refresh
      }

      if (config.COGNITO_USER_POOL_ID) {
        const result = await authService.refresh(refresh.token);
        if (refresh.browser) {
          reply.setCookie(refreshCookieName, result.refresh_token, cookieOptions());
          return ok(browserTokenResponse(result));
        }
        return ok(result);
      }

      throw new AuthError("TOKEN_INVALID", "Unable to refresh session");
    } catch (err) {
      return handleAuthError(request, reply, err);
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    const body = parseBody(refreshSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }
    let browser = false;
    try {
      const refresh = refreshTokenFromRequest(request, body.value);
      browser = refresh.browser;
      if (config.COGNITO_USER_POOL_ID) {
        await authService.logout(refresh.token);
      }
      return ok({ logged_out: true });
    } catch (err) {
      return handleAuthError(request, reply, err);
    } finally {
      if (browser) reply.clearCookie(refreshCookieName, cookieOptions());
    }
  });

  app.get("/auth/me", { onRequest: [requireAuth] }, async (request) => {
    return ok({
      id: request.auth.userId,
      role: request.auth.role,
      phone: request.auth.phone,
    });
  });

  app.get("/auth/profile", { onRequest: [requireAuth] }, async (request, reply) => {
    const profile = await getUserProfile(request.auth.userId);
    if (!profile) {
      return reply.code(404).send(fail("USER_NOT_FOUND", "User profile not found"));
    }
    return ok(profile);
  });

  const updateProfileSchema = z
    .object({
      full_name: z.string().trim().min(2, "Full name must be at least 2 characters").max(100).optional(),
      mobile_number: phoneSchema.optional(),
      email: z.string().email().nullable().optional(),
      avatar_url: z.string().url().nullable().optional(),
      skills: z.array(z.string().max(50)).max(20).optional(),
      preferred_radius_km: z.number().int().min(1).max(200).optional(),
      is_available: z.boolean().optional(),
    })
    .strict();

  app.patch("/auth/profile", { onRequest: [requireAuth] }, async (request, reply) => {
    const body = parseBody(updateProfileSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }
    const updated = await updateUserProfile(request.auth.userId, {
      fullName: body.value.full_name,
      mobileNumber: body.value.mobile_number,
      email: body.value.email,
      avatarUrl: body.value.avatar_url,
      skills: body.value.skills,
      preferredRadiusKm: body.value.preferred_radius_km,
      isAvailable: body.value.is_available,
    });
    if (!updated) {
      return reply.code(404).send(fail("USER_NOT_FOUND", "User profile not found"));
    }
    return ok(updated);
  });
}

function handleAuthError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof AuthError) {
    request.log.warn({ code: err.code }, "authentication request rejected");
    if (err.statusCode === 429) reply.header("Retry-After", "60");
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }

  request.log.error({ err }, "authentication request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}
