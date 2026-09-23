import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendOtpEmail = vi.hoisted(() => vi.fn());

vi.mock("../src/services/email-service.js", () => ({
  emailService: { sendOtpEmail },
}));

vi.mock("../src/services/auth-service.js", () => ({
  authService: { logout: vi.fn(), requestOtp: vi.fn(), verifyOtpAndLogin: vi.fn() },
}));

// NP-08/NP-09/NP-10 moved challenges and rate limits into Postgres. This fake
// stands in for that table and reproduces the semantics the route depends on:
// single-use consumption, an attempt ceiling, and expiry.
const otpStore = vi.hoisted(() => new Map<string, {
  email: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  consumed: boolean;
  role: "CLIENT" | "WORKER";
}>());

vi.mock("../src/repository.js", () => ({
  getUserProfile: vi.fn(),
  updateUserProfile: vi.fn(),
  getUserById: vi.fn(),
  getUserByEmail: vi.fn().mockResolvedValue(null),
  resolveEmailUser: vi.fn(),
  consumeAuthRateLimit: vi.fn().mockResolvedValue(true),
  createEmailOtpChallenge: vi.fn(async (input: {
    challengeRef: string; email: string; codeHash: string; expiresAt: Date; role: "CLIENT" | "WORKER";
  }) => {
    otpStore.set(input.challengeRef, {
      email: input.email,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt.getTime(),
      attempts: 0,
      consumed: false,
      role: input.role,
    });
  }),
  deleteEmailOtpChallenge: vi.fn(async (ref: string) => {
    otpStore.delete(ref);
  }),
  findActiveChallengeRefByEmail: vi.fn(async (email: string) => {
    for (const [ref, entry] of otpStore) {
      if (entry.email.toLowerCase() === email.toLowerCase() && !entry.consumed && entry.expiresAt > Date.now()) {
        return ref;
      }
    }
    return null;
  }),
  registerOtpAttempt: vi.fn(async (ref: string, maxAttempts: number) => {
    const entry = otpStore.get(ref);
    if (!entry) return { outcome: "NOT_FOUND", codeHash: null, email: null, role: null };
    if (entry.consumed) return { outcome: "ALREADY_USED", codeHash: null, email: entry.email, role: entry.role };
    if (entry.expiresAt <= Date.now()) return { outcome: "EXPIRED", codeHash: null, email: entry.email, role: entry.role };
    if (entry.attempts >= maxAttempts) return { outcome: "LOCKED", codeHash: null, email: entry.email, role: entry.role };
    entry.attempts += 1;
    return { outcome: "OK", codeHash: entry.codeHash, email: entry.email, role: entry.role };
  }),
  consumeOtpChallenge: vi.fn(async (ref: string) => {
    const entry = otpStore.get(ref);
    if (!entry || entry.consumed || entry.expiresAt <= Date.now()) return false;
    entry.consumed = true;
    return true;
  }),
}));

import authRoutes from "../src/routes/auth.js";
import { config } from "../src/config.js";

let app: ReturnType<typeof Fastify> | undefined;

async function buildTestApp() {
  const testApp = Fastify();
  await testApp.register(cookie);
  await testApp.register(authRoutes, { prefix: config.API_PREFIX });
  await testApp.ready();
  return testApp;
}

function requestCode(target: ReturnType<typeof Fastify>, email: string) {
  return target.inject({
    method: "POST",
    url: `${config.API_PREFIX}/auth/email-otp/request`,
    payload: { email },
  });
}

beforeEach(() => {
  sendOtpEmail.mockReset();
  otpStore.clear();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
});

