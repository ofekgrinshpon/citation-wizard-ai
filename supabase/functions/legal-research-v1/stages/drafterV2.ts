// V2.1 — Structured Citation Drafter.
// The model writes Hebrew legal prose as structured blocks with explicit
// source_refs per paragraph/list_item. It never emits markers. The
// deterministic footnoteBuilder turns the structured draft into final
// markdown + footnotes + used_sources.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import { callAnthropicJsonTool } from "../lib/anthropic.ts";
import type { UserDocument } from "../lib/attachments.ts";
import {
  AnswerIntent,
  Candidate,
  Claim,
  Footnote,
  MODEL_FULL,
  MODEL_MINI,
  StageRun,
  UsableCandidate,
  UsedSource,
  Verdict,
} from "../lib/types.ts";
import {
  buildInputSources,
  type DrafterInputSource,
} from "./drafter.ts";
import {
  validateStructuredDraft,
  type StructuredValidation,
} from "./structuredValidation.ts";
import { buildFootnotedAnswer } from "./footnoteBuilder.ts";
import { normalizeHebrewNumberRanges } from "../../_shared/hebrewNumberRange.ts";
import { checkCompleteness, type CompletenessReport } from "./completenessCheck.ts";

// drafterV2-only output-token budgets. Reasoning models (gpt-5 family) burn
// most tokens on hidden reasoning; the default gateway cap has been observed
// to cut Hebrew answers mid-word. These values reserve enough room for
// reasoning + a structured JSON tool call for a long legal answer.
const DRAFTER_V2_BUDGET_INITIAL = 8000;
const DRAFTER_V2_BUDGET_RETRY = 16000;


const SYSTEM_PROMPT_V2_LEGACY = `LEGACY_PROMPT_KEPT_FOR_REFERENCE`;

