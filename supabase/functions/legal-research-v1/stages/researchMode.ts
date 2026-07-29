// Research-mode classification + mode-aware planner obligations.
//
// Scope: planner-only. This module derives a *general* research mode from the
// question phrasing + analyzer answer_intent (output_shape), turns it into
// planner instructions, and deterministically audits the planner output
// against the mode's source-search obligations.
//
// Hard rules for this module:
// - no doctrine dictionaries, no landmark case names, no source allowlists.
// - purely structural / phrasing-based signals.

import { AnalyzerOutput, OutputShape, Query, QueryTarget, SourceRole } from "../lib/types.ts";
import { detectStatuteSections } from "./statuteSectionDetection.ts";
import { detectDockets } from "./docketDetection.ts";

export const RESEARCH_MODES = [
  "specific_case",
  "statute_section_definition",
  "case_law_synthesis",
  "doctrine_explanation",
  "practical_steps",
  "canonical_quote",
  "generic",
] as const;
export type ResearchMode = typeof RESEARCH_MODES[number];

export interface ModeObligation {
  id: string;
  /** Human-readable description (telemetry only). */
  label: string;
}

export interface ResearchModeDecision {
  mode: ResearchMode;
  output_shape: OutputShape | null;
  reasons: string[];
  obligations: ModeObligation[];
  has_statute_section: boolean;
  has_docket: boolean;
}

// ─── Phrasing signals (structural, not doctrinal) ───────────────────────────

/** "מה הפסיקה אומרת על…", "מה נקבע בפסיקה לגבי…", "מה ההלכה לגבי…" … */
const CASE_LAW_SYNTHESIS_CUE =
  /(מה\s+(ה)?פסיקה\s+(אומרת|קובעת|גורסת)|מה\s+נקבע\s+ב(ה)?פסיקה|מה\s+(ה)?הלכה\s+(לגבי|בעניין|בנוגע|בדבר|ב)|כיצד\s+(ה)?פסיקה\s+(מתייחסת|מתמודדת)|איך\s+(ה)?פסיקה\s+מתייחסת|עמדת\s+(ה)?פסיקה|קו\s+(ה)?פסיקה|הלכת\s+\S+)/;

/** "מה עושים אם…", "כיצד ניתן לתבוע…", "אילו צעדים…" */
const PRACTICAL_CUE =
  /(מה\s+(עושים|ניתן\s+לעשות|אפשר\s+לעשות)|אילו\s+צעדים|כיצד\s+(ניתן\s+)?(לתבוע|להגיש|לפעול|לממש)|איך\s+(ניתן\s+)?(לתבוע|להגיש|לפעול|לממש)|מה\s+ה?הליך)/;

const CASE_LAW_ROLES: SourceRole[] = ["binding_case_law", "persuasive_case_law"];
const STATUTORY_ROLES: SourceRole[] = ["primary_statute", "regulation"];

/** Words indicating a query hunts for limits/exceptions/criticism of a rule. */
const LIMITING_CUE = /(חריג|סייג|צמצום|הבחנה|ביקורת|דעת\s+מיעוט|אי[- ]?תחולה|גבולות|מגבל)/;
/** Words indicating a query hunts for application of a rule to facts. */
const APPLYING_CUE = /(יישום|החל|הוחל|נסיבות|מקרים|לאחר\s+הלכת|בעקבות)/;
/** Procedure / remedy / enforcement vocabulary. */
const PROCEDURE_CUE =
  /(סדר\s+הדין|תביעה\s+קטנה|כתב\s+תביעה|הוצאה\s+לפועל|אכיפה|תקנות\s+סדרי|הליך\s+משפטי|בית\s+משפט\s+לתביעות|סעד\s+זמני|התיישנות|אגרה)/;

const DOCKET_IN_QUERY = /\d{1,5}\s*\/\s*\d{2,4}/;

// ─── Obligation catalogue per mode ──────────────────────────────────────────