// NP-02: the request endpoint used to discard the delivery result entirely, so a
// provider that sent nothing still produced a 200 and a live challenge. A user
// then waited forever for a code that was never dispatched.
describe("email OTP delivery reporting", () => {
  it("returns 502 when the provider could not send the code", async () => {
    sendOtpEmail.mockResolvedValue({
      success: false,
      provider: "log",
      error: "No email provider is configured.",
    });
    app = await buildTestApp();

    const response = await requestCode(app, "blocked@networkpeer.io");

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("OTP_DELIVERY_FAILED");
  });

  it("does not leave a usable challenge behind after a failed send", async () => {
    sendOtpEmail.mockResolvedValue({ success: false, provider: "ses", error: "MessageRejected" });
    app = await buildTestApp();

    const email = "discarded@networkpeer.io";
    await requestCode(app, email);

    // Every 6-digit code must be rejected, because the challenge was dropped.
    const verify = await app.inject({
      method: "POST",
      url: `${config.API_PREFIX}/auth/email-otp/verify`,
      payload: { email, otp: "123456", transport: "native" },
    });

    // Both a discarded challenge and a wrong code answer OTP_INVALID, so assert
    // the message: "no active challenge" is what proves it was actually dropped
    // rather than left sitting there waiting to be guessed.
    expect(verify.statusCode).toBe(400);
    expect(verify.json().error.code).toBe("OTP_INVALID");
    expect(verify.json().error.message).toMatch(/no active verification challenge/i);
    // And it is gone from the store, not merely unreachable by this lookup.
    expect(otpStore.size).toBe(0);
  });

  it("reports success and the provider once the code is accepted for delivery", async () => {
    sendOtpEmail.mockResolvedValue({ success: true, provider: "ses", messageId: "ses-msg-1" });
    app = await buildTestApp();

    const response = await requestCode(app, "delivered@networkpeer.io");

    expect(response.statusCode).toBe(200);
    expect(response.json().data.challenge_id).toMatch(/^chn_[0-9a-f]{32}$/);
    expect(sendOtpEmail).toHaveBeenCalledTimes(1);
    expect(sendOtpEmail.mock.calls[0]?.[0]).toMatchObject({ to: "delivered@networkpeer.io" });
  });

  it("accepts a code once and refuses the replay", async () => {
    sendOtpEmail.mockResolvedValue({ success: true, provider: "ses", messageId: "ses-msg-3" });
    app = await buildTestApp();

    const email = "replay@networkpeer.io";
    const issued = await requestCode(app, email);
    const code = sendOtpEmail.mock.calls[0]?.[0]?.code as string;
    const challengeId = issued.json().data.challenge_id as string;

    const verify = (otp: string) => app!.inject({
      method: "POST",
      url: `${config.API_PREFIX}/auth/email-otp/verify`,
      payload: { email, otp, challenge_id: challengeId, transport: "native", full_name: "Replay Tester", mobile_number: "+919876543210" },
    });

    const first = await verify(code);
    expect(first.statusCode).not.toBe(400);

    const second = await verify(code);
    expect(second.statusCode).toBe(400);
    expect(second.json().error.code).toBe("OTP_ALREADY_USED");
  });

  it("stops accepting guesses after the attempt ceiling", async () => {
    sendOtpEmail.mockResolvedValue({ success: true, provider: "ses", messageId: "ses-msg-4" });
    app = await buildTestApp();

    const email = "bruteforce@networkpeer.io";
    const issued = await requestCode(app, email);
    const challengeId = issued.json().data.challenge_id as string;
    const realCode = sendOtpEmail.mock.calls[0]?.[0]?.code as string;
    const wrongCode = realCode === "000000" ? "111111" : "000000";

    const verify = (otp: string) => app!.inject({
      method: "POST",
      url: `${config.API_PREFIX}/auth/email-otp/verify`,
      payload: { email, otp, challenge_id: challengeId, transport: "native" },
    });

    for (let i = 0; i < 5; i += 1) {
      expect((await verify(wrongCode)).json().error.code).toBe("OTP_INVALID");
    }

    // The sixth guess is refused outright -- and so is the correct code, which
    // is what makes the ceiling worth having.
    const locked = await verify(realCode);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("OTP_LOCKED");
  });

  it("sends a six digit code, never the hash", async () => {
    sendOtpEmail.mockResolvedValue({ success: true, provider: "ses", messageId: "ses-msg-2" });
    app = await buildTestApp();

    await requestCode(app, "format@networkpeer.io");

    expect(sendOtpEmail.mock.calls[0]?.[0]?.code).toMatch(/^\d{6}$/);
  });
});