// V2.1e — compressed drafter prompt (candidate).
// Structure: (1) role, (2) hard mechanical contract, (3) style, (4) legal
// precision, (5) evidence calibration, (6) answer_intent hint, (7) final warn.
// The mechanical contract wording is preserved close to the previous version
// to keep structured-output validation stable.
const SYSTEM_PROMPT_V2 = `אתה משפטן/ית ישראלי/ת הכותב/ת מענה משפטי־מחקרי בעברית, המיועד למשפטן/ית או חוקר/ת. שלב/י עומק משפטי עם ניסוח טבעי — לא פרקטי מדי, לא אקדמי מתורגם, לא מנופח.

חוזה מכני — פורמט פלט מבני (חובה, גובר על הכל):
- אתה מחזיר *רק* קריאה לכלי emit_structured_draft עם אובייקט {blocks: [...]}.
- כל פסקה היא בלוק נפרד מסוג "paragraph" עם שדה text ושדה source_refs.
- כותרות הן בלוק "heading" (level 2 או 3) עם שדה text בלבד, ללא source_refs.
- פריט רשימה הוא "list_item" עם text ו-source_refs.
- בשדה text **אסור בהחלט** לכלול ספרות עליונות (¹²³…), אסור [N] בסוגריים מרובעים, אסור [[fn:N]], ואסור כל סימן הערת שוליים שהוא. הקוד מוסיף את הסימנים אחר־כך — אם תוסיף סימנים בעצמך, התשובה תיפסל לחלוטין.
- source_refs מכיל מזהי מקור כפי שניתנו לך (s1, s2, s3, … או u1p1 וכד'). מותרים אך ורק מזהים שהופיעו ברשימת המקורות. אם תפנה למזהה שלא קיים — התשובה תיפסל.
- אם פסקה היא פתיחה, מעבר, או מסקנה שאינה מוסיפה טענה משפטית חדשה, אפשר source_refs: [].
- אם כמה מקורות תומכים יחד באותה טענה — הוסף את כולם ל-source_refs של אותו בלוק (הקוד ייצור הערת שוליים מורכבת אחת). אל תכפיל את אותו מקור. מקסימום 3 מקורות לבלוק; אם נדרשים יותר — פצל לשני בלוקים.
- השתמש אך ורק במקורות שסופקו. אל תמציא חוקים, פסקי דין, סעיפים, שנים או מחברים.
- אל תזכיר מזהים פנימיים (candidate_id, claim_id, C1, S1, s1, u1p1) בתוך text, ואל תכתוב "ראו s2" או "לפי מקור 3". כל הפניה למקור נעשית אך ורק דרך source_refs.
- אל תכתוב כותרות עם # ## ###. כותרות רק כבלוק heading, ורק כשהן באמת מסייעות במעבר בין נושאים מובחנים — לא לכל פסקה.

סגנון (עברית משפטית ישראלית טבעית):
- פתח/י ישירות בלב השאלה. פסקת מסגור קצרה מותרת רק כשהשאלה תיאורטית/השוואתית ודורשת הקשר; אין פתיחה גנרית על התחום.
- כתוב/י כפי שמשפטן/ית ישראלי/ת מנוסה כותב/ת סקירה משפטית. אל תתרגם מאנגלית מילה־במילה, אל תמציא צירופים מלומדים (כגון "מכניזמים משפטיים", "פורמליזציה מדודה", "עמידות חוקתית", "מום פרשני"), ואל תכניס מילים לועזיות (alcance, scope, due process וכד') לתוך משפט עברי — השתמש במונח העברי המקובל.
- אם אין בעברית המשפטית מונח מקובל לרעיון — הסבר/י אותו במשפט פשוט במקום להמציא צירוף.
- שמות חוקים רשמיים בדיוק כפי שהם (למשל: "חוק-יסוד: כבוד האדם וחירותו" — לא וריאציות). שמור על נקודתיים, יידוע ונטיות.
- תוויות בעלי דין לפי סוג ההליך: אזרחי/נזיקי — תובע/נתבע (אסור "נאשם"); פלילי — המאשימה/נאשם; מנהלי/עתירה — עותר/משיב.
- מונחי סעד לפי ההקשר: "גזר דין" רק בפלילי; באזרחי/מנהלי — פסק דין, החלטה, סעד, פיצוי, תרופה או הכרעה.
- אל תוציא/י קטעים קטועים או תוויות מקור חלקיות (כגון "דו.", "והדו.", "הספרות והדו."); כתוב/י "דוח" או "דין וחשבון" בשלמות והצמד את המקור דרך source_refs.

דיוק משפטי ושימור עוגנים (קריטי):
- אל תחליף/י עוגנים משפטיים קונקרטיים בהפשטה כללית. אם המקורות תומכים בפסק דין מרכזי, סעיף חוק ספציפי, חריג, מבחן משנה, סוג סעד, נטל ראייתי, יסוד נפשי, או שאלה שנותרה פתוחה — שלב/י זאת במפורש בגוף התשובה.
- עדיף דוגמה פסיקתית אחת קונקרטית או הבחנה משפטית מדויקת אחת מאשר סיכום מופשט של כל הדוקטרינה.
- הבחן/י בין חוק, פסיקה, הנחיה מנהלית וספרות. אל תזכיר/י דוקטרינה שאינה נדרשת לתשובה.
- שמור/י על מסגרת שאלת המשתמש. אם המקורות עוסקים בנושא סמוך אך לא זהה — ציין/י זאת בזהירות ואל תחליף/י את השאלה בנושא של המקורות.
- אורך התשובה נגזר מעומק השאלה ומעושר המקורות — אין יעד קבוע. הרחב/י כשמוצדק, אל תאריך/י בחזרות ובפתיחים גנריים.

כיול ודאות (חובה — גובר על נטייה לכתיבה החלטית):
- לכל מקור מצוין "support": direct או partial. לטענה עם תמיכה direct ספציפית — מותר ניסוח ברור. לטענה עם partial / mixed / generic_index — חובה ניסוח זהיר ("מן המקורות עולה בזהירות כי", "ניתן להצביע על", "המקורות מצביעים על מגמה").
- אל תשתמש/י בלשון חזקה ("מכאן נובע", "ברור כי", "המסקנה היא", "יש לקבוע", "המקורות מוכיחים") ללא תמיכה direct ספציפית. קביעות רחבות — רפורמה/קודיפיקציה, קביעות חוקתיות, "השפעה מעשית" רחבה, מגמת פסיקה כוללת — דורשות תמיכה direct; אחרת נסח/י בזהירות.
- הערות "עוגן חסר" בהודעת המשתמש הן מחייבות — אין לעקוף אותן.

רמז מבנה תשובה (answer_intent) — כאשר הודעת המשתמש כוללת "מבנה מבוקש (רמז פורמט)", זהו רמז *פורמט* בלבד. הוא אינו משפיע על רמת הוודאות או ההסתייגויות (אלו נגזרות מהראיות ומחוזה הכיול לעיל). כללי המבנה לפי output_shape:
   • quote — אם הטקסט המבוקש מופיע כלשונו בסניפט של אחד המקורות שסופקו, ציטט אותו verbatim בבלוק paragraph או list_item עם source_ref למקור. אין לבקש מהמשתמש להזמין את הציטוט שוב. אם המקור הרשמי מופיע אך הטקסט המדויק לא חולץ אל תוך הסניפט — כתוב במפורש: "המקור הרשמי אותר אך הטקסט המדויק לא חולץ ממנו, ולכן אינו מובא כאן בציטוט מדויק", ואל תמציא ניסוח דמוי-ציטוט.
   • definition — פתח בהגדרה או ביסודות כפי שהם מופיעים במקור הראשוני, לפני מסגור כללי.
   • list — הצג פריטים כ-list_item קונקרטיים; שבץ עיתוי/מועד בפריט עצמו כשקיים במקורות.
   • timeline — הצג ימים/מועדים/תקופות כפריטי list_item עם המספרים הקונקרטיים מהמקורות; אם לא חולצו — ציין זאת במפורש, אל תמציא.
   • case_holding — כאשר פסק הדין הספציפי מופיע במקורות המאומתים, נסח את ההלכה/הרציו ישירות. כשחסר (בלוק "הערה קריטית" על עוגן חסר) — פעל לפיו ואל תייחס לתיק קביעות שאינן במקורות. עצם השאלה על תיק ספציפי היא שקובעת את הצורה — לא הרמז.
   • analysis / comparison — התנהג כרגיל, הטה את המבנה בהתאם (דיון רציף מול השוואה מובנית).

זכור: אם תכניס סימן עילי כלשהו לתוך text, התשובה תיפסל.`;



