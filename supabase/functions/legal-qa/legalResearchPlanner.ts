// Phase 6.5 — Legal Research Planner.
//
// Sits between Router/Decomposition and retrieval. Declares:
//   - answerStrategy (what shape the answer wants),
//   - requiredRoles (must / should source roles),
//   - canonicalSearchTargets (queries that go INTO round-1 retrieval).
//
// Consumes:
//   - user question
//   - LegalIssueRoute (router output)
//   - DecomposedPlan (decomposition output)
//   - OpenWebDiscovery resolved_entities + suggested_trusted_queries (when available)
//
// Implementation: Gemini Flash, structured tool-call output. Falls back to
// a heuristic plan derived from router/decomposition on any failure — never
// throws, always returns a usable plan.

import { callPlannerJSON, type PlannerToolDef, type StageRun } from "./aiProvider.ts";
import type { LegalIssueRoute } from "./legalIssueRouter.ts";
import type { DecomposedPlan } from "./decomposition.ts";
import type { OpenWebDiscovery } from "./openWebDiscovery.ts";
import type {
  AnswerStrategy,
  DiscoveryAlignment,
  LegalResearchPlan,
  RequiredRole,
  RetrievalStrategy,
  SourceRole,
} from "./contracts.ts";

const PLANNER_TOOL: PlannerToolDef = {
  name: "submit_legal_research_plan",
  description:
    "Plan the source-role coverage and concrete retrieval queries needed to answer this legal research question.",
  parameters: {
    type: "object",
    properties: {
      answer_strategy: {
        type: "string",
        enum: [
          "doctrinal_synthesis",
          "statutory_application",
          "amendment_comparison",
          "theoretical_analysis",
          "procedural_explanation",
          "current_status_summary",
          "comparative_analysis",
          "mixed",
        ],
      },
      required_roles: {
        type: "array",
        description:
          "Source roles a competent answer MUST or SHOULD have. Pick from the role taxonomy.",
        items: {
          type: "object",
          properties: {
            role: {
              type: "string",
              enum: [
                "doctrinal_anchor",
                "statutory_anchor",
                "legislative_history",
                "academic_commentary",
                "theoretical_anchor",
                "policy_analysis",
                "case_example",
                "application_example",
                "counter_position",
                "institutional_context",
                "background_context",
              ],
            },
            min_count: { type: "integer", minimum: 1, maximum: 4 },
            priority: { type: "string", enum: ["must", "should"] },
            rationale: { type: "string" },
          },
          required: ["role", "min_count", "priority", "rationale"],
          additionalProperties: false,
        },
        minItems: 1,
        maxItems: 6,
      },
      preferred_roles: {
        type: "array",
        description: "Additional roles that strengthen the answer when available.",
        items: { type: "string" },
      },
      canonical_search_targets: {
        type: "array",
        description:
          "Concrete Hebrew search queries to feed retrieval (3–6). Each is a real query, not a topic phrase.",
        items: { type: "string" },
        minItems: 1,
        maxItems: 8,
      },
      doctrinal_anchor_names: {
        type: "array",
        description:
          "Names of landmark cases / doctrines you are confident about (e.g. 'אפרופים'). Empty when unsure.",
        items: { type: "string" },
      },
      statute_names: {
        type: "array",
        description:
          "Names of statutes the question hinges on (e.g. 'חוק החוזים (חלק כללי)'). Empty when unsure.",
        items: { type: "string" },
      },
      notes: { type: "string" },
      confidence: { type: "number" },
      retrieval_strategy: {
        type: "string",
        enum: ["db_first", "discovery_first", "hybrid"],
        description:
          "db_first for narrow doctrinal/statutory/case-law questions with clear known anchors. discovery_first or hybrid for theoretical/critical/institutional/policy/reform/academic/unclear-source-universe questions.",
      },
      retrieval_strategy_rationale: {
        type: "string",
        description: "Short Hebrew rationale for the chosen retrieval_strategy (telemetry only).",
      },
      discovery_alignment: {
        type: "object",
        description:
          "How the planner consumed the structured DISCOVERY_INPUT. Empty arrays when no discovery input was supplied.",
        properties: {
          consumed_entities: { type: "array", items: { type: "string" } },
          consumed_queries: { type: "array", items: { type: "string" } },
          ignored_entities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                reason: { type: "string" },
              },
              required: ["value", "reason"],
              additionalProperties: false,
            },
          },
          required_verification_targets: {
            type: "array",
            description: "Canonical names/titles downstream retrieval should attempt to verify.",
            items: { type: "string" },
          },
        },
        required: [
          "consumed_entities",
          "consumed_queries",
          "ignored_entities",
          "required_verification_targets",
        ],
        additionalProperties: false,
      },
    },
    required: [
      "answer_strategy",
      "required_roles",
      "preferred_roles",
      "canonical_search_targets",
      "doctrinal_anchor_names",
      "statute_names",
      "notes",
      "confidence",
      "retrieval_strategy",
      "retrieval_strategy_rationale",
    ],
    additionalProperties: false,
  },
};

