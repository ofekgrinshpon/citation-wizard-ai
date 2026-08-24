// source_nomination_v2 — "what sources would a competent Israeli legal
// researcher expect to obtain for this question?"
//
// v2 splits nomination into two first-class buckets:
//
//   1. actionable_sources        — concrete targets discovery/cache can pursue
//                                  (docket, official statute title, named
//                                  report, high-confidence bibliography, or a
//                                  strong case name without a docket);
//   2. exploratory_topic_searches — broad topic searches for scholarship,
//                                  books, Knesset/MMM and institutional
//                                  reports. Never sent to official discovery
//                                  or to the verified-source cache; they run
//                                  through ordinary local/web retrieval.
//
// Exploratory searches are NOT a fallback. A doctrinal run keeps at least one;
// an academic/policy run keeps several. Over-correcting toward identifiers
// only would lose the literature the model cannot name in advance.
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

export const SOURCE_NOMINATION_VERSION = "source_nomination_v2";

export const NOMINATION_LIMITS = {
  MAX_CANDIDATES: 5,
  MAX_QUERIES: 5,
  MAX_JUDGMENTS: 2,
  MAX_STATUTES: 2,
  MAX_SECONDARY: 2,
  MAX_EXPLORATORY: 3,
  /** Query-bucket reservations inside MAX_QUERIES. */
  RESERVED_ACTIONABLE_QUERIES: 2,
  RESERVED_EXPLORATORY_QUERIES: 2,
  /** Budget must cover reasoning tokens AND the tool call. At 1500 the gpt-5
   *  family burned the whole budget on reasoning and returned finish_reason
   *  "length" with no tool call — that was the nomination outage. */
  MAX_COMPLETION_TOKENS: 6000,
  RETRY_COMPLETION_TOKENS: 8000,
  ESCALATION_COMPLETION_TOKENS: 10000,
  /** A docket / bibliographic detail below this confidence is stripped. */
  IDENTIFIER_CONFIDENCE: 0.8,
  /** Nominations below this relevance are dropped entirely. */
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

export type NominationActionability =
  | "known_identifier"
  | "known_name_no_docket"
  | "topic_only";

export type NominationBucket = "actionable" | "exploratory";

export interface NominatedSource {
  nomination_id: string;
  bucket: NominationBucket;
  actionability: NominationActionability;
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
  relevance_confidence: number;
  identifier_confidence: number;
  /** Legacy alias of relevance_confidence (kept for downstream telemetry). */
  confidence: number;
  must_verify: true;
  nominated_by: string;
  /** Deterministic post-parse hardening record. */
  stripped_fields: string[];
  demoted: boolean;
  demoted_reason: string | null;
}

export interface SourceNominationResult {
  version: string;
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
  /** Actionable + exploratory, in that order (legacy consumers read this). */
  candidates: NominatedSource[];
  actionable: NominatedSource[];
  exploratory: NominatedSource[];
  dropped: Array<{ label: string; reason: string }>;
  queries: Query[];
  category_mix: Record<string, number>;
  actionability_mix: Record<NominationActionability, number>;
  identifier_confidence_histogram: Record<string, number>;
  identifier_bearing_count: number;
  known_name_no_docket_count: number;
  topic_only_count: number;
  actionable_count: number;
  exploratory_count: number;
  stripped_identifiers: Array<{ nomination_id: string; label: string; fields: string[] }>;
  demoted_identifiers: Array<{ nomination_id: string; label: string; reason: string }>;
  queries_by_bucket: Record<NominationBucket, number>;
  stage_runs: StageRun[];
  ms: number;
}

/** Modes that must stay byte-identical / deterministic — never nominate. */
const SKIP_MODES = new Set(["canonical_quote"]);

const CATEGORY_ENUM = [
  "statute",
  "regulation",
  "judgment",
  "government_report",
  "knesset_report",
  "regulator_guidance",
  "bill",
  "scholarship",
  "other",
] as const;

const TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["actionable_sources", "exploratory_topic_searches"],
  properties: {
    actionable_sources: {
      type: "array",
      description:
        "עד 5 מקורות קונקרטיים שניתן לרדוף אחריהם ישירות: פסק דין עם מספר הליך או עם שם פרשה מוכר, חוק בשמו הרשמי (וסעיף אם רלוונטי), דוח ממ\"מ/מבקר המדינה בשם ידוע, או מאמר/ספר כאשר הכותרת, המחבר והשנה ידועים בביטחון גבוה.",
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
          "identifier_query",
          "role_in_answer",
          "relevance_confidence",
          "identifier_confidence",
          "actionability",
        ],
        properties: {
          category: { type: "string", enum: CATEGORY_ENUM as unknown as string[] },
          label_he: { type: "string" },
          docket: { type: ["string", "null"] },
          statute_title: { type: ["string", "null"] },
          statute_section: { type: ["string", "null"] },
          authors: { type: "array", items: { type: "string" } },
          journal_or_publisher: { type: ["string", "null"] },
          institution: { type: ["string", "null"] },
          year: { type: ["integer", "null"] },
          identifier_query: {
            type: ["string", "null"],
            description: "שאילתה קצרה וממוקדת לזיהוי המקור, ללא תיאורים כלליים.",
          },
          role_in_answer: { type: ["string", "null"] },
          relevance_confidence: { type: "number" },
          identifier_confidence: { type: "number" },
          actionability: {
            type: "string",
            enum: ["known_identifier", "known_name_no_docket"],
          },
        },
      },
    },
    exploratory_topic_searches: {
      type: "array",
      description:
        "עד 4 חיפושי נושא רחבים לספרות אקדמית, ספרים, דוחות ממ\"מ/מוסדיים/ממשלתיים וניירות מדיניות — כאשר אינך יודע כותרת או שנה מדויקת. אלה תוצרים מלאי ערך, לא פתרון מחדל.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic_query", "focus", "role_in_answer", "relevance_confidence"],
        properties: {
          topic_query: { type: "string" },
          focus: {
            type: "string",
            enum: [
              "scholarship",
              "book",
              "knesset_report",
              "government_report",
              "institutional_report",
              "policy_paper",
              "comparative",
              "other",
            ],
          },
          role_in_answer: { type: ["string", "null"] },
          relevance_confidence: { type: "number" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT =
  `אתה חוקר משפטי ישראלי בכיר. בהינתן שאלה משפטית וניתוח טענות, בנה אסטרטגיית איתור מקורות בשני ערוצים.

ערוץ 1 — actionable_sources (מקורות קונקרטיים שאפשר לרדוף אחריהם ישירות):
- פסק דין עם מספר הליך מדויק, למשל: ע"א 6821/93 בנק המזרחי; בג"ץ 1715/97 לשכת מנהלי ההשקעות; בג"ץ 1000/92 בבלי; בג"ץ 8497/00 סימה אמיר; בג"ץ 5555/18 חסון נ' כנסת ישראל.
- פסק דין שאתה מזהה בשמו/בשמות הצדדים אך אינך בטוח במספר ההליך: השאר docket ריק (null), ציין את השם ב-label_he וסמן actionability = known_name_no_docket.
- חוק בשמו הרשמי, למשל: חוק יחסי ממון בין בני זוג; חוק שיפוט בתי דין רבניים (נישואין וגירושין); חוק-יסוד: כבוד האדם וחירותו, סעיף 8; חוק-יסוד: ישראל — מדינת הלאום של העם היהודי. הוסף סעיף כאשר הוא רלוונטי.
- דוח ממ"מ / מבקר המדינה / דוח ממשלתי כאשר הכותרת והמוסד ידועים.
- מאמר או ספר רק כאשר הכותרת, המחבר והשנה ידועים בביטחון גבוה.

ערוץ 2 — exploratory_topic_searches (חיפושי נושא רחבים):
- ספרות אקדמית, ספרים ופרקים, דוחות ממ"מ ומוסדיים שאינך יודע את כותרתם, דוחות ממשלתיים, ניירות מדיניות, ספרות השוואתית ותיאורטית.
- דוגמאות טובות: "מידתיות במשפט החוקתי הישראלי מאמר"; "פסקת ההגבלה מבחני המידתיות ספר"; "בית דין רבני דין אזרחי חלוקת רכוש מאמר"; "מרכז המחקר והמידע של הכנסת בתי דין רבניים רכוש גירושין"; "חוק הלאום זהות לאומית משפט ישראלי מאמר".
- אלה תוצר מלא וחשוב, לא כישלון ולא פתרון מחדל.

כמה מכל ערוץ:
- לשאלות דוקטרינריות / שאלות "מה הדין": 1–2 מקורות קונקרטיים אם הם באמת מוכרים לך, וגם 1–2 חיפושי נושא לספרות/דוחות.
- לשאלות אקדמיות, עיוניות או מדיניות: חיפושי הנושא הם התוצר המרכזי; הוסף מקורות קונקרטיים רק כשהם ברורים.

איסורים:
- אל תמציא מספר הליך, כותרת מאמר, שם מחבר, כתב עת, כותרת דוח או שנה. אם אינך בטוח — הוצא חיפוש נושא בלבד.
- אל תכתוב תיאור מעורפל בערוץ 1. רע: "פסקי דין מנחים של הנשיא ברק על מבחן המידתיות", "פסיקה בנושא דין אזרחי בבית הדין הרבני". טוב: "בג"ץ 1715/97 לשכת מנהלי ההשקעות".
- כאשר רשות מוכרת ברורה מתבקשת — נקוב בה, אל תסתפק בתיאור.

ציונים:
- relevance_confidence: כמה המקור רלוונטי לשאלה (0–1).
- identifier_confidence: כמה אתה בטוח במזהה עצמו — מספר ההליך, השם הרשמי של החוק או הפרטים הביבליוגרפיים (0–1). אם מתחת ל-0.8 המערכת תסיר את המזהה.

החזר את התוצאה רק דרך הקריאה לכלי emit_source_nominations.`;

interface RawActionable {
  category?: string;
  label_he?: string;
  docket?: string | null;
  statute_title?: string | null;
  statute_section?: string | null;
  authors?: string[] | null;
  journal_or_publisher?: string | null;
  institution?: string | null;
  year?: number | null;
  identifier_query?: string | null;
  topic_query?: string | null;
  role_in_answer?: string | null;
  relevance_confidence?: number;
  identifier_confidence?: number;
  confidence?: number;
  actionability?: string;
}

interface RawExploratory {
  topic_query?: string;
  focus?: string;
  role_in_answer?: string | null;
  relevance_confidence?: number;
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
    actionable: [],
    exploratory: [],
    dropped: [],
    queries: [],
    category_mix: {},
    actionability_mix: { known_identifier: 0, known_name_no_docket: 0, topic_only: 0 },
    identifier_confidence_histogram: {},
    identifier_bearing_count: 0,
    known_name_no_docket_count: 0,
    topic_only_count: 0,
    actionable_count: 0,
    exploratory_count: 0,
    stripped_identifiers: [],
    demoted_identifiers: [],
    queries_by_bucket: { actionable: 0, exploratory: 0 },
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
  if (n.actionability !== "known_identifier") return false;
  if (n.docket) return true;
  if (n.statute_title) return true;
  if (n.category === "scholarship" && n.authors.length > 0 && n.year) return true;
  if (
    (n.category === "government_report" || n.category === "knesset_report") &&
    n.institution && (n.year || n.label_he)
  ) return true;
  return false;
}

/** Actionable and pursuable by discovery — identifier OR strong case name. */
export function isDiscoveryEligible(n: NominatedSource): boolean {
  if (n.bucket !== "actionable") return false;
  return n.actionability === "known_identifier" ||
    n.actionability === "known_name_no_docket";
}

const FOCUS_CATEGORY: Record<string, NominationCategory> = {
  scholarship: "scholarship",
  book: "scholarship",
  comparative: "scholarship",
  knesset_report: "knesset_report",
  government_report: "government_report",
  institutional_report: "government_report",
  policy_paper: "government_report",
  other: "other",
};

/** Vague actionable labels that carry no pursuable identity. */
const VAGUE_LABEL_RE =
  /^(?:פסקי[\s-]*דין|פסיקה|הלכות|פסקי דין מנחים|ספרות|מאמרים|דוחות|חקיקה)\b/;

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.min(1, v))
    : fallback;
}

