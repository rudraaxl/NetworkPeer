import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  isValidTransition,
  nextStates,
  isTerminal,
  canBeClaimed,
  canClientCancel,
  canWorkOn,
  isWorkflowOpen,
} from "../src/state-machine.js";

describe("job state machine", () => {
  it("follows the canonical lifecycle", () => {
    const path = [
      "POSTED",
      "ASSIGNED",
      "EN_ROUTE",
      "AT_LOCATION",
      "IN_PROGRESS",
      "SUBMITTED",
      "APPROVED",
      "COMPLETED",
    ] as const;
    for (let i = 0; i < path.length - 1; i++) {
      expect(isValidTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it("rejects invalid transitions", () => {
    expect(isValidTransition("POSTED", "COMPLETED")).toBe(false);
    expect(isValidTransition("COMPLETED", "ASSIGNED")).toBe(false);
    expect(isValidTransition("POSTED", "IN_PROGRESS")).toBe(false);
  });

  it("rejects revisiting a status", () => {
    expect(isValidTransition("IN_PROGRESS", "ASSIGNED")).toBe(false);
  });

  it("assertValidTransition throws on invalid moves", () => {
    expect(() => assertValidTransition("POSTED", "APPROVED")).toThrow();
    expect(() => assertValidTransition("POSTED", "ASSIGNED")).not.toThrow();
  });

  it("allows worker cancellation before submission", () => {
    for (const s of ["ASSIGNED", "EN_ROUTE", "AT_LOCATION", "IN_PROGRESS"] as const) {
      expect(isValidTransition(s, "CANCELLED")).toBe(true);
    }
  });

  it("rejects cancellation once submitted", () => {
    expect(isValidTransition("SUBMITTED", "CANCELLED")).toBe(false);
    expect(isValidTransition("COMPLETED", "CANCELLED")).toBe(false);
  });

  it("does not advertise admin transitions that PostgreSQL rejects", () => {
    expect(isValidTransition("POSTED", "COMPLETED", true)).toBe(false);
    expect(isValidTransition("ASSIGNED", "COMPLETED", true)).toBe(false);
    expect(isValidTransition("DISPUTED", "APPROVED", true)).toBe(true);
  });

  it("regular flow cannot reach COMPLETED without approval", () => {
    expect(isValidTransition("IN_PROGRESS", "COMPLETED")).toBe(false);
  });

  it("exposes terminal / claimable / workable predicates", () => {
    expect(isTerminal("COMPLETED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("ASSIGNED")).toBe(false);
    expect(canBeClaimed("POSTED")).toBe(true);
    expect(canBeClaimed("ASSIGNED")).toBe(false);
    expect(canWorkOn("AT_LOCATION")).toBe(true);
    expect(canWorkOn("SUBMITTED")).toBe(false);
    expect(isWorkflowOpen("EN_ROUTE")).toBe(true);
    expect(isWorkflowOpen("COMPLETED")).toBe(false);
  });

  it("nextTransition returns the allowed successors", () => {
    expect(nextStates("POSTED")).toEqual(expect.arrayContaining(["ASSIGNED", "CANCELLED"]));
  });

  it("allows a client to cancel only an unfunded FUNDING job", () => {
    expect(canClientCancel("FUNDING")).toBe(true);
    expect(canClientCancel("POSTED")).toBe(false);
    expect(canClientCancel("ASSIGNED")).toBe(false);
    expect(canClientCancel("IN_PROGRESS")).toBe(false);
    expect(canClientCancel("SUBMITTED")).toBe(false);
    expect(canClientCancel("COMPLETED")).toBe(false);
  });
});