const DRAFTER_V2_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    blocks: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["heading", "paragraph", "list_item"] },
          level: { type: "integer", enum: [2, 3] },
          text: { type: "string", minLength: 1 },
          source_refs: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["kind", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["blocks"],
  additionalProperties: false,
};

function buildUserMessage(
  question: string,
  claims: Claim[],
  sources: DrafterInputSource[],
  userDocs: UserDocument[],
  useAsSource: boolean,
  missingAnchors: Array<{ description: string; is_docket?: boolean }>,
  answerIntent?: AnswerIntent,
): string {
  const lines: string[] = [];
  lines.push(`שאלת המשתמש: ${question}`);
  lines.push(
    "מסגרת התשובה חייבת להישאר נאמנה לשאלה כפי שנשאלה. אם המקורות עוסקים בנושא סמוך אך לא זהה — ציין זאת במפורש ואל תחליף את שאלת המשתמש.",
  );
  const missingDocketAnchors = missingAnchors.filter((a) => a.is_docket);
  const missingNonDocketAnchors = missingAnchors.filter((a) => !a.is_docket);
  if (missingNonDocketAnchors.length > 0) {
    lines.push("");
    lines.push(
      "הערה משפטית חשובה: עוגן ראשוני הבא נדרש לתשובה מלאה אך לא נמצא במקורות שסופקו לך:",
    );
    for (const a of missingNonDocketAnchors) lines.push(`  • ${a.description}`);
    lines.push(
      "בתשובתך, ציין במפורש שהעוגן הזה אינו בידיך וכי ניתוח ההמשכיות/החוקיות המלא דורש עיון בו, במקום להניח ממנו מסקנות חיוביות.",
    );
  }
  if (missingDocketAnchors.length > 0) {
    lines.push("");
    lines.push(
      "הערה קריטית — פסק הדין הספציפי שהמשתמש שאל עליו לא אותר במקורות שעברו אימות:",
    );
    for (const a of missingDocketAnchors) lines.push(`  • ${a.description}`);
    lines.push(
      'עליך לכלול בגוף התשובה, במפורש ובלשון כמעט זהה, את המשפט הבא: "לא אותר פסק הדין עצמו במקורות שעברו אימות; לכן לא ניתן לקבוע בביטחון את ההלכה שנפסקה בו." אין להציג מקורות רקע או פסיקה סמוכה כאילו הם ההלכה שנפסקה בתיק הספציפי הזה. מותר לתאר את ההקשר המשפטי הכללי בזהירות, אך לא לייחס לתיק ספציפי קביעות שאין להן תמיכה ישירה במקורות שסופקו.',
    );
  }
  lines.push("");
  lines.push("טענות (לשימוש פנימי בלבד — אל תזכיר מזהי טענות בשום text):");
  for (const cl of claims) {
    lines.push(`- (${cl.claim_id}) ${cl.text_he}`);
  }
  if (answerIntent) {
    lines.push("");
    lines.push(`מבנה מבוקש (רמז פורמט): ${answerIntent.output_shape}`);
  }
  lines.push("");
  lines.push(`מקורות זמינים (${sources.length}) — השתמש אך ורק במזהים האלה ב-source_refs:`);
  for (const s of sources) {
    lines.push("---");
    lines.push(`ref: ${s.ref}`);
    lines.push(`title: ${s.title}`);
    if (s.url) lines.push(`url: ${s.url}`);
    lines.push(`source_type: ${s.source_type} | role: ${s.role} | support: ${s.best_support}`);
    if (s.best_support === "partial") {
      lines.push(`hint: תמיכה חלקית בלבד — נסח טענה זו בלשון זהירה (ראה חוזה הראיות במערכת ההנחיות).`);
    }
    if (s.supported_points.length) {
      lines.push(`supported_points:`);
      for (const p of s.supported_points) lines.push(`  • ${p}`);
    }
    if (s.snippet) lines.push(`snippet: ${s.snippet}`);
  }
  if (!useAsSource && userDocs.some((d) => d.chunks.length > 0)) {
    lines.push("");
    lines.push("הקשר רך מהמסמכים שצירף המשתמש (לרקע בלבד — אסור לצטט מהם):");
    for (const d of userDocs) {
      for (const ch of d.chunks) {
        lines.push("---");
        lines.push(`קובץ: ${d.file_name} | עמ' ${ch.page}`);
        lines.push(ch.text.slice(0, 1500));
      }
    }
  }
  lines.push("");
  lines.push(
    "החזר אובייקט {blocks: [...]} דרך הכלי emit_structured_draft. זכור: אסור סימני הערות שוליים בתוך text — הקוד מוסיף אותם דטרמיניסטית לפי source_refs.",
  );
  return lines.join("\n");
}

