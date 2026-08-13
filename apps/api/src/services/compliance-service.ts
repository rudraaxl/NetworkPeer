import {
  recordConsent,
  withdrawConsent,
  deleteUserData,
  openDispute,
  resolveDispute,
} from "../repository.js";

export class ComplianceServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "ComplianceServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function mapDatabaseError(err: unknown): never {
  if (err instanceof ComplianceServiceError) throw err;
  const code = (err as { code?: unknown })?.code;
  if (code === "P0002") throw new ComplianceServiceError("NOT_FOUND", "The requested record was not found", 404);
  if (code === "55000" || code === "23514") {
    throw new ComplianceServiceError("COMPLIANCE_OPERATION_CONFLICT", "The requested compliance operation is not allowed", 409);
  }
  throw err;
}

export class ComplianceService {
  async grantConsent(userId: string, purpose: string): Promise<void> {
    try {
      await recordConsent(userId, purpose);
    } catch (err) {
      mapDatabaseError(err);
    }
  }

  async withdraw(userId: string, purpose: string): Promise<void> {
    try {
      await withdrawConsent(userId, purpose);
    } catch (err) {
      mapDatabaseError(err);
    }
  }

  async deleteUserData(userId: string): Promise<void> {
    try {
      await deleteUserData(userId);
    } catch (err) {
      mapDatabaseError(err);
    }
  }

  async openDispute(actorUserId: string, jobId: string, reason: string): Promise<{ dispute_id: string }> {
    try {
      const disputeId = await openDispute(actorUserId, jobId, reason);
      if (!disputeId) throw new ComplianceServiceError("DISPUTE_FAILED", "Dispute could not be opened", 409);
      return { dispute_id: disputeId };
    } catch (err) {
      if (err instanceof ComplianceServiceError) throw err;
      mapDatabaseError(err);
    }
  }

  async resolve(
    actorUserId: string,
    disputeId: string,
    resolution: "RESOLVED_REFUND" | "RESOLVED_RELEASE",
    resolutionText: string,
  ): Promise<{ resolved: boolean }> {
    try {
      return { resolved: await resolveDispute(actorUserId, disputeId, resolution, resolutionText) };
    } catch (err) {
      if (err instanceof ComplianceServiceError) throw err;
      mapDatabaseError(err);
    }
  }
}

export const complianceService = new ComplianceService();