const PLANNER_SYSTEM_PROMPT = `אתה מתכנן מחקר משפטי. תפקידך לקבוע אילו תפקידי-מקור (source roles) דרושים כדי לענות בצורה מקצועית על שאלת מחקר משפטית ישראלית, ולנסח שאילתות חיפוש קונקרטיות.

תפקידי-מקור (source roles):
- doctrinal_anchor — פסק דין מכונן שמבסס/פירש את הדוקטרינה (למשל אפרופים לפרשנות חוזים).
- statutory_anchor — החוק / הסעיף עצמו שהשאלה מתייחסת אליו.
- legislative_history — הצעות חוק, פרוטוקולי ועדה, מחקרי כנסת.
- academic_commentary — מאמר אקדמי שמבקר/מסביר את הדוקטרינה.
- theoretical_anchor — עמדה אקדמית קנונית שמשמשת כטענה תיאורטית, לא כסמכות.
- policy_analysis — ניתוח מדיניות (לרוב מכוני מחקר / IDI / מחקרי כנסת).
- case_example — פסק דין שממחיש את הדוקטרינה (כל ערכאה).
- application_example — פסק דין מערכאה נמוכה שמיישם דוקטרינה על עובדות ספציפיות.
- counter_position — דעת מיעוט / עמדה מנוגדת.
- institutional_context — רקע מוסדי על המוסד / ההליך הרלוונטי.
- background_context — הקשר כללי שאינו תומך טענה ספציפית.

הנחיות בחירת תפקידים:
- שאלה דוקטרינרית ("מה ההלכה לגבי X" / "האם תיקון שינה את ההלכה") — חובה doctrinal_anchor (≥1 must) ו-statutory_anchor אם מעורב חוק. רצוי counter_position.
- שאלה תיאורטית/מדיניותית ("האם בית המשפט מתנהל באקטיביזם שיפוטי") — אל תדרוש doctrinal_anchor אחד. דרוש academic_commentary + theoretical_anchor + counter_position + case_example.
- שאלת יישום סטטוטורי ("מתי בית משפט יתיר X לפי סעיף Y") — חובה statutory_anchor + application_example. רצוי case_example.
- שאלה פרוצדורלית — application_example + procedural rules; doctrinal_anchor רק אם יש הלכה מנחה ברורה.
- שאלת השוואת תיקונים — חובה statutory_anchor (לפני) + statutory_anchor (אחרי) + doctrinal_anchor (ההלכה הקודמת) + legislative_history.

שאילתות חיפוש (canonical_search_targets):
- 3–6 שאילתות עבריות קונקרטיות שאפשר להזין למנוע חיפוש משפטי. לא ביטויים כלליים.
- כלול שמות חוקים מדויקים, שמות פסקי דין שזיהית בוודאות, מונחי ליבה.
- אל תמציא שמות. אם אינך בטוח לגבי שם פסק דין — אל תרשום אותו ב-doctrinal_anchor_names.

ביטחון (confidence): 0..1. נמוך כשהשאלה עמומה.

אסטרטגיית אחזור (retrieval_strategy):
- "db_first" — שאלה דוקטרינרית/סטטוטורית/יישום-פסיקה ממוקדת עם עוגנים ידועים ברורים (חוק יעד מזוהה, שם פס"ד מכונן ידוע, או query_type=case_law_application עם הלכה מוכרת).
- "discovery_first" — שאלה תיאורטית / ביקורתית / מוסדית / מדיניותית / רפורמית / אקדמית / כשעולם המקורות לא ברור ואין עוגן דוקטרינרי מובהק.
- "hybrid" — מעורב: יש עוגן דוקטרינרי או חוק יעד אבל מסגרת השאלה דורשת גם פרשנות ביקורתית / אקדמית / מדיניותית.

דוגמאות:
- "מה נקבע באפרופים?" → db_first
- "האם נכון לפצל את תפקיד היועמ״ש?" → discovery_first / hybrid
- "האם בית המשפט מתנהל באקטיביזם שיפוטי בסכסוכי עוברים מוקפאים?" → discovery_first / hybrid

יישור גילוי (discovery_alignment):
- אם סופק <DISCOVERY_INPUT>, מלא consumed_entities/queries לפי מה שאימצת, ignored_entities עם נימוק קצר, ו-required_verification_targets — שמות/כותרות שאחזור צריך לאמת.

retrieval_strategy_rationale: משפט קצר בעברית שמסביר את הבחירה.

החזר JSON בלבד דרך הכלי submit_legal_research_plan.`;