export interface QualityWarningHit {
  bucket: string;
  match: string;
  index: number;
}

export interface QualityWarning {
  buckets: string[];
  hit_count: number;
  hits: QualityWarningHit[];
}

const BROKEN_HEBREW_DENYLIST = [
  "בשן טוב",
  "לא להתאזר בסבירות",
  "הודו-נתונה סמכות חוקית",
  "תקנן הסביר",
  "הגנה ההופכת",
  "הכלתנייתיות",
  "אפסון נזיקין",
  "סעדין ניתנים",
  "כברות של נאשם אחר",
  // V2.1e additions — invented words / malformed compounds / unnatural phrasing.
  "סמלייים",
  "סמליומית",
  "הבטחה מנהירת סמכויות",
  "המשרוק",
  "מום פרשני",
  "שווה לנקוט",
  "משקל תקף נמוך יותר",
  // Phase B additions — observed bad phrases.
  "פוקודה",
  "המסקנהיות",
  "כלים עיליים",
  "הדין הפרשני האקטיבי",
  "כלי עובדני",
];

// V2.1e — wrong official names. Canonical: "חוק-יסוד: כבוד האדם וחירותו".
const WRONG_OFFICIAL_NAME_PHRASES = [
  "כיבוד האדם והחירות",
  "חוק-יסוד של כיבוד האדם והחירות",
];

// V2.1e — foreign words appearing inside Hebrew legal answers. Tight allowlist —
// not a generic Latin sweep (URLs/refs contain Latin). Case-insensitive.
const FOREIGN_WORD_PATTERNS: RegExp[] = [
  /\balcance\b/gi,
];

