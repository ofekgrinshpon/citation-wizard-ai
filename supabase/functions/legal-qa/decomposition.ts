// Schemas + prompts for Stage A+B (decomposition + query plan)
// and Stage D (claim map) of the upgraded Legal Research pipeline.
//
// All inputs/outputs in this module are INTERNAL ONLY — never serialized
// to the user-facing response. They are recorded in `qa_logs.metadata`
// for admin diagnostics.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";

// ────────────────────────────────────────────────────────────────
// Stage A+B: Decomposition + Query Plan (single planner call)
// ────────────────────────────────────────────────────────────────

export interface Decomposition {
  main_issue: string;
  sub_issues: string[];
  question_type:
    | "doctrinal"
    | "procedural"
    | "factual_legal"
    | "comparative"
    | "policy"
    | "mixed";
  requires_legislation: boolean;
  requires_caselaw: boolean;
  requires_secondary_sources: boolean;
  jurisdiction: "israel";
}

export interface SubIssueQueryPlan {
  sub_issue: string;
  legislation_query?: string;
  caselaw_query?: string;
  literature_query?: string;
  external_query?: string;
}

export interface DecomposedPlan {
  decomposition: Decomposition;
  query_plan: SubIssueQueryPlan[];
}

const DECOMP_PLAN_TOOL: PlannerToolDef = {
  name: "submit_decomposed_plan",
  description:
    "Decompose the legal research question into sub-issues and produce per-sub-issue retrieval queries.",
  parameters: {
    type: "object",
    properties: {
      decomposition: {
        type: "object",
        properties: {
          main_issue: { type: "string", description: "תיאור קצר של הסוגיה המשפטית המרכזית" },
          sub_issues: {
            type: "array",
            description: "2–5 תת-סוגיות עצמאיות שניתן לחקור בנפרד",
            items: { type: "string" },
            minItems: 2,
            maxItems: 5,
          },
          question_type: {
            type: "string",
            enum: ["doctrinal", "procedural", "factual_legal", "comparative", "policy", "mixed"],
          },
          requires_legislation: { type: "boolean" },
          requires_caselaw: { type: "boolean" },
          requires_secondary_sources: { type: "boolean" },
          jurisdiction: { type: "string", enum: ["israel"] },
        },
        required: [
          "main_issue",
          "sub_issues",
          "question_type",
          "requires_legislation",
          "requires_caselaw",
          "requires_secondary_sources",
          "jurisdiction",
        ],
        additionalProperties: false,
      },
      query_plan: {
        type: "array",
        description: "תוכנית אחזור לכל תת-סוגיה. השאילתות בעברית, קצרות וממוקדות.",
        items: {
          type: "object",
          properties: {
            sub_issue: { type: "string" },
            legislation_query: {
              type: "string",
              description: "שאילתה לאחזור חקיקה (חוקים, פקודות, תקנות) — דלג אם לא רלוונטי",
            },
            caselaw_query: {
              type: "string",
              description: "שאילתה לאחזור פסיקה — דלג אם לא רלוונטי",
            },
            literature_query: {
              type: "string",
              description: "שאילתה לאחזור ספרות אקדמית — דלג אם לא רלוונטי",
            },
            external_query: {
              type: "string",
              description: "שאילתה לחיפוש חיצוני (Perplexity) — דלג אם לא רלוונטי",
            },
          },
          required: ["sub_issue"],
          additionalProperties: false,
        },
      },
    },
    required: ["decomposition", "query_plan"],
    additionalProperties: false,
  },
};

const DECOMP_SYSTEM_PROMPT = `אתה אנליסט משפטי. תפקידך לפרק שאלת מחקר משפטית ישראלית לתת-סוגיות ולהפיק תוכנית אחזור.

הנחיות:
- 2–5 תת-סוגיות עצמאיות. כל אחת היבט משפטי שניתן לחקור בנפרד (למשל: מקור הסמכות, מעמד נורמטיבי, פסיקה רלוונטית, אילוצים מנהליים, אילוצים חוקתיים).
- question_type: doctrinal=שאלה דוקטרינרית, procedural=פרוצדורלית, factual_legal=שילוב עובדה ומשפט, comparative=השוואתית, policy=מדיניות, mixed=שילוב.
- requires_legislation/caselaw/secondary_sources: סמן true רק אם נדרש באופן מהותי.
- שאילתות אחזור: עברית, קצרות וממוקדות (4–10 מילים), ניתנות לשימוש כקלט לחיפוש מקומי או Perplexity. דלג על שדה אם אינו רלוונטי לתת-הסוגיה.
- jurisdiction: תמיד "israel".

החזר JSON בלבד דרך הכלי submit_decomposed_plan.`;

/**
 * Stage A+B: One planner call that returns both decomposition and per-sub-issue query plan.
 * Returns `{ data, run }`. `data` is null on any failure → caller must fall back to
 * legacy retrieval path. `run` carries full telemetry (status, duration, model used).
 */