function hardenActionable(
  raw: RawActionable,
  idx: number,
): NominatedSource | { drop: string } {
  const label = String(raw.label_he ?? "").trim();
  if (!label) return { drop: "empty_label" };
  const relevance = num(raw.relevance_confidence ?? raw.confidence, 0);
  if (relevance < NOMINATION_LIMITS.MIN_CONFIDENCE) return { drop: "low_relevance_confidence" };

  const category = (CATEGORY_ENUM as readonly string[]).includes(String(raw.category))
    ? (raw.category as NominationCategory)
    : "other";

  const stripped: string[] = [];
  const identifierConfidence = num(raw.identifier_confidence, relevance);
  const strongIdentifier = identifierConfidence >= NOMINATION_LIMITS.IDENTIFIER_CONFIDENCE;

  // ── Hardening: strip weak identifiers, DEMOTE — never delete the nomination
  //    when the name itself is still useful.
  let docket = raw.docket ? String(raw.docket).trim() : null;
  if (docket && !strongIdentifier) {
    docket = null;
    stripped.push("docket");
  }
  let authors = Array.isArray(raw.authors) ? raw.authors.map(String).filter(Boolean) : [];
  let journal = raw.journal_or_publisher ? String(raw.journal_or_publisher).trim() : null;
  let year = typeof raw.year === "number" && raw.year > 1900 && raw.year < 2100
    ? Math.floor(raw.year)
    : null;
  if (category === "scholarship" && !strongIdentifier) {
    if (authors.length) stripped.push("authors");
    if (journal) stripped.push("journal_or_publisher");
    if (year) stripped.push("year");
    authors = [];
    journal = null;
    year = null;
  }
  const statute_title = raw.statute_title ? String(raw.statute_title).trim() : null;
  const statute_section = raw.statute_section ? String(raw.statute_section).trim() : null;

  let actionability: NominationActionability =
    raw.actionability === "known_name_no_docket" ? "known_name_no_docket" : "known_identifier";
  let demoted = false;
  let demoted_reason: string | null = null;

  const hasIdentifier = !!docket || !!statute_title ||
    (category === "scholarship" && authors.length > 0 && !!year) ||
    ((category === "government_report" || category === "knesset_report") && !!raw.institution);

  if (actionability === "known_identifier" && !hasIdentifier) {
    actionability = "known_name_no_docket";
    demoted = true;
    demoted_reason = stripped.length ? `identifier_stripped:${stripped.join("+")}` : "no_stable_identifier";
  }

  // A vague description with no identifier is not actionable at all — it
  // becomes an exploratory topic search instead of being deleted.
  if (actionability === "known_name_no_docket" && VAGUE_LABEL_RE.test(label)) {
    actionability = "topic_only";
    demoted = true;
    demoted_reason = "vague_label_no_identity";
  }

  const bucket: NominationBucket = actionability === "topic_only" ? "exploratory" : "actionable";
  const topic_query = (raw.identifier_query ?? raw.topic_query ?? null)
    ? String(raw.identifier_query ?? raw.topic_query).trim()
    : null;

  return {
    nomination_id: `N${idx + 1}`,
    bucket,
    actionability,
    category,
    label_he: label,
    docket,
    statute_title,
    statute_section,
    authors,
    journal_or_publisher: journal,
    institution: raw.institution ? String(raw.institution).trim() : null,
    year,
    topic_query,
    role_in_answer: raw.role_in_answer ? String(raw.role_in_answer).trim() : null,
    relevance_confidence: relevance,
    identifier_confidence: docket || statute_title ? identifierConfidence : 0,
    confidence: relevance,
    must_verify: true,
    nominated_by: SOURCE_NOMINATION_VERSION,
    stripped_fields: stripped,
    demoted,
    demoted_reason,
  };
}

