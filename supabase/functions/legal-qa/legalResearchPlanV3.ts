// Research V3 — Stage 1: LegalResearchPlan with expected_anchors.
//
// Step 2.3: planner also classifies the question's `doctrinal_frame` and a
// frame-gate sanitizer drops constitutional anchors that drift into
// non-constitutional questions UNLESS the planner provides a concrete
// `constitutional_relevance_reason`. Goal: prevent constitutional drift,
// not legitimate constitutional analysis.
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

export type V3DoctrinalFrame =
  | "constitutional"
  | "administrative"
  | "procedural_civil"
  | "procedural_admin"
  | "contract"
  | "criminal"
  | "tort"
  | "other";

export interface V3ExpectedAnchor {
  id: string;
  type: V3AnchorType;
  name: string;
  section?: string;
  docket?: string;
  centrality: V3Centrality;
  rationale: string;
  /** Required for constitutional anchors when frame !== "constitutional". */
  constitutional_relevance_reason?: string;
}

export interface FrameMismatchDrop {
  anchor_id: string;
  name: string;
  reason: string;
}

export interface LegalResearchPlanV3 {
  frame: string;
  doctrinal_frame: V3DoctrinalFrame;
  expected_anchors: V3ExpectedAnchor[];
  notes?: string;
  /** Sanitizer telemetry — anchors dropped by the constitutional frame gate. */
  frame_mismatch_dropped?: FrameMismatchDrop[];
  /** Anchors kept under non-constitutional frame because they carried a reason. */
  constitutional_anchors_kept_with_reason?: number;
  frame_gate_underflow?: boolean;
}