interface RawPlannerOutput {
  answer_strategy: AnswerStrategy;
  required_roles: Array<{
    role: SourceRole;
    min_count: number;
    priority: "must" | "should";
    rationale: string;
  }>;
  preferred_roles: SourceRole[];
  canonical_search_targets: string[];
  doctrinal_anchor_names: string[];
  statute_names: string[];
  notes: string;
  confidence: number;
  retrieval_strategy?: RetrievalStrategy;
  retrieval_strategy_rationale?: string;
  discovery_alignment?: {
    consumed_entities?: string[];
    consumed_queries?: string[];
    ignored_entities?: Array<{ value?: unknown; reason?: unknown }>;
    required_verification_targets?: string[];
  };
}

export interface PlannerInputs {
  question: string;
  router: LegalIssueRoute | null;
  decomposition: DecomposedPlan | null;
  discovery: OpenWebDiscovery | null;
}

/**
 * Run the planner. On any failure returns a heuristic plan derived from
 * router/decomposition. Always non-null `data`.
 */
export async function runLegalResearchPlanner(
  inputs: PlannerInputs,
): Promise<{ plan: LegalResearchPlan; run: StageRun; usedFallback: boolean }> {
  const userPrompt = buildUserPrompt(inputs);
  const { data, run } = await callPlannerJSON<RawPlannerOutput>(
    PLANNER_SYSTEM_PROMPT,
    userPrompt,
    PLANNER_TOOL,
    {
      stage: "legal_research_planner",
      timeoutMs: 18000,
      reasoningEffort: "minimal",
      forceProvider: "gemini",
    },
  );

  if (!data) {
    return {
      plan: buildHeuristicPlan(inputs),
      run,
      usedFallback: true,
    };
  }

  const planId = `plan-${Date.now()}`;
  const plan: LegalResearchPlan = {
    planId,
    consumedRoute: {
      queryType: inputs.router?.query_type ?? null,
      legalDomain: inputs.router?.legal_domain ?? null,
    },
    answerStrategy: normalizeStrategy(data.answer_strategy),
    requiredRoles: normalizeRequiredRoles(data.required_roles),
    preferredRoles: Array.isArray(data.preferred_roles)
      ? (data.preferred_roles.filter(isValidRole) as SourceRole[])
      : [],
    canonicalSearchTargets: Array.isArray(data.canonical_search_targets)
      ? data.canonical_search_targets
          .filter((q) => typeof q === "string" && q.trim().length >= 4)
          .map((q) => q.trim())
          .slice(0, 8)
      : [],
    doctrinalAnchorNames: cleanStrings(data.doctrinal_anchor_names),
    statuteNames: cleanStrings(data.statute_names),
    notes: typeof data.notes === "string" ? data.notes.slice(0, 400) : "",
    confidence:
      typeof data.confidence === "number" && isFinite(data.confidence)
        ? Math.max(0, Math.min(1, data.confidence))
        : 0.5,
    retrievalStrategy: normalizeStrategyChoice(data.retrieval_strategy, inputs),
    retrievalStrategyRationale:
      typeof data.retrieval_strategy_rationale === "string"
        ? data.retrieval_strategy_rationale.slice(0, 240)
        : "",
    discoveryAlignment: normalizeDiscoveryAlignment(data.discovery_alignment, inputs),
  };

  // If the model produced zero roles, fall back to heuristic to keep gate
  // useful instead of trivially passing.
  if (plan.requiredRoles.length === 0) {
    return { plan: buildHeuristicPlan(inputs), run, usedFallback: true };
  }
  return { plan, run, usedFallback: false };
}

function cleanStrings(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is string => typeof s === "string" && s.trim().length > 1)
    .map((s) => s.trim())
    .slice(0, 8);
}