function hardenExploratory(
  raw: RawExploratory,
  idx: number,
): NominatedSource | { drop: string } {
  const q = String(raw.topic_query ?? "").trim();
  if (q.length < 6) return { drop: "empty_topic_query" };
  const relevance = num(raw.relevance_confidence, 0.6);
  if (relevance < NOMINATION_LIMITS.MIN_CONFIDENCE) return { drop: "low_relevance_confidence" };
  const category = FOCUS_CATEGORY[String(raw.focus ?? "other")] ?? "other";
  return {
    nomination_id: `E${idx + 1}`,
    bucket: "exploratory",
    actionability: "topic_only",
    category,
    label_he: q,
    docket: null,
    statute_title: null,
    statute_section: null,
    authors: [],
    journal_or_publisher: null,
    institution: null,
    year: null,
    topic_query: q,
    role_in_answer: raw.role_in_answer ? String(raw.role_in_answer).trim() : null,
    relevance_confidence: relevance,
    identifier_confidence: 0,
    confidence: relevance,
    must_verify: true,
    nominated_by: SOURCE_NOMINATION_VERSION,
    stripped_fields: [],
    demoted: false,
    demoted_reason: null,
  };
}

/** Primary law first inside the actionable bucket. */
function primaryLawRank(n: NominatedSource): number {
  if (n.category === "judgment") return n.docket ? 0 : 1;
  if (n.category === "statute" || n.category === "bill") return 0;
  if (n.category === "regulation" || n.category === "regulator_guidance") return 2;
  return 3;
}

