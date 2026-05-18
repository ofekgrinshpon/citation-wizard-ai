// Research V3 — Stage 1: LegalResearchPlan with expected_anchors.
//
// This stage runs BEFORE retrieval. It does NOT replace V2's existing
// ResearchPlan (claims + search_targets) — retrieval is still delegated to V2.
// Its single job in step 1 is to produce a structured list of `expected_anchors`
// (statutes, sections, leading cases, academic works) that a competent Israeli
// legal researcher would expect to see in a complete answer. The anchors are
// stamped into qa_logs.metadata as `v3_legal_research_plan` for telemetry and
// later (step 2+) will drive an exact-anchor retrieval track.
//
// Hallucination guard: the planner is explicitly told that omitting an anchor
// is preferable to inventing one. Caller treats null / empty as a soft signal
// (telemetry only) and does NOT block V2 retrieval.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";

export type V3AnchorType =
  | "statute_section"
  | "basic_law_section"
  | "regulation"
  | "leading_case"
  | "academic"
  | "committee_report";

export type V3Centrality = "seminal" | "supporting" | "background";

export interface V3ExpectedAnchor {
  /** Stable id A1..A8 for cross-referencing in telemetry. */
  id: string;
  type: V3AnchorType;
  /** Hebrew display name (e.g. "חוק העונשין, התשל\"ז–1977"). */
  name: string;
  /** Optional pinpoint ("סעיף 18", "סעיף 8"). */
  section?: string;
  /** Optional docket for cases ("בג\"ץ 6821/93"). */
  docket?: string;
  centrality: V3Centrality;
  /** One-sentence Hebrew explanation of why this anchor is expected. */
  rationale: string;
}

export interface LegalResearchPlanV3 {
  /** Short Hebrew framing of the legal issue (≤220 chars). */
  frame: string;
  expected_anchors: V3ExpectedAnchor[];
  /** Free-text planner notes — telemetry only. */
  notes?: string;
}

