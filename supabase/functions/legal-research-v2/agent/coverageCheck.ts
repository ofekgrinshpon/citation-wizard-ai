/**
 * legal-research-v2 — agent-owned pre-memo coverage reflection
 * (agent_owned_coverage_check_v1).
 *
 * ONE bounded, semantic self-check handed to the research agent immediately
 * before its memo is accepted. It asks a single question:
 *
 *   "does this memo actually address the dimensions the user asked for?"
 *
 * What this module is NOT:
 *   • not a classifier — no keyword matching on the question, ever
 *   • not a quota — no required source, viewpoint, claim or footnote count
 *   • not source utilization — read sources may always stay unused
 *   • not a loop — at most one reflection per run, never recursive
 *
 * The only deterministic thing here is WHEN the question is asked: it is worth
 * asking only when the run still holds read material that the memo did not
 * use, and that material is not simply another copy of a work already memoed.
 * Everything substantive — which dimensions were requested, whether they are
 * covered, whether an unused source genuinely helps — stays with the agent.
 */

import type { EvidenceSource, ResearchMemo } from "../types.ts";
import { normalizeUrlKey, workKey } from "../tools/sameWorkRecovery.ts";

export interface CoverageCheckStats {
  /** How many times the reflection was handed to the agent (0 or 1 per run). */
  memo_coverage_check_triggered: number;
  /** Read, non-duplicate sources the first memo did not use, at check time. */
  memo_coverage_unused_read_sources: number;
  /** The resubmitted memo cited a source that was already read at check time. */
  memo_coverage_used_existing_read_source: number;
  /** The agent chose to run further research tools after the reflection. */
  memo_coverage_continued_research: number;
  /** Claim delta between the first and the resubmitted memo (may be 0 or <0). */
  memo_coverage_claims_added: number;
  /** The resubmitted memo recorded an additional unresolved gap. */
  memo_coverage_gap_left_explicit: number;
  /** The resubmission came back empty, so the pre-check memo was kept. */
  memo_coverage_reverted_to_pre_check: number;
}

export function emptyCoverageCheckStats(): CoverageCheckStats {
  return {
    memo_coverage_check_triggered: 0,
    memo_coverage_unused_read_sources: 0,
    memo_coverage_used_existing_read_source: 0,
    memo_coverage_continued_research: 0,
    memo_coverage_claims_added: 0,
    memo_coverage_gap_left_explicit: 0,
    memo_coverage_reverted_to_pre_check: 0,
  };
}

/** Every source_id the memo actually leans on. */
export function memoedSourceIds(memo: ResearchMemo | null): Set<string> {
  const ids = new Set<string>();
  for (const c of memo?.claims ?? []) {
    for (const e of c.evidence ?? []) if (e.source_id) ids.add(e.source_id);
  }
  return ids;
}

function identityKeys(s: EvidenceSource): string[] {
  const keys: string[] = [];
  const k = workKey({ title: s.bibliographic?.title ?? s.title });
  if (k) keys.push(k);
  const u = normalizeUrlKey(s.url);
  if (u) keys.push(`url:${u}`);
  return keys;
}

/**
 * Read sources the memo did not use, EXCLUDING another copy of a work that is
 * already memoed (repository landing page vs PDF vs alternate copy). Same-work
 * identity logic is reused as-is; nothing here creates artificial diversity.
 */
export function unusedReadSources(
  memo: ResearchMemo | null,
  readable: EvidenceSource[],
): EvidenceSource[] {
  const used = memoedSourceIds(memo);
  const usedKeys = new Set<string>();
  for (const s of readable) {
    if (!used.has(s.source_id)) continue;
    for (const k of identityKeys(s)) usedKeys.add(k);
  }
  const out: EvidenceSource[] = [];
  for (const s of readable) {
    if (used.has(s.source_id)) continue;
    if (s.fetch_status !== "ok" || s.is_actual_document === false) continue;
    const keys = identityKeys(s);
    if (keys.some((k) => usedKeys.has(k))) continue; // duplicate of a memoed work
    for (const k of keys) usedKeys.add(k); // and duplicates among the unused
    out.push(s);
  }
  return out;
}

