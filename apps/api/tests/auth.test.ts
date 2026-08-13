import { describe, expect, it } from "vitest";
import {
  AuthError,
  generateOtp,
  hashOtp,
  otpMatches,
  parseDurationToSeconds,
  signAccessToken,
  verifyAccessToken,
} from "../src/auth.js";

describe("duration parsing", () => {
  it("parses common TTL formats", () => {
    expect(parseDurationToSeconds("15m")).toBe(900);
    expect(parseDurationToSeconds("7d")).toBe(604800);
    expect(parseDurationToSeconds("1h")).toBe(3600);
    expect(parseDurationToSeconds("45s")).toBe(45);
  });

  it("rejects malformed durations", () => {
    expect(() => parseDurationToSeconds("abc")).toThrow();
    expect(() => parseDurationToSeconds("0m")).toThrow();
  });
});

describe("OTP", () => {
  it("generates codes of the requested length", () => {
    for (let len = 4; len <= 8; len++) {
      const otp = generateOtp(len);
      expect(otp).toMatch(new RegExp(`^\\d{${len}}$`));
    }
  });

  it("does not store the OTP in plaintext", () => {
    const otp = generateOtp(6);
    const hash = hashOtp(otp);
    expect(hash).not.toContain(otp);
    expect(hash).toHaveLength(64); // sha256 hex
  });

  it("matches only the exact OTP, in constant time", () => {
    const otp = generateOtp(6);
    const hash = hashOtp(otp);
    expect(otpMatches(otp, hash)).toBe(true);
    expect(otpMatches("000000", hash)).toBe(false);
    expect(otpMatches(String(Number(otp) + 1).padStart(6, "0"), hash)).toBe(false);
  });
});

describe("access token JWT", () => {
  const subscriber = { id: "user-1", role: "WORKER" as const, phone: "+15550001111" };

  it("signs and verifies a token with correct claims", () => {
    const token = signAccessToken(subscriber);
    const claims = verifyAccessToken(token);
    expect(claims.sub).toBe("user-1");
    expect(claims.role).toBe("WORKER");
    expect(claims.phone).toBe("+15550001111");
    expect(claims.type).toBe("access");
  });

  it("rejects a tampered signature", () => {
    const token = signAccessToken(subscriber);
    const [header, payload] = token.split(".");
    const forged = `${header}.${payload}.${"a".repeat(43)}`; // base64url 32-byte sig
    expect(() => verifyAccessToken(forged)).toThrow(AuthError);
  });

  it("rejects tokens with extra JWT segments", () => {
    const token = signAccessToken(subscriber);
    expect(() => verifyAccessToken(`${token}.unexpected`)).toThrow(AuthError);
  });

  it("rejects non-canonical signature encodings", () => {
    const token = signAccessToken(subscriber);
    // Buffer.from(..., "base64url") ignores some invalid characters unless
    // verification validates the encoded segment before comparing bytes.
    expect(() => verifyAccessToken(`${token}!`)).toThrow(AuthError);
  });

  it("rejects base64url aliases that decode to the same signature bytes", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const [header, payload, signature] = signAccessToken(subscriber).split(".") as [string, string, string];
    const signatureBytes = Buffer.from(signature, "base64url");
    const alias = [...alphabet]
      .map((lastCharacter) => `${signature.slice(0, -1)}${lastCharacter}`)
      .find((candidate) => candidate !== signature && Buffer.from(candidate, "base64url").equals(signatureBytes));

    expect(alias).toBeDefined();
    expect(() => verifyAccessToken(`${header}.${payload}.${alias}`)).toThrow(AuthError);
  });
});
