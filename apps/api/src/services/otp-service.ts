/**
 * OTP lifecycle service: rate-limited generation and constant-time verification.
 * Delivery is a stub in Phase 2 (SMS/FCM wiring arrives in a later phase).
 */

import {
  AuthError,
  generateOtp,
  hashOtp,
  otpMatches,
  getStoredOtpHash,
  storeOtp,
  consumeStoredOtp,
  isRateLimited,
  resetRateLimit,
  incrementAttempts,
} from "../auth.js";
import { config } from "../config.js";
import { smsProvider, renderOtpMessage } from "./sms-provider.js";

const REQUEST_RATE_KEY = (phone: string) => `otp:req:${phone}`;
const VERIFY_RATE_KEY = (phone: string) => `otp:verify:${phone}`;
const FAIL_COUNT_KEY = (phone: string) => `otp:fail:${phone}`;

export interface OtpDelivery {
  transport: "sms" | "log";
  to?: string;
}

export class OtpService {
  /**
   * Generate, store and "deliver" an OTP for a phone number.
   * In production the code is sent via an SMS/notification provider (no echo);
   * in dev/test the code is returned so the flow can be exercised.
   */
  async request(phone: string): Promise<{
    expiresInSeconds: number;
    otpLength: number;
    otp?: string;
    delivery: OtpDelivery;
  }> {
    const limited = await isRateLimited(
      REQUEST_RATE_KEY(phone),
      config.OTP_RATE_LIMIT_WINDOW_MS,
      config.OTP_RATE_LIMIT_MAX,
    );
    if (limited) {
      throw new AuthError("OTP_RATE_LIMITED", "Too many OTP requests. Try again later.", 429);
    }

    const otp = generateOtp(config.OTP_LENGTH);
    await storeOtp(phone, otp, config.OTP_TTL_SECONDS);
    await resetRateLimit(VERIFY_RATE_KEY(phone));
    await resetRateLimit(FAIL_COUNT_KEY(phone));

    // Deliver the code via the configured SMS provider (console in dev,
    // Twilio/others in production). Never echo it to the client in production.
    const delivery: OtpDelivery =
      smsProvider.name === "console"
        ? { transport: "log", to: phone }
        : { transport: "sms", to: phone };

    try {
      await smsProvider.send(phone, renderOtpMessage(otp, config.OTP_TTL_SECONDS));
    } catch {
      // Do not leave a server-side code valid if the provider definitively
      // rejected delivery. Compare-and-delete avoids removing a concurrent
      // retry's newer OTP.
      await consumeStoredOtp(phone, hashOtp(otp)).catch(() => false);
      throw new AuthError(
        "OTP_DELIVERY_FAILED",
        "We could not deliver a verification code. Please try again shortly.",
        503,
      );
    }

    const echo = config.OTP_ECHO_IN_RESPONSE === "true";
    return {
      expiresInSeconds: config.OTP_TTL_SECONDS,
      otpLength: config.OTP_LENGTH,
      otp: echo ? otp : undefined,
      delivery,
    };
  }

  async verify(phone: string, providedOtp: string): Promise<void> {
    const limited = await isRateLimited(
      VERIFY_RATE_KEY(phone),
      config.OTP_RATE_LIMIT_WINDOW_MS,
      config.OTP_VERIFY_RATE_LIMIT_MAX,
    );
    if (limited) {
      throw new AuthError("OTP_RATE_LIMITED", "Too many verification attempts. Try again later.", 429);
    }

    const storedHash = await getStoredOtpHash(phone);
    if (!storedHash) {
      throw new AuthError("OTP_EXPIRED", "OTP is missing or has expired. Request a new one.", 400);
    }

    if (!otpMatches(providedOtp, storedHash)) {
      const failures = await incrementAttempts(FAIL_COUNT_KEY(phone), config.OTP_TTL_SECONDS);
      if (failures >= config.OTP_MAX_VERIFY_ATTEMPTS) {
        await consumeStoredOtp(phone, storedHash);
      }
      throw new AuthError("OTP_INVALID", "Invalid OTP.", 400);
    }

    if (!(await consumeStoredOtp(phone, storedHash))) {
      throw new AuthError("OTP_EXPIRED", "OTP has already been used or has expired. Request a new one.", 400);
    }
    await resetRateLimit(VERIFY_RATE_KEY(phone));
    await resetRateLimit(FAIL_COUNT_KEY(phone));
  }
}

export const otpService = new OtpService();
