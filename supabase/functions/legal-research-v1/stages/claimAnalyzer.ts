// Claim Analyzer — Stage 1 of legal-research-v1.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import {
  ANALYZER_TOOL_PARAMETERS,
  validateAnalyzer,
  ValidationResult,
} from "../lib/schemas.ts";
import {
  analyzerEscalationReasons,
  shouldPreEscalateAnalyzer,
} from "../lib/escalation.ts";
import {
  AnalyzerOutput,
  MODEL_FULL,
  MODEL_MINI,
  StageRun,
} from "../lib/types.ts";

const SYSTEM_PROMPT = `אתה אנליסט משפטי ישראלי. הקלט הוא שאלה משפטית בעברית.
המטרה: לפרק את השאלה ל־3 עד 5 טענות (claims) משפטיות אטומיות שצריך לענות עליהן.

לכל טענה ציין:
- claim_id (C1, C2, ...)
- text_he: ניסוח הטענה בעברית
- required_roles: סוגי המקורות הדרושים מתוך הרשימה הסגורה
- is_black_letter: true אם זו טענה דוקטרינרית/משפטית "ספרי לימוד" שדורשת תשתית נורמטיבית מחייבת
- reason: למה צריך את התפקידים האלו

required_roles חייב להיות תת־קבוצה של:
primary_statute, regulation, binding_case_law, persuasive_case_law, scholarship, factual_report, government_report.

חוקים:
- אל תשתמש בקטלוג דוקטרינות קבוע. נתח לפי השאלה עצמה.
- שאלת חוק/תקנה ספציפית → primary_statute או regulation חובה.
- שאלת דוקטרינה משפטית → required_roles חייב לכלול binding_case_law או primary_statute.
- שאלה עובדתית/דו"ח → factual_report או government_report.
- confidence: 0..1, כמה ברורה ומובנת השאלה.
- legal_area: תחום משפטי קצר (לדוגמה "סדר דין אזרחי", "משפט מינהלי", "דיני חוזים").
- answer_type: אחד מהקבועים.

דיסאמביגואציה של מונחים בעברית משפטית:
- "השתק פלוגתא" משמעו ברירת מחדל issue preclusion / השתק עילה ספציפית מתוך דיני מעשה בית דין (res judicata), ולא promissory estoppel. אל תפרש אותו כ"השתק על־פי הצגה" או "השתק מחמת הבטחה" אלא אם המשתמש מציין במפורש הבטחה, מצג, הסתמכות או הקשר של דיני חוזים/נזיקין פרטיים. מושגי מפתח שצפויים לעלות בטענות ובשאילתות: זהות פלוגתא, הכרעה פוזיטיבית, הכרעה חיונית, פסק דין חלוט, צדדים או חליפיהם, הזדמנות מלאה להתדיין. מקורות צפויים: binding_case_law של בית המשפט העליון על מעשה בית דין, וספרות (נינה זלצמן ואחרים).
- "פקודה מנדטורית" / "חקיקה מנדטורית" / "דבר המלך … מנדטורי" — ברירת המחדל היא פקודה מתקופת המנדט הבריטי (Mandate-era ordinance), כלומר חקיקה היסטורית שעודנה תקפה מכוח המשך תחולת הדין (סעיף 11 לפקודת סדרי השלטון והמשפט תש"ח-1948) ושעברה לרוב גרסת "נוסח חדש" ותיקונים נרחבים של הכנסת. אל תפרש "מנדטורי" כ"נורמה קוגנטית" / "הוראה שאינה ניתנת להתניה" / mandatory rule / binding norm אלא אם המשתמש משתמש מפורשות בביטויים כמו "נורמה קוגנטית", "הוראה שאינה ניתנת להתניה", "אי אפשר להתנות עליה", "mandatory rule" או "binding norm". מושגי מפתח שצפויים: המנדט הבריטי, המשך תחולת חקיקה מנדטורית, סעיף 11 לפקודת סדרי השלטון והמשפט, נוסח חדש, פקודת מס הכנסה [נוסח חדש] תשכ"א-1961, Income Tax Ordinance 1947, רפורמה / קודיפיקציה.

כשמתבצעת דיסאמביגואציה כזו (לכל מונח דו-משמעי שמכוסה ברשימה מעלה), חובה למלא את השדה interpretation_note בעברית, משפט קצר אחד שמסביר את הפרשנות שנבחרה (לדוגמה: "מנדטורי פורש כפקודה מתקופת המנדט הבריטי"). אל תמלא את השדה כאשר אין דיסאמביגואציה שדורשת הבהרה.

כוונת תשובה (answer_intent) — חובה למלא כאשר צורת הפלט הנדרשת ברורה משאלת המשתמש. הוא מנחה את שלב הכתיבה (drafter) ואינו קשור לתכנון השאילתות. מבנה השדה:
- output_shape: אחד מהערכים ברשימה סגורה, לפי הניסוח של המשתמש:
  • verbatim_quote — המשתמש ביקש ציטוט מדויק / להביא את לשון החוק / להביא את הסעיף / "צטט את סעיף…".
  • definition_elements — המשתמש שאל "מהי ההגדרה של…", "מהם היסודות של…", "מה תנאי…". הפתיחה תיפתח בהגדרה/יסודות מן המקור עצמו.
  • enumerate_duties — המשתמש שאל "מהן החובות", "אילו חובות דיווח", "מה מוטל על…". תשובה כרשימת חובות קונקרטיות, כולל עיתוי כאשר מבוקש.
  • timeframe_table — המשתמש שאל "תוך כמה ימים", "מה לוחות הזמנים", "מהי תקופת ההתיישנות". תשובה עם ימים/מועדים קונקרטיים.
  • case_holding — שאלה שמתייחסת לתיק ספציפי לפי מספרו ("מה נפסק ב-…", "כתבו הערת ביקורת על …"). זו הצורה גם כאשר יש חשש שפסק הדין עצמו לא נמצא — במקרה כזה יש להשתמש ב-confidence_posture המתאים ולא לשנות את output_shape.
  • doctrinal_explanation — שאלה תיאורטית/דוקטרינרית כללית ("מה ההלכה בעניין X", "הסבר את דוקטרינת Y").
  • application — יישום דין על עובדות שהמשתמש תיאר.
  • comparison — השוואה בין דוקטרינות/שיטות/הוראות.
  • insufficient_source_response — כאשר ניכר מראש שאין די מקורות משפטיים לענות; מסרב להמציא הלכה.
  • other — רק כאשר אף אחד מהאחרים לא מתאים.
- must_include: 1–4 פריטים קונקרטיים שהמשתמש ביקש במפורש (למשל "ציטוט מדויק של סעיף 1", "עיתוי הדיווח לרשות לאיסור הלבנת הון").
- must_avoid: אנטי-דפוסים ספציפיים לשאלה זו (למשל "אל תבקש מהמשתמש להזמין את הציטוט שוב", "אל תישאר ברמת עקרונות").
- confidence_posture:
  • direct_if_primary_present — ברירת מחדל לרוב השאלות. משמעו: אם וכאשר טקסט המקור בפועל תומך בטענה או בפלט הספציפי — לענות ישירות; מעצם נוכחות המקור אין להסיק ולהמציא.
  • cautious_if_partial — שאלה רחבה/מעורבת שבה סביר שהתמיכה תהיה חלקית בלבד.
  • refuse_specific_holding_if_primary_missing — כאשר המשתמש שואל על ההלכה של תיק ספציפי ולא ניתן להניח שפסק הדין עצמו יימצא בחבילת המקורות. סרב לקבוע את ההלכה בהיעדר פסק הדין עצמו.

אם השאלה עמומה ולא ניתן לקבוע output_shape בביטחון סביר, השמט את השדה answer_intent לגמרי.

החזר את התוצאה רק דרך הקריאה לכלי emit_claim_analysis.`;


