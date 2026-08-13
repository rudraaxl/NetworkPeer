import type { JobStatus } from "./contracts.js";

/**
 * Pure state machine for job lifecycle transitions.
 * NO database or HTTP side-effects — this module only encodes valid transitions
 * and guards. Source of truth for what may transition to what.
 */

export const JOB_STATUSES: readonly JobStatus[] = [
  "FUNDING",
  "POSTED",
  "ASSIGNED",
  "EN_ROUTE",
  "AT_LOCATION",
  "IN_PROGRESS",
  "SUBMITTED",
  "APPROVED",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
] as const;

/**
 * Canonical happy-path lifecycle defined in the roadmap:
 * FUNDING -> POSTED -> ASSIGNED -> EN_ROUTE -> AT_LOCATION -> IN_PROGRESS -> SUBMITTED -> APPROVED -> COMPLETED
 */
const TRANSITIONS: ReadonlyMap<JobStatus, ReadonlySet<JobStatus>> = new Map<JobStatus, ReadonlySet<JobStatus>>([
  ["FUNDING", new Set(["POSTED", "CANCELLED"])],
  ["POSTED", new Set(["ASSIGNED", "CANCELLED"])],
  ["ASSIGNED", new Set(["EN_ROUTE", "CANCELLED", "DISPUTED"])],
  ["EN_ROUTE", new Set(["AT_LOCATION", "CANCELLED", "DISPUTED"])],
  ["AT_LOCATION", new Set(["IN_PROGRESS", "CANCELLED", "DISPUTED"])],
  ["IN_PROGRESS", new Set(["SUBMITTED", "CANCELLED", "DISPUTED"])],
  ["SUBMITTED", new Set(["APPROVED", "DISPUTED"])],
  ["APPROVED", new Set(["COMPLETED", "DISPUTED"])],
  ["COMPLETED", new Set()],
  ["CANCELLED", new Set()],
  ["DISPUTED", new Set(["APPROVED"])],
]);

// Administrative job overrides require a dedicated audited PostgreSQL function.
// Until that function exists, all callers use the same durable transition set
// enforced by migrations/005; a TypeScript-only admin bypass is forbidden.
const ADMIN_TRANSITIONS = TRANSITIONS;

export function isValidTransition(from: JobStatus, to: JobStatus, admin = false): boolean {
  const table = admin ? ADMIN_TRANSITIONS : TRANSITIONS;
  return table.get(from)?.has(to) ?? false;
}

export function assertValidTransition(from: JobStatus, to: JobStatus, admin = false): void {
  if (!isValidTransition(from, to, admin)) {
    throw new Error(`Invalid job state transition: ${from} -> ${to}`);
  }
}

export function nextStates(from: JobStatus, admin = false): readonly JobStatus[] {
  const table = admin ? ADMIN_TRANSITIONS : TRANSITIONS;
  return [...(table.get(from) ?? new Set<JobStatus>())];
}

export function isTerminal(status: JobStatus): boolean {
  return status === "COMPLETED" || status === "CANCELLED";
}

export function canBeClaimed(status: JobStatus): boolean {
  return status === "POSTED";
}

/**
 * A client may cancel an unfunded FUNDING job. Once escrow is held, cancellation
 * needs an explicit audited refund workflow rather than silent fund release.
 */
export function canClientCancel(status: JobStatus): boolean {
  return status === "FUNDING";
}

export function canWorkOn(status: JobStatus): boolean {
  return new Set(["ASSIGNED", "EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"]).has(status);
}

export function isWorkflowOpen(status: JobStatus): boolean {
  return !isTerminal(status) && !["FUNDING", "POSTED", "SUBMITTED", "APPROVED"].includes(status);
}