const TOOL: PlannerToolDef = {
  name: "submit_legal_research_plan_v3",
  description:
    "Identify the seminal / supporting authorities a competent Israeli legal researcher would expect to see in a complete answer to the question. Omitting an authority is strictly preferable to inventing one.",
  parameters: {
    type: "object",
    properties: {
      frame: {
        type: "string",
        description:
          "משפט אחד בעברית שמסגר את הסוגיה המשפטית (הדוקטרינה / התחום הרלוונטי). ≤220 תווים.",
      },
      expected_anchors: {
        type: "array",
        minItems: 2,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "A1, A2, … (≤4 תווים)." },
            type: {
              type: "string",
              enum: [
                "statute_section",
                "basic_law_section",
                "regulation",
                "leading_case",
                "academic",
                "committee_report",
              ],
            },
            name: {
              type: "string",
              description:
                'שם מלא בעברית: לחוק/תקנה — שם החוק כולל שנה; לפסיקה — סוג ההליך, מספר תיק, ושמות הצדדים; לאקדמיה — מחבר וכותרת.',
            },
            section: {
              type: "string",
              description: "אם רלוונטי: סעיף/תקנה/פרק.",
            },
            docket: {
              type: "string",
              description: 'אם פסיקה: מספר ההליך (למשל "בג\\"ץ 6821/93").',
            },
            centrality: {
              type: "string",
              enum: ["seminal", "supporting", "background"],
            },
            rationale: {
              type: "string",
              description: "משפט אחד בעברית: למה אסמכתא זו חיונית/רלוונטית.",
            },
          },
          required: ["id", "type", "name", "centrality", "rationale"],
          additionalProperties: false,
        },
      },
      notes: {
        type: "string",
        description: "הערות פנימיות קצרות. ≤300 תווים.",
      },
    },
    required: ["frame", "expected_anchors"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `אתה שלב LegalResearchPlan (V3) בצינור מחקר משפטי ישראלי.
המטרה: לזהות *מראש* את האסמכתאות הקנוניות שחוקר מיומן היה מצפה לראות בתשובה מלאה.

כללים מחייבים:
- כל אסמכתא חייבת להיות ישראלית (חוק, תקנה, חוק יסוד, פסיקה ישראלית, או ספרות אקדמית ישראלית).
- חוקים/תקנות — כתוב שם מדויק כולל שנה (למשל: 'חוק החוזים (חלק כללי), התשל"ג–1973'), והוסף section אם יש סעיף ספציפי רלוונטי לסוגיה.
- פסיקה — כתוב סוג הליך + מספר תיק + שמות צדדים מרכזיים.
- אקדמיה — מחבר + כותרת בלבד. אל תמציא כרך/עמוד/הוצאה.
- centrality:
    seminal     = אסמכתא שאי-אזכורה הוא פגם משמעותי בתשובה.
    supporting  = אסמכתא רגילה תומכת.
    background  = רקע/אוריינטציה בלבד (לרוב מכוני מחקר או אנציקלופדיות).
- rationale — משפט אחד שמסביר את התרומה של האסמכתא לסוגיה הקונקרטית.

איזון בין השמטה לכיסוי קנוני:
- אסור להמציא. אם אינך מכיר את האסמכתא — השמט.
- אבל: כאשר השאלה עוסקת בדוקטרינה ישראלית מוכרת היטב, חובה לכלול את פסקי הדין הקנוניים והסעיפים הסטטוטוריים שחוקר משפטי מיומן בישראל היה בודק כדבר ראשון. אל תשמיט אסמכתאות קנוניות רק מפני שאינך זוכר את כל פרטי הציטוט; כלול את השם/מספר התיק המוכר אם אתה בטוח בו, וסמן פרטים חסרים בשדה rationale.
- מנה לעצמך לפחות 4 אסמכתאות בכל שאלת דוקטרינה מרכזית: לפחות אסמכתא חוקית/חוקתית אחת + פסק דין מוביל אחד + פסק דין תומך אחד + ספרות אקדמית או פסק דין נוסף.

דוגמה (few-shot):

שאלה: "מהם המבחנים לפסילת חוק בלתי חוקתי?"
אסמכתאות צפויות:
- A1 basic_law_section: 'חוק-יסוד: כבוד האדם וחירותו', section: 'סעיף 8' (פסקת ההגבלה), centrality: seminal.
- A2 basic_law_section: 'חוק-יסוד: חופש העיסוק', section: 'סעיף 4' (פסקת ההגבלה המקבילה), centrality: seminal.
- A3 leading_case: 'ע"א 6821/93 בנק המזרחי המאוחד נ' מגדל', docket: 'ע"א 6821/93', centrality: seminal (מקור הביקורת השיפוטית בישראל).
- A4 leading_case: 'בג"ץ 1715/97 לשכת מנהלי ההשקעות בישראל נ' שר האוצר', docket: 'בג"ץ 1715/97', centrality: seminal (פיתוח מבחני המידתיות).
- A5 academic: 'אהרן ברק, מידתיות במשפט', centrality: supporting.

החזר JSON בלבד דרך הכלי submit_legal_research_plan_v3.`;

export interface BuildLegalResearchPlanV3Args {
  question: string;
  depth: "deep"; // V3 is Deep-only for now
  domainHint?: string;
}

export interface BuildLegalResearchPlanV3Result {
  plan: LegalResearchPlanV3 | null;
  run: StageRun;
  fallback_reason?: string;
}

export async function buildLegalResearchPlanV3(
  args: BuildLegalResearchPlanV3Args,
): Promise<BuildLegalResearchPlanV3Result> {
  const { question, domainHint } = args;
  const preamble = domainHint
    ? `הקשר תחומי (לא מחייב): ${domainHint.slice(0, 200)}\n\n`
    : "";
  const userPrompt = `${preamble}שאלת המחקר:\n${question}\n\nזהה את האסמכתאות הקנוניות הצפויות בתשובה מלאה. עקוב במדויק אחר סכימת הכלי. עדיף להשמיט אסמכתא מאשר להמציא.`;

  const { data, run } = await callPlannerJSON<LegalResearchPlanV3>(
    SYSTEM_PROMPT,
    userPrompt,
    TOOL,
    {
      stage: "legal_research_plan_v3",
      timeoutMs: 45000,
      reasoningEffort: "minimal",
    },
  );

  const plan = data ? sanitize(data) : null;
  if (plan && plan.expected_anchors.length >= 2) {
    return { plan, run };
  }
  const reason = !data
    ? (run.status === "timeout" ? "primary_timeout" : `primary_${run.status}`)
    : "insufficient_anchors";
  return { plan: null, run, fallback_reason: reason };
}

function sanitize(raw: LegalResearchPlanV3): LegalResearchPlanV3 | null {
  if (!raw || typeof raw.frame !== "string" || !Array.isArray(raw.expected_anchors)) {
    return null;
  }
  const VALID_TYPES: V3AnchorType[] = [
    "statute_section", "basic_law_section", "regulation",
    "leading_case", "academic", "committee_report",
  ];
  const VALID_CENT: V3Centrality[] = ["seminal", "supporting", "background"];
  const seen = new Set<string>();
  const anchors: V3ExpectedAnchor[] = [];
  for (const a of raw.expected_anchors) {
    if (!a || typeof a.id !== "string" || typeof a.name !== "string") continue;
    if (seen.has(a.id)) continue;
    if (!VALID_TYPES.includes(a.type as V3AnchorType)) continue;
    if (!VALID_CENT.includes(a.centrality as V3Centrality)) continue;
    seen.add(a.id);
    anchors.push({
      id: a.id.slice(0, 4),
      type: a.type as V3AnchorType,
      name: a.name.trim().slice(0, 280),
      ...(typeof a.section === "string" && a.section.trim()
        ? { section: a.section.trim().slice(0, 80) } : {}),
      ...(typeof a.docket === "string" && a.docket.trim()
        ? { docket: a.docket.trim().slice(0, 60) } : {}),
      centrality: a.centrality as V3Centrality,
      rationale: typeof a.rationale === "string" ? a.rationale.trim().slice(0, 260) : "",
    });
    if (anchors.length >= 8) break;
  }
  return {
    frame: raw.frame.trim().slice(0, 240),
    expected_anchors: anchors,
    ...(typeof raw.notes === "string" ? { notes: raw.notes.slice(0, 300) } : {}),
  };
}

export function summarizeLegalResearchPlanV3(
  plan: LegalResearchPlanV3 | null,
  run: StageRun,
) {
  const byCent = { seminal: 0, supporting: 0, background: 0 };
  const byType: Record<string, number> = {};
  if (plan) {
    for (const a of plan.expected_anchors) {
      byCent[a.centrality] = (byCent[a.centrality] ?? 0) + 1;
      byType[a.type] = (byType[a.type] ?? 0) + 1;
    }
  }
  return {
    used: !!plan,
    model: run.model,
    duration_ms: run.duration_ms,
    status: run.status,
    frame_chars: plan?.frame.length ?? 0,
    anchor_count: plan?.expected_anchors.length ?? 0,
    by_centrality: byCent,
    by_type: byType,
    anchor_ids: plan?.expected_anchors.map((a) => a.id) ?? [],
  };
}