function applyCategoryCaps(
  list: NominatedSource[],
  maxCandidates: number,
): { kept: NominatedSource[]; dropped: Array<{ label: string; reason: string }> } {
  const kept: NominatedSource[] = [];
  const dropped: Array<{ label: string; reason: string }> = [];
  let judgments = 0;
  let statutes = 0;
  let secondary = 0;
  const sorted = [...list].sort((a, b) =>
    primaryLawRank(a) - primaryLawRank(b) ||
    b.relevance_confidence - a.relevance_confidence
  );
  for (const n of sorted) {
    if (kept.length >= maxCandidates) {
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

/** Clean identifier query — never a long concatenated hybrid. */
function actionableQueryText(n: NominatedSource): string {
  if (n.category === "judgment") {
    const name = n.label_he.replace(/\s+/g, " ").trim();
    return (n.docket && !name.includes(n.docket) ? `${n.docket} ${name}` : name).slice(0, 120);
  }
  if (n.statute_title) {
    return (n.statute_section ? `${n.statute_title} סעיף ${n.statute_section}` : n.statute_title)
      .slice(0, 120);
  }
  if (n.category === "government_report" || n.category === "knesset_report") {
    return [n.institution, n.label_he].filter(Boolean).join(" ").slice(0, 140);
  }
  if (n.category === "scholarship" && n.authors.length && n.year) {
    return `${n.authors[0]} ${n.label_he} ${n.year}`.slice(0, 140);
  }
  return (n.topic_query ?? n.label_he).slice(0, 140);
}

function toQuery(n: NominatedSource, claimId: string, query_he: string): Query {
  return {
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
      nomination_bucket: n.bucket,
      nomination_actionability: n.actionability,
      nomination_category: n.category,
      nomination_confidence: n.relevance_confidence,
      relevance_confidence: n.relevance_confidence,
      identifier_confidence: n.identifier_confidence,
      role_in_answer: n.role_in_answer,
      must_verify: true,
      /** Exploratory queries never reach official discovery or the cache. */
      discovery_eligible: isDiscoveryEligible(n),
    },
  } as unknown as Query;
}

/**
 * Interleave the buckets so neither can starve the other: the reserved
 * actionable lanes first, then the reserved exploratory lanes, then whatever
 * budget remains, best-first.
 */
function buildQueries(
  actionable: NominatedSource[],
  exploratory: NominatedSource[],
  claimId: string,
): Query[] {
  const seen = new Set<string>();
  const out: Query[] = [];
  const push = (n: NominatedSource) => {
    if (out.length >= NOMINATION_LIMITS.MAX_QUERIES) return;
    const text = (n.bucket === "actionable" ? actionableQueryText(n) : (n.topic_query ?? n.label_he))
      .replace(/\s+/g, " ").trim();
    if (text.length < 6) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(toQuery(n, claimId, text));
  };

  const a = [...actionable];
  const e = [...exploratory];
  a.slice(0, NOMINATION_LIMITS.RESERVED_ACTIONABLE_QUERIES).forEach(push);
  e.slice(0, NOMINATION_LIMITS.RESERVED_EXPLORATORY_QUERIES).forEach(push);
  a.slice(NOMINATION_LIMITS.RESERVED_ACTIONABLE_QUERIES).forEach(push);
  e.slice(NOMINATION_LIMITS.RESERVED_EXPLORATORY_QUERIES).forEach(push);
  return out;
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
  const maxCandidates = input.max_candidates ?? NOMINATION_LIMITS.MAX_CANDIDATES;
  if (maxCandidates <= 0) return emptyResult("router_cap_zero");

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
    const r = await callOpenAIJsonTool<
      { actionable_sources?: RawActionable[]; exploratory_topic_searches?: RawExploratory[] }
    >({
      model,
      system: SYSTEM_PROMPT,
      user,
      tool: {
        name: "emit_source_nominations",
        description: "אסטרטגיית מקורות בשני ערוצים: מקורות קונקרטיים וחיפושי נושא",
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
  const digest = (res: Attempt) => {
    const rawActionable = Array.isArray(res.data?.actionable_sources)
      ? res.data!.actionable_sources!
      : [];
    const rawExploratory = Array.isArray(res.data?.exploratory_topic_searches)
      ? res.data!.exploratory_topic_searches!
      : [];
    const dropped: Array<{ label: string; reason: string }> = [];
    const hardened: NominatedSource[] = [];
    rawActionable.slice(0, 6).forEach((raw, i) => {
      const out = hardenActionable(raw, i);
      if ("drop" in out) {
        dropped.push({ label: String(raw.label_he ?? "?"), reason: out.drop });
        return;
      }
      hardened.push(out);
    });
    const exploratory: NominatedSource[] = [];
    rawExploratory.slice(0, 4).forEach((raw, i) => {
      const out = hardenExploratory(raw, i);
      if ("drop" in out) {
        dropped.push({ label: String(raw.topic_query ?? "?"), reason: out.drop });
        return;
      }
      exploratory.push(out);
    });
    // Demoted actionable nominations become exploratory searches.
    const demotedToExploratory = hardened.filter((n) => n.bucket === "exploratory");
    const actionableOnly = hardened.filter((n) => n.bucket === "actionable");

    const capped = applyCategoryCaps(actionableOnly, maxCandidates);
    dropped.push(...capped.dropped);
    const keptExploratory = [...exploratory, ...demotedToExploratory]
      .sort((a, b) => b.relevance_confidence - a.relevance_confidence)
      .slice(0, NOMINATION_LIMITS.MAX_EXPLORATORY);

    return {
      res,
      raw_count: rawActionable.length + rawExploratory.length,
      hardened_count: hardened.length + exploratory.length,
      kept: capped.kept,
      keptExploratory,
      dropped,
      /** Structural failure: nothing parseable came back at all. */
      structural_failure: !res.data,
      usable: capped.kept.length + keptExploratory.length,
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
  const mini_after_first = attempt.usable;

  // ── Attempt 2 (cheap): one bounded mini repair retry, only on a structural
  //    failure. Never a 30s escalation for a parse/budget hiccup.
  if (attempt.structural_failure) {
    mini_retry_used = true;
    const retry = digest(
      await call(MODEL_MINI, "medium", NOMINATION_LIMITS.RETRY_COMPLETION_TOKENS),
    );
    if (!retry.structural_failure) attempt = retry;
    else attempt = retry.usable ? retry : attempt;
  }

  // ── Attempt 3 (expensive): escalate ONLY when mini produced nothing usable.
  const miniFallback = attempt.usable > 0 ? attempt : null;
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
    model_final = MODEL_FULL;
    if (full.usable > 0 || !full.structural_failure) attempt = full;
  }
  if (escalated && attempt.usable === 0 && miniFallback) {
    attempt = miniFallback;
    fallback_to_mini_used = true;
  }

  const actionable = attempt.kept;
  const exploratory = attempt.keptExploratory;
  const all = [...actionable, ...exploratory];
  const dropped = attempt.dropped;
  const claimId = input.analyzer.claims?.[0]?.claim_id ?? "C1";
  const queries = buildQueries(actionable, exploratory, claimId);

  const category_mix: Record<string, number> = {};
  for (const n of all) category_mix[n.category] = (category_mix[n.category] ?? 0) + 1;
  const actionability_mix: Record<NominationActionability, number> = {
    known_identifier: 0,
    known_name_no_docket: 0,
    topic_only: 0,
  };
  for (const n of all) actionability_mix[n.actionability]++;
  const identifier_confidence_histogram: Record<string, number> = {};
  for (const n of all) {
    const bucket = n.identifier_confidence >= 0.8
      ? "0.8-1.0"
      : n.identifier_confidence >= 0.6
      ? "0.6-0.8"
      : n.identifier_confidence >= 0.4
      ? "0.4-0.6"
      : "0.0-0.4";
    identifier_confidence_histogram[bucket] = (identifier_confidence_histogram[bucket] ?? 0) + 1;
  }

  const queries_by_bucket: Record<NominationBucket, number> = { actionable: 0, exploratory: 0 };
  for (const q of queries) {
    const b = ((q.metadata ?? {}) as Record<string, unknown>).nomination_bucket as NominationBucket;
    if (b) queries_by_bucket[b]++;
  }

  // A parse / tool-call failure is NOT a valid "no nominations" result.
  const parse_error = attempt.res.parse_error ?? null;
  const stage_failed = all.length === 0 && (attempt.structural_failure || !!parse_error);

  return {
    version: SOURCE_NOMINATION_VERSION,
    enabled: true,
    skip_reason: stage_failed
      ? "nomination_parse_failure"
      : all.length === 0
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
    candidates: all,
    actionable,
    exploratory,
    dropped,
    queries,
    category_mix,
    actionability_mix,
    identifier_confidence_histogram,
    identifier_bearing_count: all.filter(isIdentifierBearing).length,
    known_name_no_docket_count: actionability_mix.known_name_no_docket,
    topic_only_count: actionability_mix.topic_only,
    actionable_count: actionable.length,
    exploratory_count: exploratory.length,
    stripped_identifiers: all
      .filter((n) => n.stripped_fields.length > 0)
      .map((n) => ({ nomination_id: n.nomination_id, label: n.label_he, fields: n.stripped_fields })),
    demoted_identifiers: all
      .filter((n) => n.demoted)
      .map((n) => ({
        nomination_id: n.nomination_id,
        label: n.label_he,
        reason: n.demoted_reason ?? "demoted",
      })),
    queries_by_bucket,
    stage_runs,
    ms: Date.now() - t0,
  };
}
