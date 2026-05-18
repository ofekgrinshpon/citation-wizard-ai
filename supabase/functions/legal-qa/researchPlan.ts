// Research V2 — Stage 1: ResearchPlan
//
// One strong reasoning call that replaces the old chain of
// router → decomposition → legalResearchPlanner → issueMap → candidateClaims.
//
// Output: a thesis, 4–8 candidate claims, optional counter-claims, with
// per-claim search targets that downstream per-claim retrieval consumes
// directly.
//
// Gated by env `RESEARCH_V2=true`. Not wired into index.ts in this commit —
// new modules are additive and validated in isolation first.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";

export type V2ClaimKind = "doctrinal" | "procedural" | "empirical" | "normative";

export type V2EvidenceType =
  | "statute"
  | "case"
  | "academic"
  | "committee"
  | "news";

export interface V2Claim {
  /** Stable id C1..C8. */
  id: string;
  /** Single Hebrew sentence stating the claim hypothesis. */
  statement: string;
  kind: V2ClaimKind;
  /** Evidence types the claim needs to be considered supported. */
  required_evidence: V2EvidenceType[];
  /** 2–4 specific Hebrew search queries that would surface direct support. */
  search_targets: string[];
  /** Template hedge wording when verification returns partial_support only. */
  hedge_if_partial: string;
}

export interface V2CounterClaim {
  /** Stable id CC1..CC4. */
  id: string;
  statement: string;
  search_targets: string[];
}

export interface ResearchPlan {
  thesis: string;
  claims: V2Claim[];
  counter_claims: V2CounterClaim[];
  /** Free-text planner notes — telemetry only. */
  notes?: string;
}

const TOOL: PlannerToolDef = {
  name: "submit_research_plan",
  description:
    "Produce a single research plan: thesis, 4–8 candidate claim hypotheses, optional counter-claims, with per-claim search targets and required evidence types.",
  parameters: {
    type: "object",
    properties: {
      thesis: {
        type: "string",
        description:
          "משפט תזה אחד שמתאר את העמדה המרכזית שהתשובה צריכה להוכיח או לדחות. עברית, ≤220 תווים.",
      },
      claims: {
        type: "array",
        minItems: 4,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "C1, C2, … (≤4 תווים)." },
            statement: {
              type: "string",
              description: "משפט אחד בעברית שמנסח השערה ניתנת לאימות.",
            },
            kind: {
              type: "string",
              enum: ["doctrinal", "procedural", "empirical", "normative"],
            },
            required_evidence: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              items: {
                type: "string",
                enum: ["statute", "case", "academic", "committee", "news"],
              },
            },
            search_targets: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "string",
                description:
                  "שאילתת חיפוש עברית ספציפית: שמות צדדים, מספרי תיק, סעיפי חוק, מונחים דוקטרינריים. הימנע משאילתות כלליות.",
              },
            },
            hedge_if_partial: {
              type: "string",
              description:
                "תבנית ניסוח מסויג אם רק partial_support נמצא (למשל 'עמדה מקובלת היא ש...', 'נטען בספרות כי...').",
            },
          },
          required: [
            "id",
            "statement",
            "kind",
            "required_evidence",
            "search_targets",
            "hedge_if_partial",
          ],
          additionalProperties: false,
        },
      },
      counter_claims: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "CC1, CC2, … (≤5 תווים)." },
            statement: { type: "string" },
            search_targets: {
              type: "array",
              minItems: 1,
              maxItems: 3,
              items: { type: "string" },
            },
          },
          required: ["id", "statement", "search_targets"],
          additionalProperties: false,
        },
      },
      notes: {
        type: "string",
        description: "הערות פנימיות קצרות — לא לתשובה למשתמש.",
      },
    },
    required: ["thesis", "claims"],
    additionalProperties: false,
  },
};

const SYSTEM_PROMPT = `אתה שלב ResearchPlan בצינור מחקר משפטי ישראלי.
המטרה: ייצור מסמך תכנון *יחיד* שמחליף את שלבי הניתוב/הפירוק/מפת-הסוגיה/מועמדי-הטענות הקודמים.

תוצר:
1. **thesis** — משפט אחד שמתאר את הטענה המרכזית של התשובה.
2. **claims** — 4–8 השערות (לא עובדות) שצריך לאמת כדי לבסס את התזה.
3. **counter_claims** — עד 4 השערות-נגד שיש לבחון. אם הן יאומתו, הן יוצגו בתשובה כעמדה מתחרה.

כללים קריטיים:
- כל claim הוא משפט אחד, ממוקד, ניתן לאימות. לא קונגלומרט.
- search_targets חייבים להיות ספציפיים: שמות צדדים, מספרי תיק, סעיפי חוק, מונחים דוקטרינריים. אל תכתוב שאילתות כלליות כמו "אקטיביזם שיפוטי" — חייב להיות צירוף ספציפי לסוגיה (למשל "אקטיביזם שיפוטי נחמני עוברים מוקפאים").
- required_evidence מציין איזה סוג מקור יוכל לתמוך בטענה. אל תבקש "academic" עבור טענה דוקטרינרית שמוכרעת בפסיקה.
- hedge_if_partial הוא תבנית ניסוח שתופיע *רק* אם השלב הבא יחזיר partial_support בלבד. השאר קצר ופונקציונלי.
- אסור להמציא מקורות, ציטוטים, או שמות פסקי דין שאינך בטוח בהם. תכנון בלבד, לא הוכחה.

החזר JSON בלבד דרך הכלי submit_research_plan.`;

