/**
 * SMS delivery abstraction. The app talks to `smsProvider` only; providers are
 * chosen by config (SMS_PROVIDER). Add providers by implementing SmsProvider
 * and registering them in `getSmsProvider`.
 *
 * Dev: "console" logs the message to the server (OTP is also echoed to the
 *      client only when OTP_ECHO_IN_RESPONSE=true).
 * Prod: "twilio" sends a real SMS via Twilio's REST API using the global fetch
 *      (no SDK dependency, no transitive CVE surface).
 */

import { config } from "../config.js";

export interface SmsProvider {
  readonly name: "console" | "twilio";
  send(phoneNumber: string, message: string): Promise<void>;
}

export class SmsSendError extends Error {
  readonly provider: string;
  constructor(provider: string, message: string) {
    super(message);
    this.name = "SmsSendError";
    this.provider = provider;
  }
}

const CONSOLE_SMS_PROVIDER: SmsProvider = {
  name: "console",
  async send(phoneNumber, message) {
    // eslint-disable-next-line no-console
    console.log(`[sms:console] to=${phoneNumber} message=${JSON.stringify(message)}`);
  },
};

/**
 * Real SMS delivery through Twilio's Messages API.
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.
 * Credentials are never logged.
 */
class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio" as const;

  async send(phoneNumber: string, message: string): Promise<void> {
    const sid = config.TWILIO_ACCOUNT_SID;
    const token = config.TWILIO_AUTH_TOKEN;
    const from = config.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) {
      throw new SmsSendError(
        "twilio",
        "Twilio credentials missing: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER",
      );
    }

    const body = new URLSearchParams({
      From: from,
      To: phoneNumber,
      Body: message,
    });

    let response: Response;
    try {
      response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          signal: AbortSignal.timeout(config.SMS_REQUEST_TIMEOUT_MS),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          },
          body,
        },
      );
    } catch {
      throw new SmsSendError("twilio", "Twilio request could not be completed");
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "no detail");
      throw new SmsSendError(
        "twilio",
        `Twilio responded ${response.status}: ${detail.slice(0, 300)}`,
      );
    }

    const result = await response.json().catch(() => null) as {
      sid?: unknown;
      status?: unknown;
      error_code?: unknown;
    } | null;
    if (
      typeof result?.sid !== "string" ||
      result.error_code !== null && result.error_code !== undefined ||
      result.status === "failed" ||
      result.status === "undelivered"
    ) {
      throw new SmsSendError("twilio", "Twilio did not accept the SMS for delivery");
    }
  }
}

export function getSmsProvider(): SmsProvider {
  if (config.SMS_PROVIDER === "twilio") {
    return new TwilioSmsProvider();
  }
  return CONSOLE_SMS_PROVIDER;
}

/** Render the configured OTP template with the actual code. */
export function renderOtpMessage(otp: string, ttlSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));
  return config.OTP_SMS_TEMPLATE.replaceAll("{{code}}", otp).replaceAll("{{minutes}}", String(minutes));
}

export const smsProvider = getSmsProvider();
