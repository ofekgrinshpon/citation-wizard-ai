// P4 — Source Verifier (P6.2a: batched).
// Verifier runs at most 1–2 batched LLM calls per run instead of one call per
// claim. Each batch contains one or more whole claims plus all their
// candidates; the model emits one verdict per (candidate_id, claim_id) pair
// it was given. role_match is still computed deterministically in code.
// Acceptance behavior (direct/partial usable, tangential/unrelated dropped)
// and per-candidate aggregation are unchanged from the per-claim version.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import {
  Candidate,
  Claim,
  DroppedCandidate,
  MODEL_FULL,
  MODEL_MINI,
  StageRun,
  SUPPORT_LEVELS,
  SUPPORT_SUBTYPES,
  SourceRole,
  SupportLevel,
  SupportSubtype,
  UsableCandidate,
  Verdict,
} from "../lib/types.ts";

// Batching threshold (total candidates across all claims in this run).
const SINGLE_BATCH_MAX = 24;
// If any individual claim has more candidates than this, it gets its own call.
const PER_CLAIM_OVERSIZED = 24;
// P6.2b: Verifier batches run concurrently with a small cap. Cap=2 is enough
// for today's planBatches output (≤2 normal batches + oversized-per-claim) and
// keeps headroom against provider rate limits. Failed-with-rate-limit batches
// fall back to a sequential retry preserving plan order.
const VERIFIER_BATCH_CONCURRENCY = 2;

const SYSTEM_PROMPT = `אתה מאמת מקורות משפטי (Source Verifier) במערכת מחקר משפטי ישראלית.
תקבל שאלה אחת של המשתמש, רשימת טענות משפטיות (claims), ורשימת מועמדים (candidates) שאוחזרו עבורן.
כל מועמד מתויג עם ה-claim_id של הטענה שעבורה אוחזר.
המשימה: לקבוע עבור כל זוג (candidate_id, claim_id) שסיפקתי לך עד כמה המועמד תומך בטענה הספציפית הזו.

ערכי support מותרים: direct, partial, tangential, unrelated.

הגדרות (זהות סובייקטיבית — subject identity — היא המבחן העיקרי):
- direct: המקור עוסק *ישירות* בסובייקט הספציפי של הטענה — אותו חוק/פקודה, אותה דוקטרינה, אותו פסק דין, אותו סעיף, או אותה סוגיה עובדתית. חפיפת מילות מפתח או שיוך לאותו תחום משפט אינה מספיקה ל-direct.
- partial: עוסק בסובייקט קרוב או באספקט מסוים של הטענה, שמיש כתמיכה משלימה (למשל: אותו תחום משפטי אך חוק אחר; אותה דוקטרינה בהקשר מקביל; מקור המסביר את הרקע הכללי).
- tangential: נוגע רק בשולי הנושא (אזכור צדדי, רקע רחב, מקור על תחום סמוך, דף נחיתה של כתב עת ללא תוכן ממוקד).
- unrelated: לא קשור לטענה כלל, גם אם הכותרת נראית דומה, גם אם קיימת חפיפת מילים.

כללי סיווג נוקשים:
- חוק/פקודה אחר מזה שבטענה = לא direct. לדוגמה: טענה על "פקודת מס הכנסה" ומקור על "פקודת הראיות (נוסח חדש)" אינם באותו סובייקט → tangential לכל היותר; support_subtype: "wrong_subject".
- הרחבה דוקטרינרית או אנלוגית = partial לכל היותר, לא direct. לדוגמה: טענה על התפתחות פסיקתית של דיני מס ומקור על החלת דין מנדטורי בשטחי יו"ש → אנלוגי בלבד; support_subtype: "analogical".
- תקנות/חוק בתחום סמוך אך שונה = לא direct. לדוגמה: טענה על זכויות לפי פקודת מס הכנסה ומקור על תקנות ביטוח לאומי (ביטוח סיעוד) → סובייקט אחר; support_subtype: "wrong_subject".
- דף נחיתה, אינדקס של כתב עת, עמוד מוסדי כללי, או מקור ללא תוכן ממוקד = לא direct גם אם התחום כללי מתאים; support_subtype: "background".
- אם ה-reason שלך אומר שהמקור *אינו עוסק* בנושא הטענה (למשל "אינו מקור לפקודת המס עצמה", "does not address"), אסור לסמן direct — יש להוריד ל-partial לכל היותר.

תפקידי מקור:
- חוק (primary_statute) יכול לתמוך ישירות בכלל משפטי "ספרי" (black-letter) — אם זה אותו חוק/סעיף.
- פסיקה (binding_case_law / persuasive_case_law) יכולה לתמוך בדוקטרינה וביישומה — אם אותה דוקטרינה, אותו סובייקט.
- ספרות (scholarship) מסבירה דוקטרינה אך אינה תחליף לחוק/פסיקה כשנדרש דין מהותי.
- דו"חות (factual_report / government_report) מתאימים לרקע עובדתי, לא לכלל משפטי בפני עצמם.
- דחה (unrelated) מועמדי exact_authority "רועשים": אם הכותרת והקטע אינם נוגעים לטענה — לדוגמה "החוק העותומני על האגודות", "חוק אמנת האג", תקנות גמלאות לשרים כאשר הטענה היא על פיצוי מוסכם.
- בטענות על "השתק פלוגתא" / "מעשה בית דין" / issue preclusion: מועמדים העוסקים ב"השתק מחמת מצג" / promissory estoppel הם unrelated אלא אם הטענה מציינת מפורשות הבטחה/מצג/הסתמכות.

שדות פלט:
- support: אחד מהערכים לעיל.
- support_subtype (אופציונלי, מומלץ): "exact_subject" (אותו חוק/סעיף/דוקטרינה בדיוק) | "same_domain" (תחום זהה אך חוק/סוגיה אחרים) | "analogical" (הקבלה דוקטרינרית/אנלוגית) | "background" (רקע כללי, דף נחיתה, סקירה) | "wrong_subject" (סובייקט אחר לחלוטין).
- supported_points: 1–3 נקודות קצרות בעברית המסבירות *מה* בדיוק תומך (ריק אם unrelated).
- reason: משפט קצר בעברית המסביר את ההחלטה, ובפרט עבור tangential/unrelated — מדוע נדחה.

החזר רק דרך הקריאה לכלי emit_verdicts. כלול verdict אחד לכל זוג (candidate_id, claim_id) שסיפקתי לך — בדיוק לפי אותם candidate_id ו-claim_id, ללא המצאות.`;

