// source_nomination_v1 — "what sources would a competent Israeli legal
// researcher expect to obtain for this question?"
//
// The planner answers "what search strings should we run?". Nothing before
// this stage ever names a concrete *source*. This stage nominates candidate
// sources (statutes, sections, regulations, judgments, MMM / State Comptroller
// / government reports, regulator guidance, bills, scholarship) and emits a
// small number of name-anchored retrieval queries for them.
//
// Nomination is never citation. Every nominated source must still be
// retrieved, acquired, validated and admitted by the existing gates. Nothing
// here relaxes verifier / source-integrity / claim-source-match / sufficiency.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import {
  AnalyzerOutput,
  MODEL_FULL,
  MODEL_MINI,
  Query,
  SourceRole,
  StageRun,
} from "../lib/types.ts";

export const SOURCE_NOMINATION_VERSION = "source_nomination_v1";

export const NOMINATION_LIMITS = {
  MAX_CANDIDATES: 5,
  MAX_QUERIES: 4,
  MAX_JUDGMENTS: 2,
  MAX_STATUTES: 2,
  MAX_SECONDARY: 2,
  /** Budget must cover reasoning tokens AND the tool call. At 1500 the gpt-5
   *  family burned the whole budget on reasoning and returned finish_reason
   *  "length" with no tool call — that was the nomination outage. */
  MAX_COMPLETION_TOKENS: 6000,
  RETRY_COMPLETION_TOKENS: 8000,
  ESCALATION_COMPLETION_TOKENS: 10000,
  /** A docket / bibliographic detail below this confidence is stripped. */
  IDENTIFIER_CONFIDENCE: 0.8,
  /** Nominations below this confidence are dropped entirely. */
  MIN_CONFIDENCE: 0.4,
} as const;

export type NominationCategory =
  | "statute"
  | "regulation"
  | "judgment"
  | "government_report"
  | "knesset_report"
  | "regulator_guidance"
  | "bill"
  | "scholarship"
  | "other";

export interface NominatedSource {
  nomination_id: string;
  category: NominationCategory;
  label_he: string;
  docket: string | null;
  statute_title: string | null;
  statute_section: string | null;
  authors: string[];
  journal_or_publisher: string | null;
  institution: string | null;
  year: number | null;
  topic_query: string | null;
  role_in_answer: string | null;
  confidence: number;
  must_verify: true;
  nominated_by: typeof SOURCE_NOMINATION_VERSION;
  /** Deterministic post-parse hardening record. */
  stripped_fields: string[];
}

export interface SourceNominationResult {
  version: typeof SOURCE_NOMINATION_VERSION;
  enabled: boolean;
  skip_reason: string | null;
  model_initial: string | null;
  model_final: string | null;
  escalated: boolean;
  escalation_reason: string | null;
  stage_failed: boolean;
  mini_retry_used: boolean;
  fallback_to_mini_used: boolean;
  mini_candidates_count_before_hardening: number;
  mini_candidates_count_after_hardening: number;
  finish_reason: string | null;
  reasoning_tokens: number | null;
  parse_error: string | null;
  http_status: number | null;
  candidates: NominatedSource[];
  dropped: Array<{ label: string; reason: string }>;
  queries: Query[];
  category_mix: Record<string, number>;
  identifier_bearing_count: number;
  stage_runs: StageRun[];
  ms: number;
}

/** Modes that must stay byte-identical / deterministic — never nominate. */
const SKIP_MODES = new Set(["canonical_quote"]);

const TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["nominations"],
  properties: {
    nominations: {
      type: "array",
      description: "עד 8 מקורות שחוקר משפטי ישראלי מיומן היה מצפה למצוא לשאלה הזו.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "category",
          "label_he",
          "docket",
          "statute_title",
          "statute_section",
          "authors",
          "journal_or_publisher",
          "institution",
          "year",
          "topic_query",
          "role_in_answer",
          "confidence",
        ],
        properties: {
          category: {
            type: "string",
            enum: [
              "statute",
              "regulation",
              "judgment",
              "government_report",
              "knesset_report",
              "regulator_guidance",
              "bill",
              "scholarship",
              "other",
            ],
          },
          label_he: { type: "string" },
          docket: { type: ["string", "null"] },
          statute_title: { type: ["string", "null"] },
          statute_section: { type: ["string", "null"] },
          authors: { type: "array", items: { type: "string" } },
          journal_or_publisher: { type: ["string", "null"] },
          institution: { type: ["string", "null"] },
          year: { type: ["integer", "null"] },
          topic_query: { type: ["string", "null"] },
          role_in_answer: { type: ["string", "null"] },
          confidence: { type: "number" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT =
  `אתה חוקר משפטי ישראלי בכיר. בהינתן שאלה משפטית וניתוח טענות, נקוב במקורות שחוקר מיומן היה מצפה להשיג כדי לענות עליה.

כללים:
- נקוב במקורות קונקרטיים ככל שאתה בטוח בהם: חוקי יסוד, חוקים וסעיפים, תקנות, פסקי דין מנחים, דוחות מרכז המחקר והמידע של הכנסת (ממ"מ), דוחות מבקר המדינה, דוחות ממשלתיים, הנחיות רגולטור והנחיות היועמ"ש, הצעות חוק ודברי הסבר, ספרות אקדמית.
- אל תגביל את עצמך לפסיקה. לשאלות מדיניות/אמפיריות נקוב בדוחות מוסדיים. לשאלות עיוניות נקוב גם בספרות.
- confidence בין 0 ל-1. אם אינך בטוח במספר ההליך המדויק — אל תמציא. השאר docket ריק (null) ונקוב בשמות הצדדים בתוך label_he ובשאילתה ב-topic_query.
- אותו כלל לשנת פרסום, שם מחבר וכתב עת: אם אינך בטוח — null.
- topic_query: שאילתת חיפוש בעברית שתאתר את המקור.
- role_in_answer: מה תפקיד המקור בתשובה (לדוגמה: "מקור הסמכות", "אמת המידה לביקורת שיפוטית", "רקע עובדתי", "ספרות תומכת").
- אל תמציא מקורות. עדיף פחות מקורות ובטוחים יותר.

החזר את התוצאה רק דרך הקריאה לכלי emit_source_nominations.`;

interface RawNomination {
  category?: string;
  label_he?: string;
  docket?: string | null;
  statute_title?: string | null;
  statute_section?: string | null;
  authors?: string[] | null;
  journal_or_publisher?: string | null;
  institution?: string | null;
  year?: number | null;
  topic_query?: string | null;
  role_in_answer?: string | null;
  confidence?: number;
}

function emptyResult(skip_reason: string | null): SourceNominationResult {
  return {
    version: SOURCE_NOMINATION_VERSION,
    enabled: skip_reason === null,
    skip_reason,
    model_initial: null,
    model_final: null,
    escalated: false,
    escalation_reason: null,
    stage_failed: false,
    mini_retry_used: false,
    fallback_to_mini_used: false,
    mini_candidates_count_before_hardening: 0,
    mini_candidates_count_after_hardening: 0,
    finish_reason: null,
    reasoning_tokens: null,
    parse_error: null,
    http_status: null,
    candidates: [],
    dropped: [],
    queries: [],
    category_mix: {},
    identifier_bearing_count: 0,
    stage_runs: [],
    ms: 0,
  };
}

function roleForCategory(cat: NominationCategory): SourceRole {
  switch (cat) {
    case "statute":
    case "bill":
      return "primary_statute" as SourceRole;
    case "regulation":
    case "regulator_guidance":
      return "regulation" as SourceRole;
    case "judgment":
      return "binding_case_law" as SourceRole;
    case "scholarship":
      return "scholarship" as SourceRole;
    case "government_report":
    case "knesset_report":
      return "government_report" as SourceRole;
    default:
      return "factual_report" as SourceRole;
  }
}

function expectedTypeForCategory(cat: NominationCategory): string {
  switch (cat) {
    case "statute":
    case "bill":
      return "statute";
    case "regulation":
    case "regulator_guidance":
      return "regulation";
    case "judgment":
      return "case";
    case "scholarship":
      return "academic";
    case "government_report":
    case "knesset_report":
      return "report";
    default:
      return "other";
  }
}

/** True when the nomination carries a stable cache/lookup identifier. */
export function isIdentifierBearing(n: NominatedSource): boolean {
  if (n.docket) return true;
  if (n.statute_title && n.statute_section) return true;
  if (n.category === "scholarship" && n.authors.length > 0 && n.year) return true;
  if (
    (n.category === "government_report" || n.category === "knesset_report") &&
    n.institution && n.year
  ) return true;
  return false;
}

function harden(raw: RawNomination, idx: number): NominatedSource | { drop: string } {
  const label = String(raw.label_he ?? "").trim();
  if (!label) return { drop: "empty_label" };
  const confidence = typeof raw.confidence === "number"
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0;
  if (confidence < NOMINATION_LIMITS.MIN_CONFIDENCE) return { drop: "low_confidence" };
  const category = ([
    "statute",
    "regulation",
    "judgment",
    "government_report",
    "knesset_report",
    "regulator_guidance",
    "bill",
    "scholarship",
    "other",
  ].includes(String(raw.category)) ? raw.category : "other") as NominationCategory;

  const stripped: string[] = [];
  const strong = confidence >= NOMINATION_LIMITS.IDENTIFIER_CONFIDENCE;

  let docket = raw.docket ? String(raw.docket).trim() : null;
  if (docket && !strong) {
    docket = null;
    stripped.push("docket");
  }
  let authors = Array.isArray(raw.authors) ? raw.authors.map(String).filter(Boolean) : [];
  let journal = raw.journal_or_publisher ? String(raw.journal_or_publisher).trim() : null;
  let year = typeof raw.year === "number" && raw.year > 1900 && raw.year < 2100
    ? Math.floor(raw.year)
    : null;
  if (category === "scholarship" && !strong) {
    if (authors.length) stripped.push("authors");
    if (journal) stripped.push("journal_or_publisher");
    if (year) stripped.push("year");
    authors = [];
    journal = null;
    year = null;
  }

  return {
    nomination_id: `N${idx + 1}`,
    category,
    label_he: label,
    docket,
    statute_title: raw.statute_title ? String(raw.statute_title).trim() : null,
    statute_section: raw.statute_section ? String(raw.statute_section).trim() : null,
    authors,
    journal_or_publisher: journal,
    institution: raw.institution ? String(raw.institution).trim() : null,
    year,
    topic_query: raw.topic_query ? String(raw.topic_query).trim() : null,
    role_in_answer: raw.role_in_answer ? String(raw.role_in_answer).trim() : null,
    confidence,
    // Forced regardless of model output — a nomination is never evidence.
    must_verify: true,
    nominated_by: SOURCE_NOMINATION_VERSION,
    stripped_fields: stripped,
  };
}

/** Per-category caps (§6 of the design). */
function applyCategoryCaps(
  list: NominatedSource[],
): { kept: NominatedSource[]; dropped: Array<{ label: string; reason: string }> } {
  const kept: NominatedSource[] = [];
  const dropped: Array<{ label: string; reason: string }> = [];
  let judgments = 0;
  let statutes = 0;
  let secondary = 0;
  for (const n of [...list].sort((a, b) => b.confidence - a.confidence)) {
    if (kept.length >= NOMINATION_LIMITS.MAX_CANDIDATES) {
      dropped.push({ label: n.label_he, reason: "total_cap" });
      continue;
    }
    if (n.category === "judgment") {
      if (judgments >= NOMINATION_LIMITS.MAX_JUDGMENTS) {
        dropped.push({ label: n.label_he, reason: "judgment_cap" });
        continue;
      }
      judgments++;
    } else if (n.category === "statute" || n.category === "regulation" || n.category === "bill") {
      if (statutes >= NOMINATION_LIMITS.MAX_STATUTES) {
        dropped.push({ label: n.label_he, reason: "statute_cap" });
        continue;
      }
      statutes++;
    } else {
      if (secondary >= NOMINATION_LIMITS.MAX_SECONDARY) {
        dropped.push({ label: n.label_he, reason: "secondary_cap" });
        continue;
      }
      secondary++;
    }
    kept.push(n);
  }
  return { kept, dropped };
}

function buildQueries(kept: NominatedSource[], claimId: string): Query[] {
  const queries: Query[] = [];
  for (const n of kept) {
    if (queries.length >= NOMINATION_LIMITS.MAX_QUERIES) break;
    const parts = [
      n.label_he,
      n.docket ?? "",
      n.statute_title && n.statute_section ? `${n.statute_title} סעיף ${n.statute_section}` : "",
      n.institution ?? "",
      n.topic_query ?? "",
    ].filter(Boolean);
    const query_he = parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 220);
    if (query_he.length < 6) continue;
    queries.push({
      claim_id: claimId,
      role: roleForCategory(n.category),
      query_he,
      targets: ["local_db", "perplexity"],
      expected_source_type: expectedTypeForCategory(n.category),
      reason: `${SOURCE_NOMINATION_VERSION}:${n.nomination_id}`,
      metadata: {
        source_nomination: true,
        nomination_id: n.nomination_id,
        nominated_by: SOURCE_NOMINATION_VERSION,
        nomination_category: n.category,
        nomination_confidence: n.confidence,
        role_in_answer: n.role_in_answer,
        must_verify: true,
      },
    } as unknown as Query);
  }
  return queries;
}

export interface SourceNominationInput {
  question: string;
  analyzer: AnalyzerOutput;
  mode: string | null;
  /** Router-scoped: 0 disables the stage. */
  max_candidates?: number;
  /** Deterministic branches that must not be perturbed. */
  skip?: boolean;
  skip_reason?: string;
}

export async function runSourceNomination(
  input: SourceNominationInput,
): Promise<SourceNominationResult> {
  const t0 = Date.now();
  if (input.skip) return emptyResult(input.skip_reason ?? "skipped_by_caller");
  if (input.mode && SKIP_MODES.has(input.mode)) return emptyResult(`mode:${input.mode}`);
  if ((input.max_candidates ?? NOMINATION_LIMITS.MAX_CANDIDATES) <= 0) {
    return emptyResult("router_cap_zero");
  }

  const claims = (input.analyzer.claims ?? []).map((c) => `- ${c.claim_id}: ${c.text_he}`).join("\n");
  const user = [
    `שאלה: ${input.question}`,
    input.analyzer.legal_area ? `תחום משפטי: ${input.analyzer.legal_area}` : "",
    claims ? `טענות:\n${claims}` : "",
    input.mode ? `סוג שאלה: ${input.mode}` : "",
  ].filter(Boolean).join("\n\n");

  const stage_runs: StageRun[] = [];
  const call = async (model: string, effort: "low" | "medium", tokens: number) => {
    const tA = Date.now();
    const r = await callOpenAIJsonTool<{ nominations?: RawNomination[] }>({
      model,
      system: SYSTEM_PROMPT,
      user,
      tool: {
        name: "emit_source_nominations",
        description: "רשימת מקורות משפטיים מועמדים לאימות",
        parameters: TOOL_PARAMETERS as unknown as Record<string, unknown>,
      },
      reasoningEffort: effort,
      maxCompletionTokens: tokens,
    });
    stage_runs.push({
      stage: `source_nomination.${model}.${effort}`,
      ms: Date.now() - tA,
      ok: !!r.data,
    } as StageRun);
    return r;
  };

  type Attempt = Awaited<ReturnType<typeof call>>;
  /** Parse + harden + cap one attempt. */
  const digest = (res: Attempt) => {
    const list = Array.isArray(res.data?.nominations) ? res.data!.nominations! : [];
    const dropped: Array<{ label: string; reason: string }> = [];
    const hardened: NominatedSource[] = [];
    list.slice(0, 8).forEach((raw, i) => {
      const out = harden(raw, i);
      if ("drop" in out) {
        dropped.push({ label: String(raw.label_he ?? "?"), reason: out.drop });
        return;
      }
      hardened.push(out);
    });
    const capped = applyCategoryCaps(hardened);
    const kept = capped.kept.slice(0, input.max_candidates ?? NOMINATION_LIMITS.MAX_CANDIDATES);
    dropped.push(...capped.dropped);
    return {
      res,
      raw_count: list.length,
      hardened_count: hardened.length,
      kept,
      dropped,
      /** Structural failure: nothing parseable came back at all. */
      structural_failure: !res.data,
    };
  };

  const complexMode = input.mode === "case_law_synthesis" ||
    input.mode === "doctrine_explanation" || input.mode === "legal_memo";

  // ── Attempt 1: mini, low reasoning effort, realistic budget ──────────────
  let attempt = digest(
    await call(MODEL_MINI, "low", NOMINATION_LIMITS.MAX_COMPLETION_TOKENS),
  );
  let model_final = MODEL_MINI;
  let escalated = false;
  let escalation_reason: string | null = null;
  let mini_retry_used = false;
  let fallback_to_mini_used = false;
  const mini_before = attempt.raw_count;
  const mini_after_first = attempt.kept.length;

  // ── Attempt 2 (cheap): one bounded mini repair retry, only on a structural
  //    failure. Never a 30s escalation for a parse/budget hiccup.
  if (attempt.structural_failure) {
    mini_retry_used = true;
    const retry = digest(
      await call(MODEL_MINI, "medium", NOMINATION_LIMITS.RETRY_COMPLETION_TOKENS),
    );
    if (!retry.structural_failure) attempt = retry;
    else attempt = retry.kept.length ? retry : attempt;
  }

  // ── Attempt 3 (expensive): escalate ONLY when mini produced nothing usable.
  const miniFallback = attempt.kept.length > 0 ? attempt : null;
  if (!miniFallback) {
    escalation_reason = attempt.structural_failure
      ? "mini_structural_failure"
      : complexMode
      ? "mini_zero_usable_candidates_complex_mode"
      : "mini_zero_usable_candidates";
    escalated = true;
    const full = digest(
      await call(MODEL_FULL, "low", NOMINATION_LIMITS.ESCALATION_COMPLETION_TOKENS),
    );
    if (full.kept.length > 0 || !full.structural_failure) {
      attempt = full;
      model_final = MODEL_FULL;
    } else {
      model_final = MODEL_FULL;
    }
  }
  if (escalated && attempt.kept.length === 0 && miniFallback) {
    attempt = miniFallback;
    fallback_to_mini_used = true;
  }

  const kept = attempt.kept;
  const dropped = attempt.dropped;
  const claimId = input.analyzer.claims?.[0]?.claim_id ?? "C1";
  const queries = buildQueries(kept, claimId);

  const category_mix: Record<string, number> = {};
  for (const n of kept) category_mix[n.category] = (category_mix[n.category] ?? 0) + 1;

  // A parse / tool-call failure is NOT a valid "no nominations" result.
  const parse_error = attempt.res.parse_error ?? null;
  const stage_failed = kept.length === 0 && (attempt.structural_failure || !!parse_error);

  return {
    version: SOURCE_NOMINATION_VERSION,
    enabled: true,
    skip_reason: stage_failed
      ? "nomination_parse_failure"
      : kept.length === 0
      ? "valid_no_nominations"
      : null,
    stage_failed,
    model_initial: MODEL_MINI,
    model_final,
    escalated,
    escalation_reason,
    mini_retry_used,
    fallback_to_mini_used,
    mini_candidates_count_before_hardening: mini_before,
    mini_candidates_count_after_hardening: mini_after_first,
    finish_reason: attempt.res.finish_reason ?? null,
    reasoning_tokens: attempt.res.reasoning_tokens ?? null,
    parse_error,
    http_status: attempt.res.http_status ?? null,
    candidates: kept,
    dropped,
    queries,
    category_mix,
    identifier_bearing_count: kept.filter(isIdentifierBearing).length,
    stage_runs,
    ms: Date.now() - t0,
  };
}