const VALID_ROLES = new Set<SourceRole>([
  "doctrinal_anchor",
  "statutory_anchor",
  "legislative_history",
  "academic_commentary",
  "theoretical_anchor",
  "policy_analysis",
  "case_example",
  "application_example",
  "counter_position",
  "institutional_context",
  "background_context",
]);

function isValidRole(r: unknown): r is SourceRole {
  return typeof r === "string" && VALID_ROLES.has(r as SourceRole);
}

function normalizeRequiredRoles(raw: unknown): RequiredRole[] {
  if (!Array.isArray(raw)) return [];
  const out: RequiredRole[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const obj = r as Record<string, unknown>;
    if (!isValidRole(obj.role)) continue;
    const minCount = Math.max(1, Math.min(4, Number(obj.min_count) || 1));
    const priority = obj.priority === "must" ? "must" : "should";
    out.push({
      role: obj.role,
      minCount,
      priority,
      rationale: typeof obj.rationale === "string" ? obj.rationale.slice(0, 200) : "",
    });
  }
  return out.slice(0, 6);
}

function normalizeStrategy(s: unknown): AnswerStrategy {
  const valid: AnswerStrategy[] = [
    "doctrinal_synthesis",
    "statutory_application",
    "amendment_comparison",
    "theoretical_analysis",
    "procedural_explanation",
    "current_status_summary",
    "comparative_analysis",
    "mixed",
  ];
  return valid.includes(s as AnswerStrategy) ? (s as AnswerStrategy) : "mixed";
}

function buildUserPrompt(inputs: PlannerInputs): string {
  const parts: string[] = [];
  parts.push(`שאלת המחקר:\n${inputs.question}`);

  if (inputs.router) {
    parts.push("");
    parts.push(
      `נתב משפטי: query_type=${inputs.router.query_type} legal_domain=${inputs.router.legal_domain} (confidence=${inputs.router.confidence.toFixed(2)})`,
    );
    if (inputs.router.target_statute?.name) {
      parts.push(
        `חוק יעד: ${inputs.router.target_statute.name}${inputs.router.target_statute.amendment === "latest" ? " (התיקון האחרון)" : ""}`,
      );
    }
    if (inputs.router.requires_current_context) {
      parts.push("דורש הקשר עדכני");
    }
  }

  if (inputs.decomposition?.decomposition) {
    const d = inputs.decomposition.decomposition;
    parts.push("");
    parts.push(`סוגיה מרכזית: ${d.main_issue}`);
    if (Array.isArray(d.sub_issues) && d.sub_issues.length > 0) {
      parts.push(`תת-סוגיות:\n- ${d.sub_issues.slice(0, 5).join("\n- ")}`);
    }
  }

  if (inputs.discovery) {
    const ents = inputs.discovery.resolved_entities ?? [];
    if (ents.length > 0) {
      const lines = ents
        .slice(0, 6)
        .map((e) => `- ${e.type}: ${e.name}${e.identifier ? ` (${e.identifier})` : ""}`);
      parts.push("");
      parts.push("ישויות שזוהו על ידי גילוי רשת פתוחה:");
      parts.push(lines.join("\n"));
    }
    const sq = inputs.discovery.suggested_trusted_queries ?? [];
    if (sq.length > 0) {
      parts.push("");
      parts.push(`שאילתות מוצעות מגילוי:\n- ${sq.slice(0, 4).join("\n- ")}`);
    }
  }

  return parts.join("\n");
}

// ─── Heuristic fallback ────────────────────────────────────────────────
// Used when the planner call fails or returns an empty/invalid plan.
// Reads router/decomposition signals to produce a reasonable role
// requirements set so the gate stays meaningful.

