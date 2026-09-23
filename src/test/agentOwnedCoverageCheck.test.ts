/**
 * agent_owned_coverage_check_v1 — C1–C7.
 *
 * The pre-memo reflection is a semantic self-check, not a quota: it never
 * names a source, never demands a count, fires at most once, and never fires
 * when every read source is already memoed (narrow questions).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  buildCoverageReflection,
  emptyCoverageCheckStats,
  noteCoverageOutcome,
  shouldRunCoverageCheck,
  unusedReadSources,
} from "../../supabase/functions/legal-research-v2/agent/coverageCheck";
import type {
  EvidenceSource,
  ResearchMemo,
} from "../../supabase/functions/legal-research-v2/types";

function src(id: string, title: string, url?: string): EvidenceSource {
  return {
    source_id: id,
    title,
    url,
    sha256: id,
    fetch_status: "ok",
    extracted_text: "טקסט",
    text_length: 5,
    identity_fields: { dockets: [], statutes: [] },
    is_actual_document: true,
    origin: "web",
    fetched_at: new Date().toISOString(),
  } as unknown as EvidenceSource;
}

function memoWith(ids: string[]): ResearchMemo {
  return {
    issue_summary: "סוגיה",
    claims: ids.map((id, i) => ({
      claim_id: `C${i + 1}`,
      proposition: "טענה",
      importance: "core",
      evidence: [{ source_id: id, quoted_span: "ציטוט", reason: "כי" }],
    })),
    unresolved_questions: [],
    research_complete: true,
  } as unknown as ResearchMemo;
}

const QUESTION = "תעשה לי סקירת ספרות על עילת הסבירות: גישות, מחלוקות והתפתחות לאורך השנים.";

describe("C1 — no forced source use", () => {
  it("the reflection names no source and allows submitting as-is", () => {
    const text = buildCoverageReflection({ question: QUESTION, researchBudgetLeft: true });
    expect(text).not.toMatch(/\bS\d+\b/);
    expect(text).toMatch(/הגש את התזכיר כפי שהוא/);
    expect(text).toMatch(/אין מכסת מקורות/);
    expect(text).toMatch(/אל תייצר מחלוקת שאינה קיימת/);
  });

  it("does not fire when the memo already used every read source", () => {
    const readable = [src("S1", "א"), src("S2", "ב")];
    expect(
      shouldRunCoverageCheck({ memo: memoWith(["S1", "S2"]), readable, alreadyUsed: false }),
    ).toBe(false);
  });
});

describe("C2 — duplicate copies are not missing diversity", () => {
  it("a landing page of a memoed PDF is not counted as unused material", () => {
    const pdf = src("S1", "Agency Costs of Controlling Shareholders", "https://x.edu/a.pdf");
    const landing = src("S2", "Agency Costs of Controlling Shareholders", "https://x.edu/a.html");
    const readable = [pdf, landing];
    expect(unusedReadSources(memoWith(["S1"]), readable)).toEqual([]);
    expect(shouldRunCoverageCheck({ memo: memoWith(["S1"]), readable, alreadyUsed: false })).toBe(
      false,
    );
  });
});

describe("C3 / C4 — a genuinely unused source makes the reflection worthwhile", () => {
  const readable = [
    src("S1", "עילת הסבירות — המצב כיום"),
    src("S2", "התפתחות עילת הסבירות משנות השמונים"),
    src("S3", "ביקורת על עילת הסבירות — עמדה נוגדת"),
  ];

  it("C3 historical material read but not memoed triggers the check", () => {
    expect(shouldRunCoverageCheck({ memo: memoWith(["S1"]), readable, alreadyUsed: false })).toBe(
      true,
    );
    expect(unusedReadSources(memoWith(["S1"]), readable).map((s) => s.source_id)).toEqual([
      "S2",
      "S3",
    ]);
  });

  it("C4 the reflection asks about requested dimensions, not about utilization", () => {
    const text = buildCoverageReflection({ question: QUESTION, researchBudgetLeft: true });
    expect(text).toMatch(/בממדים שהמשתמש ביקש/);
    expect(text).toMatch(/בדוק תחילה את החומר שכבר נקרא/);
    expect(text).toMatch(/אין חובה להשתמש בכל מה שנקרא/);
    expect(text).not.toMatch(/חייב לצטט|עליך להשתמש/);
  });
});

describe("C5 — no evidence available leaves an explicit gap", () => {
  it("records the gap when the resubmitted memo adds an unresolved question", () => {
    const stats = emptyCoverageCheckStats();
    const before = memoWith(["S1"]);
    const after = { ...memoWith(["S1"]), unresolved_questions: ["לא נמצאה עמדה נוגדת מבוססת"] };
    noteCoverageOutcome(stats, {
      before,
      after: after as ResearchMemo,
      readAtCheck: new Set(["S1", "S2"]),
      researchCallsAfterCheck: 0,
    });
    expect(stats.memo_coverage_gap_left_explicit).toBe(1);
    expect(stats.memo_coverage_used_existing_read_source).toBe(0);
    expect(stats.memo_coverage_continued_research).toBe(0);
  });

  it("records reuse of already-read material when it happens", () => {
    const stats = emptyCoverageCheckStats();
    noteCoverageOutcome(stats, {
      before: memoWith(["S1"]),
      after: memoWith(["S1", "S2"]),
      readAtCheck: new Set(["S1", "S2"]),
      researchCallsAfterCheck: 0,
    });
    expect(stats.memo_coverage_used_existing_read_source).toBe(1);
    expect(stats.memo_coverage_claims_added).toBe(1);
  });
});

describe("C6 — narrow queries are unaffected", () => {
  it("a single read statute source that is memoed never triggers the check", () => {
    const readable = [src("S1", "חוק החוזים (חלק כללי)")];
    expect(shouldRunCoverageCheck({ memo: memoWith(["S1"]), readable, alreadyUsed: false })).toBe(
      false,
    );
  });
});

describe("C7 — at most one reflection per run", () => {
  it("never fires again once used", () => {
    const readable = [src("S1", "א"), src("S2", "ב")];
    expect(shouldRunCoverageCheck({ memo: memoWith(["S1"]), readable, alreadyUsed: true })).toBe(
      false,
    );
  });

  it("the agent loop gates the check on the run-level counter", () => {
    const loop = readFileSync(
      "supabase/functions/legal-research-v2/agent/researchAgent.ts",
      "utf8",
    );
    expect(loop).toMatch(/alreadyUsed: stats\.memo_coverage_check_triggered > 0/);
  });
});

describe("no classifier and no quota were introduced", () => {
  it("the coverage module never inspects the question text for keywords", () => {
    const mod = readFileSync(
      "supabase/functions/legal-research-v2/agent/coverageCheck.ts",
      "utf8",
    );
    expect(mod).not.toMatch(/question\.(includes|match|test)/);
    expect(mod).not.toMatch(/MIN_(SOURCES|VIEWS|CLAIMS)/);
  });
});
