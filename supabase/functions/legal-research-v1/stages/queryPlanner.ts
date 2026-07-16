// Research Query Planner — Stage 2 of legal-research-v1.

import { callOpenAIJsonTool } from "../lib/openai.ts";
import {
  PLANNER_TOOL_PARAMETERS,
  validatePlanner,
  ValidationResult,
} from "../lib/schemas.ts";
import { plannerEscalationReasons } from "../lib/escalation.ts";
import {
  AnalyzerOutput,
  MODEL_FULL,
  MODEL_MINI,
  PlannerOutput,
  Query,
  StageRun,
} from "../lib/types.ts";


const SYSTEM_PROMPT = `אתה מתכנן שאילתות מחקר משפטי. הקלט: ניתוח טענות (claims) של שאלה משפטית בעברית.
המטרה: ליצור שאילתות חיפוש קונקרטיות בעברית עבור כל טענה וכל תפקיד מקור נדרש.

לכל שאילתה ציין:
- claim_id: חייב להתאים ל־claim_id קיים מהניתוח
- role: תפקיד המקור (אחד מ: primary_statute, regulation, binding_case_law, persuasive_case_law, scholarship, factual_report, government_report)
- query_he: שאילתת חיפוש קונקרטית בעברית, לא טרמינולוגיה גנרית בודדת
- targets: ["local_db"] או ["perplexity"] או שניהם — בחר באופן מושכל, אל תכלול שניהם בכל מקרה
- expected_source_type: statute | regulation | case | academic | report | other
- reason: למה השאילתה הזו

כללי שאילתות:
- היו ספציפיים. אל תשתמשו במונח גנרי בודד כמו "סבירות" או "חוזים" לבד.
- לחוקים: כללו את שם החוק והסעיף אם ניתן להסיק. דוגמה: "חוק החוזים (תרופות) סעיף 15 פיצויים מוסכמים".
- לפסיקה מחייבת: כללו "בית המשפט העליון", "בג""ץ", "רע""א", "ע""א" כשרלוונטי.
- לאקדמיה: כללו "מאמר", שם כתב עת, או שם מחבר אם רלוונטי וידוע.
- לשאלות עובדתיות/דו"חות: כללו "ועדה", "הכנסת", "משרד", "דו""ח" וכד'.
- targets: local_db טוב למקור מוכר בתאגיד שלנו; perplexity טוב לרעננות/אינטרנט פתוח; שניהם רק כשבאמת צריך כיסוי רחב.
- אל תייצרו יותר מ־4 שאילתות לאותה claim_id.
- ייצרו לפחות שאילתה אחת לכל claim.

כללי תיוג role (קריטי):
- אם השאלה המקורית מזכירה "סעיף X לחוק Y" — חובה לייצר שאילתת primary_statute שמכילה גם את שם החוק וגם את מספר הסעיף (לדוגמה: "סעיף 15 חוק החוזים תרופות פיצוי מוסכם"). אסור להחליף את שם החוק או להשמיט את מספר הסעיף.
- אם השאילתה מחפשת חוק, סעיף חוק, או PDF רשמי של חקיקה (גם אם הוא מתפרסם באתר knesset.gov.il או fs.knesset.gov.il) — role חייב להיות primary_statute, ולעולם לא scholarship.
- אם השאילתה מחפשת תקנות — role חייב להיות regulation, ולעולם לא scholarship.
- scholarship מיועד אך ורק למאמרים אקדמיים, ספרים, או פרקים אקדמיים. אסור לסווג PDF רשמי של חוק או הצעת חוק כ־scholarship.
- אם השאילתה מחפשת פסק דין או החלטה שיפוטית — role חייב להיות binding_case_law (עליון/בג"ץ) או persuasive_case_law (מחוזי/שלום), ולעולם לא factual_report ולא scholarship.
- factual_report ו־government_report מיועדים לדו"חות ולא לחוקים או פסקי דין.
- expected_source_type חייב להתאים ל־role: statute/regulation עבור חקיקה ותקנות, case עבור פסיקה, academic עבור scholarship, report עבור דו"חות.

כללי דיסאמביגואציה (interpretation_note):
- אם הניתוח כולל interpretation_note שמסמן פרשנות "פקודה מתקופת המנדט הבריטי" / "Mandate-era ordinance" / המשך תחולת חקיקה מנדטורית — חובה לייצר לפחות שאילתה אחת שמכילה במפורש מונחים מההקשר ההיסטורי/המשכיותי, לדוגמה: "המנדט הבריטי", "נוסח חדש", "Income Tax Ordinance 1947", "המשך תחולת חקיקה מנדטורית", "סעיף 11 לפקודת סדרי השלטון והמשפט", או "פקודת מס הכנסה [נוסח חדש] תשכ\"א-1961". אל תסתפק בשאילתות שמחפשות תקנות עזר או הוראות מינהליות בלבד.

החזר את התוצאה רק דרך הקריאה לכלי emit_research_queries.`;