const OBLIGATIONS: Record<ResearchMode, ModeObligation[]> = {
  specific_case: [
    { id: "exact_docket_query", label: "שאילתה עם מספר ההליך המדויק" },
    { id: "multiple_exact_authority_probes", label: "לפחות שתי שאילתות לאיתור פסק הדין עצמו" },
    { id: "caselaw_dual_target", label: "שאילתות פסיקה מופנות ל-local_db וגם ל-perplexity" },
    { id: "secondary_support_only", label: "פרשנות/ספרות רק כתמיכה משנית" },
  ],
  statute_section_definition: [
    { id: "statute_text_query", label: "שאילתת נוסח הסעיף עצמו" },
    { id: "statute_first", label: "שאילתת החקיקה מופיעה לפני פרשנות" },
    { id: "interpretation_after_statute", label: "פרשנות/פסיקה אחרי נוסח הסעיף" },
  ],
  case_law_synthesis: [
    { id: "statutory_background", label: "רקע חקיקתי" },
    { id: "leading_case_law", label: "פסיקה מנחה/מחייבת" },
    { id: "applying_case_law", label: "פסיקה מיישמת" },
    { id: "limiting_case_law", label: "פסיקה מסייגת/מבחינה" },
    { id: "secondary_commentary", label: "ספרות משנית" },
    { id: "caselaw_dual_target", label: "שאילתות פסיקה מופנות ל-local_db וגם ל-perplexity" },
  ],
  doctrine_explanation: [
    { id: "doctrinal_anchor", label: "עוגן דוקטרינרי ישיר (חוק / פסיקה מחייבת)" },
    { id: "bounded_scholarship", label: "ספרות מוגבלת ולא חבילת scholarship גנרית" },
  ],
  practical_steps: [
    { id: "substantive_law_query", label: "שאילתת דין מהותי בתחום" },
    { id: "substantive_before_procedure", label: "דין מהותי לפני סדרי דין/אכיפה" },
  ],
  canonical_quote: [],
  generic: [],
};

// ─── Classification ─────────────────────────────────────────────────────────

export function classifyResearchMode(
  question: string,
  analyzer: AnalyzerOutput,
): ResearchModeDecision {
  const shape = analyzer.answer_intent?.output_shape ?? null;
  const reasons: string[] = [];
  const has_statute_section = detectStatuteSections(question).length > 0;
  const has_docket = detectDockets(question).length > 0;

  let mode: ResearchMode = "generic";

  if (shape === "quote") {
    mode = "canonical_quote";
    reasons.push("shape=quote");
  } else if (shape === "case_holding" || has_docket) {
    mode = "specific_case";
    reasons.push(shape === "case_holding" ? "shape=case_holding" : "docket_detected");
  } else if (shape === "definition" && has_statute_section) {
    mode = "statute_section_definition";
    reasons.push("shape=definition+statute_section");
  } else if (CASE_LAW_SYNTHESIS_CUE.test(question)) {
    mode = "case_law_synthesis";
    reasons.push("case_law_synthesis_phrasing");
  } else if (shape === "list" || PRACTICAL_CUE.test(question)) {
    mode = "practical_steps";
    reasons.push(shape === "list" ? "shape=list" : "practical_phrasing");
  } else if (shape === "analysis" || shape === "definition" || shape === "comparison") {
    mode = "doctrine_explanation";
    reasons.push(`shape=${shape}`);
  } else {
    reasons.push(`shape=${shape ?? "unknown"}:no_mode_signal`);
  }

  return {
    mode,
    output_shape: shape,
    reasons,
    obligations: OBLIGATIONS[mode],
    has_statute_section,
    has_docket,
  };
}

// ─── Planner prompt directives per mode ─────────────────────────────────────

