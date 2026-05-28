// Phase 3.QG — Post-drafter quality gate.
//
// Pure evaluation over a finished drafter result. Decides whether the shipped
// answer is visibly trustworthy. Does NOT change sources, retrieval, verifier,
// Phase 3 logic, tokenization, or marker positions.
//
// Triggers (any one is sufficient):
//   1. phase3.discarded_reason === "ambiguous_raw_superscript_run"
//      AND placement.max_cluster_len >= 4
//   2. placement.end_paragraph_dump_count > 0
//   3. placement.cluster_run_count >= 8  OR  placement.cluster_count >= 15
//   4. phantom-footnote run: a visible superscript-digit run that can be read
//      as a marker number greater than used_sources.length (e.g. ⁸⁹¹⁰ with 9
//      sources).
//   5. Hebrew artifact denylist present in the answer.

import type { Footnote, MarkerValidation, UsedSource } from "../lib/types.ts";

// Superscript digits (¹²³…). Kept in the gate to avoid coupling to drafter.ts.
const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUP_TO_DIGIT: Record<string, string> = Object.fromEntries(
  SUP_DIGITS.split("").map((c, i) => [c, String(i)]),
);
const SUP_RUN_RE = /[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu;

/** Hebrew artifact denylist (case- and whitespace-insensitive substrings). */
export const LANGUAGE_ARTIFACTS: readonly string[] = [
  "שורת התחתית",
  "המשדר להפרה",
  "בפברגים",
  "זהות של פגיעים",
  "סעדיים",
  "הצהריתיות",
  "מנגנון מעשיר של פיקוח",
];

/** Retry instruction appended to SYSTEM_PROMPT for the targeted retry. */
export const RETRY_PRESENTATION_ADDENDUM = `

המהות המשפטית ומאגר המקורות קבועים. נסח מחדש את התשובה באמצעות אותם מקורות בלבד, בלי להוסיף או להסיר מקור. שפר את מיקום האזכורים ואת איכות העברית.
אל תניח שני סימני הערה זה לצד זה. אל תיצור רצפים כגון ¹²³ או ⁸⁹¹⁰, ואל תיצור רצף ספרות־על שאפשר לקרוא כמספר הערה שאינו קיים.
אם כמה מקורות תומכים באותה טענה, נסח את הטענה כך שמנגנון האזכור יוכל לאחד את המקורות בהערת שוליים אחת, או פצל את הטענות למשפטים נפרדים כך שכל הערה תוצמד לטענה שהיא תומכת בה.
אל תרכז אזכורים בסוף פסקה. אל תסיים בסיכום עם מצבור מקורות.
כתוב עברית משפטית ישראלית טבעית; אל תייצר ביטויים מעוותים כגון 'שורת התחתית', 'בפברגים', 'סעדיים', 'הצהריתיות', 'מנגנון מעשיר של פיקוח'.`;

export interface PhantomRunSample {
  run: string;
  parsed_number: number;
  max_valid: number;
  context: string;
}

export interface QualityGateMetrics {
  cluster_count: number;
  cluster_run_count: number;
  max_cluster_len: number;
  end_paragraph_dump_count: number;
  phase3_applied: boolean;
  phase3_discarded_reason: string | null;
  compound_group_count: number | null;
  ambiguous_run_samples: unknown[] | null;
  phantom_footnote_runs: PhantomRunSample[];
  language_artifact_count: number;
  language_artifacts_found: string[];
}

export interface QualityGateEvaluation {
  triggered: boolean;
  reasons: string[];
  metrics: QualityGateMetrics;
}

/**
 * Detect runs of superscript digits that, when parsed as one multi-digit
 * integer, exceed the number of real sources. Example: with 9 sources, ⁸⁹¹⁰
 * yields "8910" (and any contiguous grouping containing "10") which is > 9.
 *
 * We test every contiguous sub-run length >= 1 to catch e.g. "¹⁰" inside
 * "⁸⁹¹⁰". Single-digit valid runs are never flagged.
 */
export function detectPhantomFootnoteRuns(
  answer: string,
  maxValidMarker: number,
): PhantomRunSample[] {
  if (maxValidMarker <= 0 || !answer) return [];
  const out: PhantomRunSample[] = [];
  let m: RegExpExecArray | null;
  SUP_RUN_RE.lastIndex = 0;
  while ((m = SUP_RUN_RE.exec(answer)) !== null) {
    const run = m[0];
    if (run.length < 2) continue;
    const digits = run.split("").map((c) => SUP_TO_DIGIT[c]).join("");
    // Try every contiguous sub-run of length >= 2.
    let flagged: { sub: string; n: number } | null = null;
    for (let len = 2; len <= digits.length && !flagged; len++) {
      for (let i = 0; i + len <= digits.length; i++) {
        const sub = digits.slice(i, i + len);
        if (sub.startsWith("0")) continue;
        const n = Number(sub);
        if (Number.isFinite(n) && n > maxValidMarker) {
          flagged = { sub, n };
          break;
        }
      }
    }
    if (flagged) {
      const start = Math.max(0, m.index - 30);
      const end = Math.min(answer.length, m.index + run.length + 30);
      out.push({
        run,
        parsed_number: flagged.n,
        max_valid: maxValidMarker,
        context: answer.slice(start, end),
      });
    }
  }
  return out;
}

export function detectLanguageArtifacts(answer: string): string[] {
  if (!answer) return [];
  const found: string[] = [];
  for (const phrase of LANGUAGE_ARTIFACTS) {
    if (answer.includes(phrase)) found.push(phrase);
  }
  return found;
}

export function evaluateQualityGate(input: {
  answer: string;
  used_sources: UsedSource[];
  footnotes: Footnote[];
  marker_validation: MarkerValidation | null | undefined;
}): QualityGateEvaluation {
  const reasons: string[] = [];
  const mv = input.marker_validation ?? null;
  const placement = mv?.placement ?? null;
  const phase3 = mv?.citation_cleanup?.phase3 ?? null;
  const uniqueSourceCount = input.used_sources.length;

  const cluster_count = placement?.cluster_count ?? 0;
  const cluster_run_count = placement?.cluster_run_count ?? 0;
  const max_cluster_len = placement?.max_cluster_len ?? 0;
  const end_paragraph_dump_count = placement?.end_paragraph_dump_count ?? 0;
  const phase3_applied = phase3?.applied === true;
  const phase3_discarded_reason = phase3?.discarded_reason ?? null;
  const compound_group_count = phase3?.compound_group_count ?? null;
  const ambiguous_run_samples =
    (phase3 as { ambiguous_run_samples?: unknown[] } | null)?.ambiguous_run_samples ?? null;

  // Trigger 1
  if (
    phase3_discarded_reason === "ambiguous_raw_superscript_run" &&
    max_cluster_len >= 4
  ) {
    reasons.push("ambiguous_raw_superscript_run_with_long_cluster");
  }
  // Trigger 2
  if (end_paragraph_dump_count > 0) {
    reasons.push("end_paragraph_dump");
  }
  // Trigger 3
  if (cluster_run_count >= 8 || cluster_count >= 15) {
    reasons.push("excessive_cluster_density");
  }
  // Trigger 4
  const phantom = detectPhantomFootnoteRuns(input.answer, uniqueSourceCount);
  if (phantom.length > 0) {
    reasons.push("phantom_footnote_run");
  }
  // Trigger 5
  const artifacts = detectLanguageArtifacts(input.answer);
  if (artifacts.length > 0) {
    for (const a of artifacts) reasons.push(`lang_artifact:${a}`);
  }

  const metrics: QualityGateMetrics = {
    cluster_count,
    cluster_run_count,
    max_cluster_len,
    end_paragraph_dump_count,
    phase3_applied,
    phase3_discarded_reason,
    compound_group_count,
    ambiguous_run_samples,
    phantom_footnote_runs: phantom.slice(0, 5),
    language_artifact_count: artifacts.length,
    language_artifacts_found: artifacts,
  };

  return { triggered: reasons.length > 0, reasons, metrics };
}

/**
 * Source-set invariance check between initial and retry drafter results.
 * Compares the multiset of candidate_ids.
 */
export function sourceSetsEqual(
  a: UsedSource[],
  b: UsedSource[],
): boolean {
  if (a.length !== b.length) return false;
  const ka = a.map((s) => s.candidate_id).sort().join("|");
  const kb = b.map((s) => s.candidate_id).sort().join("|");
  return ka === kb;
}