export interface PlannerStageResult {
  result: ValidationResult<PlannerOutput>;
  model_initial: string;
  model_final: string;
  escalated: boolean;
  escalation_reasons: string[];
  stage_runs: StageRun[];
  raw_text_initial: string;
  raw_text_final: string;
}


function plannerUserMessage(analyzer: AnalyzerOutput, question: string): string {
  const payload: Record<string, unknown> = {
    question_he: question,
    legal_area: analyzer.legal_area,
    answer_type: analyzer.answer_type,
    claims: analyzer.claims.map((c) => ({
      claim_id: c.claim_id,
      text_he: c.text_he,
      required_roles: c.required_roles,
      is_black_letter: c.is_black_letter,
    })),
  };
  if (analyzer.interpretation_note) {
    payload.interpretation_note = analyzer.interpretation_note;
  }
  return `ניתוח הטענות:\n${JSON.stringify(payload, null, 2)}\n\nצור שאילתות מחקר.`;
}


export async function runQueryPlanner(
  question: string,
  analyzer: AnalyzerOutput,
): Promise<PlannerStageResult> {
  const knownClaimIds = analyzer.claims.map((c) => c.claim_id);
  const userMsg = plannerUserMessage(analyzer, question);

  const stage_runs: StageRun[] = [];

  const t0 = Date.now();

  const first = await callOpenAIJsonTool<unknown>({
    model: MODEL_MINI,
    system: SYSTEM_PROMPT,
    user: userMsg,
    tool: {
      name: "emit_research_queries",
      description: "Emit concrete Hebrew research queries per claim and source role.",
      parameters: PLANNER_TOOL_PARAMETERS,
    },
  });
  stage_runs.push({
    stage: "query_planner.initial",
    model: MODEL_MINI,
    ms: Date.now() - t0,
    ok: !!first.data,
  });

  let validated = validatePlanner(first.data, knownClaimIds);
  const reasons = plannerEscalationReasons(validated.ok, validated.value, analyzer);

  if (reasons.length === 0) {
    return {
      result: validated,
      model_initial: MODEL_MINI,
      model_final: MODEL_MINI,
      escalated: false,
      escalation_reasons: [],
      stage_runs,
      raw_text_initial: first.raw_text,
      raw_text_final: first.raw_text,
    };
  }

  // Escalate once.
  const t1 = Date.now();
  const retry = await callOpenAIJsonTool<unknown>({
    model: MODEL_FULL,
    system: SYSTEM_PROMPT,
    user: userMsg,
    tool: {
      name: "emit_research_queries",
      description: "Emit concrete Hebrew research queries per claim and source role.",
      parameters: PLANNER_TOOL_PARAMETERS,
    },
    reasoningEffort: "medium",
  });
  stage_runs.push({
    stage: "query_planner.escalated",
    model: MODEL_FULL,
    ms: Date.now() - t1,
    ok: !!retry.data,
    escalated: true,
  });
  validated = validatePlanner(retry.data, knownClaimIds);

  return {
    result: validated,
    model_initial: MODEL_MINI,
    model_final: MODEL_FULL,
    escalated: true,
    escalation_reasons: reasons,
    stage_runs,
    raw_text_initial: first.raw_text,
    raw_text_final: retry.raw_text,
  };
}