export function modePlannerDirective(decision: ResearchModeDecision): string {
  switch (decision.mode) {
    case "specific_case":
      return `מצב מחקר: פסק דין ספציפי (specific_case).
חובות תכנון:
- ייצר לפחות שתי שאילתות שונות לאיתור פסק הדין עצמו (מספר ההליך + שמות הצדדים + בית המשפט/מאגר), לא בדיקה גנרית אחת.
- כל שאילתה שמחפשת את פסק הדין תכלול את מספר ההליך כפי שהופיע בשאלה.
- לשאילתות פסיקה קבע targets: ["local_db","perplexity"].
- פרשנות, ספרות ופסיקה מאוחרת — רק כשאילתות תמיכה משניות ובכמות קטנה.`;

    case "statute_section_definition":
      return `מצב מחקר: הגדרת סעיף חוק (statute_section_definition).
חובות תכנון:
- השאילתה הראשונה חייבת להיות primary_statute לנוסח הסעיף עצמו (שם החוק + מספר הסעיף).
- העדף מקורות חקיקה רשמיים/מוכרים.
- שאילתות פרשנות ופסיקה יבואו רק אחרי שאילתת נוסח הסעיף, ובכמות קטנה.`;

    case "case_law_synthesis":
      return `מצב מחקר: סינתזת פסיקה (case_law_synthesis).
חובות תכנון — ייצר חבילת מקורות שכבתית, שאילתה אחת לפחות לכל שכבה:
1. רקע חקיקתי (primary_statute/regulation) — החוק או ההסדר הסטטוטורי שבתוכו פועלת ההלכה.
2. פסיקה מנחה (binding_case_law) — פסקי הדין המכוננים של בית המשפט העליון בסוגיה.
3. פסיקה מיישמת (binding_case_law/persuasive_case_law) — שאילתה עם מונחי יישום כמו "יישום", "נסיבות", "מקרים", "בעקבות".
4. פסיקה מסייגת/מבחינה — שאילתה עם מונחי סיוג כמו "חריג", "סייג", "צמצום", "הבחנה", "ביקורת", "דעת מיעוט".
5. ספרות משנית (scholarship) — מעט, לתמיכה בלבד.
לכל שאילתת פסיקה קבע targets: ["local_db","perplexity"].
אל תשתמש בשמות פסקי דין שלא הופיעו בשאלה — תאר את הסוגיה במילים.`;

    case "doctrine_explanation":
      return `מצב מחקר: הסבר דוקטרינה (doctrine_explanation).
חובות תכנון:
- ייצר עוגן דוקטרינרי ישיר: חוק רלוונטי או פסיקה מחייבת שעוסקת ישירות בדוקטרינה.
- קבוצת תמיכה קטנה בלבד. אל תייצר חבילת scholarship גנרית ורחבה (לכל היותר שתי שאילתות scholarship).`;

    case "practical_steps":
      return `מצב מחקר: צעדים מעשיים (practical_steps).
חובות תכנון:
- השאילתה הראשונה חייבת להיות דין מהותי בתחום הספציפי של השאלה (primary_statute/regulation של אותו תחום), ולא סדרי דין.
- רק אחריה ייצר שאילתות של הליך, סעד ואכיפה.
- אל תתכנן מענה שמבוסס על מקורות סדר דין אזרחי בלבד.`;

    case "canonical_quote":
      return `מצב מחקר: ציטוט מדויק (canonical_quote). המשך בהתנהגות הרגילה — שאילתות לנוסח הרשמי של ההוראה המצוטטת.`;

    default:
      return `מצב מחקר: כללי (generic). המשך בהתנהגות הרגילה.`;
  }
}

// ─── Deterministic target enforcement (planner-scope) ───────────────────────

function withTargets(q: Query, add: QueryTarget[]): Query {
  const set = new Set<QueryTarget>([...q.targets, ...add]);
  return { ...q, targets: [...set] };
}

export interface TargetEnforcementReport {
  applied: boolean;
  widened_query_count: number;
  rule?: string;
}

/**
 * For modes where case-law recall matters, case-law queries must hit both
 * lanes. Purely mechanical: adds a missing target, never removes one and never
 * invents new queries.
 */
export function enforceModeTargets(
  decision: ResearchModeDecision,
  queries: Query[],
): { queries: Query[]; report: TargetEnforcementReport } {
  if (decision.mode !== "case_law_synthesis" && decision.mode !== "specific_case") {
    return { queries, report: { applied: false, widened_query_count: 0 } };
  }
  let widened = 0;
  const out = queries.map((q) => {
    if (!CASE_LAW_ROLES.includes(q.role)) return q;
    const needs = (["local_db", "perplexity"] as QueryTarget[]).filter((t) => !q.targets.includes(t));
    if (needs.length === 0) return q;
    widened++;
    return withTargets(q, needs);
  });
  return {
    queries: out,
    report: {
      applied: widened > 0,
      widened_query_count: widened,
      rule: "caselaw_roles_dual_target",
    },
  };
}

