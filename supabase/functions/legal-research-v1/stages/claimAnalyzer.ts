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

  // Escalate once to gpt-5.
  const t1 = Date.now();
  const retry = await callOpenAIJsonTool<unknown>({
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
  stage_runs.push({
    stage: "claim_analyzer.escalated",
    model: MODEL_FULL,
    ms: Date.now() - t1,
    ok: !!retry.data,
    escalated: true,
  });
  validated = validateAnalyzer(retry.data);

  return {
    result: validated,
    model_initial: initialModel,
    model_final: MODEL_FULL,
    escalated: true,
    escalation_reasons: postReasons,
    stage_runs,
    raw_text_initial: first.raw_text,
    raw_text_final: retry.raw_text,
  };
}
