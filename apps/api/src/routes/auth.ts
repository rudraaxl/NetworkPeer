import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authService } from "../services/auth-service.js";
import { AuthError } from "../auth.js";
import { requireAuth } from "../middleware/auth.js";
import { ok, fail } from "../contracts.js";
import { parseBody } from "../utils/validation.js";
import { config } from "../config.js";

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{1,14}$/, "Phone number must be in E.164 format, e.g. +1234567890");

const requestOtpSchema = z.object({
  phone_number: phoneSchema,
}).strict();

const verifyOtpSchema = z.object({
  phone_number: phoneSchema,
  otp: z.string().regex(/^\d{4,8}$/, "OTP must be 4-8 digits"),
  role: z.enum(["CLIENT", "WORKER"]).optional(),
}).strict();

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
}).strict();

export default async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post("/auth/otp/request", async (request, reply) => {
    const body = parseBody(requestOtpSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }
    try {
      const result = await authService.requestOtp(body.value.phone_number);
      return ok(result);
    } catch (err) {
      return handleAuthError(request, reply, err);
    }
  });

  app.post("/auth/otp/verify", async (request, reply) => {
    const body = parseBody(verifyOtpSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }
    try {
      const result = await authService.verifyOtpAndLogin({
        phone: body.value.phone_number,
        otp: body.value.otp,
        role: body.value.role,
      });
      return ok(result);
    } catch (err) {
      return handleAuthError(request, reply, err);
    }
  });

  app.post("/auth/refresh", async (request, reply) => {
    const body = parseBody(refreshSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }
    try {
      const result = await authService.refresh(body.value.refresh_token);
      return ok(result);
    } catch (err) {
      return handleAuthError(request, reply, err);
    }
  });

  app.post("/auth/logout", { onRequest: [requireAuth] }, async (request, reply) => {
    const body = parseBody(refreshSchema, request.body);
    if (!body.ok) {
      return reply.code(400).send(fail("VALIDATION_ERROR", body.message));
    }
    try {
      await authService.logout(request.auth.userId, body.value.refresh_token);
      return ok({ logged_out: true });
    } catch (err) {
      return handleAuthError(request, reply, err);
    }
  });

  app.get("/auth/me", { onRequest: [requireAuth] }, async (request) => {
    return ok({
      id: request.auth.userId,
      role: request.auth.role,
      phone: request.auth.phone,
    });
  });
}

function handleAuthError(request: FastifyRequest, reply: FastifyReply, err: unknown): unknown {
  if (err instanceof AuthError) {
    request.log.warn({ code: err.code }, "authentication request rejected");
    if (err.statusCode === 429) {
      reply.header("Retry-After", String(Math.ceil(config.OTP_RATE_LIMIT_WINDOW_MS / 1000)));
    }
    return reply.code(err.statusCode).send(fail(err.code, err.message));
  }

  request.log.error({ err }, "authentication request failed");
  return reply.code(500).send(fail("INTERNAL_SERVER_ERROR", "An internal server error occurred"));
}
