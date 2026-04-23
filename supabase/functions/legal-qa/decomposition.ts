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
    // Tier-2 (pilot v4): primary is now gpt-5-mini (see legalResearchModels.ts).
    // 45s timeout absorbs the long tail; nano→mini retry removed since mini IS primary.
    { stage: "decomposition", timeoutMs: 45000, reasoningEffort: "minimal" },
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

const CLAIM_MAP_SYSTEM_PROMPT = `אתה אנליסט משפטי. תפקידך לבנות מפת טענות מעוגנת לפני כתיבת חוות הדעת.

חוקים:
- כל טענה חייבת להיות נתמכת על ידי source_ids ספציפיים מ-source pack. אם אין מקור תומך → allowed_to_state=false.
- support_strength="strong" רק אם הקטע (excerpt) שסופק קובע במפורש את הטענה.
- support_strength="partial" כשניתן להסיק את הטענה מהקטע אך אינה כתובה במפורש.
- support_strength="weak" כשהקשר עקיף בלבד — חובה לציין בתשובה כחוסר ודאות, או לדלג.
- authority_level="high" רק לחקיקה ראשית, חוקי-יסוד, או החלטות בית המשפט העליון.
- needs_pinpoint=true כשהטענה נסמכת על סעיף/עמוד ספציפי שחייב להופיע בהערת השוליים.
- צור 4–12 טענות ממוקדות. אל תייצר טענות שאין להן עיגון.
- טענות באותה תת-סוגיה רצוי לקבץ.

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
    // 60s timeout (was 45s) to absorb gpt-5-mini variance even with trimmed input.
    { stage: "claim_map", timeoutMs: 60000, reasoningEffort: "low" },
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
