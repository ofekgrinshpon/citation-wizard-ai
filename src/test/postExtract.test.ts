// Regression coverage for bounded post-extract processing.
//
// Failure modes covered:
//   1. A ~1.15M-character extracted PDF body (the ע"א 6821/93 case) must be
//      processed under hard limits and must not be passed through whole.
//   2. Worker/isolate pressure right after `binary_extract_done` must produce a
//      deterministic terminal error, never a hang.
//   3. Documents beyond the absolute ceiling fail closed.

import { describe, expect, it } from "vitest";
import {
  POST_EXTRACT_LIMITS,
  PostExtractTooLarge,
  processExtractedBody,
} from "../../supabase/functions/legal-research-v1/stages/postExtract.ts";

const HEB = 'ע"א 6821/93 בנק המזרחי המאוחד בע"מ נ\' מגדל כפר שיתופי\nפסק דין\n';

function bigBody(chars: number): string {
  const filler = "  <p>נימוקי\tבית המשפט</p>\n".repeat(1000);
  let s = HEB;
  while (s.length < chars) s += filler;
  return s.slice(0, chars);
}

describe("processExtractedBody", () => {
  it("processes a 1.15M-character extraction under bounded limits", async () => {
    const raw = bigBody(1_150_000);
    const stages: string[] = [];
    const t0 = Date.now();
    const res = await processExtractedBody(raw, { onStage: (n) => stages.push(n) });

    expect(res.input_chars).toBe(1_150_000);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBeLessThanOrEqual(POST_EXTRACT_LIMITS.MAX_CLEAN_CHARS);
    expect(res.text).toContain("6821/93");
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(stages).toEqual(
      expect.arrayContaining([
        "post_extract_start",
        "clean_start",
        "clean_done",
        "normalize_start",
        "normalize_done",
        "post_extract_done",
      ]),
    );
  });

  it("emits identity checkpoints and reports a docket match", async () => {
    const stages: string[] = [];
    const res = await processExtractedBody(bigBody(600_000), {
      onStage: (n) => stages.push(n),
      validateText: (head) => head.includes("6821/93"),
    });
    expect(stages).toEqual(expect.arrayContaining(["identity_start", "identity_done"]));
    expect(res.identity_checked).toBe(true);
    expect(res.identity_ok).toBe(true);
  });

  it("fails deterministically when the budget dies after binary_extract_done", async () => {
    const stages: string[] = [];
    // Simulates isolate/worker pressure detected immediately post-extract.
    await expect(
      processExtractedBody(bigBody(1_150_000), {
        onStage: (n) => stages.push(n),
        budgetExceeded: () => true,
      }),
    ).rejects.toThrow("retrieval_timeout");
    expect(stages).toContain("post_extract_budget_exceeded");
    expect(stages).not.toContain("post_extract_done");
  });

  it("fails deterministically when the budget dies mid-normalization", async () => {
    let calls = 0;
    await expect(
      processExtractedBody(bigBody(1_150_000), {
        // Let cleaning run, then starve the normalization loop.
        budgetExceeded: () => ++calls > 4,
      }),
    ).rejects.toThrow("retrieval_timeout");
  });

  it("rejects pathological documents past the hard ceiling", async () => {
    const raw = "א".repeat(POST_EXTRACT_LIMITS.HARD_MAX_CHARS + 1);
    await expect(processExtractedBody(raw)).rejects.toBeInstanceOf(PostExtractTooLarge);
  });

  it("passes small bodies through unchanged in substance", async () => {
    const res = await processExtractedBody(`${HEB}<p>קביעה   מרכזית</p>`);
    expect(res.truncated).toBe(false);
    expect(res.text).toContain("קביעה מרכזית");
  });
});