// Truncated source-label fragments: דו / הדו / והדו / הספרות והדו followed by . or "
// and then a non-Hebrew-letter (whitespace, punctuation, end). Hebrew letters U+05D0–U+05EA.
const TRUNCATED_FRAGMENT_RE =
  /(?<![\u05D0-\u05EA])((?:הספרות\s+)?ו?ה?דו)["\.](?![\u05D0-\u05EA])/g;

// Scaffold leakage. Avoid broad s\d+ — too noisy.
const SCAFFOLD_PATTERNS: Array<{ bucket: string; re: RegExp }> = [
  { bucket: "scaffold_leakage", re: /שאלה\s+C\d+/g },
  { bucket: "scaffold_leakage", re: /\bC\d+\b/g },
  { bucket: "scaffold_leakage", re: /\bclaim_id\b/g },
  { bucket: "scaffold_leakage", re: /\bcandidate_id\b/g },
  { bucket: "scaffold_leakage", re: /\bu\d+p\d+\b/g },
];

// V2.1e — civil/tort vs criminal context markers for wrong-party-label check.
const CIVIL_MARKERS = [
  "נזיקין", "רשלנות", "תביעה אזרחית", "פיצויים", "תובע", "נתבע",
  "חוזה", "חוזים", "הפרת חוזה", "עוולה",
];
const CRIMINAL_MARKERS = [
  "פלילי", "פליליים", "כתב אישום", "הרשעה", "גזר דין",
  "עונש", "מאסר", "קנס פלילי", "המאשימה",
];
const NAASHAM_RE = /(?<![\u05D0-\u05EA])ה?נאשם(?:ים|ת|ות)?(?![\u05D0-\u05EA])/g;

function computeQualityWarning(
  answer: string,
  context?: { question?: string; source_context?: string },
): QualityWarning | undefined {
  if (!answer) return undefined;
  const hits: QualityWarningHit[] = [];

  for (const phrase of BROKEN_HEBREW_DENYLIST) {
    let idx = answer.indexOf(phrase);
    while (idx !== -1) {
      hits.push({ bucket: "broken_hebrew", match: phrase, index: idx });
      idx = answer.indexOf(phrase, idx + phrase.length);
    }
  }

  for (const phrase of WRONG_OFFICIAL_NAME_PHRASES) {
    let idx = answer.indexOf(phrase);
    while (idx !== -1) {
      hits.push({ bucket: "wrong_official_name", match: phrase, index: idx });
      idx = answer.indexOf(phrase, idx + phrase.length);
    }
  }

  for (const re of FOREIGN_WORD_PATTERNS) {
    for (const m of answer.matchAll(re)) {
      hits.push({ bucket: "foreign_word_in_hebrew", match: m[0], index: m.index ?? -1 });
    }
  }

  for (const m of answer.matchAll(TRUNCATED_FRAGMENT_RE)) {
    hits.push({
      bucket: "truncated_source_fragment",
      match: m[0],
      index: m.index ?? -1,
    });
  }

  for (const { bucket, re } of SCAFFOLD_PATTERNS) {
    for (const m of answer.matchAll(re)) {
      hits.push({ bucket, match: m[0], index: m.index ?? -1 });
    }
  }

  // V2.1e — wrong party label in civil/tort context.
  const ctxBlob = `${context?.question ?? ""}\n${context?.source_context ?? ""}`;
  if (ctxBlob.trim()) {
    const hasCivil = CIVIL_MARKERS.some((m) => ctxBlob.includes(m));
    const hasCriminal = CRIMINAL_MARKERS.some((m) => ctxBlob.includes(m));
    if (hasCivil && !hasCriminal) {
      for (const m of answer.matchAll(NAASHAM_RE)) {
        hits.push({
          bucket: "wrong_party_label_civil",
          match: m[0],
          index: m.index ?? -1,
        });
      }
    }
  }

  if (hits.length === 0) return undefined;
  const buckets = Array.from(new Set(hits.map((h) => h.bucket))).sort();
  return { buckets, hit_count: hits.length, hits: hits.slice(0, 50) };
}

export interface DrafterV2Result {
  ok: boolean;
  ms: number;
  model_initial: string;
  model_final: string;
  provider: "openai" | "anthropic";
  escalated: boolean;
  sources_passed: number;
  sources_used: number;
  answer_markdown: string;
  used_sources: UsedSource[];
  footnotes: Footnote[];
  stage_runs: StageRun[];
  error?: string;
  raw_text?: string;
  structured_validation: StructuredValidation;
  /** Parsed structured draft (used by the answer-style report-only gate). */
  structured_draft?: import("./structuredValidation.ts").StructuredDraft | null;
  /** Input sources actually passed to the drafter (display titles applied). */
  input_sources?: DrafterInputSource[];
  builder_report?: ReturnType<typeof buildFootnotedAnswer>["builder_report"];
  quality_warning?: QualityWarning;
  usage?: { input_tokens?: number; output_tokens?: number };
  // Debug: whether the missing-required-anchor caveat instruction was injected.
  missing_anchor_caveat_injected?: boolean;
  missing_anchor_descriptions?: string[];
  schema_failure_reason?:
    | "no_tool_call"
    | "json_parse"
    | "schema_invalid"
    | "no_cited_segments"
    | "unknown_source_refs"
    | "forbidden_markers_in_text"
    | "no_usable_candidates";
  // ── Truncation guard telemetry (drafterV2-only, additive) ─────────────
  /** Completeness report on the final draft that was rendered. */
  completeness?: CompletenessReport;
  /** Completeness report on the very first draft (before any retry). */
  completeness_initial?: CompletenessReport;
  /** Retry accounting for the truncation guard. */
  truncation_retry?: {
    attempted: boolean;
    same_model_retry: boolean;
    escalated_to_full: boolean;
    retry_ms: number;
    reasons_initial: string[];
  };
  /** `max_completion_tokens` value on the final successful call. */
  max_completion_tokens_used?: number;
}

export async function runDrafterV2(
  question: string,
  claims: Claim[],
  candidates: Candidate[],
  verifier: { usable: UsableCandidate[]; verdicts: Verdict[] },
  opts?: {
    userDocs?: UserDocument[];
    useAsSource?: boolean;
    // Harness-only: force a specific drafter model (e.g. MODEL_FULL) and
    // skip the mini→full escalation. Used by offline model-comparison runs.
    forceModel?: string;
    skipEscalation?: boolean;
    // Harness-only: provider routing. Defaults to "openai" (Lovable AI Gateway).
    // "anthropic" calls the Anthropic Messages API directly with the same
    // structured-output schema; the rest of the pipeline is identical.
    provider?: "openai" | "anthropic";
    // Required-anchor caveat (Phase-1 minimal): when one or more declared
    // legal anchors did not reach the verifier or were not effectively
    // supported, append a single instruction to the user message telling
    // the drafter to caveat the answer instead of inferring around them.
    missingRequiredAnchors?: Array<{ description: string; is_docket?: boolean }>;
    // Optional analyzer-emitted answer intent. Rendered into the user message
    // as a compact "Answer Intent" block; the drafter system prompt has
    // per-shape and per-posture rules that reference it. Backwards
    // compatible: omit → drafter falls back to prior behavior.
    answerIntent?: AnswerIntent;
  },
): Promise<DrafterV2Result> {
  const t_total = Date.now();
  const stage_runs: StageRun[] = [];

  const userDocs = opts?.userDocs ?? [];
  const useAsSource = opts?.useAsSource ?? false;
  const forceModel = opts?.forceModel;
  const skipEscalation = opts?.skipEscalation === true || !!forceModel;
  const provider: "openai" | "anthropic" = opts?.provider ?? "openai";


  const inputSources = buildInputSources(
    candidates,
    verifier.verdicts,
    verifier.usable,
    userDocs,
    useAsSource,
  );
  const sources_passed = inputSources.length;
  const allowedRefs = new Set(inputSources.map((s) => s.ref));

  const emptyValidation: StructuredValidation = {
    ok: false,
    errors: ["no_usable_candidates"],
    block_count: 0,
    paragraph_count: 0,
    list_item_count: 0,
    heading_count: 0,
    cited_segment_count: 0,
    total_source_ref_count: 0,
    unknown_source_refs: [],
    forbidden_text_hits: [],
  };

  if (sources_passed === 0) {
    return {
      ok: false,
      ms: Date.now() - t_total,
      model_initial: forceModel ?? MODEL_MINI,
      model_final: MODEL_MINI,
      provider,
      escalated: false,
      sources_passed: 0,
      sources_used: 0,
      answer_markdown: "",
      used_sources: [],
      footnotes: [],
      stage_runs,
      error: "no_usable_candidates",
      structured_validation: emptyValidation,
      schema_failure_reason: "no_usable_candidates",
    };
  }

  const missingAnchors = opts?.missingRequiredAnchors ?? [];
  const userMsg = buildUserMessage(question, claims, inputSources, userDocs, useAsSource, missingAnchors, opts?.answerIntent);
  const tool = {
    name: "emit_structured_draft",
    description: "Emit the Hebrew legal answer as structured blocks. Code adds footnote markers.",
    parameters: DRAFTER_V2_TOOL_PARAMETERS,
  };

  let lastUsage: { input_tokens?: number; output_tokens?: number } | undefined;

  const tryOne = async (
    model: string,
    stage: string,
    maxCompletionTokens?: number,
  ) => {
    const t0 = Date.now();
    let data: unknown = null;
    let raw_text = "";
    let parse_error: string | undefined;
    let http_status = 0;
    let http_error: string | undefined;

    if (provider === "anthropic") {
      const resp = await callAnthropicJsonTool<unknown>({
        model,
        system: SYSTEM_PROMPT_V2,
        user: userMsg,
        tool: {
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        },
      });
      data = resp.data;
      raw_text = resp.raw_text;
      parse_error = resp.parse_error;
      http_status = resp.http_status;
      http_error = resp.http_error;
      lastUsage = resp.usage;
    } else {
      const resp = await callOpenAIJsonTool<unknown>({
        model,
        system: SYSTEM_PROMPT_V2,
        user: userMsg,
        tool,
        maxCompletionTokens,
      });
      data = resp.data;
      raw_text = resp.raw_text;
      parse_error = resp.parse_error;
      http_status = resp.http_status;
      http_error = resp.http_error;
    }

    stage_runs.push({
      stage,
      model,
      ms: Date.now() - t0,
      ok: !!data,
      escalated: stage === "drafter_v2.escalated" || stage === "drafter_v2.truncation_escalated",
      parse_error,
      http_status,
      http_error,
    });
    return { data, raw_text, parse_error };
  };

  const initialModel = forceModel ?? MODEL_MINI;
  let modelUsed = initialModel;
  let escalated = false;
  let maxTokensUsed: number | undefined = DRAFTER_V2_BUDGET_INITIAL;
  let resp = await tryOne(initialModel, "drafter_v2.initial", DRAFTER_V2_BUDGET_INITIAL);


  let parsed = validateStructuredDraft(resp.data, allowedRefs);
  let schema_failure_reason: DrafterV2Result["schema_failure_reason"];
  if (!resp.data) {
    schema_failure_reason = resp.parse_error ? "json_parse" : "no_tool_call";
  } else if (!parsed.report.ok) {
    if (parsed.report.unknown_source_refs.length) schema_failure_reason = "unknown_source_refs";
    else if (parsed.report.forbidden_text_hits.length) schema_failure_reason = "forbidden_markers_in_text";
    else if (parsed.report.cited_segment_count === 0) schema_failure_reason = "no_cited_segments";
    else schema_failure_reason = "schema_invalid";
  }

  if (!parsed.draft && !skipEscalation) {

    escalated = true;
    modelUsed = MODEL_FULL;
    maxTokensUsed = DRAFTER_V2_BUDGET_RETRY;
    resp = await tryOne(MODEL_FULL, "drafter_v2.escalated", DRAFTER_V2_BUDGET_RETRY);
    parsed = validateStructuredDraft(resp.data, allowedRefs);
    if (!resp.data) {
      schema_failure_reason = resp.parse_error ? "json_parse" : "no_tool_call";
    } else if (!parsed.report.ok) {
      if (parsed.report.unknown_source_refs.length) schema_failure_reason = "unknown_source_refs";
      else if (parsed.report.forbidden_text_hits.length) schema_failure_reason = "forbidden_markers_in_text";
      else if (parsed.report.cited_segment_count === 0) schema_failure_reason = "no_cited_segments";
      else schema_failure_reason = "schema_invalid";
    } else {
      schema_failure_reason = undefined;
    }
  }


  if (!parsed.draft) {
    return {
      ok: false,
      ms: Date.now() - t_total,
      model_initial: forceModel ?? MODEL_MINI,
      model_final: modelUsed,
      provider,
      escalated,
      sources_passed,
      sources_used: 0,
      answer_markdown: "",
      used_sources: [],
      footnotes: [],
      stage_runs,
      error: parsed.report.errors.join("; ") || "structured_draft_invalid",
      raw_text: (resp.raw_text || "").slice(0, 1000),
      structured_validation: parsed.report,
      schema_failure_reason: schema_failure_reason ?? "schema_invalid",
      usage: lastUsage,
    };
  }

  // ── Truncation guard (drafterV2-only) ────────────────────────────────────
  // Run a cheap deterministic completeness check on the parsed draft. If the
  // model closed mid-word / mid-clause, retry once with a larger budget on
  // the same model; only escalate to MODEL_FULL if that retry still fails.
  // Skipped when the caller forces a specific model / suppresses escalation
  // (harness runs) and skipped for the anthropic provider (its token limits
  // are handled elsewhere and it hasn't shown this failure mode).
  let completeness = checkCompleteness(parsed.draft);
  const completeness_initial = completeness;
  let truncation_retry: DrafterV2Result["truncation_retry"] = {
    attempted: false,
    same_model_retry: false,
    escalated_to_full: false,
    retry_ms: 0,
    reasons_initial: completeness_initial.reasons,
  };

  if (completeness.truncated && !skipEscalation && provider === "openai") {
    const t_retry = Date.now();
    truncation_retry.attempted = true;

    // Retry #1 — same model, larger output budget.
    truncation_retry.same_model_retry = true;
    let retryResp = await tryOne(
      initialModel,
      "drafter_v2.truncation_retry",
      DRAFTER_V2_BUDGET_RETRY,
    );
    let retryParsed = validateStructuredDraft(retryResp.data, allowedRefs);
    if (retryParsed.draft) {
      resp = retryResp;
      parsed = retryParsed;
      modelUsed = initialModel;
      maxTokensUsed = DRAFTER_V2_BUDGET_RETRY;
      completeness = checkCompleteness(parsed.draft);
    }

    // Retry #2 (escalation) — only if same-model retry failed schema OR
    // still shows a strong truncation signal.
    const stillTruncated = !retryParsed.draft
      || checkCompleteness(retryParsed.draft).truncated;
    if (stillTruncated) {
      truncation_retry.escalated_to_full = true;
      const escResp = await tryOne(
        MODEL_FULL,
        "drafter_v2.truncation_escalated",
        DRAFTER_V2_BUDGET_RETRY,
      );
      const escParsed = validateStructuredDraft(escResp.data, allowedRefs);
      if (escParsed.draft) {
        resp = escResp;
        parsed = escParsed;
        modelUsed = MODEL_FULL;
        escalated = true;
        maxTokensUsed = DRAFTER_V2_BUDGET_RETRY;
        completeness = checkCompleteness(parsed.draft);
      }
    }

    truncation_retry.retry_ms = Date.now() - t_retry;
  }

  const built = buildFootnotedAnswer(parsed.draft, inputSources);


  // Rule 1.10 — Hebrew number ranges must be written high→low in source order.
  const answer_markdown = normalizeHebrewNumberRanges(built.answer_markdown);
  const footnotes = built.footnotes.map((fn) => ({
    ...fn,
    text: normalizeHebrewNumberRanges(fn.text),
  }));

  return {
    ok: true,
    ms: Date.now() - t_total,
    model_initial: forceModel ?? MODEL_MINI,
    model_final: modelUsed,
    provider,
    escalated,
    sources_passed,
    sources_used: built.used_sources.length,
    answer_markdown,
    used_sources: built.used_sources,
    footnotes,
    stage_runs,
    structured_validation: parsed.report,
    structured_draft: parsed.draft,
    input_sources: inputSources,
    builder_report: built.builder_report,
    quality_warning: computeQualityWarning(answer_markdown, {
      question,
      source_context: inputSources
        .map((s) => `${s.title}\n${s.snippet ?? ""}\n${(s.supported_points ?? []).join("\n")}`)
        .join("\n")
        .slice(0, 20000),
    }),
    usage: lastUsage,
    missing_anchor_caveat_injected: missingAnchors.length > 0,
    missing_anchor_descriptions: missingAnchors.map((a) => a.description),
    completeness,
    completeness_initial,
    truncation_retry,
    max_completion_tokens_used: maxTokensUsed,
  };
}
