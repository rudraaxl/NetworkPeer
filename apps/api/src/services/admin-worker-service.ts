import type { WorkerJobProfile, WorkerVerificationStatus } from "../repository.js";
import { adminService, AdminServiceError } from "./admin-service.js";

export class AdminWorkerServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "AdminWorkerServiceError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class AdminWorkerService {
  async setVerification(
    actorUserId: string,
    workerId: string,
    verificationStatus: WorkerVerificationStatus,
    isAvailable: boolean,
    reason: string,
  ): Promise<WorkerJobProfile> {
    try {
      const result = await adminService.updateWorkerVerification({
        actorUserId,
        workerId,
        verificationStatus,
        isAvailable,
        reason,
      });
      return result.profile;
    } catch (err) {
      if (err instanceof AdminServiceError && err.statusCode === 409) {
        throw new AdminWorkerServiceError(
          "WORKER_HAS_ACTIVE_JOB",
          "Resolve active work before changing worker verification",
          409,
        );
      }
      if (err instanceof AdminServiceError && err.statusCode === 404) {
        throw new AdminWorkerServiceError("WORKER_NOT_FOUND", "Worker profile not found", 404);
      }
      if (err instanceof AdminServiceError) {
        throw new AdminWorkerServiceError(err.code, err.message, err.statusCode);
      }
      throw err;
    }
  }
}

export const adminWorkerService = new AdminWorkerService();
