/**
 * v2_result_id_durability_v1
 *
 * A resumed chunk runs in a fresh isolate, where the process-wide result-id
 * counter starts at zero again. Without seeding, a new search result would
 * re-mint an id that the restored `discovered` map already uses, silently
 * overwriting an earlier candidate together with the authority identity it
 * carried. These tests pin the seeding contract only — no research policy.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  nextResultId,
  resetResultIds,
  seedResultIds,
} from "../../supabase/functions/legal-research-v2/tools/resultIds";

describe("result id durability across worker restart", () => {
  beforeEach(() => resetResultIds());

  it("continues past the highest restored id", () => {
    seedResultIds(["R1", "R2", "R7"]);
    expect(nextResultId()).toBe("R8");
  });

  it("never lowers the counter", () => {
    expect(nextResultId()).toBe("R1");
    expect(nextResultId()).toBe("R2");
    seedResultIds(["R1"]);
    expect(nextResultId()).toBe("R3");
  });

  it("ignores malformed or empty ids", () => {
    seedResultIds(["", "x", "R", "Rabc", undefined as unknown as string]);
    expect(nextResultId()).toBe("R1");
  });

  it("a fresh isolate seeded from restored candidates never collides", () => {
    // chunk 1
    const chunk1 = [nextResultId(), nextResultId(), nextResultId()];
    // worker restart
    resetResultIds();
    seedResultIds(chunk1);
    const chunk2 = [nextResultId(), nextResultId()];
    expect(new Set([...chunk1, ...chunk2]).size).toBe(5);
  });
});
