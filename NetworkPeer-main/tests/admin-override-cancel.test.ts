import { afterEach, describe, expect, it, vi } from "vitest";

const adminOverrideJob = vi.hoisted(() => vi.fn());

vi.mock("../src/repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/repository.js")>();
  return { ...actual, adminOverrideJob };
});

import { adminService, AdminServiceError } from "../src/services/admin-service.js";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const JOB_ID = "00000000-0000-4000-8000-0000000000aa";

/** enforce_job_financial_state raises 23514 for a CANCELLED job whose escrow is
 *  still HELD or FROZEN. */
function financialStateRejection(): Error & { code: string } {
  return Object.assign(
    new Error("Funded jobs require an explicit refund before cancellation"),
    { code: "23514" },
  );
}

afterEach(() => {
  adminOverrideJob.mockReset();
});

describe("adminService.overrideJob — cancelling a funded job", () => {
  it("tells the operator to refund first instead of surfacing an opaque conflict", async () => {
    adminOverrideJob.mockRejectedValue(financialStateRejection());

    const attempt = adminService.overrideJob({
      actorUserId: ADMIN_ID,
      jobId: JOB_ID,
      action: "CANCEL",
      reason: "Client no longer needs the survey",
    } as Parameters<typeof adminService.overrideJob>[0]);

    await expect(attempt).rejects.toBeInstanceOf(AdminServiceError);
    await expect(attempt).rejects.toMatchObject({
      code: "REFUND_REQUIRED_BEFORE_CANCEL",
      statusCode: 409,
    });
    // The message has to name the route, otherwise the operator is stuck: the
    // trigger's own wording says a refund is needed but not how to issue one.
    await expect(attempt).rejects.toThrow(/\/admin\/jobs\/:jobId\/refund/);
  });

  it("leaves the generic conflict mapping alone for other actions", async () => {
    // A STATUS override that trips the same trigger is a different problem and
    // must not be relabelled as a refund prerequisite.
    adminOverrideJob.mockRejectedValue(financialStateRejection());

    const attempt = adminService.overrideJob({
      actorUserId: ADMIN_ID,
      jobId: JOB_ID,
      action: "STATUS",
      targetStatus: "APPROVED",
      reason: "Manual settlement correction",
    } as Parameters<typeof adminService.overrideJob>[0]);

    await expect(attempt).rejects.toMatchObject({
      code: "ADMIN_OPERATION_CONFLICT",
      statusCode: 409,
    });
  });

  it("still maps a missing job to 404 on a cancel", async () => {
    adminOverrideJob.mockRejectedValue(Object.assign(new Error("not found"), { code: "P0002" }));

    const attempt = adminService.overrideJob({
      actorUserId: ADMIN_ID,
      jobId: JOB_ID,
      action: "CANCEL",
      reason: "Cancel a job that does not exist",
    } as Parameters<typeof adminService.overrideJob>[0]);

    await expect(attempt).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("passes an unfunded cancellation straight through", async () => {
    adminOverrideJob.mockResolvedValue({ auditId: "9100", job: { id: JOB_ID, status: "CANCELLED" } });

    const result = await adminService.overrideJob({
      actorUserId: ADMIN_ID,
      jobId: JOB_ID,
      action: "CANCEL",
      reason: "Client withdrew before funding",
    } as Parameters<typeof adminService.overrideJob>[0]);

    expect(result.audit_id).toBe("9100");
  });
});
