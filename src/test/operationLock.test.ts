import { describe, expect, it } from "vitest";
import {
  OPERATION_LABELS_HE,
  operationInProgressPayload,
  type ProtectedOperationType,
} from "../../supabase/functions/_shared/operationLock";

/**
 * Account-level concurrency protection — client-visible contract.
 *
 * The atomic acquire/release semantics live in Postgres (acquire_operation_lock)
 * and are validated directly against the database; these tests pin the shared
 * contract every surface depends on: the machine code, the Hebrew wording, and
 * the fact that no internal identifiers leak to the user.
 */
describe("operationInProgressPayload", () => {
  it("returns the OPERATION_IN_PROGRESS code with Hebrew title and body", () => {
    const p = operationInProgressPayload("research_answer");
    expect(p.error).toBe("OPERATION_IN_PROGRESS");
    expect(p.title).toBe("כבר מתבצעת פעולה בחשבון");
    expect(String(p.message)).toContain("מחקר משפטי");
  });

  it("names source search and case summary distinctly", () => {
    expect(String(operationInProgressPayload("source_search").message)).toContain("חיפוש מקורות");
    expect(String(operationInProgressPayload("case_summary").message)).toContain("סיכום פסק דין");
  });

  it("falls back to a neutral message for an unknown operation type", () => {
    const p = operationInProgressPayload(undefined);
    expect(String(p.message)).toContain("פעולה פעילה");
    expect(p.active_operation_type).toBeNull();
  });

  it("never exposes job ids, devices, IPs or other internal metadata", () => {
    const serialized = JSON.stringify(operationInProgressPayload("research_answer"));
    for (const leak of ["job", "ip", "device", "fingerprint", "user_id", "operation_id"]) {
      expect(serialized.toLowerCase()).not.toContain(leak);
    }
  });

  it("labels every protected operation type", () => {
    const types: ProtectedOperationType[] = [
      "research_answer",
      "source_search",
      "case_summary",
      "academic_chapter",
    ];
    for (const t of types) expect(OPERATION_LABELS_HE[t]).toBeTruthy();
  });
});
