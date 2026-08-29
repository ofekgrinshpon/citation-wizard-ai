import { describe, expect, it } from "vitest";
import { assessSourceSufficiency } from "../../supabase/functions/legal-research-v1/stages/sourceSufficiency.ts";

const secondary = (ref: string, verdict = "direct") =>
  ({
    ref,
    title: "מאמר: חלוקת רכוש בין בני זוג",
    source_type: "legal_article",
    url: "https://law.tau.ac.il/files/paper.pdf",
    body_acquired: true,
    text: "ניתוח דוקטרינרי מפורט של חלוקת רכוש בין בני זוג לאחר גירושין. ".repeat(40),
    verifier_verdict: verdict,
    metadata: { body_acquired: true, source_integrity: { text_usability: "full_text" } },
  }) as never;

const run = (question: string, sources: unknown[], depthMode: string) =>
  assessSourceSufficiency({
    question,
    sources: sources as never,
    shape: "analysis",
    depthMode,
  } as never);

describe("narrow_doctrine_limited_doctrinal_answer_v1", () => {
  it("allows a limited doctrinal answer for narrow doctrinal questions", () => {
    const r = run("מהי אמת המידה לחלוקת רכוש בין בני זוג?", [
      secondary("s1"),
      secondary("s2", "partial"),
    ], "narrow_doctrine");
    expect(r.limited_doctrinal_answer).toBe(true);
    expect(r.limited_doctrinal_answer_allowed).toBe(true);
    expect(r.doctrinal_fallback_combination).toBe("D");
    expect(r.sufficiency_authority_basis).toBe("doctrinal_secondary_limited");
    expect(r.branch_after).toBe("limited_doctrinal_answer");
    expect(r.found_only_used_for_support).toBe(false);
  });

  it("refuses when an explicit docket is requested", () => {
    const r = run("מה נקבע בבג\"ץ 5555/18 בעניין חלוקת רכוש?", [
      secondary("s1"),
      secondary("s2"),
    ], "narrow_doctrine");
    expect(r.limited_doctrinal_answer_allowed).toBe(false);
    expect(r.exact_docket_or_case_holding_blocked).toBe(true);
  });

  it("refuses without a direct acquired doctrinal source", () => {
    const r = run("מהי אמת המידה לחלוקת רכוש בין בני זוג?", [
      secondary("s1", "tangential"),
    ], "narrow_doctrine");
    expect(r.limited_doctrinal_answer_allowed).toBe(false);
  });
});