const TOOL: PlannerToolDef = {
  name: "submit_legal_research_plan_v3",
  description:
    "Classify the doctrinal frame of the question and identify the seminal / supporting authorities a competent Israeli legal researcher would expect to see. Omitting an authority is strictly preferable to inventing one. Constitutional anchors under a non-constitutional frame require an explicit constitutional_relevance_reason.",
  parameters: {
    type: "object",
    properties: {
      frame: {
        type: "string",
        description:
          "משפט אחד בעברית שמסגר את הסוגיה המשפטית (הדוקטרינה / התחום הרלוונטי). ≤220 תווים.",
      },
      doctrinal_frame: {
        type: "string",
        enum: [
          "constitutional",
          "administrative",
          "procedural_civil",
          "procedural_admin",
          "contract",
          "criminal",
          "tort",
          "other",
        ],
        description:
          "סיווג הסוגיה: constitutional (ביקורת חוקתית/חוקי יסוד/זכויות יסוד), administrative (משפט מינהלי מהותי), procedural_civil (סדר דין אזרחי), procedural_admin (סדרי דין מינהליים/עתירה מינהלית), contract (חוזים), criminal (פלילי), tort (נזיקין), other.",
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
            section: { type: "string", description: "אם רלוונטי: סעיף/תקנה/פרק." },
            docket: { type: "string", description: 'אם פסיקה: מספר ההליך (למשל "בג\\"ץ 6821/93").' },
            centrality: {
              type: "string",
              enum: ["seminal", "supporting", "background"],
            },
            rationale: {
              type: "string",
              description: "משפט אחד בעברית: למה אסמכתא זו חיונית/רלוונטית.",
            },
            constitutional_relevance_reason: {
              type: "string",
              description:
                "חובה כאשר doctrinal_frame אינו constitutional והאסמכתא היא חוקתית (חוק יסוד, פסקת הגבלה, בנק המזרחי, לשכת מנהלי ההשקעות, ברק 'מידתיות', עילת הסבירות וכו'). משפט אחד שמסביר *למה ספציפית* בסוגיה הזו נדרשת אסמכתא חוקתית (למשל: 'צו מניעה נגד פרסום פוגע בחופש הביטוי' / 'חובת המדינה להגן על חיים ושלמות הגוף לפי סעיפים 2 ו-4'). אסור משפטי בוילרפלייט כמו 'חשוב לנושא' או 'רלוונטי באופן כללי'. ≤200 תווים.",
            },
          },
          required: ["id", "type", "name", "centrality", "rationale"],
          additionalProperties: false,
        },
      },
      notes: { type: "string", description: "הערות פנימיות קצרות. ≤300 תווים." },
    },
    required: ["frame", "doctrinal_frame", "expected_anchors"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `אתה שלב LegalResearchPlan (V3) בצינור מחקר משפטי ישראלי.
המטרה: לזהות *מראש* את האסמכתאות הקנוניות שחוקר מיומן היה מצפה לראות בתשובה מלאה.

שלב 0 — סיווג מסגרת דוקטרינרית (doctrinal_frame):
- constitutional: ביקורת חוקתית, חוקי יסוד, פסקת ההגבלה, ביטול חקיקה, פגיעה בזכויות יסוד.
- administrative: משפט מינהלי מהותי (שיקול דעת, סבירות, מידתיות מינהלית).
- procedural_civil: סדר דין אזרחי (צו מניעה זמני, סמכות, סעדים זמניים).
- procedural_admin: עתירה מינהלית, מיצוי הליכים, סמכות בג"ץ/בית משפט מינהלי.
- contract: דיני חוזים (פרשנות, אכיפה, ביטול).
- criminal: פלילי.
- tort: נזיקין.
- other: אחר.

כללי אסמכתאות:
- כל אסמכתא חייבת להיות ישראלית (חוק, תקנה, חוק יסוד, פסיקה ישראלית, או ספרות אקדמית ישראלית).
- חוקים/תקנות — כתוב שם מדויק כולל שנה, והוסף section אם יש סעיף ספציפי רלוונטי.
- פסיקה — כתוב סוג הליך + מספר תיק + שמות צדדים מרכזיים.
- אקדמיה — מחבר + כותרת בלבד. אל תמציא כרך/עמוד/הוצאה.
- centrality: seminal / supporting / background.
- rationale — משפט אחד שמסביר את התרומה הקונקרטית של האסמכתא לסוגיה.

איזון בין השמטה לכיסוי קנוני:
- אסור להמציא. אם אינך מכיר את האסמכתא — השמט.
- אבל בדוקטרינה ישראלית מוכרת, כלול את האסמכתאות שחוקר מיומן היה בודק כדבר ראשון לפי המסגרת.
- חתור ל-4+ אסמכתאות בכל שאלת דוקטרינה מרכזית.

שער רלוונטיות חוקתית (קריטי!):
- אם doctrinal_frame === "constitutional" — אסמכתאות חוקתיות (חוקי יסוד, פסקת הגבלה, בנק המזרחי, לשכת מנהלי ההשקעות, ברק "מידתיות", עילת הסבירות וכו') *מותרות וצפויות*.
- אם doctrinal_frame אינו constitutional — אסמכתה חוקתית *מותרת רק* אם מתקיים אחד מאלה, וחובה לציין זאת בשדה constitutional_relevance_reason:
    (1) שאלת המשתמש מזכירה במפורש חוקי יסוד, זכויות חוקתיות, פסקת הגבלה, ביטול חקיקה או ביקורת שיפוטית על חקיקה;
    (2) תת-שאלה ספציפית כרוכה בפגיעה בזכות חוקתית מוגנת;
    (3) קיים נימוק דוקטרינרי קונקרטי שקושר את האסמכתא החוקתית *לסוגיה הזו* (למשל: חובת המדינה להגן על חיים/גוף/כבוד/רכוש לפי סעיפים 2,4; חופש הביטוי מול צו מניעה זמני).
- אם אינך יכול לכתוב constitutional_relevance_reason קונקרטי — אל תכלול את האסמכתא החוקתית. השמטה עדיפה על המצאה של נימוק.
- אסור משפטי בוילרפלייט ("חשוב לנושא", "רלוונטי באופן כללי", "מסגרת חוקתית כללית"). הנימוק חייב להיות צמוד לסוגיה.

דוגמאות מסגרת (few-shot):

(א) constitutional — שאלה: "מהם המבחנים לפסילת חוק בלתי חוקתי?"
doctrinal_frame: "constitutional".
- A1 basic_law_section 'חוק-יסוד: כבוד האדם וחירותו' section 'סעיף 8', seminal.
- A2 basic_law_section 'חוק-יסוד: חופש העיסוק' section 'סעיף 4', seminal.
- A3 leading_case 'ע"א 6821/93 בנק המזרחי המאוחד נ' מגדל', docket 'ע"א 6821/93', seminal.
- A4 leading_case 'בג"ץ 1715/97 לשכת מנהלי ההשקעות בישראל נ' שר האוצר', docket 'בג"ץ 1715/97', seminal.
- A5 academic 'אהרן ברק, מידתיות במשפט', supporting.

(ב) procedural_civil — שאלה: "מהם התנאים לצו מניעה זמני?"
doctrinal_frame: "procedural_civil".
- A1 regulation 'תקנות סדר הדין האזרחי, התשע"ט–2018' section 'תקנה 95', seminal.
- A2 statute_section 'חוק בתי המשפט [נוסח משולב], התשמ"ד–1984' section 'סעיף 75', seminal.
- A3 leading_case 'רע"א 4196/93 שפע בר ניהול ושירותים נ' שפע מסעדות', docket 'רע"א 4196/93', seminal.
- (אם התרחיש הוא צו מניעה נגד פרסום — מותר להוסיף:)
  A4 basic_law_section 'חוק-יסוד: כבוד האדם וחירותו' section 'סעיף 7' עם constitutional_relevance_reason="צו מניעה זמני נגד פרסום פוגע בחופש הביטוי המוגן כנגזרת מכבוד האדם".

(ג) contract — שאלה: "פרשנות חוזה לפי כוונת הצדדים — הלכת אפרופים."
doctrinal_frame: "contract".
- A1 leading_case 'ע"א 4628/93 מדינת ישראל נ' אפרופים שיכון ויזום', docket 'ע"א 4628/93', seminal.
- A2 leading_case 'ע"א 2825/97 מגדלי הירקות נ' מדינת ישראל', docket 'ע"א 2825/97', seminal.
- A3 statute_section 'חוק החוזים (חלק כללי), התשל"ג–1973' section 'סעיף 25', seminal.
- אין מקום לאסמכתאות חוקתיות.

(ד) procedural_admin — שאלה: "מתי דורש בית המשפט מיצוי הליכים לפני עתירה לבג"ץ?"
doctrinal_frame: "procedural_admin".
- A1 leading_case 'בג"ץ 991/91 פסטרנק נ' שר הבינוי והשיכון', docket 'בג"ץ 991/91', seminal.
- A2 statute_section 'חוק בתי משפט לעניינים מינהליים, התש"ס–2000', seminal.
- A3 academic 'יצחק זמיר, הסמכות המינהלית', supporting.
- אסור לכלול את בנק המזרחי או פסקת הגבלה אלא אם העתירה עצמה תוקפת חקיקה.

(ה) administrative עם רלוונטיות חוקתית מוצדקת — שאלה: "אחריות המדינה לאי-מניעת פשיעה (דמי חסות)."
doctrinal_frame: "administrative" (או tort, לפי הניסוח).
- A1 basic_law_section 'חוק-יסוד: כבוד האדם וחירותו' section 'סעיפים 2 ו-4' עם constitutional_relevance_reason="החובה החיובית של המדינה להגן על חיים, שלמות הגוף, הכבוד והקניין נגזרת ישירות מסעיפים 2 ו-4".
- A2-A4 פסיקה/חקיקה רלוונטית מינהלית/נזיקית.

החזר JSON בלבד דרך הכלי submit_legal_research_plan_v3.`;

export interface BuildLegalResearchPlanV3Args {
  question: string;
  depth: "deep";
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
  const userPrompt = `${preamble}שאלת המחקר:\n${question}\n\nסווג doctrinal_frame תחילה, ואז זהה את האסמכתאות הקנוניות. הקפד על שער הרלוונטיות החוקתית. עדיף להשמיט אסמכתא מאשר להמציא נימוק.`;

  const { data, run } = await callPlannerJSON<LegalResearchPlanV3>(
    SYSTEM_PROMPT,
    userPrompt,
    TOOL,
    {
      stage: "legal_research_plan_v3",
      timeoutMs: 75000,
      reasoningEffort: "minimal",
    },
  );

  const plan = data ? sanitize(data) : null;
  if (plan && plan.expected_anchors.length >= 2) {
    return { plan, run };
  }
  // Allow plan-with-underflow to surface (frame gate may legitimately drop anchors).
  if (plan && plan.expected_anchors.length >= 1 && plan.frame_gate_underflow) {
    return { plan, run };
  }
  const reason = !data
    ? (run.status === "timeout" ? "primary_timeout" : `primary_${run.status}`)
    : "insufficient_anchors";
  return { plan: null, run, fallback_reason: reason };
}

// ── Constitutional canon detection ─────────────────────────────────────
const CONSTITUTIONAL_NAME_RE = new RegExp(
  [
    "חוק[- ]?יסוד",          // any Basic Law
    "בנק\\s+המזרחי",         // Bank Mizrahi
    "לשכת\\s+מנהלי\\s+ההשקעות",
    "פסקת\\s+ה?הגבלה",
    "מידתיות\\s+במשפט",      // Barak — Proportionality
    "ברק.*מידתיות",
    "עילת\\s+ה?סבירות",
    "בג\"?ץ\\s*5658/23",     // עתירה לביטול חוק יסוד עילת הסבירות
  ].join("|"),
);

function isConstitutionalAnchor(a: V3ExpectedAnchor): boolean {
  if (a.type === "basic_law_section") return true;
  return CONSTITUTIONAL_NAME_RE.test(a.name || "");
}

const BOILERPLATE_REASONS = [
  "חשוב לנושא",
  "רלוונטי באופן כללי",
  "רלוונטי לנושא",
  "מסגרת חוקתית כללית",
  "חשוב",
  "רלוונטי",
  "כללי",
];

function isReasonAcceptable(reason: string | undefined): boolean {
  if (!reason) return false;
  const t = reason.trim();
  if (t.length < 15) return false;
  const lower = t.toLowerCase();
  for (const bp of BOILERPLATE_REASONS) {
    if (lower === bp.toLowerCase() || lower === bp.toLowerCase() + ".") return false;
  }
  return true;
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
  const VALID_FRAMES: V3DoctrinalFrame[] = [
    "constitutional", "administrative", "procedural_civil", "procedural_admin",
    "contract", "criminal", "tort", "other",
  ];

  const doctrinal_frame: V3DoctrinalFrame = VALID_FRAMES.includes(
    raw.doctrinal_frame as V3DoctrinalFrame,
  )
    ? (raw.doctrinal_frame as V3DoctrinalFrame)
    : "other";

  const seen = new Set<string>();
  const preGate: V3ExpectedAnchor[] = [];
  for (const a of raw.expected_anchors) {
    if (!a || typeof a.id !== "string" || typeof a.name !== "string") continue;
    if (seen.has(a.id)) continue;
    if (!VALID_TYPES.includes(a.type as V3AnchorType)) continue;
    if (!VALID_CENT.includes(a.centrality as V3Centrality)) continue;
    seen.add(a.id);
    preGate.push({
      id: a.id.slice(0, 4),
      type: a.type as V3AnchorType,
      name: a.name.trim().slice(0, 280),
      ...(typeof a.section === "string" && a.section.trim()
        ? { section: a.section.trim().slice(0, 80) } : {}),
      ...(typeof a.docket === "string" && a.docket.trim()
        ? { docket: a.docket.trim().slice(0, 60) } : {}),
      centrality: a.centrality as V3Centrality,
      rationale: typeof a.rationale === "string" ? a.rationale.trim().slice(0, 260) : "",
      ...(typeof a.constitutional_relevance_reason === "string"
        && a.constitutional_relevance_reason.trim()
        ? { constitutional_relevance_reason: a.constitutional_relevance_reason.trim().slice(0, 200) }
        : {}),
    });
    if (preGate.length >= 8) break;
  }

  // ── Frame gate ──────────────────────────────────────────────────────
  const dropped: FrameMismatchDrop[] = [];
  let keptWithReason = 0;
  const anchors: V3ExpectedAnchor[] = [];
  for (const a of preGate) {
    if (doctrinal_frame === "constitutional" || !isConstitutionalAnchor(a)) {
      anchors.push(a);
      continue;
    }
    // Non-constitutional frame + constitutional anchor → require reason.
    if (isReasonAcceptable(a.constitutional_relevance_reason)) {
      keptWithReason += 1;
      anchors.push(a);
    } else {
      dropped.push({
        anchor_id: a.id,
        name: a.name,
        reason: a.constitutional_relevance_reason
          ? "boilerplate_or_too_short"
          : "missing_constitutional_relevance_reason",
      });
    }
  }

  const frame_gate_underflow = anchors.length < 2 && preGate.length >= 2;

  return {
    frame: raw.frame.trim().slice(0, 240),
    doctrinal_frame,
    expected_anchors: anchors,
    ...(typeof raw.notes === "string" ? { notes: raw.notes.slice(0, 300) } : {}),
    frame_mismatch_dropped: dropped,
    constitutional_anchors_kept_with_reason: keptWithReason,
    ...(frame_gate_underflow ? { frame_gate_underflow: true } : {}),
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
  const dropped = plan?.frame_mismatch_dropped ?? [];
  return {
    used: !!plan,
    model: run.model,
    duration_ms: run.duration_ms,
    status: run.status,
    frame_chars: plan?.frame.length ?? 0,
    doctrinal_frame: plan?.doctrinal_frame ?? null,
    anchor_count: plan?.expected_anchors.length ?? 0,
    by_centrality: byCent,
    by_type: byType,
    anchor_ids: plan?.expected_anchors.map((a) => a.id) ?? [],
    frame_mismatch_dropped: dropped,
    frame_mismatch_dropped_count: dropped.length,
    constitutional_anchors_kept_with_reason:
      plan?.constitutional_anchors_kept_with_reason ?? 0,
    ...(plan?.frame_gate_underflow ? { frame_gate_underflow: true } : {}),
  };
}
