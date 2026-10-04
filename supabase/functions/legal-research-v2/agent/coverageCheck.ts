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
 * The deterministic trigger is the first non-empty memo with one submission
 * step left. Using every read source does not establish requested coverage.
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
  /** The agent confirmed the exact server-held candidate via confirm_existing_memo. */
  memo_coverage_confirmed_existing?: number;
  /** confirm_existing_memo calls refused (bad/stale handle, mixed call, no pending). */
  memo_coverage_confirm_rejected?: number;
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
    memo_coverage_confirmed_existing: 0,
    memo_coverage_confirm_rejected: 0,
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
 * Every non-empty memo receives one check when submission capacity remains.
 * Unused sources are an optional aid, never a prerequisite or a quota.
 */
export function shouldRunCoverageCheck(input: {
  memo: ResearchMemo | null;
  readable: EvidenceSource[];
  alreadyUsed: boolean;
  /** Never withhold the last usable memo when no resubmission step remains. */
  submissionCapacityLeft?: boolean;
}): boolean {
  if (input.alreadyUsed || input.submissionCapacityLeft === false) return false;
  return !!input.memo?.claims.length;
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
    "אם כן — אין צורך לשנות דבר: אשר את התזכיר הקיים כפי שהוא באמצעות confirm_existing_memo עם ה-handle שסופק (קריאה יחידה, ללא קריאות אחרות).",
    "אם ממד מהותי שהתבקש חסר:",
    "1. בדוק תחילה את החומר שכבר נקרא בריצה זו — ייתכן שהוא תומך באותו ממד.",
    `2. ${continuation}`,
    "3. אם אין ביסוס — שמר את הפער במפורש ב-unresolved_questions וסמן research_complete=false. תשובה חלקית וכנה עדיפה על סקירה שנראית שלמה.",
    "",
    "אין מכסת מקורות ואין חובה להשתמש בכל מה שנקרא: מקור חוזר, כפול, שולי או שנקודתו כבר מכוסה טוב יותר — אינו צריך להיכנס לתזכיר. אל תייצר מחלוקת שאינה קיימת ואל תוסיף מקורות לשם גיוון.",
    "הבחירה שלך: לאשר את התזכיר הקיים ללא שינוי ב-confirm_existing_memo, או להגיש את התזכיר המתוקן המלא ב-submit_research_memo (לאחר מחקר נוסף, רק אם התקציב מאפשר). זו הבדיקה היחידה מסוגה בריצה.",
  ].join("\n");
}

/**
 * A separate, NON-BINDING availability note handed alongside the reflection
 * (durable_quote_references_v1): which read sources the memo has not used and
 * how many stored excerpts each still holds, so the agent knows what is
 * available to it after context compaction.
 *
 * It states availability only — no legal conclusion, no required source, no
 * quota. The agent still decides whether any of them is relevant.
 */