export interface BuildResearchPlanArgs {
  question: string;
  depth: "fast" | "deep";
  /** Optional short hint from upstream routing (domain / target statute). */
  domainHint?: string;
}

export interface BuildResearchPlanResult {
  plan: ResearchPlan | null;
  run: StageRun;
}

/**
 * Build the V2 ResearchPlan. Fast → minimal reasoning_effort, ~25s budget.
 * Deep → low reasoning_effort, ~45s budget. Returns plan=null on any
 * failure; caller must fall back to legacy planning chain.
 */
export async function buildResearchPlan(
  args: BuildResearchPlanArgs,
): Promise<BuildResearchPlanResult> {
  const { question, depth, domainHint } = args;

  const preamble = domainHint
    ? `הקשר תחומי (לא מחייב): ${domainHint.slice(0, 200)}\n\n`
    : "";
  const userPrompt = `${preamble}שאלת המחקר:\n${question}\n\nהפק תכנית מחקר בודדת. עקוב במדויק אחר הסכימה של הכלי.`;

  const { data, run } = await callPlannerJSON<ResearchPlan>(
    SYSTEM_PROMPT,
    userPrompt,
    TOOL,
    {
      // claim_map stage name → routes to mini-class model in aiProvider.
      // ResearchPlan is roughly the same complexity (single-shot JSON tool-call).
      stage: "research_plan_v2",
      timeoutMs: depth === "deep" ? 45000 : 25000,
      reasoningEffort: depth === "deep" ? "low" : "minimal",
    },
  );

  if (!data) return { plan: null, run };

  const plan = sanitizePlan(data);
  if (!plan || plan.claims.length < 2) {
    return {
      plan: null,
      run: {
        ...run,
        status: "parse_error",
        error_message: "fewer than 2 valid claims after sanitization",
      },
    };
  }
  return { plan, run };
}

function sanitizePlan(raw: ResearchPlan): ResearchPlan | null {
  if (!raw || typeof raw.thesis !== "string" || !Array.isArray(raw.claims)) {
    return null;
  }
  const seen = new Set<string>();
  const claims: V2Claim[] = [];
  for (const c of raw.claims) {
    if (!c || typeof c.id !== "string" || typeof c.statement !== "string") continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const kind: V2ClaimKind = ["doctrinal", "procedural", "empirical", "normative"].includes(
      c.kind as string,
    )
      ? (c.kind as V2ClaimKind)
      : "doctrinal";
    claims.push({
      id: c.id.slice(0, 4),
      statement: c.statement.trim().slice(0, 360),
      kind,
      required_evidence: Array.isArray(c.required_evidence)
        ? (c.required_evidence
            .filter((e) =>
              ["statute", "case", "academic", "committee", "news"].includes(e as string),
            )
            .slice(0, 4) as V2EvidenceType[])
        : [],
      search_targets: Array.isArray(c.search_targets)
        ? c.search_targets
            .filter((q): q is string => typeof q === "string" && q.trim().length > 1)
            .slice(0, 4)
            .map((q) => q.trim().slice(0, 200))
        : [],
      hedge_if_partial:
        typeof c.hedge_if_partial === "string"
          ? c.hedge_if_partial.trim().slice(0, 200)
          : "עמדה מקובלת היא ש...",
    });
    if (claims.length >= 8) break;
  }
  const counter_claims: V2CounterClaim[] = Array.isArray(raw.counter_claims)
    ? raw.counter_claims
        .filter((c) => c && typeof c.id === "string" && typeof c.statement === "string")
        .slice(0, 4)
        .map((c) => ({
          id: c.id.slice(0, 5),
          statement: c.statement.trim().slice(0, 360),
          search_targets: Array.isArray(c.search_targets)
            ? c.search_targets
                .filter((q): q is string => typeof q === "string" && q.trim().length > 1)
                .slice(0, 3)
                .map((q) => q.trim().slice(0, 200))
            : [],
        }))
    : [];

  return {
    thesis: raw.thesis.trim().slice(0, 280),
    claims,
    counter_claims,
    ...(typeof raw.notes === "string" ? { notes: raw.notes.slice(0, 400) } : {}),
  };
}

/** Telemetry summary for qa_logs.metadata.research_plan. */
export function summarizeResearchPlan(plan: ResearchPlan | null, run: StageRun) {
  return {
    used: !!plan,
    model: run.model,
    duration_ms: run.duration_ms,
    status: run.status,
    thesis_chars: plan?.thesis.length ?? 0,
    claim_count: plan?.claims.length ?? 0,
    counter_count: plan?.counter_claims.length ?? 0,
  };
}