export async function decomposeAndPlan(
  question: string,
): Promise<{ data: DecomposedPlan | null; run: StageRun; retryRun?: StageRun }> {
  const { data, run } = await callPlannerJSON<DecomposedPlan>(
    DECOMP_SYSTEM_PROMPT,
    `שאלת המחקר:\n${question}`,
    DECOMP_PLAN_TOOL,
    // Pilot v7 (Fast-mode): pin decomposition to Gemini 2.5 Flash. gpt-5-mini
    // took ~25s on this schema; Flash returns the same JSON tool-call in ~6-10s.
    // 30s timeout is ample for Flash; nano→mini retry no longer relevant.
    { stage: "decomposition", timeoutMs: 30000, reasoningEffort: "minimal", forceProvider: "gemini" },
  );

  if (!data) return { data: null, run };
  if (!data.decomposition?.main_issue || !Array.isArray(data.decomposition?.sub_issues)) {
    return { data: null, run: { ...run, status: "parse_error", error_message: "missing main_issue or sub_issues" } };
  }
  if (data.decomposition.sub_issues.length < 2) {
    return { data: null, run: { ...run, status: "parse_error", error_message: "fewer than 2 sub_issues" } };
  }
  if (!Array.isArray(data.query_plan)) data.query_plan = [];
  return { data, run };
}

// ────────────────────────────────────────────────────────────────
// Stage D: Claim Map
// ────────────────────────────────────────────────────────────────

export interface ClaimMapEntry {
  claim: string;
  sub_issue: string;
  source_ids: number[];
  authority_level: "high" | "medium" | "low";
  support_strength: "strong" | "partial" | "weak";
  confidence: "high" | "medium" | "low";
  needs_pinpoint: boolean;
  allowed_to_state: boolean;
  notes: string;
}

export type ClaimMap = ClaimMapEntry[];

const CLAIM_MAP_TOOL: PlannerToolDef = {
  name: "submit_claim_map",
  description:
    "Build a list of legal claims that the drafter is allowed to state, each anchored to specific source ids.",
  parameters: {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim: { type: "string", description: "טענה משפטית קצרה אחת (משפט יחיד, עברית)" },
            sub_issue: { type: "string", description: "תת-הסוגיה אליה משתייכת הטענה" },
            source_ids: {
              type: "array",
              items: { type: "integer" },
              description: "מזהי המקורות התומכים מתוך source pack",
            },
            authority_level: { type: "string", enum: ["high", "medium", "low"] },
            support_strength: {
              type: "string",
              enum: ["strong", "partial", "weak"],
              description: "strong=הקטע קובע במפורש; partial=ניתן להסיק; weak=הקשר עקיף בלבד",
            },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            needs_pinpoint: {
              type: "boolean",
              description: "האם נדרש pinpoint (סעיף/עמוד) בהערת השוליים",
            },
            allowed_to_state: {
              type: "boolean",
              description: "false אם source_ids ריק או שהתמיכה חלשה מדי",
            },
            notes: { type: "string", description: "הערה פנימית קצרה (לא לתשובה)" },
          },
          required: [
            "claim",
            "sub_issue",
            "source_ids",
            "authority_level",
            "support_strength",
            "confidence",
            "needs_pinpoint",
            "allowed_to_state",
            "notes",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["claims"],
    additionalProperties: false,
  },
};

const CLAIM_MAP_SYSTEM_PROMPT = `אתה אנליסט משפטי דטרמיניסטי. תפקידך לבנות מפת טענות מעוגנת לפני כתיבת חוות הדעת.

אלגוריתם החלטה (יישם בסדר זה, ללא חריגה):

שלב 1 — סווג support_strength לפי הקטע (excerpt) של source_ids:
  • "strong" — הקטע מכיל את הטענה במפורש (ציטוט ישיר של חוק, סעיף, או הלכה).
  • "partial" — הקטע עוסק באותה סוגיה ומאפשר להסיק את הטענה, גם אם אין ניסוח מפורש זהה.
  • "weak" — הקטע נוגע בנושא רחב יותר אך אינו תומך ישירות בטענה.

שלב 2 — קבע allowed_to_state לפי טבלה זו (ללא שיקול דעת נוסף):
  • source_ids ריק → allowed_to_state=false.
  • support_strength="strong" → allowed_to_state=true.
  • support_strength="partial" → allowed_to_state=true.
  • support_strength="weak" → allowed_to_state=false.

שלב 3 — authority_level:
  • "high" — חקיקה ראשית, חוקי-יסוד, או פסיקת בית המשפט העליון.
  • "medium" — פסיקת בתי משפט מחוזי/שלום, חקיקת משנה.
  • "low" — מאמרים, פרשנות, מקורות משניים.

שלב 4 — needs_pinpoint=true אם ורק אם הטענה נסמכת על סעיף/עמוד ספציפי הכרחי להערת השוליים.

הנחיות מבניות:
- צור 4–8 טענות ממוקדות. אסור לייצר טענות ללא source_ids תומכים.
- קבץ טענות מאותה תת-סוגיה רצופות.
- אסור להוסיף שיקולי איכות מעבר לאלגוריתם למעלה — הסיווג חייב להיות עקבי בין הרצות.

החזר JSON בלבד דרך הכלי submit_claim_map.`;