/**
 * The reflection is worth handing over only when the run holds unused,
 * non-duplicate read material. A narrow question whose few sources are all
 * memoed therefore never triggers it — structurally, not by keyword.
 */
export function shouldRunCoverageCheck(input: {
  memo: ResearchMemo | null;
  readable: EvidenceSource[];
  alreadyUsed: boolean;
}): boolean {
  if (input.alreadyUsed) return false;
  if (!input.memo?.claims.length) return false;
  return unusedReadSources(input.memo, input.readable).length > 0;
}

/**
 * The reflection text. It names no source_id, demands no source, no count and
 * no dimension: the dimensions come from the user's own request, read
 * semantically by the agent.
 */
export function buildCoverageReflection(input: {
  question: string;
  researchBudgetLeft: boolean;
}): string {
  const continuation = input.researchBudgetLeft
    ? "אם החומר שכבר נקרא אינו תומך באותו ממד — המשך לחקור רק אם יש לכך סיכוי ממשי בתקציב שנותר."
    : "תקציב המחקר מוצה: הסתמך אך ורק על מה שכבר נקרא בריצה זו.";
  return [
    "בדיקה אחת לפני קבלת התזכיר (פעם אחת בלבד בריצה זו).",
    "",
    "קרא שוב את בקשת המשתמש כפי שנוסחה:",
    input.question,
    "",
    "שאל את עצמך שאלה אחת: האם התזכיר מטפל בפועל בממדים שהמשתמש ביקש — לדוגמה גישות ואסכולות, מחלוקת, התפתחות היסטורית, השוואה בין שיטות משפט, הסברים מתחרים או התפתחות דוקטרינרית — ככל שאלה אכן נדרשו בבקשה הזו.",
    "",
    "אם כן — הגש את התזכיר כפי שהוא. אין צורך לשנות דבר.",
    "אם ממד מהותי שהתבקש חסר:",
    "1. בדוק תחילה את החומר שכבר נקרא בריצה זו — ייתכן שהוא תומך באותו ממד.",
    `2. ${continuation}`,
    "3. אם אין ביסוס — שמר את הפער במפורש ב-unresolved_questions. תשובה חלקית וכנה עדיפה על סקירה שנראית שלמה.",
    "",
    "אין מכסת מקורות ואין חובה להשתמש בכל מה שנקרא: מקור חוזר, כפול, שולי או שנקודתו כבר מכוסה טוב יותר — אינו צריך להיכנס לתזכיר. אל תייצר מחלוקת שאינה קיימת ואל תוסיף מקורות לשם גיוון.",
    "לאחר מכן קרא שוב ל-submit_research_memo. זו הבדיקה היחידה מסוגה בריצה.",
  ].join("\n");
}

/** Deterministic before/after diagnostics for the resubmitted memo. */
export function noteCoverageOutcome(
  stats: CoverageCheckStats,
  input: {
    before: ResearchMemo | null;
    after: ResearchMemo | null;
    /** source_ids already read when the reflection was handed over. */
    readAtCheck: Set<string>;
    /** Research tool calls made between the reflection and the new memo. */
    researchCallsAfterCheck: number;
  },
): void {
  const beforeIds = memoedSourceIds(input.before);
  const afterIds = memoedSourceIds(input.after);
  const reused = [...afterIds].some((id) => !beforeIds.has(id) && input.readAtCheck.has(id));
  if (reused) stats.memo_coverage_used_existing_read_source += 1;
  if (input.researchCallsAfterCheck > 0) stats.memo_coverage_continued_research += 1;
  stats.memo_coverage_claims_added += (input.after?.claims.length ?? 0) -
    (input.before?.claims.length ?? 0);
  if (
    (input.after?.unresolved_questions.length ?? 0) >
      (input.before?.unresolved_questions.length ?? 0)
  ) {
    stats.memo_coverage_gap_left_explicit += 1;
  }
}
