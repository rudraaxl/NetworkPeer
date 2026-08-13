/**
 * Auth workflow service: register/login via OTP, token issuance, refresh,
 * logout. Bridges the repository (DB user) with the auth primitives (Redis).
 */

import {
  AuthError,
  issueTokenPair,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  type TokenPair,
  type TokenUser,
} from "../auth.js";
import {
  createUser,
  getUserByPhone,
  markUserVerified,
  recordLastLogin,
} from "../repository.js";
import { otpService } from "./otp-service.js";

export class AuthService {
  async requestOtp(phone: string) {
    return otpService.request(phone);
  }

  /**
   * Verify the OTP, then create-or-fetch the user. First-time users are
   * created with the requested public role (CLIENT or WORKER); a WORKER also
   * gets a worker_profile row. Existing provisioned ADMIN accounts authenticate
   * as their persisted role and can never be created through this public flow.
   */
  async verifyOtpAndLogin(input: {
    phone: string;
    otp: string;
    role?: "CLIENT" | "WORKER";
  }): Promise<TokenPair> {
    await otpService.verify(input.phone, input.otp);

    let user = await getUserByPhone(input.phone);
    if (!user) {
      if (!input.role) {
        throw new AuthError("ROLE_REQUIRED", "A role is required for a new account", 400);
      }
      user = await createUser({ phone: input.phone, role: input.role });
    } else if (!user.is_active) {
      throw new AuthError("USER_NOT_AUTHORIZED", "User is not authorized", 403);
    } else if (input.role && user.role !== input.role) {
      throw new AuthError("ROLE_MISMATCH", "The requested role does not match this account", 403);
    }
    await markUserVerified(user.id);
    await recordLastLogin(user.id);

    const tokenUser: TokenUser = { id: user.id, role: user.role, phone: user.phone_number };
    return issueTokenPair(tokenUser, signAccessToken);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return rotateRefreshToken(refreshToken, signAccessToken);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await revokeRefreshToken(refreshToken, userId);
  }
}

export const authService = new AuthService();