export function buildHeuristicPlan(inputs: PlannerInputs): LegalResearchPlan {
  const route = inputs.router;
  const decomp = inputs.decomposition?.decomposition;
  const qt = route?.query_type ?? "unknown";
  const requiresLeg = decomp?.requires_legislation ?? false;
  const requiresCase = decomp?.requires_caselaw ?? true;

  let strategy: AnswerStrategy;
  const required: RequiredRole[] = [];

  if (qt === "statutory_amendment_comparison") {
    strategy = "amendment_comparison";
    required.push(
      { role: "statutory_anchor", minCount: 1, priority: "must", rationale: "חוק היעד" },
      { role: "doctrinal_anchor", minCount: 1, priority: "must", rationale: "ההלכה לפני התיקון" },
      { role: "legislative_history", minCount: 1, priority: "should", rationale: "מטרת התיקון" },
    );
  } else if (qt === "doctrinal" || qt === "case_law_application") {
    strategy = "doctrinal_synthesis";
    required.push(
      { role: "doctrinal_anchor", minCount: 1, priority: "must", rationale: "ההלכה המכוננת" },
      { role: "case_example", minCount: 1, priority: "should", rationale: "יישום ההלכה" },
    );
    if (requiresLeg) {
      required.push({
        role: "statutory_anchor",
        minCount: 1,
        priority: "should",
        rationale: "החוק הרלוונטי",
      });
    }
  } else if (qt === "policy" || qt === "comparative") {
    strategy = qt === "policy" ? "theoretical_analysis" : "comparative_analysis";
    required.push(
      { role: "academic_commentary", minCount: 1, priority: "must", rationale: "ניתוח אקדמי" },
      { role: "theoretical_anchor", minCount: 1, priority: "should", rationale: "עמדה תיאורטית" },
      { role: "counter_position", minCount: 1, priority: "should", rationale: "דעת מנגד" },
    );
  } else if (qt === "procedural") {
    strategy = "procedural_explanation";
    required.push(
      { role: "statutory_anchor", minCount: 1, priority: "must", rationale: "תקנה / סעיף" },
      { role: "application_example", minCount: 1, priority: "should", rationale: "יישום בפועל" },
    );
  } else {
    strategy = "mixed";
    if (requiresCase) {
      required.push({
        role: "doctrinal_anchor",
        minCount: 1,
        priority: "should",
        rationale: "פסיקה רלוונטית",
      });
    }
    if (requiresLeg) {
      required.push({
        role: "statutory_anchor",
        minCount: 1,
        priority: "should",
        rationale: "חקיקה רלוונטית",
      });
    }
    // Always require at least ONE role so the gate isn't trivially satisfied.
    if (required.length === 0) {
      required.push({
        role: "background_context",
        minCount: 1,
        priority: "should",
        rationale: "הקשר כללי",
      });
    }
  }

  // Canonical search targets — derive from sub-issues + target statute name.
  const targets: string[] = [];
  if (route?.target_statute?.name) targets.push(route.target_statute.name);
  if (decomp && Array.isArray(decomp.sub_issues)) {
    for (const s of decomp.sub_issues.slice(0, 3)) {
      if (typeof s === "string" && s.trim().length >= 4) targets.push(s.trim());
    }
  }
  if (targets.length === 0) targets.push(inputs.question.slice(0, 120));

  return {
    planId: `plan-fallback-${Date.now()}`,
    consumedRoute: {
      queryType: route?.query_type ?? null,
      legalDomain: route?.legal_domain ?? null,
    },
    answerStrategy: strategy,
    requiredRoles: required,
    preferredRoles: [],
    canonicalSearchTargets: targets.slice(0, 6),
    doctrinalAnchorNames: [],
    statuteNames: route?.target_statute?.name ? [route.target_statute.name] : [],
    notes: "heuristic_fallback",
    confidence: 0.35,
  };
}

/**
 * Detect whether the planner's strategy/domain materially disagrees with
 * the router. Used purely for telemetry — the planner output drives
 * retrieval shaping regardless.
 */
export function detectRouterPlannerDisagreement(
  route: LegalIssueRoute | null,
  plan: LegalResearchPlan,
): { disagrees: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!route) return { disagrees: false, reasons };

  // Doctrinal/amendment router but planner picks pure theoretical → disagreement.
  if (
    (route.query_type === "doctrinal" || route.query_type === "statutory_amendment_comparison") &&
    plan.answerStrategy === "theoretical_analysis"
  ) {
    reasons.push("router=doctrinal_but_plan=theoretical");
  }

  // Policy router but planner forces a doctrinal must.
  if (
    route.query_type === "policy" &&
    plan.requiredRoles.some(
      (r) => r.priority === "must" && r.role === "doctrinal_anchor",
    )
  ) {
    reasons.push("router=policy_but_plan_requires_doctrinal_anchor");
  }

  // Router identified a target_statute but planner didn't list a statutory_anchor must.
  if (
    route.target_statute?.name &&
    !plan.requiredRoles.some(
      (r) => r.priority === "must" && r.role === "statutory_anchor",
    )
  ) {
    reasons.push("router_has_target_statute_but_plan_no_statutory_must");
  }

  return { disagrees: reasons.length > 0, reasons };
}