export interface ClaimMapInput {
  decomposition: Decomposition;
  sourcePackBrief: Array<{
    source_id: number;
    title: string;
    authority_class: string;
    excerpt: string;
  }>;
}

export async function buildClaimMap(
  question: string,
  input: ClaimMapInput,
): Promise<{ data: ClaimMap | null; run: StageRun }> {
  const subIssuesText = input.decomposition.sub_issues
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");
  // Trim claim-map input aggressively to reduce planner latency / timeouts:
  // - cap to top 10 sources (was effectively 16 from caller)
  // - truncate each excerpt to 220 chars (was 400)
  // - truncate title to 140 chars
  // The planner only needs enough signal to anchor each claim to source_ids.
  const briefForPrompt = input.sourcePackBrief.slice(0, 10);
  const sourcesText = briefForPrompt
    .map(
      (s) =>
        `[${s.source_id}] (${s.authority_class}) ${s.title.slice(0, 140)}\n   קטע: ${s.excerpt.replace(/\s+/g, " ").slice(0, 220)}`,
    )
    .join("\n\n");

  const userPrompt = `שאלת המחקר:
${question}

סוגיה מרכזית: ${input.decomposition.main_issue}

תת-סוגיות:
${subIssuesText}

מקורות זמינים (source pack, ${briefForPrompt.length} פריטים):
${sourcesText}

בנה מפת טענות מעוגנת קצרה (4–8 טענות). כל טענה עם source_ids מתוך הרשימה למעלה. הימנע מטענות חופפות.`;

  const { data, run } = await callPlannerJSON<{ claims: ClaimMap }>(
    CLAIM_MAP_SYSTEM_PROMPT,
    userPrompt,
    CLAIM_MAP_TOOL,
    // Pilot v7.5 (revert): claim_map back to Gemini Flash for Fast mode.
    // v7.4 (OpenAI gpt-5-mini, seed=7) gave deterministic claim counts but
    // cost ~30-45s per call — Q1 hit the 45s timeout 3/3 in the stability
    // test and silently fell back to legacy. We accept Gemini's seed-ignoring
    // run-to-run variance as the lesser evil for Fast; the v7.2 gate relaxation
    // (allowed >= 1) absorbs most of that variance. forceProvider omitted →
    // routes through aiProvider's default (Gemini, since Flash is primary).
    // For a future Deep mode, pass `forceProvider: "openai"` here based on a
    // depth flag — the plumbing in aiProvider.ts is intact.
    { stage: "claim_map", timeoutMs: 30000 },
  );
  if (!data || !Array.isArray(data.claims)) return { data: null, run };
  // Defensive: ensure source_ids exists and arrays of integers.
  const cleaned = data.claims.filter((c) => c && typeof c.claim === "string" && Array.isArray(c.source_ids));
  if (cleaned.length === 0) {
    return { data: null, run: { ...run, status: "parse_error", error_message: "0 valid claims after cleaning" } };
  }
  return { data: cleaned, run };
}

// ────────────────────────────────────────────────────────────────
// Helpers for diagnostics summary written to qa_logs.metadata.
// ────────────────────────────────────────────────────────────────

export function summarizeClaimMap(claims: ClaimMap | null): {
  total: number;
  allowed: number;
  by_strength: { strong: number; partial: number; weak: number };
  by_authority: { high: number; medium: number; low: number };
} {
  const empty = {
    total: 0,
    allowed: 0,
    by_strength: { strong: 0, partial: 0, weak: 0 },
    by_authority: { high: 0, medium: 0, low: 0 },
  };
  if (!claims) return empty;
  const out = { ...empty, by_strength: { ...empty.by_strength }, by_authority: { ...empty.by_authority } };
  out.total = claims.length;
  for (const c of claims) {
    if (c.allowed_to_state) out.allowed++;
    out.by_strength[c.support_strength] = (out.by_strength[c.support_strength] || 0) + 1;
    out.by_authority[c.authority_level] = (out.by_authority[c.authority_level] || 0) + 1;
  }
  return out;
}

export function summarizeQueryPlan(
  plan: SubIssueQueryPlan[] | undefined,
): Array<{ sub_issue: string; has_legislation: boolean; has_caselaw: boolean; has_external: boolean }> {
  if (!Array.isArray(plan)) return [];
  return plan.map((p) => ({
    sub_issue: p.sub_issue,
    has_legislation: !!p.legislation_query,
    has_caselaw: !!p.caselaw_query,
    has_external: !!p.external_query,
  }));
}