export function buildUnusedSourceSummary(
  entries: Array<{ source_id: string; title?: string | null; quote_count: number }>,
): string {
  if (!entries.length) return "";
  const lines = entries.slice(0, 12).map((e) =>
    `- ${e.source_id}${e.title ? ` — ${String(e.title).slice(0, 90)}` : ""}: ${
      e.quote_count > 0
        ? `${e.quote_count} קטעים מילוליים שמורים, ניתן להפנות אליהם ב-quote_id`
        : "נקרא; אין קטע מילולי שמור (ניתן fetch({source_id, query}) לקריאה ממוקדת)"
    }`
  );
  return [
    "מקורות שנקראו בריצה זו ואינם מופיעים בתזכיר (מידע בלבד — אין חובה להשתמש באף אחד מהם, ואין כאן קביעה משפטית):",
    ...lines,
    "אם אחד מהם מכסה ממד מהותי בבקשת המשתמש שהתזכיר אינו מכסה — שקול אותו לפני ההגשה. אם אינו רלוונטי, אינו תומך בטענה או כפול — השאר אותו בחוץ.",
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

// ── confirm_existing_memo (coverage_confirm_existing_v1) ─────────────────────
// During the one coverage reflection the agent may confirm the exact candidate
// the server already holds instead of re-sending it. The candidate is kept as a
// JSON string (immutable by construction), bound to the run by an opaque
// server-generated handle and to the evidence state by a fingerprint. A
// confirmation only hands that candidate to the SAME downstream verification;
// it never marks anything verified.

import { createHash } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** JSONB preserves values and array order, but not object key order. */
function canonicalEvidenceJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || !value || ancestors.has(value)) {
    throw new TypeError("Invalid coverage evidence");
  }
  if (Object.getOwnPropertySymbols(value).length) throw new TypeError("Invalid coverage evidence");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      // No holes/undefined/non-JSON array properties may silently become null.
      if (Object.keys(value).length !== value.length) throw new TypeError("Invalid coverage evidence");
      const entries: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const item = Object.getOwnPropertyDescriptor(value, String(i));
        if (!item || !("value" in item)) throw new TypeError("Invalid coverage evidence");
        entries.push(canonicalEvidenceJson(item.value, ancestors));
      }
      return `[${entries.join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Invalid coverage evidence");
    const entries: string[] = [];
    for (const key of Object.keys(value).sort()) {
      const item = Object.getOwnPropertyDescriptor(value, key)!;
      if (!("value" in item)) throw new TypeError("Invalid coverage evidence");
      // EvidenceStore has optional undefined fields; JSON checkpoints omit them.
      if (item.value !== undefined) {
        entries.push(`${JSON.stringify(key)}:${canonicalEvidenceJson(item.value, ancestors)}`);
      }
    }
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export const CONFIRM_MEMO_TOOL_NAME = "confirm_existing_memo";

export interface PendingCoverage {
  v: 1;
  handle: string;
  run_id: string;
  /** Exact candidate at reflection time, serialized once. */
  memo_json: string;
  /** sha256 of memo_json: a substituted candidate cannot reuse the handle. */
  memo_digest: string;
  read_ids: string[];
  research_calls_at_check: number;
  fingerprint: string;
  /** False once evidence/research state or the candidate changed. */
  confirmable: boolean;
}

/**
 * Evidence/research state a confirmation is bound to: every readable source
 * (body, title, URL, identity and bibliographic fields — the whole stored
 * record) and every served quote, plus the research-call count. Computed only
 * when a candidate is held and again when a confirmation is validated, so any
 * in-place mutation of an existing record (same id, same count) is caught.
 */
export function coverageFingerprint(input: {
  readable: unknown[];
  quotes: unknown[];
  researchCalls: number;
}): string {
  try {
    if (!Array.isArray(input.readable) || !Array.isArray(input.quotes)) return "";
    if (!Number.isSafeInteger(input.researchCalls) || input.researchCalls < 0) return "";
    const readable = [...input.readable].sort((a, b) =>
      String((a as { source_id?: string }).source_id).localeCompare(String((b as { source_id?: string }).source_id))
    );
    return sha256(canonicalEvidenceJson([input.researchCalls, readable, input.quotes]));
  } catch {
    // An unrepresentable state is never confirmable, even if seen twice.
    return "";
  }
}

export function createPendingCoverage(input: {
  run_id: string;
  memo: ResearchMemo;
  read_ids: string[];
  research_calls_at_check: number;
  fingerprint: string;
  handle?: string;
}): PendingCoverage {
  return {
    v: 1,
    handle: input.handle ?? `cov_${crypto.randomUUID()}`,
    run_id: input.run_id,
    memo_json: JSON.stringify(input.memo),
    memo_digest: sha256(JSON.stringify(input.memo)),
    read_ids: [...input.read_ids],
    research_calls_at_check: input.research_calls_at_check,
    fingerprint: input.fingerprint,
    confirmable: input.fingerprint !== "",
  };
}

const isStr = (x: unknown): x is string => typeof x === "string";
const isCount = (x: unknown) => typeof x === "number" && Number.isInteger(x) && x >= 0;

/** Required normalized memo shape for a confirmable candidate (pending state only). */
function validCandidate(m: unknown): boolean {
  const r = m as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || !isStr(r.issue_summary)) return false;
  if (!Array.isArray(r.unresolved_questions) || !r.unresolved_questions.every(isStr)) return false;
  if (!Array.isArray(r.claims) || r.claims.length === 0) return false;
  return r.claims.every((c) => {
    const k = c as Record<string, unknown> | null;
    return !!k && isStr(k.claim_id) && isStr(k.proposition) && k.proposition.trim() !== "" &&
      Array.isArray(k.evidence) && k.evidence.every((e) => {
        const v = e as Record<string, unknown> | null;
        return !!v && isStr(v.source_id) && isStr(v.quoted_span);
      });
  });
}

/** Restores a persisted pending reflection; anything malformed is dropped (fail closed). */
export function parsePendingCoverage(raw: unknown): PendingCoverage | null {
  const r = raw as Partial<PendingCoverage> | null;
  if (!r || typeof r !== "object" || r.v !== 1) return null;
  if (!isStr(r.handle) || !/^cov_[0-9a-f-]{36}$/.test(r.handle)) return null;
  if (!isStr(r.run_id) || !r.run_id || r.run_id.length > 200) return null;
  if (!isStr(r.memo_json) || !isStr(r.memo_digest) || !isStr(r.fingerprint)) return null;
  if (sha256(r.memo_json) !== r.memo_digest) return null;
  if (!Array.isArray(r.read_ids) || r.read_ids.length > 10_000 || !r.read_ids.every(isStr)) return null;
  if (!isCount(r.research_calls_at_check) || typeof r.confirmable !== "boolean") return null;
  try {
    if (!validCandidate(JSON.parse(r.memo_json))) return null;
  } catch {
    return null;
  }
  return {
    v: 1, handle: r.handle, run_id: r.run_id, memo_json: r.memo_json, memo_digest: r.memo_digest,
    read_ids: [...r.read_ids], research_calls_at_check: r.research_calls_at_check as number,
    fingerprint: r.fingerprint, confirmable: r.confirmable,
  };
}

export type ConfirmCheck =
  | { ok: true; memo: ResearchMemo }
  | { ok: false; reason: string; invalidate: boolean };

/** Validates one confirm call. Returns a fresh copy of the held candidate on success. */
export function checkConfirm(input: {
  pending: PendingCoverage | null;
  args: unknown;
  run_id: string;
  fingerprint: string;
}): ConfirmCheck {
  const p = input.pending;
  if (!p) return { ok: false, reason: "no_pending_memo", invalidate: false };
  const a = input.args as Record<string, unknown> | null;
  if (!a || typeof a !== "object" || Object.keys(a).some((k) => k !== "handle")) {
    return { ok: false, reason: "only_handle_allowed", invalidate: false };
  }
  if (typeof a.handle !== "string" || a.handle !== p.handle) {
    return { ok: false, reason: "invalid_handle", invalidate: false };
  }
  if (p.run_id !== input.run_id) return { ok: false, reason: "wrong_run", invalidate: true };
  if (!p.confirmable) return { ok: false, reason: "stale_handle", invalidate: true };
  if (!p.fingerprint || !input.fingerprint || p.fingerprint !== input.fingerprint) {
    return { ok: false, reason: "evidence_changed", invalidate: true };
  }
  if (!isStr(p.memo_json) || sha256(p.memo_json) !== p.memo_digest) {
    return { ok: false, reason: "candidate_integrity", invalidate: true };
  }
  let memo: unknown;
  try {
    memo = JSON.parse(p.memo_json);
  } catch {
    return { ok: false, reason: "candidate_integrity", invalidate: true };
  }
  if (!validCandidate(memo)) return { ok: false, reason: "candidate_invalid", invalidate: true };
  return { ok: true, memo: memo as ResearchMemo };
}
