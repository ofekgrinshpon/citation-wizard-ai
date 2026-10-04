/**
 * completeness_fix — validation/status/cached-read contract. Offline only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assessAnswerCompleteness, PARTIAL_ANSWER_NOTICE } from "../../supabase/functions/legal-research-v2/verification/completeness";
import { isStoredTextRead } from "../../supabase/functions/legal-research-v2/agent/researchAgent";
import { shouldRunCoverageCheck } from "../../supabase/functions/legal-research-v2/agent/coverageCheck";
import { isCurrentLawCapable } from "../../supabase/functions/legal-research-v2/verification/temporalValidity";

const read = (p: string) => readFileSync(`supabase/functions/legal-research-v2/${p}`, "utf8");
const memo = (o: Record<string, unknown> = {}) => ({
  issue_summary: "", claims: [{ claim_id: "C1", proposition: "א", evidence: [] }],
  unresolved_questions: [], research_complete: true, ...o,
}) as never;
const pack = (claims = 1, core = 0) => ({
  claims: Array.from({ length: claims }, (_, i) => ({ claim_id: `C${i}`, importance: "core" })),
  unsupported_claims: Array.from({ length: core }, () => ({ importance: "core" })),
}) as never;
const cov = (assessed: boolean, covered = true) => ({ assessed, central_issue_covered: covered }) as never;
const base = { reflectionCompleted: true, hasCitedAnswer: true, answerGaps: false };

describe("answer completeness status", () => {
  it("complete only with declared completion, reflection and assessed coverage", () => {
    expect(assessAnswerCompleteness({ ...base, memo: memo(), pack: pack(), coverage: cov(true) }))
      .toEqual({ research_complete: true, completeness_status: "complete", central_issue_covered: true });
  });
  it("unknown central coverage is null and never 'complete' by default", () => {
    const r = assessAnswerCompleteness({ ...base, memo: memo(), pack: pack(), coverage: undefined });
    expect(r.central_issue_covered).toBeNull();
    expect(assessAnswerCompleteness({ ...base, reflectionCompleted: false, memo: memo(), pack: pack(), coverage: cov(true) }).completeness_status).toBe("unknown");
  });
  it("explicit partial: declared incomplete, unresolved gaps, unsupported core, lost coverage", () => {
    for (const r of [
      assessAnswerCompleteness({ ...base, memo: memo({ research_complete: false }), pack: pack(), coverage: cov(true) }),
      assessAnswerCompleteness({ ...base, memo: memo({ unresolved_questions: ["פער"] }), pack: pack(), coverage: cov(true) }),
      assessAnswerCompleteness({ ...base, memo: memo(), pack: pack(1, 1), coverage: cov(true) }),
      assessAnswerCompleteness({ ...base, memo: memo(), pack: pack(), coverage: cov(true, false) }),
    ]) expect(r.completeness_status).toBe("partial");
  });
  it("lost final-answer blocks / validation errors mark the answer partial", () => {
    expect(assessAnswerCompleteness({ ...base, answerGaps: true, memo: memo(), pack: pack(), coverage: cov(true) }).completeness_status).toBe("partial");
  });
  it("no verified claims or no cited answer is insufficient", () => {
    expect(assessAnswerCompleteness({ ...base, memo: memo(), pack: pack(0), coverage: cov(true) })).toMatchObject({ completeness_status: "insufficient", central_issue_covered: false });
    expect(assessAnswerCompleteness({ ...base, hasCitedAnswer: false, memo: memo(), pack: pack(), coverage: cov(true) }).completeness_status).toBe("insufficient");
  });
  it("partial answers are prefixed with the notice; job status stays the lifecycle", () => {
    expect(read("index.ts")).toContain('completeness.completeness_status === "partial"\n      ? `${PARTIAL_ANSWER_NOTICE}');
    expect(PARTIAL_ANSWER_NOTICE).toMatch(/^תשובה חלקית/);
    expect(read("beta/job.ts")).toContain('completeness_status: ["complete", "partial", "unknown", "insufficient"]');
  });
});

describe("reflection trigger and memo retention", () => {
  it("all-read-used memo is reflected exactly once", () => {
    const m = memo();
    expect(shouldRunCoverageCheck({ memo: m, readable: [], alreadyUsed: false })).toBe(true);
    expect(shouldRunCoverageCheck({ memo: m, readable: [], alreadyUsed: true })).toBe(false);
    expect(shouldRunCoverageCheck({ memo: memo({ claims: [] }), readable: [], alreadyUsed: false })).toBe(false);
  });
  it("last step keeps the memo: no reflection when no submission step remains", () => {
    expect(shouldRunCoverageCheck({ memo: memo(), readable: [], alreadyUsed: false, submissionCapacityLeft: false })).toBe(false);
    expect(read("agent/researchAgent.ts")).toContain("submissionCapacityLeft: !policy.stepExhausted(),");
  });
  it("empty resubmission restores claims but preserves admitted gaps and incompleteness", () => {
    const src = read("agent/researchAgent.ts");
    expect(src).toContain("research_complete: coverageBefore.research_complete && acceptedMemo?.research_complete === true,");
    expect(src).toContain("...(acceptedMemo?.unresolved_questions ?? []),");
  });
});

describe("cached stored-text reads", () => {
  const ok = { fetch_status: "ok", is_actual_document: true, extracted_text: "טקסט" } as never;
  it("a stored excerpt read qualifies (fetch-budget-only waiver)", () => {
    expect(isStoredTextRead({ source_id: "S1" }, ok)).toBe(true);
    const src = read("agent/researchAgent.ts");
    expect(src).toContain('policyBlock?.startsWith("budget_exhausted:fetch ")');
  });
  it("PDF continuation, refetch, url/result reads and unusable sources still need budget", () => {
    for (const a of [
      { source_id: "S1", want: "later_pages" }, { source_id: "S1", want: "pdf_page_range" },
      { source_id: "S1", refetch_reason: "x" }, { source_id: "S1", url: "https://a" },
      { source_id: "S1", result_id: "R1" }, {},
    ]) expect(isStoredTextRead(a, ok)).toBe(false);
    expect(isStoredTextRead({ source_id: "S1" }, { ...(ok as object), extracted_text: " " } as never)).toBe(false);
    expect(isStoredTextRead({ source_id: "S1" }, { ...(ok as object), is_actual_document: false } as never)).toBe(false);
    expect(isStoredTextRead({ source_id: "S1" }, null)).toBe(false);
  });
});

describe("jurisdiction-aware current-law eligibility", () => {
  const s = (url: string, text: string, title = "") => ({
    url, title, extracted_text: text, fetch_status: "ok", is_actual_document: true,
    identity_fields: { statutes: [], dockets: [] },
  }) as never;
  const eu = { proposition: "לפי GDPR יש להודיע לרשות הפיקוח" };
  const il = { proposition: "לפי תקנות הגנת הפרטיות יש לדווח לרשות" };
  it("official EUR-Lex document body and EDPB guidance PDF are eligible for EU claims", () => {
    expect(isCurrentLawCapable(s("https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679", "Regulation (EU) 2016/679"), eu)).toBe(true);
    expect(isCurrentLawCapable(s("https://www.edpb.europa.eu/system/files/2023-04/edpb_guidelines_202209_personal_data_breach_notification_v2.0_en.pdf", "Guidelines on personal data breach notification"), eu)).toBe(true);
  });
  it("summaries, news, spoofed hosts and wrong jurisdiction are rejected", () => {
    expect(isCurrentLawCapable(s("https://eur-lex.europa.eu/legal-content/EN/LSU/?uri=CELEX:32016R0679", "Regulation summary"), eu)).toBe(false);
    expect(isCurrentLawCapable(s("https://www.edpb.europa.eu/news/news/2023/edpb_guidelines_news.pdf", "Guidelines data protection"), eu)).toBe(false);
    expect(isCurrentLawCapable(s("https://eur-lex.europa.eu.evil.com/legal-content/EN/TXT/?uri=CELEX:32016R0679", "Regulation"), eu)).toBe(false);
    expect(isCurrentLawCapable(s("https://ec.europa.eu/info/law/x", "Regulation"), eu)).toBe(false);
    expect(isCurrentLawCapable(s("https://www.gov.il/x", "תקנות הגנת הפרטיות"), eu)).toBe(false);
    expect(isCurrentLawCapable(s("https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679", "Regulation"), il)).toBe(false);
    expect(isCurrentLawCapable(s("https://www.gov.il/x", "תקנות"), { proposition: "בישראל וב-GDPR" })).toBe(false);
  });
  it("Israeli policy unchanged, including subdomains and Nevo; lookalikes rejected", () => {
    expect(isCurrentLawCapable(s("https://fs.knesset.gov.il/x.pdf", "חוק"), il)).toBe(true);
    expect(isCurrentLawCapable(s("https://www.nevo.co.il/law/1", "חוק"), il)).toBe(true);
    expect(isCurrentLawCapable(s("https://www.gov.il/x", "חוק"))).toBe(true);
    expect(isCurrentLawCapable(s("https://notgov.il/x", "חוק"), il)).toBe(false);
  });
});

describe("unchanged guards", () => {
  it("search follows the query jurisdiction; budgets and native fail-closed paths untouched", () => {
    expect(read("tools/search.ts")).toContain("אל תניח שדין ישראל חל רק משום ששפת השאילתה עברית");
    const agent = read("agent/researchAgent.ts");
    expect(agent).toContain("opts.usage.direct_provider_failed = true;");
    expect(agent).toContain('throw new Error(`direct_provider_experiment_failed:${res.error ?? "model_error"}`);');
    expect(agent).toContain('if (policy.checkTool("fetch") !== null) return { ok: false, failure_class: "fetch_budget_exhausted" };');
  });
});