// ─── Obligation audit ───────────────────────────────────────────────────────

export interface ObligationAudit {
  mode: ResearchMode;
  obligations: Array<{ id: string; label: string; satisfied: boolean }>;
  satisfied_count: number;
  total_count: number;
  unsatisfied: string[];
  targets_by_role: Record<string, { local_db: number; perplexity: number; total: number }>;
  caselaw_includes_perplexity: boolean;
  substantive_law_query_present: boolean;
}

export function auditPlannerObligations(
  decision: ResearchModeDecision,
  queries: Query[],
): ObligationAudit {
  const targets_by_role: ObligationAudit["targets_by_role"] = {};
  for (const q of queries) {
    const slot = targets_by_role[q.role] ?? { local_db: 0, perplexity: 0, total: 0 };
    if (q.targets.includes("local_db")) slot.local_db++;
    if (q.targets.includes("perplexity")) slot.perplexity++;
    slot.total++;
    targets_by_role[q.role] = slot;
  }

  const caselaw = queries.filter((q) => CASE_LAW_ROLES.includes(q.role));
  const statutory = queries.filter((q) => STATUTORY_ROLES.includes(q.role));
  const scholarship = queries.filter((q) => q.role === "scholarship");
  const caselaw_includes_perplexity =
    caselaw.length > 0 && caselaw.every((q) => q.targets.includes("perplexity"));
  const substantive_law_query_present = statutory.length > 0 ||
    caselaw.some((q) => !PROCEDURE_CUE.test(q.query_he));

  const firstStatutoryIdx = queries.findIndex((q) => STATUTORY_ROLES.includes(q.role));
  const firstProcedureIdx = queries.findIndex((q) => PROCEDURE_CUE.test(q.query_he));
  const firstInterpretationIdx = queries.findIndex(
    (q) => CASE_LAW_ROLES.includes(q.role) || q.role === "scholarship",
  );

  const check = (id: string): boolean => {
    switch (id) {
      case "exact_docket_query":
        return queries.some((q) => DOCKET_IN_QUERY.test(q.query_he));
      case "multiple_exact_authority_probes":
        return queries.filter((q) => DOCKET_IN_QUERY.test(q.query_he)).length >= 2;
      case "caselaw_dual_target":
        return caselaw_includes_perplexity;
      case "secondary_support_only":
        return scholarship.length <= Math.max(2, Math.floor(queries.length * 0.34));
      case "statute_text_query":
        return queries.some((q) => q.role === "primary_statute" && /סעיף/.test(q.query_he));
      case "statute_first":
        return firstStatutoryIdx === 0;
      case "interpretation_after_statute":
        return firstInterpretationIdx === -1 ||
          (firstStatutoryIdx !== -1 && firstStatutoryIdx < firstInterpretationIdx);
      case "statutory_background":
        return statutory.length > 0;
      case "leading_case_law":
        return queries.some((q) => q.role === "binding_case_law");
      case "applying_case_law":
        return caselaw.length >= 2 || caselaw.some((q) => APPLYING_CUE.test(q.query_he));
      case "limiting_case_law":
        return queries.some((q) => LIMITING_CUE.test(q.query_he));
      case "secondary_commentary":
        return scholarship.length > 0;
      case "doctrinal_anchor":
        return queries.some(
          (q) => q.role === "primary_statute" || q.role === "binding_case_law",
        );
      case "bounded_scholarship":
        return scholarship.length <= 2;
      case "substantive_law_query":
        return substantive_law_query_present;
      case "substantive_before_procedure":
        return firstProcedureIdx === -1 ||
          (firstStatutoryIdx !== -1 && firstStatutoryIdx < firstProcedureIdx);
      default:
        return false;
    }
  };

  const obligations = decision.obligations.map((o) => ({
    id: o.id,
    label: o.label,
    satisfied: check(o.id),
  }));

  return {
    mode: decision.mode,
    obligations,
    satisfied_count: obligations.filter((o) => o.satisfied).length,
    total_count: obligations.length,
    unsatisfied: obligations.filter((o) => !o.satisfied).map((o) => o.id),
    targets_by_role,
    caselaw_includes_perplexity,
    substantive_law_query_present,
  };
}
