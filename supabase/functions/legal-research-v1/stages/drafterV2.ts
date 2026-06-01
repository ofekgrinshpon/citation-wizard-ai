// V2.1 — Structured Citation Drafter.
// The model writes Hebrew legal prose as structured blocks with explicit
// source_refs per paragraph/list_item. It never emits markers. The
// deterministic footnoteBuilder turns the structured draft into final
// markdown + footnotes + used_sources.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import type { UserDocument } from "../lib/attachments.ts";
import {
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

const SYSTEM_PROMPT_V2 = `אתה חוקר משפט ישראלי הכותב תזכיר מחקר קצר ומקצועי בעברית עבור עורך/ת דין מנוסה.

חשוב מאוד — פורמט פלט מבני (לא Markdown חופשי):
- אתה מחזיר *רק* קריאה לכלי emit_structured_draft עם אובייקט {blocks: [...]}.
- כל פסקה היא בלוק נפרד מסוג "paragraph" עם שדה text ושדה source_refs.
- כותרות הן בלוק "heading" (level 2 או 3) עם שדה text בלבד, ללא source_refs.
- פריט רשימה הוא "list_item" עם text ו-source_refs.
- בשדה text **אסור בהחלט** לכלול ספרות עליונות (¹²³…), אסור [N] בסוגריים מרובעים, אסור [[fn:N]], ואסור כל סימן הערת שוליים שהוא. הקוד מוסיף את הסימנים אחר־כך — אם תוסיף סימנים בעצמך, התשובה תיפסל לחלוטין.
- source_refs מכיל מזהי מקור כפי שניתנו לך (s1, s2, s3, … או u1p1 וכד'). מותרים אך ורק מזהים שהופיעו ברשימת המקורות. אם תפנה למזהה שלא קיים — התשובה תיפסל.
- אם פסקה היא פתיחה כללית, מעבר, או מסקנה שאינה מוסיפה טענה משפטית חדשה, אפשר source_refs: [].
- אם כמה מקורות תומכים יחד באותה טענה בפסקה — הוסף את כולם ל-source_refs של אותו בלוק. הקוד ייצור הערת שוליים מורכבת אחת.
- אל תוסיף את אותו מקור פעמיים באותו בלוק.
- מקסימום 3 מקורות לבלוק (אם נדרשים יותר — פצל לשני בלוקים נפרדים).

כללי כתיבה משפטית — סגנון:
- **פתיחה תזה־קודמת:** פסקה ראשונה משיבה ישירות על השאלה במשפט אחד או שניים. אל תפתח בהקדמה על התחום.
- **עברית משפטית טבעית:** כתוב כפי שכותב משפטן ישראלי. הימנע מתרגום מאנגלית, ממטא־שפה ריקה, ומפיגומים מלאכותיים.
- **ודאות מכוילת:** הבחן בין מסקנה מבוססת, מגמה רווחת, ואי־ודאות. אל תרכך מה שהמקורות תומכים בו ישירות, ואל תקבע מה שאין לו תמיכה.
- **דיוק דוקטרינרי:** הבחן בין חוק, פסיקה, הנחיה מנהלית וספרות. אל תזכיר דוקטרינה שאינה נדרשת לתשובה.
- **מבנה מותאם:** השתמש בכותרות **bold** רק כשהן באמת עוזרות. אל תסיר כותרת שימושית רק כדי להפחית מספר כותרות, ואל תוסיף כותרות לכל סעיף משנה.
- **המקורות משרתים את הטיעון:** אל תארגן את התשובה כסקירת מקורות. שלב כל מקור בטענה שהוא תומך בה, באמצעות source_refs של אותו בלוק.
- **משמעת אורך:** אורך נגזר מהמקורות ומהשאלה. תשובה הדוקה ובהירה עדיפה תמיד — אך לא על חשבון עוגנים משפטיים קונקרטיים.

שימור עוגנים משפטיים קונקרטיים (קריטי):
- בעת ניסוח התשובה, **אל תחליף עוגנים משפטיים קונקרטיים בהפשטה כללית**. אם אחד המקורות תומך בפסק דין מרכזי, דוגמה פסיקתית, הוראת חוק או סעיף ספציפי, חריג, מבחן משנה, הבחנה דוקטרינרית, סוג סעד, נטל ראייתי או הבחנה בקשר סיבתי, או שאלה שנותרה פתוחה — שלב זאת בגוף התשובה במפורש, ולא כתקציר מופשט.
- תשובה טובה אינה רשימת יסודות מופשטת או "כרטיס הגדרה"; עליה לשמר את העוגנים המשפטיים שמעניקים לדין את הדיוק והניואנס שלו (שמות הלכות מרכזיות כשהן מופיעות במקורות, סעיפי חוק קונקרטיים, חריגים מוכרים, מדרגי יסוד נפשי, הבחנות בין סעדים, נטלי הוכחה, ושאלות שטרם הוכרעו).
- עדיף לכלול דוגמה פסיקתית אחת קונקרטית או הבחנה דוקטרינרית אחת מדויקת מאשר לסכם את כל הדוקטרינה בשורה מופשטת.
- אין צורך להאריך לשם הארכה, ואין צורך להפחית מקורות לשם הפחתה. מספר המקורות לבלוק נגזר מהטענה — בלוק יכול לצטט מספר מקורות כאשר הם תומכים יחד באותה טענה (למשל חוק + פסיקה + ספרות).
- שמור על עברית משפטית טבעית גם כשאתה משלב עוגנים קונקרטיים — אל תהפוך את התשובה לרשימה טכנית או למבנה JSON־כמו.

כללים נוספים:
- השתמש אך ורק במקורות שסופקו. אל תמציא חוקים, פסקי דין, סעיפים, שנים, או מחברים.
- אל תזכיר מזהים פנימיים (candidate_id, claim_id, C1, S1) בשום text.
- אל תכתוב כותרות עם # ## ###. כותרות יוצגו כ-bold דרך בלוק heading.
- כל הפניה למקור נעשית אך ורק דרך source_refs. אסור לכתוב "ראו s2" או "לפי מקור 3" בתוך text.

איכות לשונית, דיוק משפטי והגנה מפני זליגה פנימית:
כתוב בעברית משפטית ישראלית טבעית, כפי שעורך דין ישראלי היה מנסח. אל תמציא מונחים, אל תתרגם ביטויים משפטיים מאנגלית מילה־במילה, ואל תייצר שמות פעולה או צירופים שאינם מקובלים בשפה המשפטית. אם אינך בטוח שמונח מסוים קיים בעברית משפטית תקינה — העדף ניסוח פשוט וברור.

אין לכלול בתשובה ביטויים שבורים או מומצאים כגון: בשן טוב, לא להתאזר בסבירות, הודו-נתונה סמכות חוקית, תקנן הסביר, הגנה ההופכת, הכלתנייתיות, אפסון נזיקין, סעדין ניתנים, כברות של נאשם אחר.

השתמש במונחים משפטיים לפי ההקשר: גזר דין מתאים להליך פלילי ולשלב הענישה; בהקשרים אזרחיים או מנהליים העדף לפי הצורך פסק דין, החלטה, סעד, פיצוי, תרופה או הכרעה.

אין להוציא קטעים קטועים או תוויות מקור חלקיות בתוך גוף התשובה. אל תכתוב דו., והדו., הדו., הספרות והדו., או קיצור שנקטע באמצע. אם אתה מתכוון לדוח, כתוב דוח, דין וחשבון, או שם מקור ברור, והצמד את המקור דרך source_refs.

אין לכלול בתשובה תוויות פנימיות או מזהים פנימיים כגון C1, C2, שאלה C2, claim_id, candidate_id, s1, u1p1, או כל מזהה שנראה כמו scaffold פנימי.

שמור על מסגרת השאלה של המשתמש. אם המקורות עוסקים בנושא סמוך אך לא זהה, ציין זאת בזהירות ואל תחליף את שאלת המשתמש בנושא של המקורות. לדוגמה, אם המשתמש שאל על גביית דמי חסות / פרוטקשן והמקור עוסק בצווי הגנה, אל תהפוך את התשובה לשאלה על צווי הגנה; השתמש במקור רק כרקע או ציין שמדובר במקור סמוך.

העדף ניסוח משפטי ברור על פני ניסוח אקדמי־עמום. מטרת התשובה היא דיוק משפטי, לא יצירת רושם לשוני.

חיזוק איכות לשונית — עברית משפטית נקייה, שמות רשמיים, ותוויות בעלי דין (חובה):
- אל תמציא מילים בעברית ואל תייצר צורות נטייה מומצאות. אם אינך בטוח שהצירוף קיים בעברית משפטית — נסח בפשטות במונח מקובל.
- אל תכניס מילים לועזיות (אנגלית, ספרדית, לטינית וכד') לתוך תשובה בעברית, אלא אם מדובר במונח משפטי מקובל וכשהשימוש בו הכרחי. אל תכתוב alcance, scope, due process וכד' בתוך משפט עברי — השתמש ב"היקף", "הסמכות", "הליך הוגן" וכיו"ב.
- שמות חוקים רשמיים — בדיוק כפי שהם. למשל: "חוק-יסוד: כבוד האדם וחירותו" — לא "חוק-יסוד של כיבוד האדם והחירות", לא "כיבוד האדם והחירות", לא וריאציות אחרות. שמור על נקודתיים, יידוע ונטיות מדויקות.
- תוויות בעלי דין לפי הקשר ההליך:
  - הליך אזרחי / נזיקי: "תובע" ו"נתבע". אסור "נאשם" בהקשר אזרחי.
  - הליך פלילי: "המאשימה" ו"נאשם".
  - הליך מנהלי / עתירה: "עותר" ו"משיב".
- אל תמציא צירופים סביב סמכות מנהלית. כתוב "הבטחה מנהלית", "הרשות המוסמכת", "בעל הסמכות" — לא "הבטחה מנהירת סמכויות", לא "המשרוק", לא ניסוחים דומים שאינם קיימים בעברית משפטית.
- העדף עברית משפטית פשוטה ונכונה על פני ניסוח מרשים-לכאורה. אל תשתמש בביטויים כמו "מום פרשני", "שווה לנקוט", "משקל תקף נמוך יותר" וכיו"ב — בחר במונח מקובל ("פגם פרשני", "ראוי לנקוט", "משקל נמוך יותר") או נסח מחדש.

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
): string {
  const lines: string[] = [];
  lines.push(`שאלת המשתמש: ${question}`);
  lines.push(
    "מסגרת התשובה חייבת להישאר נאמנה לשאלה כפי שנשאלה. אם המקורות עוסקים בנושא סמוך אך לא זהה — ציין זאת במפורש ואל תחליף את שאלת המשתמש.",
  );
  lines.push("");
  lines.push("טענות (לשימוש פנימי בלבד — אל תזכיר מזהי טענות בשום text):");
  for (const cl of claims) {
    lines.push(`- (${cl.claim_id}) ${cl.text_he}`);
  }
  lines.push("");
  lines.push(`מקורות זמינים (${sources.length}) — השתמש אך ורק במזהים האלה ב-source_refs:`);
  for (const s of sources) {
    lines.push("---");
    lines.push(`ref: ${s.ref}`);
    lines.push(`title: ${s.title}`);
    if (s.url) lines.push(`url: ${s.url}`);
    lines.push(`source_type: ${s.source_type} | role: ${s.role} | support: ${s.best_support}`);
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
  builder_report?: ReturnType<typeof buildFootnotedAnswer>["builder_report"];
  quality_warning?: QualityWarning;
  schema_failure_reason?:
    | "no_tool_call"
    | "json_parse"
    | "schema_invalid"
    | "no_cited_segments"
    | "unknown_source_refs"
    | "forbidden_markers_in_text"
    | "no_usable_candidates";
}

export async function runDrafterV2(
  question: string,
  claims: Claim[],
  candidates: Candidate[],
  verifier: { usable: UsableCandidate[]; verdicts: Verdict[] },
  opts?: { userDocs?: UserDocument[]; useAsSource?: boolean },
): Promise<DrafterV2Result> {
  const t_total = Date.now();
  const stage_runs: StageRun[] = [];

  const userDocs = opts?.userDocs ?? [];
  const useAsSource = opts?.useAsSource ?? false;

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
      model_initial: MODEL_MINI,
      model_final: MODEL_MINI,
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

  const userMsg = buildUserMessage(question, claims, inputSources, userDocs, useAsSource);
  const tool = {
    name: "emit_structured_draft",
    description: "Emit the Hebrew legal answer as structured blocks. Code adds footnote markers.",
    parameters: DRAFTER_V2_TOOL_PARAMETERS,
  };

  const tryOne = async (model: string, stage: string) => {
    const t0 = Date.now();
    const resp = await callOpenAIJsonTool<unknown>({
      model,
      system: SYSTEM_PROMPT_V2,
      user: userMsg,
      tool,
    });
    stage_runs.push({
      stage,
      model,
      ms: Date.now() - t0,
      ok: !!resp.data,
      escalated: stage === "drafter_v2.escalated",
      parse_error: resp.parse_error,
      http_status: resp.http_status,
      http_error: resp.http_error,
    });
    return resp;
  };

  let modelUsed = MODEL_MINI;
  let escalated = false;
  let resp = await tryOne(MODEL_MINI, "drafter_v2.initial");

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

  if (!parsed.draft) {
    escalated = true;
    modelUsed = MODEL_FULL;
    resp = await tryOne(MODEL_FULL, "drafter_v2.escalated");
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
      model_initial: MODEL_MINI,
      model_final: modelUsed,
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
    };
  }

  const built = buildFootnotedAnswer(parsed.draft, inputSources);

  return {
    ok: true,
    ms: Date.now() - t_total,
    model_initial: MODEL_MINI,
    model_final: modelUsed,
    escalated,
    sources_passed,
    sources_used: built.used_sources.length,
    answer_markdown: built.answer_markdown,
    used_sources: built.used_sources,
    footnotes: built.footnotes,
    stage_runs,
    structured_validation: parsed.report,
    builder_report: built.builder_report,
    quality_warning: computeQualityWarning(built.answer_markdown, {
      question,
      source_context: inputSources
        .map((s) => `${s.title}\n${s.snippet ?? ""}\n${(s.supported_points ?? []).join("\n")}`)
        .join("\n")
        .slice(0, 20000),
    }),
  };
}
