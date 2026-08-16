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
  getUserById,
  getUserByPhone,
  markUserVerified,
  recordLastLogin,
  updateUserFullName,
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
    fullName?: string;
  }): Promise<TokenPair & { is_new_account: boolean }> {
    await otpService.verify(input.phone, input.otp);

    let user = await getUserByPhone(input.phone);
    let isNewAccount = false;
    if (!user) {
      if (!input.role) {
        throw new AuthError("ROLE_REQUIRED", "A role is required for a new account", 400);
      }
      user = await createUser({
        phone: input.phone,
        role: input.role,
        fullName: input.fullName,
      });
      isNewAccount = true;
    } else if (!user.is_active) {
      throw new AuthError("USER_NOT_AUTHORIZED", "User is not authorized", 403);
    } else if (input.role && user.role !== input.role) {
      throw new AuthError("ROLE_MISMATCH", "The requested role does not match this account", 403);
    }
    if (input.fullName && user.full_name === "Unnamed user") {
      user = await updateUserFullName(user.id, input.fullName);
    }
    await markUserVerified(user.id);
    await recordLastLogin(user.id);

    const tokenUser: TokenUser = { id: user.id, role: user.role, phone: user.phone_number, full_name: user.full_name };
    const pair = await issueTokenPair(tokenUser, signAccessToken);
    return { ...pair, is_new_account: isNewAccount };
  }

  async updateProfile(userId: string, fullName: string): Promise<{ full_name: string }> {
    const user = await updateUserFullName(userId, fullName);
    return { full_name: user.full_name };
  }

  async getProfile(userId: string) {
    return getUserById(userId);
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return rotateRefreshToken(refreshToken, signAccessToken);
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await revokeRefreshToken(refreshToken, userId);
  }
}

export const authService = new AuthService();