export interface AnalyzerStageResult {
  result: ValidationResult<AnalyzerOutput>;
  model_initial: string;
  model_final: string;
  escalated: boolean;
  escalation_reasons: string[];
  stage_runs: StageRun[];
  raw_text_initial: string;
  raw_text_final: string;
  /**
   * True when escalation never produced a usable response from the model
   * because every attempt failed at the transport/gateway layer (network,
   * 429/5xx, malformed gateway payload). Distinct from a model response that
   * arrived but failed schema validation. The caller should surface a clean
   * "temporarily unavailable" state instead of the P2 stub answer.
   */
  transport_failed: boolean;
  attempts_summary: Array<{
    attempt: number;
    ms: number;
    http_status?: number;
    http_error?: string;
    parse_error?: string;
    got_data: boolean;
  }>;
}

// HTTP statuses we'll retry. 0 means thrown/network. 408/429/5xx are
// classic transient gateway/provider failures.
const RETRYABLE_HTTP = new Set([0, 408, 429, 500, 502, 503, 504]);
const MAX_FULL_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 3000]; // between attempts 1->2 and 2->3

export async function runClaimAnalyzer(
  question: string,
  opts?: { attachmentsContext?: string },
): Promise<AnalyzerStageResult> {
  const preReasons = shouldPreEscalateAnalyzer(question);
  const initialModel = preReasons.length > 0 ? MODEL_FULL : MODEL_MINI;

  const stage_runs: StageRun[] = [];
  const attempts_summary: AnalyzerStageResult["attempts_summary"] = [];

  const userPrompt = opts?.attachmentsContext
    ? `${opts.attachmentsContext}\n\nשאלת המשתמש: ${question}`
    : question;

  const t0 = Date.now();
  const first = await callOpenAIJsonTool<unknown>({
    model: initialModel,
    system: SYSTEM_PROMPT,
    user: userPrompt,
    tool: {
      name: "emit_claim_analysis",
      description: "Emit the structured claim analysis for a Hebrew legal question.",
      parameters: ANALYZER_TOOL_PARAMETERS,
    },
  });
  stage_runs.push({
    stage: "claim_analyzer.initial",
    model: initialModel,
    ms: Date.now() - t0,
    ok: !!first.data,
    http_status: first.http_status,
    http_error: first.http_error,
    parse_error: first.parse_error,
  });

  let validated = validateAnalyzer(first.data);
  const postReasons = analyzerEscalationReasons(validated.ok, validated.value);

  // Already on gpt-5 (pre-escalated) → no further retry.
  if (initialModel === MODEL_FULL) {
    return {
      result: validated,
      model_initial: initialModel,
      model_final: initialModel,
      escalated: false,
      escalation_reasons: preReasons,
      stage_runs,
      raw_text_initial: first.raw_text,
      raw_text_final: first.raw_text,
      transport_failed: !first.data && RETRYABLE_HTTP.has(first.http_status ?? 0),
      attempts_summary,
    };
  }

  if (postReasons.length === 0) {
    return {
      result: validated,
      model_initial: initialModel,
      model_final: initialModel,
      escalated: false,
      escalation_reasons: [],
      stage_runs,
      raw_text_initial: first.raw_text,
      raw_text_final: first.raw_text,
      transport_failed: false,
      attempts_summary,
    };
  }

  // Escalate to gpt-5. Up to 3 attempts. Retry ONLY on transport-class
  // failures (network throw, 408/429/5xx). A schema-invalid response from
  // the model is NOT a transport failure and is not retried.
  const callEscalation = () =>
    callOpenAIJsonTool<unknown>({
      model: MODEL_FULL,
      system: SYSTEM_PROMPT,
      user: userPrompt,
      tool: {
        name: "emit_claim_analysis",
        description: "Emit the structured claim analysis for a Hebrew legal question.",
        parameters: ANALYZER_TOOL_PARAMETERS,
      },
      reasoningEffort: "medium",
    });

  let last: { data: unknown; raw_text: string; http_status?: number; http_error?: string; parse_error?: string } | null = null;
  let allTransport = true;

  for (let i = 0; i < MAX_FULL_ATTEMPTS; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS[i - 1] ?? 3000));
    const tA = Date.now();
    let resp: Awaited<ReturnType<typeof callEscalation>> | null = null;
    let threw = false;
    try {
      resp = await callEscalation();
    } catch (_e) {
      threw = true;
    }
    const ms = Date.now() - tA;
    const status = resp?.http_status ?? 0;
    const gotData = !!resp?.data;
    const isTransport = threw || !resp || (!gotData && RETRYABLE_HTTP.has(status));

    const stageName =
      i === 0 ? "claim_analyzer.escalated" : `claim_analyzer.escalated_retry${i > 1 ? `_${i}` : ""}`;
    stage_runs.push({
      stage: stageName,
      model: MODEL_FULL,
      ms,
      ok: gotData,
      escalated: true,
      http_status: status,
      http_error: resp?.http_error,
      parse_error: resp?.parse_error,
      retry_skipped_reason: !gotData && !isTransport ? "non_retryable_response" : undefined,
    });
    attempts_summary.push({
      attempt: i + 1,
      ms,
      http_status: status,
      http_error: resp?.http_error,
      parse_error: resp?.parse_error,
      got_data: gotData,
    });

    if (resp) last = resp;
    if (gotData) {
      allTransport = false;
      break;
    }
    if (!isTransport) {
      // Real model response that failed (e.g. parse error of valid HTTP 200);
      // don't waste more attempts.
      allTransport = false;
      break;
    }
    // else: transport failure → loop continues if attempts remain.
  }

  validated = validateAnalyzer(last?.data);

  return {
    result: validated,
    model_initial: initialModel,
    model_final: MODEL_FULL,
    escalated: true,
    escalation_reasons: postReasons,
    stage_runs,
    raw_text_initial: first.raw_text,
    raw_text_final: last?.raw_text ?? "",
    transport_failed: !last?.data && allTransport,
    attempts_summary,
  };
}