const VERIFIER_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          candidate_id: { type: "string" },
          claim_id: { type: "string" },
          support: { type: "string", enum: [...SUPPORT_LEVELS] },
          support_subtype: {
            type: "string",
            enum: [...SUPPORT_SUBTYPES],
            description:
              "Optional subject-identity sub-classification. Use wrong_subject for a different statute/case/doctrine; analogical for a parallel doctrine; background for landing pages or generic overviews.",
          },
          supported_points: {
            type: "array",
            items: { type: "string" },
            maxItems: 3,
          },
          reason: { type: "string" },
        },
        required: ["candidate_id", "claim_id", "support", "supported_points", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

interface RawVerdict {
  candidate_id?: unknown;
  claim_id?: unknown;
  support?: unknown;
  support_subtype?: unknown;
  supported_points?: unknown;
  reason?: unknown;
}

function pairKey(candidate_id: string, claim_id: string): string {
  return `${candidate_id}::${claim_id}`;
}

// ─── Subject-identity strictness (Phase 1) ─────────────────────────────────
// Deterministic post-verdict pass. Applies after the model returns and before
// verdicts feed into aggregation. Never *promotes* — only demotes.
export type DemotionRule =
  | "wrong_subject"
  | "analogical"
  | "background"
  | "self_contradiction"
  | "landing_page";

export interface DemotionEvent {
  candidate_id: string;
  claim_id: string;
  from: SupportLevel;
  to: SupportLevel;
  rule: DemotionRule;
  reason_excerpt: string;
}

const SELF_CONTRADICTION_PATTERNS: RegExp[] = [
  /אינ[הו]\s*(?:ה)?\s*(?:מקור|עוסק|מתייחס|נוגע)/,
  /לא\s+עוסק/,
  /לא\s+מתייחס/,
  /לא\s+נוגע/,
  /not\s+about/i,
  /does\s+not\s+address/i,
  /does\s+not\s+discuss/i,
  /unrelated\s+to/i,
  /off[-\s]topic/i,
];

const LANDING_SNIPPET_MIN = 120;

function isSelfContradictory(reason: string): boolean {
  if (!reason) return false;
  return SELF_CONTRADICTION_PATTERNS.some((re) => re.test(reason));
}

function isLandingPage(cand: Candidate | undefined): boolean {
  if (!cand) return false;
  const snip = (cand.snippet || "").trim();
  return snip.length < LANDING_SNIPPET_MIN;
}

/**
 * Enforce subject-identity strictness. Returns a possibly-modified verdict and
 * the demotion event that fired (if any). Order matters — the strictest rule
 * that applies wins:
 *   1. wrong_subject → unrelated
 *   2. self_contradiction (direct only) → partial
 *   3. landing_page (direct only) → partial
 *   4. analogical (direct only) → partial
 *   5. background (direct only) → partial
 *
 * Never promotes; already-tangential/unrelated verdicts pass through
 * untouched (except for wrong_subject which always forces unrelated).
 */
export function enforceSubjectIdentity(
  verdict: Verdict,
  cand: Candidate | undefined,
): { verdict: Verdict; demotion: DemotionEvent | null } {
  const from = verdict.support;
  const excerpt = (verdict.reason || "").slice(0, 200);

  // Rule 1: wrong_subject forces unrelated regardless of current support.
  if (verdict.support_subtype === "wrong_subject" && from !== "unrelated") {
    return {
      verdict: { ...verdict, support: "unrelated" },
      demotion: {
        candidate_id: verdict.candidate_id,
        claim_id: verdict.claim_id,
        from,
        to: "unrelated",
        rule: "wrong_subject",
        reason_excerpt: excerpt,
      },
    };
  }

  // Rules 2–5 only demote direct → partial.
  if (from !== "direct") return { verdict, demotion: null };

  if (isSelfContradictory(verdict.reason)) {
    return {
      verdict: { ...verdict, support: "partial" },
      demotion: {
        candidate_id: verdict.candidate_id,
        claim_id: verdict.claim_id,
        from,
        to: "partial",
        rule: "self_contradiction",
        reason_excerpt: excerpt,
      },
    };
  }

  if (isLandingPage(cand)) {
    return {
      verdict: { ...verdict, support: "partial" },
      demotion: {
        candidate_id: verdict.candidate_id,
        claim_id: verdict.claim_id,
        from,
        to: "partial",
        rule: "landing_page",
        reason_excerpt: excerpt,
      },
    };
  }

  if (verdict.support_subtype === "analogical") {
    return {
      verdict: { ...verdict, support: "partial" },
      demotion: {
        candidate_id: verdict.candidate_id,
        claim_id: verdict.claim_id,
        from,
        to: "partial",
        rule: "analogical",
        reason_excerpt: excerpt,
      },
    };
  }

  if (verdict.support_subtype === "background") {
    return {
      verdict: { ...verdict, support: "partial" },
      demotion: {
        candidate_id: verdict.candidate_id,
        claim_id: verdict.claim_id,
        from,
        to: "partial",
        rule: "background",
        reason_excerpt: excerpt,
      },
    };
  }

  return { verdict, demotion: null };
}


function validateBatchVerdicts(
  raw: unknown,
  expectedPairs: Set<string>,
): { ok: boolean; verdicts: Verdict[]; errors: string[]; missing: string[] } {
  const errors: string[] = [];
  const r = (raw ?? {}) as Record<string, unknown>;
  const arr = Array.isArray(r.verdicts) ? (r.verdicts as RawVerdict[]) : [];
  const verdicts: Verdict[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const candidate_id = typeof v.candidate_id === "string" ? v.candidate_id : "";
    const claim_id = typeof v.claim_id === "string" ? v.claim_id : "";
    if (!candidate_id || !claim_id) {
      errors.push(`missing candidate_id/claim_id`);
      continue;
    }
    const key = pairKey(candidate_id, claim_id);
    if (!expectedPairs.has(key)) {
      errors.push(`unknown pair: ${key}`);
      continue;
    }
    if (seen.has(key)) {
      errors.push(`duplicate pair: ${key}`);
      continue;
    }
    const support = typeof v.support === "string" &&
        (SUPPORT_LEVELS as readonly string[]).includes(v.support)
      ? (v.support as SupportLevel)
      : null;
    if (!support) {
      errors.push(`invalid support for ${key}: ${String(v.support)}`);
      continue;
    }
    const supported_points = Array.isArray(v.supported_points)
      ? (v.supported_points as unknown[]).filter((p): p is string => typeof p === "string" && p.length > 0).slice(0, 3)
      : [];
    const reason = typeof v.reason === "string" ? v.reason : "";
    const support_subtype = typeof v.support_subtype === "string" &&
        (SUPPORT_SUBTYPES as readonly string[]).includes(v.support_subtype)
      ? (v.support_subtype as SupportSubtype)
      : undefined;
    seen.add(key);
    verdicts.push({
      candidate_id,
      claim_id,
      support,
      role_match: false, // filled in by caller
      supported_points,
      reason,
      ...(support_subtype ? { support_subtype } : {}),
    });
  }
  const missing: string[] = [];
  for (const k of expectedPairs) {
    if (!seen.has(k)) missing.push(k);
  }
  // We tolerate a few unknown-pair errors without failing the whole batch,
  // but require that no expected pair is missing for the batch to be "ok".
  return { ok: missing.length === 0 && errors.length === 0, verdicts, errors, missing };
}

function buildBatchUserMessage(
  question: string,
  claims: Claim[],
  cands: Candidate[],
): string {
  const lines: string[] = [];
  lines.push(`שאלת המשתמש: ${question}`);
  lines.push("");
  lines.push(`טענות בקבוצה זו (${claims.length}):`);
  for (const cl of claims) {
    lines.push("---");
    lines.push(`claim_id: ${cl.claim_id}`);
    lines.push(`טענה: ${cl.text_he}`);
    lines.push(`required_roles: ${cl.required_roles.join(", ") || "(none)"}`);
    lines.push(`is_black_letter: ${cl.is_black_letter}`);
  }
  lines.push("");
  lines.push(`מועמדים בקבוצה זו (${cands.length}). כל מועמד אוחזר עבור claim_id הספציפי שלו ויש לחוות עליו דעה ביחס לאותה טענה בלבד:`);
  for (const c of cands) {
    const snip = (c.snippet || "").replace(/\s+/g, " ").trim().slice(0, 600);
    lines.push("---");
    lines.push(`candidate_id: ${c.candidate_id}`);
    lines.push(`claim_id: ${c.claim_id}`);
    lines.push(`role: ${c.role}`);
    lines.push(`source_type: ${c.source_type}`);
    lines.push(`origin: ${c.origin} (${c.retrieval_method})`);
    lines.push(`title: ${c.title}`);
    if (c.source_url) lines.push(`url: ${c.source_url}`);
    if (snip) lines.push(`snippet: ${snip}`);
  }
  lines.push("");
  lines.push(
    `החזר verdicts עבור כל ${cands.length} הזוגות (candidate_id, claim_id) לעיל, בשימוש באותם מזהים בדיוק.`,
  );
  return lines.join("\n");
}

function rolesMatch(candidateRole: SourceRole, required: SourceRole[]): boolean {
  if (required.length === 0) return true;
  if (required.includes(candidateRole)) return true;
  if (
    (candidateRole === "binding_case_law" && required.includes("persuasive_case_law")) ||
    (candidateRole === "persuasive_case_law" && required.includes("binding_case_law"))
  ) return true;
  return false;
}

const SUPPORT_RANK: Record<SupportLevel, number> = {
  direct: 0,
  partial: 1,
  tangential: 2,
  unrelated: 3,
};

export interface VerifierCallFailure {
  batch_label: string;
  stage: string; // e.g. "verifier.batch1.initial" | "verifier.batch1.escalated"
  model: string;
  ms: number;
  http_status?: number;
  http_error?: string;
  parse_error?: string;
  failure_reason: string;
  candidate_count: number;
  request_payload_size: number;
  tool_call_present: boolean;
  raw_response_present: boolean;
  escalation_attempted: boolean;
  escalation_from?: string;
  escalation_to?: string;
}

export interface VerifierResult {
  ms: number;
  model_initial: string;
  model_final: string;
  escalated_claims: string[];
  per_claim_ms: Record<string, number>;
  verdicts: Verdict[];
  counts: {
    by_support: Record<SupportLevel, number>;
    by_role_match: { true: number; false: number };
    // Split of by_support into real model verdicts vs synthetic backfill.
    by_support_model: Record<SupportLevel, number>;
    by_support_synthetic: Record<SupportLevel, number>;
    model_verdicts: number;
    synthetic_verdicts: number;
  };
  candidates_verified: number;
  candidates_usable: number;
  candidates_dropped: number;
  usable: UsableCandidate[];
  dropped: DroppedCandidate[];
  stage_runs: StageRun[];
  errors: Array<{ claim_id: string; reason: string }>;
  batches: Array<{
    label: string;
    claim_ids: string[];
    candidates: number;
    escalated: boolean;
    ms: number;
    failed?: boolean;
    failure_reason?: string;
  }>;
  // P6.2b parallel verifier telemetry (orchestration only, contract preserved):
  parallel: boolean;
  concurrency_limit: number;
  batch_count: number;
  batch_ms: number[];
  total_wall_ms: number;
  total_sum_ms: number;
  escalated_batches: number;
  merge_order_preserved: boolean;
  rate_limit_count: number;
  retry_count: number;
  fallback_to_sequential: boolean;
  // Verifier-call observability (new).
  call_failed: boolean;
  call_failures: VerifierCallFailure[];
  recovered_batches: number;
  retry_attempts: number;
  split_probe_attempts: number;
  // Phase 1: subject-identity strictness telemetry.
  demotions: DemotionEvent[];
  demotions_by_rule: Record<DemotionRule, number>;

}

interface Batch {
  label: string;
  claims: Claim[];
  candidates: Candidate[];
}

function planBatches(claims: Claim[], byClaim: Map<string, Candidate[]>, planOpts?: { forceSplit?: boolean }): Batch[] {
  const present = claims.filter((c) => (byClaim.get(c.claim_id)?.length ?? 0) > 0);
  if (present.length === 0) return [];

  const oversized: Claim[] = [];
  const normal: Claim[] = [];
  for (const c of present) {
    const n = byClaim.get(c.claim_id)?.length ?? 0;
    if (n > PER_CLAIM_OVERSIZED) oversized.push(c);
    else normal.push(c);
  }

  const batches: Batch[] = [];
  // Oversized claims each get a dedicated batch.
  for (const c of oversized) {
    batches.push({
      label: `oversized.${c.claim_id}`,
      claims: [c],
      candidates: byClaim.get(c.claim_id) ?? [],
    });
  }

  const totalNormal = normal.reduce((s, c) => s + (byClaim.get(c.claim_id)?.length ?? 0), 0);
  if (totalNormal === 0) return batches;

  // Test-only: force splitting into 2 buckets to exercise the parallel path.
  // Triggered via planOpts.forceSplit (set by runVerifier when caller passes
  // opts.forceSplit). Production paths never pass this; behavior is identical.
  const forceSplit = planOpts?.forceSplit === true;

  if (!forceSplit && totalNormal <= SINGLE_BATCH_MAX) {
    batches.push({
      label: `batch1`,
      claims: normal,
      candidates: normal.flatMap((c) => byClaim.get(c.claim_id) ?? []),
    });
    return batches;
  }
  if (forceSplit && normal.length < 2) {
    batches.push({
      label: `batch1`,
      claims: normal,
      candidates: normal.flatMap((c) => byClaim.get(c.claim_id) ?? []),
    });
    return batches;
  }

  // Split normal claims greedily into 2 buckets balanced by candidate count,
  // largest-first.
  const sorted = [...normal].sort(
    (a, b) => (byClaim.get(b.claim_id)?.length ?? 0) - (byClaim.get(a.claim_id)?.length ?? 0),
  );
  const buckets: Claim[][] = [[], []];
  const sizes = [0, 0];
  for (const c of sorted) {
    const n = byClaim.get(c.claim_id)?.length ?? 0;
    const target = sizes[0] <= sizes[1] ? 0 : 1;
    buckets[target].push(c);
    sizes[target] += n;
  }
  buckets.forEach((claimsInBucket, i) => {
    if (claimsInBucket.length === 0) return;
    batches.push({
      label: `batch${i + 1}`,
      claims: claimsInBucket,
      candidates: claimsInBucket.flatMap((c) => byClaim.get(c.claim_id) ?? []),
    });
  });
  return batches;
}

export async function runVerifier(
  question: string,
  claims: Claim[],
  candidates: Candidate[],
  opts?: { forceSplit?: boolean },
): Promise<VerifierResult> {
  const t_total = Date.now();
  const stage_runs: StageRun[] = [];
  const errors: Array<{ claim_id: string; reason: string }> = [];
  const per_claim_ms: Record<string, number> = {};
  const escalated_claims: string[] = [];
  const allVerdicts: Verdict[] = [];
  const batchesMeta: VerifierResult["batches"] = [];

  // Group candidates by claim_id.
  const byClaim = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = byClaim.get(c.claim_id) ?? [];
    arr.push(c);
    byClaim.set(c.claim_id, arr);
  }
  const claimsById = new Map(claims.map((c) => [c.claim_id, c]));

  // Test-only: caller may force planBatches to split into >=2 buckets so the
  // parallel orchestration path is actually exercised in E.1 validation.
  // Production paths never pass opts.forceSplit. No env mutation.
  const batches = planBatches(claims, byClaim, { forceSplit: opts?.forceSplit === true });

  let anyEscalated = false;

  // ---- P6.2b: parallel verifier batches with deterministic plan-order merge.
  // Each batch is processed by processBatch() into a self-contained BatchOutcome.
  // After the bounded pool drains, outcomes are flushed in slot (plan) order
  // into the existing accumulators so stage_runs / batchesMeta / per_claim_ms
  // remain byte-identical in ordering to the sequential implementation.
  interface BatchOutcome {
    stage_runs: StageRun[];
    verdicts: Verdict[];
    demotions: DemotionEvent[];
    meta: {
      label: string;
      claim_ids: string[];
      candidates: number;
      escalated: boolean;
      ms: number;
      failed?: boolean;
      failure_reason?: string;
      attempts?: number;
      split_probes?: number;
      recovered?: boolean;
    };
    errors: Array<{ claim_id: string; reason: string }>;
    per_claim_ms: Record<string, number>;
    escalated_claim_ids: string[];
    rate_limited: boolean;
    failed: boolean;
    failure_reason?: string;
    call_failures: VerifierCallFailure[];
    recovered: boolean;
    retry_attempts: number;
    split_probe_attempts: number;
  }

  const isRateLimited = (r: { http_status: number; http_error?: string }): boolean => {
    if (r.http_status === 429) return true;
    const t = (r.http_error || "").toLowerCase();
    return /(^|\b)429\b/.test(t) || /rate[\s_-]*limit/.test(t);
  };

  interface AttemptResult {
    hasData: boolean;
    verdicts: Verdict[];
    stage_runs: StageRun[];
    call_failures: VerifierCallFailure[];
    demotions: DemotionEvent[];
    escalated: boolean;
    rate_limited: boolean;
    validator_errors: string[];
    last_failure_reason?: string;
  }

  // Run one attempt (initial + optional escalation) over an arbitrary
  // (claims, candidates) slice. Never backfills; returns only what the model
  // produced. Caller composes attempts and does final backfill.
  const runAttempt = async (
    stageLabel: string,
    attemptClaims: Claim[],
    attemptCands: Candidate[],
  ): Promise<AttemptResult> => {
    const out: AttemptResult = {
      hasData: false,
      verdicts: [],
      stage_runs: [],
      call_failures: [],
      demotions: [],
      escalated: false,
      rate_limited: false,
      validator_errors: [],
    };
    const expectedPairs = new Set<string>(
      attemptCands.map((c) => pairKey(c.candidate_id, c.claim_id)),
    );
    const candById = new Map(attemptCands.map((c) => [c.candidate_id, c]));
    const userMsg = buildBatchUserMessage(question, attemptClaims, attemptCands);
    const payloadSize = SYSTEM_PROMPT.length + userMsg.length;

    const t0 = Date.now();
    let resp = await callOpenAIJsonTool<unknown>({
      model: MODEL_MINI,
      system: SYSTEM_PROMPT,
      user: userMsg,
      tool: {
        name: "emit_verdicts",
        description: "Emit one verdict per (candidate_id, claim_id) pair provided.",
        parameters: VERIFIER_TOOL_PARAMETERS,
      },
    });
    const initialMs = Date.now() - t0;
    const initialStage = `verifier.${stageLabel}.initial`;
    out.stage_runs.push({
      stage: initialStage,
      model: MODEL_MINI,
      ms: initialMs,
      ok: !!resp.data,
      ...(typeof resp.http_status === "number" ? { http_status: resp.http_status } : {}),
      ...(resp.http_error ? { http_error: resp.http_error.slice(0, 500) } : {}),
      ...(resp.parse_error ? { parse_error: resp.parse_error.slice(0, 500) } : {}),
    });
    if (!resp.data) {
      out.call_failures.push({
        batch_label: stageLabel,
        stage: initialStage,
        model: MODEL_MINI,
        ms: initialMs,
        http_status: resp.http_status,
        http_error: resp.http_error?.slice(0, 500),
        parse_error: resp.parse_error?.slice(0, 500),
        failure_reason:
          resp.http_error || resp.parse_error || `http_status=${resp.http_status}`,
        candidate_count: attemptCands.length,
        request_payload_size: payloadSize,
        tool_call_present: false,
        raw_response_present: !!resp.raw_text,
        escalation_attempted: false,
      });
      out.last_failure_reason =
        resp.http_error || resp.parse_error || `http_status=${resp.http_status}`;
    }
    if (isRateLimited(resp)) out.rate_limited = true;
    let parsed = validateBatchVerdicts(resp.data, expectedPairs);

    if (!parsed.ok) {
      out.escalated = true;
      const t1 = Date.now();
      resp = await callOpenAIJsonTool<unknown>({
        model: MODEL_FULL,
        system: SYSTEM_PROMPT,
        user: userMsg,
        tool: {
          name: "emit_verdicts",
          description: "Emit one verdict per (candidate_id, claim_id) pair provided.",
          parameters: VERIFIER_TOOL_PARAMETERS,
        },
      });
      const escMs = Date.now() - t1;
      const escStage = `verifier.${stageLabel}.escalated`;
      out.stage_runs.push({
        stage: escStage,
        model: MODEL_FULL,
        ms: escMs,
        ok: !!resp.data,
        escalated: true,
        ...(typeof resp.http_status === "number" ? { http_status: resp.http_status } : {}),
        ...(resp.http_error ? { http_error: resp.http_error.slice(0, 500) } : {}),
        ...(resp.parse_error ? { parse_error: resp.parse_error.slice(0, 500) } : {}),
      });
      if (!resp.data) {
        out.call_failures.push({
          batch_label: stageLabel,
          stage: escStage,
          model: MODEL_FULL,
          ms: escMs,
          http_status: resp.http_status,
          http_error: resp.http_error?.slice(0, 500),
          parse_error: resp.parse_error?.slice(0, 500),
          failure_reason:
            resp.http_error || resp.parse_error || `http_status=${resp.http_status}`,
          candidate_count: attemptCands.length,
          request_payload_size: payloadSize,
          tool_call_present: false,
          raw_response_present: !!resp.raw_text,
          escalation_attempted: true,
          escalation_from: MODEL_MINI,
          escalation_to: MODEL_FULL,
        });
        out.last_failure_reason =
          resp.http_error || resp.parse_error || `http_status=${resp.http_status}`;
      }
      if (isRateLimited(resp)) out.rate_limited = true;
      parsed = validateBatchVerdicts(resp.data, expectedPairs);
    }

    out.hasData = !!resp.data;
    out.validator_errors = parsed.errors;
    for (const v of parsed.verdicts) {
      const cand = candById.get(v.candidate_id);
      const claim = claimsById.get(v.claim_id);
      if (cand && claim) v.role_match = rolesMatch(cand.role, claim.required_roles);
      const enforced = enforceSubjectIdentity(v, cand);
      if (enforced.demotion) out.demotions.push(enforced.demotion);
      out.verdicts.push(enforced.verdict);
    }
    return out;
  };

  const processBatch = async (batch: Batch): Promise<BatchOutcome> => {
    const outerT0 = Date.now();
    const out: BatchOutcome = {
      stage_runs: [],
      verdicts: [],
      demotions: [],
      meta: {
        label: batch.label,
        claim_ids: batch.claims.map((c) => c.claim_id),
        candidates: batch.candidates.length,
        escalated: false,
        ms: 0,
        attempts: 0,
        split_probes: 0,
        recovered: false,
      },
      errors: [],
      per_claim_ms: {},
      escalated_claim_ids: [],
      rate_limited: false,
      failed: false,
      call_failures: [],
      recovered: false,
      retry_attempts: 0,
      split_probe_attempts: 0,
    };

    // Validate that all batch claims exist in analyzer output.
    for (const cl of batch.claims) {
      if (!claimsById.has(cl.claim_id)) {
        out.errors.push({ claim_id: cl.claim_id, reason: "claim not found in analyzer output" });
      }
    }

    const mergedByPair = new Map<string, Verdict>();
    const mergeAttempt = (att: AttemptResult) => {
      out.stage_runs.push(...att.stage_runs);
      out.call_failures.push(...att.call_failures);
      out.demotions.push(...att.demotions);
      if (att.escalated) out.meta.escalated = true;
      if (att.rate_limited) out.rate_limited = true;
      if (att.validator_errors.length) {
        out.errors.push({
          claim_id: batch.claims.map((c) => c.claim_id).join(","),
          reason: att.validator_errors.slice(0, 3).join("; "),
        });
      }
      for (const v of att.verdicts) {
        const key = pairKey(v.candidate_id, v.claim_id);
        if (!mergedByPair.has(key)) mergedByPair.set(key, v);
      }
    };

    // Attempt 1: original batch.
    out.meta.attempts = 1;
    const att1 = await runAttempt(batch.label, batch.claims, batch.candidates);
    mergeAttempt(att1);
    let lastFailure = att1.last_failure_reason;
    let recoveredFromRetry = false;

    // Attempt 2: bounded retry of the same batch if no data (or missing pairs).
    if (!att1.hasData || att1.verdicts.length === 0) {
      out.meta.attempts = 2;
      out.retry_attempts = 1;
      const att2 = await runAttempt(`${batch.label}.retry1`, batch.claims, batch.candidates);
      mergeAttempt(att2);
      lastFailure = att2.last_failure_reason ?? lastFailure;
      if (att2.hasData && att2.verdicts.length > 0) recoveredFromRetry = true;

      // Attempt 3: split into per-candidate probes (grouped by claim).
      if (!att2.hasData || att2.verdicts.length === 0) {
        // Chunk into groups of 4 for efficiency; each chunk keeps its claim.
        const chunkSize = 4;
        const candsByClaim = new Map<string, Candidate[]>();
        for (const c of batch.candidates) {
          const arr = candsByClaim.get(c.claim_id) ?? [];
          arr.push(c);
          candsByClaim.set(c.claim_id, arr);
        }
        let probeIdx = 0;
        let anySplitOk = false;
        for (const cl of batch.claims) {
          const arr = candsByClaim.get(cl.claim_id) ?? [];
          for (let i = 0; i < arr.length; i += chunkSize) {
            const chunk = arr.slice(i, i + chunkSize);
            probeIdx++;
            out.split_probe_attempts++;
            const attS = await runAttempt(
              `${batch.label}.split${probeIdx}`,
              [cl],
              chunk,
            );
            mergeAttempt(attS);
            if (attS.hasData && attS.verdicts.length > 0) anySplitOk = true;
            lastFailure = attS.last_failure_reason ?? lastFailure;
          }
        }
        out.meta.split_probes = probeIdx;
        if (anySplitOk) recoveredFromRetry = true;
      }
    }

    // Deterministic backfill for still-missing pairs (mark synthetic).
    const candById = new Map(batch.candidates.map((c) => [c.candidate_id, c]));
    for (const c of batch.candidates) {
      const key = pairKey(c.candidate_id, c.claim_id);
      if (!mergedByPair.has(key)) {
        const claim = claimsById.get(c.claim_id);
        if (!claim) continue;
        mergedByPair.set(key, {
          candidate_id: c.candidate_id,
          claim_id: c.claim_id,
          support: "unrelated",
          role_match: rolesMatch(c.role, claim.required_roles),
          supported_points: [],
          reason: "verifier did not return a verdict for this candidate",
          synthetic: true,
          synthetic_reason: "missing_verifier_output",
        });
      }
    }
    // Emit merged verdicts (dedup done by mergedByPair).
    out.verdicts = Array.from(mergedByPair.values());
    void candById;

    out.meta.ms = Date.now() - outerT0;
    for (const cl of batch.claims) out.per_claim_ms[cl.claim_id] = out.meta.ms;
    if (out.meta.escalated) {
      for (const cl of batch.claims) out.escalated_claim_ids.push(cl.claim_id);
    }

    const realCount = out.verdicts.filter((v) => !v.synthetic).length;
    out.recovered = recoveredFromRetry && realCount > 0;
    out.meta.recovered = out.recovered;
    if (realCount === 0) {
      out.failed = true;
      out.failure_reason = lastFailure ?? "verifier returned no data after retries";
      out.meta.failed = true;
      out.meta.failure_reason = out.failure_reason;
    }
    return out;
  };


  // Bounded-concurrency worker pool. Cursor is shared via closure; JS is
  // single-threaded so `cursor++` is atomic across workers.
  const slots: (BatchOutcome | undefined)[] = new Array(batches.length).fill(undefined);
  const t_pool = Date.now();
  {
    let cursor = 0;
    const workers: Promise<void>[] = [];
    const workerCount = Math.min(VERIFIER_BATCH_CONCURRENCY, batches.length);
    for (let w = 0; w < workerCount; w++) {
      workers.push((async () => {
        while (true) {
          const i = cursor++;
          if (i >= batches.length) return;
          try {
            slots[i] = await processBatch(batches[i]);
          } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            slots[i] = {
              stage_runs: [],
              verdicts: [],
              demotions: [],
              meta: {
                label: batches[i].label,
                claim_ids: batches[i].claims.map((c) => c.claim_id),
                candidates: batches[i].candidates.length,
                escalated: false,
                ms: 0,
                failed: true,
                failure_reason: reason,
              },
              errors: [{
                claim_id: batches[i].claims.map((c) => c.claim_id).join(","),
                reason: `processBatch threw: ${reason}`,
              }],
              per_claim_ms: {},
              escalated_claim_ids: [],
              rate_limited: false,
              failed: true,
              failure_reason: reason,
              call_failures: [{
                batch_label: batches[i].label,
                stage: `verifier.${batches[i].label}.exception`,
                model: MODEL_MINI,
                ms: 0,
                failure_reason: reason,
                candidate_count: batches[i].candidates.length,
                request_payload_size: 0,
                tool_call_present: false,
                raw_response_present: false,
                escalation_attempted: false,
              }],
              recovered: false,
              retry_attempts: 0,
              split_probe_attempts: 0,
            };

          }
        }
      })());
    }
    await Promise.all(workers);
  }


  // Rate-limit safety net: re-run only rate-limited failed slots sequentially.
  // Preserves slot indexes; never re-runs successful batches.
  let rate_limit_count = slots.reduce((n, s) => n + (s?.rate_limited ? 1 : 0), 0);
  let retry_count = 0;
  let fallback_to_sequential = false;
  const rateLimitedFailed: number[] = [];
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s && s.failed && s.rate_limited) rateLimitedFailed.push(i);
  }
  if (rateLimitedFailed.length > 0) {
    fallback_to_sequential = true;
    for (const i of rateLimitedFailed) {
      try {
        slots[i] = await processBatch(batches[i]);
      } catch (e) {
        const prev = slots[i]!;
        prev.errors.push({
          claim_id: batches[i].claims.map((c) => c.claim_id).join(","),
          reason: `sequential retry threw: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      retry_count++;
      if (slots[i]?.rate_limited) rate_limit_count++;
    }
  }

  // Flush slots in plan order — deterministic merge.
  let merge_order_preserved = true;
  let escalated_batches = 0;
  const batch_ms_arr: number[] = [];
  const allDemotions: DemotionEvent[] = [];
  const allCallFailures: VerifierCallFailure[] = [];
  let recovered_batches = 0;
  let total_retry_attempts = 0;
  let total_split_probe_attempts = 0;
  let unrecovered_failed_batches = 0;

  for (let i = 0; i < batches.length; i++) {
    const s = slots[i];
    if (!s) {
      merge_order_preserved = false;
      continue;
    }
    if (s.meta.label !== batches[i].label) merge_order_preserved = false;
    stage_runs.push(...s.stage_runs);
    allVerdicts.push(...s.verdicts);
    allDemotions.push(...s.demotions);
    errors.push(...s.errors);
    allCallFailures.push(...s.call_failures);
    for (const cid of s.escalated_claim_ids) escalated_claims.push(cid);
    for (const [k, v] of Object.entries(s.per_claim_ms)) per_claim_ms[k] = v;
    batchesMeta.push(s.meta);
    batch_ms_arr.push(s.meta.ms);
    if (s.meta.escalated) {
      escalated_batches++;
      anyEscalated = true;
    }
    if (s.recovered) recovered_batches++;
    total_retry_attempts += s.retry_attempts;
    total_split_probe_attempts += s.split_probe_attempts;
    // Surface every UNRECOVERED batch call failure as a top-level verifier
    // error entry. When retry/split recovers real model verdicts, we do NOT
    // pollute the top-level errors array (recovered_batches still records it).
    if (s.failed && s.failure_reason) {
      unrecovered_failed_batches++;
      errors.push({
        claim_id: batches[i].claims.map((c) => c.claim_id).join(","),
        reason: `verifier_call_failed: ${s.failure_reason}`,
      });
    }
  }

  const total_wall_ms = Date.now() - t_pool;
  const total_sum_ms = batch_ms_arr.reduce((a, b) => a + b, 0);


  // Aggregate per-candidate best/worst across all its verdicts.
  const bestByCand = new Map<string, Verdict>();
  const allByCand = new Map<string, Verdict[]>();
  for (const v of allVerdicts) {
    const arr = allByCand.get(v.candidate_id) ?? [];
    arr.push(v);
    allByCand.set(v.candidate_id, arr);
    const prev = bestByCand.get(v.candidate_id);
    if (!prev || SUPPORT_RANK[v.support] < SUPPORT_RANK[prev.support]) {
      bestByCand.set(v.candidate_id, v);
    }
  }
  const candById = new Map(candidates.map((c) => [c.candidate_id, c]));

  const usable: UsableCandidate[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const c of candidates) {
    const best = bestByCand.get(c.candidate_id);
    if (!best) continue;
    if (best.support === "direct" || best.support === "partial") {
      const claimIds = (allByCand.get(c.candidate_id) ?? [])
        .filter((v) => v.support === "direct" || v.support === "partial")
        .map((v) => v.claim_id);
      usable.push({
        candidate_id: c.candidate_id,
        best_support: best.support,
        role_match: best.role_match,
        verdict_claim_ids: Array.from(new Set(claimIds)),
      });
    } else {
      const verdicts = allByCand.get(c.candidate_id) ?? [];
      const tangential = verdicts.find((v) => v.support === "tangential" && v.reason);
      const unrelated = verdicts.find((v) => v.support === "unrelated" && v.reason);
      const chosen = tangential ?? unrelated ?? best;
      dropped.push({
        candidate_id: c.candidate_id,
        title: c.title,
        role: c.role,
        origin: c.origin,
        retrieval_method: c.retrieval_method,
        reason: chosen.reason || "no reason given",
        worst_support: best.support,
      });
    }
  }

  const emptySupport = (): Record<SupportLevel, number> => ({
    direct: 0, partial: 0, tangential: 0, unrelated: 0,
  });
  const counts = {
    by_support: emptySupport(),
    by_role_match: { true: 0, false: 0 },
    by_support_model: emptySupport(),
    by_support_synthetic: emptySupport(),
    model_verdicts: 0,
    synthetic_verdicts: 0,
  };
  for (const v of allVerdicts) {
    counts.by_support[v.support] = (counts.by_support[v.support] ?? 0) + 1;
    if (v.role_match) counts.by_role_match.true++;
    else counts.by_role_match.false++;
    if (v.synthetic) {
      counts.by_support_synthetic[v.support] = (counts.by_support_synthetic[v.support] ?? 0) + 1;
      counts.synthetic_verdicts++;
    } else {
      counts.by_support_model[v.support] = (counts.by_support_model[v.support] ?? 0) + 1;
      counts.model_verdicts++;
    }
  }

  return {
    ms: Date.now() - t_total,
    model_initial: MODEL_MINI,
    model_final: anyEscalated ? MODEL_FULL : MODEL_MINI,
    escalated_claims: Array.from(new Set(escalated_claims)),
    per_claim_ms,
    verdicts: allVerdicts,
    counts,
    candidates_verified: candById.size,
    candidates_usable: usable.length,
    candidates_dropped: dropped.length,
    usable,
    dropped,
    stage_runs,
    errors,
    batches: batchesMeta,
    parallel: true,
    concurrency_limit: VERIFIER_BATCH_CONCURRENCY,
    batch_count: batches.length,
    batch_ms: batch_ms_arr,
    total_wall_ms,
    total_sum_ms,
    escalated_batches,
    merge_order_preserved,
    rate_limit_count,
    retry_count,
    fallback_to_sequential,
    call_failed: unrecovered_failed_batches > 0,
    call_failures: allCallFailures,
    recovered_batches,
    retry_attempts: total_retry_attempts,
    split_probe_attempts: total_split_probe_attempts,

    demotions: allDemotions,
    demotions_by_rule: allDemotions.reduce((acc, d) => {
      acc[d.rule] = (acc[d.rule] ?? 0) + 1;
      return acc;
    }, { wrong_subject: 0, analogical: 0, background: 0, self_contradiction: 0, landing_page: 0 } as Record<DemotionRule, number>),
  };
}
