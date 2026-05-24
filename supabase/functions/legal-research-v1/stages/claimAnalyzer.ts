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
}

export async function runClaimAnalyzer(question: string): Promise<AnalyzerStageResult> {
  const preReasons = shouldPreEscalateAnalyzer(question);
  const initialModel = preReasons.length > 0 ? MODEL_FULL : MODEL_MINI;

  const stage_runs: StageRun[] = [];
  const t0 = Date.now();
  const first = await callOpenAIJsonTool<unknown>({
    model: initialModel,
    system: SYSTEM_PROMPT,
    user: question,
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
    };
  }

  // Escalate to gpt-5. Attempt 1; if it looks like a transient transport
  // failure (threw, or returned no data in <2s), retry once after 800ms.
  // A real schema-invalid response from the model is NOT retried.
  const TRANSIENT_MS = 2000;
  const RETRY_DELAY_MS = 800;

  const callEscalation = () =>
    callOpenAIJsonTool<unknown>({
      model: MODEL_FULL,
      system: SYSTEM_PROMPT,
      user: question,
      tool: {
        name: "emit_claim_analysis",
        description: "Emit the structured claim analysis for a Hebrew legal question.",
        parameters: ANALYZER_TOOL_PARAMETERS,
      },
      reasoningEffort: "medium",
    });

  const t1 = Date.now();
  let retry: { data: unknown; raw_text: string } | null = null;
  let attempt1Threw = false;
  try {
    retry = await callEscalation();
  } catch (_e) {
    attempt1Threw = true;
  }
  const attempt1Ms = Date.now() - t1;
  stage_runs.push({
    stage: "claim_analyzer.escalated",
    model: MODEL_FULL,
    ms: attempt1Ms,
    ok: !!retry?.data,
    escalated: true,
  });

  const attempt1Transient =
    !retry?.data && (attempt1Threw || attempt1Ms < TRANSIENT_MS);

  if (attempt1Transient) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    const t2 = Date.now();
    let retry2: { data: unknown; raw_text: string } | null = null;
    try {
      retry2 = await callEscalation();
    } catch (_e) {
      retry2 = null;
    }
    stage_runs.push({
      stage: "claim_analyzer.escalated_retry",
      model: MODEL_FULL,
      ms: Date.now() - t2,
      ok: !!retry2?.data,
      escalated: true,
    });
    if (retry2) retry = retry2;
  }

  validated = validateAnalyzer(retry?.data);

  return {
    result: validated,
    model_initial: initialModel,
    model_final: MODEL_FULL,
    escalated: true,
    escalation_reasons: postReasons,
    stage_runs,
    raw_text_initial: first.raw_text,
    raw_text_final: retry?.raw_text ?? "",
  };
}
