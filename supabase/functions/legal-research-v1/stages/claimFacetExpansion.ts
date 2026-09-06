// claim_facet_expansion_v1 — decompose planner claims into doctrinal facets.
//
// Scope (narrow, by design):
// - legal-research runs only, and only for doctrine_explanation mode /
//   `analysis` output shape. Every other mode (specific_case,
//   canonical_quote, statute_section_definition, practical_steps,
//   case_law_synthesis without an analysis shape) is untouched.
// - Adds area-locked retrieval queries *after* the planner and *before*
//   retrieval, plus facet-scoped drafter directives and telemetry.
// - Never loosens the verifier, the sufficiency gate, or the metadata-only
//   holding gate, and never promotes a source automatically.

import { AnalyzerOutput, Query, SourceRole } from "../lib/types.ts";

export type FacetSourcePreference =
  | "primary_statute"
  | "binding_case_law"
  | "procedure_rules"
  | "scholarship_secondary";

export type FacetSupportType = "direct_rule" | "application" | "background_only";

export interface ClaimFacet {
  facet_id: string;
  parent_claim_id: string;
  legal_area: string;
  doctrinal_label: string;
  required_source_preference: FacetSourcePreference;
  query_terms: string[];
  negative_scope_terms: string[];
  expected_support_type: FacetSupportType;
}

export interface FacetGuardRecord {
  run_id: string | null;
  original_query: string;
  normalized_query: string;
  proposed_facet: string;
  proposed_query: string;
  topical_overlap_score: number;
  shared_key_terms: string[];
  unrelated_entities: string[];
  accepted: boolean;
  rejection_reason: string | null;
}

export interface FacetExpansionResult {
  enabled: boolean;
  gate_reason: string;
  legal_area_lock: string | null;
  lock_terms: string[];
  facets: ClaimFacet[];
  queries: Query[];
  /** natural_literature_mode_and_topic_guard_v1 — per-facet topical guard. */
  contamination_guard: FacetGuardRecord[];
}


// ─── Caps (CPU / retrieval budget protection) ───────────────────────────────
const MAX_FACETS_PER_CLAIM = 6;
const MIN_FACETS_PER_CLAIM = 3;
const MAX_FACETS_TOTAL = 8;
const QUERIES_PER_FACET = 1;
const MAX_FACET_QUERIES = 6;

// ─── Area locks — structural vocabulary, not case names ─────────────────────
interface AreaLock {
  id: string;
  label: string;
  trigger: RegExp;
  /** Terms appended to every facet query so retrieval stays inside the area. */
  lock_terms: string[];
  /** Terms that mark out-of-area material (telemetry + negative scope). */
  negative_terms: string[];
}

const AREA_LOCKS: AreaLock[] = [
  {
    id: "public_law_hcj",
    label: "משפט מינהלי/חוקתי — בג\"ץ",
    trigger:
      /(בג["״']?ץ|בית\s+המשפט\s+הגבוה\s+לצדק|עתיר(ה|ות|ת)|משפט\s+מינהלי|רשות\s+מינהלית|ביקורת\s+שיפוטית|צו\s+על\s+תנאי)/,
    lock_terms: ["בג\"ץ", "משפט מינהלי"],
    negative_terms: ["נזיקין", "מס הכנסה", "מע\"מ", "חוזה מסחרי", "תביעה כספית", "ביטוח"],
  },
  {
    id: "family_property",
    label: "דיני משפחה — יחסי ממון",
    trigger: /(גירוש|בית\s+הדין\s+הרבני|יחסי\s+ממון|חלוקת\s+רכוש|איזון\s+משאבים|כתובה)/,
    lock_terms: ["דיני משפחה", "יחסי ממון בין בני זוג"],
    negative_terms: ["נזיקין", "מס הכנסה", "דיני חברות"],
  },
  {
    id: "companies",
    label: "דיני חברות",
    trigger: /(חוק\s+החברות|הרמת\s+מסך|אישיות\s+משפטית\s+נפרדת|נושא\s+משרה|בעל\s+שליטה)/,
    lock_terms: ["דיני חברות", "חוק החברות"],
    negative_terms: ["נזיקין", "דיני משפחה", "משפט מינהלי"],
  },
  {
    id: "contracts",
    label: "דיני חוזים",
    trigger: /(חוק\s+החוזים|תום\s+לב|משא\s+ומתן|הפרת\s+חוזה|תרופות\s+בשל\s+הפרת)/,
    lock_terms: ["דיני חוזים", "חוק החוזים"],
    negative_terms: ["משפט מינהלי", "דיני חברות", "מס הכנסה"],
  },
  {
    id: "constitutional",
    label: "משפט חוקתי",
    trigger: /(מידתיות|פסקת\s+ההגבלה|חוק[- ]יסוד|זכות\s+חוקתית|ביטול\s+חוק)/,
    lock_terms: ["משפט חוקתי", "חוקי היסוד"],
    negative_terms: ["נזיקין", "דיני חברות", "מס הכנסה"],
  },
];

function resolveAreaLock(question: string, analyzer: AnalyzerOutput): AreaLock | null {
  const hay = [question, analyzer.legal_area ?? "", ...(analyzer.claims ?? []).map((c) => c.text_he)]
    .join(" ");
  for (const a of AREA_LOCKS) if (a.trigger.test(hay)) return a;
  return null;
}

// ─── Facet families — structural doctrinal decomposition per area ───────────
interface FacetTemplate {
  label: string;
  preference: FacetSourcePreference;
  support: FacetSupportType;
  terms: string[];
}

/** Burden-of-proof facets inside public law (the HCJ recall gap). */
const HCJ_BURDEN_FACETS: FacetTemplate[] = [
  {
    label: "נטל ראשוני על העותר בעתירת בג\"ץ",
    preference: "binding_case_law",
    support: "direct_rule",
    terms: ["הנטל הראשוני המוטל על העותר בעתירה לבג\"ץ", "על העותר להניח תשתית ראייתית ראשונית עתירה מינהלית"],
  },
  {
    label: "חזקת התקינות המנהלית",
    preference: "binding_case_law",
    support: "direct_rule",
    terms: ["חזקת התקינות המנהלית נטל הסתירה", "חזקת החוקיות של מעשה הרשות המינהלית פסיקה"],
  },
  {
    label: "חובת ההסבר / חובת ההנמקה של הרשות",
    preference: "primary_statute",
    support: "direct_rule",
    terms: ["חובת ההנמקה של הרשות המינהלית חוק לתיקון סדרי המינהל הנמקות", "חובת ההסבר של הרשות בתשובה לעתירה"],
  },
  {
    label: "צו על תנאי והעברת נטל מעשית למשיב",
    preference: "procedure_rules",
    support: "direct_rule",
    terms: ["צו על תנאי בבג\"ץ נטל התשובה של המשיב", "תקנות סדרי הדין בבית המשפט הגבוה לצדק צו על תנאי"],
  },
  {
    label: "סעד זמני בבג\"ץ: ראיות לכאורה ומאזן נוחות",
    preference: "procedure_rules",
    support: "application",
    terms: ["סעד זמני בבג\"ץ מאזן הנוחות סיכויי העתירה", "צו ביניים בעתירה מינהלית ראיות לכאורה"],
  },
  {
    label: "הבחנה בין נטל שכנוע לנטל הבאת ראיות",
    preference: "scholarship_secondary",
    support: "background_only",
    terms: ["ההבחנה בין נטל השכנוע לנטל הבאת הראיות במשפט המינהלי", "נטל הבאת ראיות רשות מינהלית עתירה"],
  },
];

/** Standard-of-review facets inside public law (MAYA-style questions). */
const HCJ_REVIEW_FACETS: FacetTemplate[] = [
  {
    label: "עילת ההתערבות של בג\"ץ בבית דין דתי",
    preference: "binding_case_law",
    support: "direct_rule",
    terms: ["התערבות בג\"ץ בפסיקת בית הדין הרבני חריגה מסמכות", "ביקורת שיפוטית של בג\"ץ על בתי דין דתיים"],
  },
  {
    label: "תחולת הדין האזרחי על בית הדין הרבני",
    preference: "primary_statute",
    support: "direct_rule",
    terms: ["חוק שיפוט בתי דין רבניים נישואין וגירושין סמכות", "החלת הדין האזרחי בענייני ממון בבית הדין הרבני"],
  },
  {
    label: "שיקול זר וחריגה מסמכות",
    preference: "binding_case_law",
    support: "direct_rule",
    terms: ["שיקול זר בהחלטת בית דין רבני ביטול בבג\"ץ", "חריגה מסמכות בית דין דתי הלכה"],
  },
  {
    label: "איזון משאבים וחלוקת רכוש",
    preference: "primary_statute",
    support: "direct_rule",
    terms: ["חוק יחסי ממון בין בני זוג איזון משאבים", "הלכת השיתוף בנכסים חלוקת רכוש בין בני זוג"],
  },
];

interface FacetFamily {
  id: string;
  area_id: string;
  trigger: RegExp;
  templates: FacetTemplate[];
}

const FACET_FAMILIES: FacetFamily[] = [
  {
    id: "hcj_burden_of_proof",
    area_id: "public_law_hcj",
    trigger: /(נטל\s+(ה)?(הוכחה|שכנוע|ראיה|ראיות|הבאת)|חובת\s+ההוכחה|על\s+מי\s+מוטל)/,
    templates: HCJ_BURDEN_FACETS,
  },
  {
    id: "hcj_standard_of_review",
    area_id: "public_law_hcj",
    trigger: /(אמת\s+מידה|סטנדרט|ביקורת\s+שיפוטית|התערבות)/,
    templates: HCJ_REVIEW_FACETS,
  },
  {
    id: "family_review",
    area_id: "family_property",
    trigger: /(אמת\s+מידה|ביקורת\s+שיפוטית|התערבות|שיקול\s+זר)/,
    templates: HCJ_REVIEW_FACETS,
  },
];

// ─── Generic (area-agnostic) structural decomposition ───────────────────────
function genericTemplates(claimText: string, area: AreaLock | null): FacetTemplate[] {
  const core = compactClaim(claimText);
  const areaWord = area?.lock_terms[0] ?? "";
  return [
    {
      label: `ההוראה המחייבת בבסיס: ${core}`,
      preference: "primary_statute",
      support: "direct_rule",
      terms: [`${core} ${areaWord} הוראת החוק`.trim(), `${core} סעיף חוק נוסח`.trim()],
    },
    {
      label: `הלכה מחייבת בסוגיה: ${core}`,
      preference: "binding_case_law",
      support: "direct_rule",
      terms: [`${core} ${areaWord} בית המשפט העליון הלכה`.trim(), `${core} פסק דין מנחה`.trim()],
    },
    {
      label: `יישום וסייגים: ${core}`,
      preference: "binding_case_law",
      support: "application",
      terms: [`${core} ${areaWord} חריגים וסייגים`.trim(), `${core} יישום בפסיקה`.trim()],
    },
    {
      label: `רקע עיוני: ${core}`,
      preference: "scholarship_secondary",
      support: "background_only",
      terms: [`${core} ${areaWord} מאמר אקדמי`.trim()],
    },
  ];
}

function compactClaim(text: string): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  const words = clean.split(" ").slice(0, 9);
  return words.join(" ");
}

function preferenceToRole(p: FacetSourcePreference): SourceRole {
  switch (p) {
    case "primary_statute":
      return "primary_statute";
    case "binding_case_law":
      return "binding_case_law";
    case "procedure_rules":
      return "regulation";
    case "scholarship_secondary":
      return "scholarship";
  }
}

function preferenceToExpected(p: FacetSourcePreference) {
  switch (p) {
    case "primary_statute":
      return "statute" as const;
    case "binding_case_law":
      return "case" as const;
    case "procedure_rules":
      return "regulation" as const;
    case "scholarship_secondary":
      return "academic" as const;
  }
}

/**
 * Gate: legal-research doctrine/analysis runs only.
 */
export function facetExpansionGate(
  mode: string | null,
  outputShape: string | null,
): { enabled: boolean; reason: string } {
  if (mode === "specific_case" || mode === "canonical_quote" || mode === "statute_section_definition") {
    return { enabled: false, reason: `mode_excluded:${mode}` };
  }
  if (mode === "doctrine_explanation" || outputShape === "analysis") {
    return { enabled: true, reason: `mode=${mode ?? "unknown"};shape=${outputShape ?? "unknown"}` };
  }
  return { enabled: false, reason: `shape_not_eligible:${outputShape ?? "unknown"}` };
}

export function expandClaimFacets(
  question: string,
  analyzer: AnalyzerOutput,
  opts: { mode: string | null; outputShape: string | null },
): FacetExpansionResult {
  const gate = facetExpansionGate(opts.mode, opts.outputShape);
  const area = resolveAreaLock(question, analyzer);
  const empty: FacetExpansionResult = {
    enabled: false,
    gate_reason: gate.reason,
    legal_area_lock: area?.id ?? null,
    lock_terms: area?.lock_terms ?? [],
    facets: [],
    queries: [],
  };
  if (!gate.enabled) return empty;

  const claims = analyzer.claims ?? [];
  if (claims.length === 0) return { ...empty, gate_reason: "no_claims" };

  const hay = `${question} ${claims.map((c) => c.text_he).join(" ")}`;
  const family = area
    ? FACET_FAMILIES.find((f) => f.area_id === area.id && f.trigger.test(hay)) ?? null
    : null;

  const facets: ClaimFacet[] = [];
  let seq = 0;
  for (const claim of claims) {
    if (facets.length >= MAX_FACETS_TOTAL) break;
    const templates = (family && facets.length === 0)
      ? family.templates
      : genericTemplates(claim.text_he, area);
    const take = Math.min(
      Math.max(MIN_FACETS_PER_CLAIM, Math.min(templates.length, MAX_FACETS_PER_CLAIM)),
      MAX_FACETS_TOTAL - facets.length,
    );
    for (const t of templates.slice(0, take)) {
      seq += 1;
      facets.push({
        facet_id: `F${seq}`,
        parent_claim_id: claim.claim_id,
        legal_area: area?.label ?? (analyzer.legal_area || "unknown"),
        doctrinal_label: t.label,
        required_source_preference: t.preference,
        query_terms: t.terms.slice(0, QUERIES_PER_FACET),
        negative_scope_terms: area?.negative_terms ?? [],
        expected_support_type: t.support,
      });
    }
    // Family templates already cover the question; do not fan out per claim.
    if (family) break;
  }

  const queries: Query[] = [];
  for (const f of facets) {
    if (f.expected_support_type === "background_only") continue;
    for (const term of f.query_terms) {
      if (queries.length >= MAX_FACET_QUERIES) break;
      const role = preferenceToRole(f.required_source_preference);
      queries.push({
        claim_id: f.parent_claim_id,
        role,
        query_he: term,
        targets: role === "scholarship" ? ["perplexity"] : ["local_db", "perplexity"],
        expected_source_type: preferenceToExpected(f.required_source_preference),
        reason: `claim_facet:${f.facet_id}`,
        metadata: {
          facet_id: f.facet_id,
          facet_label: f.doctrinal_label,
          facet_area_lock: area?.id ?? null,
          facet_expected_support: f.expected_support_type,
        },
      } as Query);
    }
  }

  return {
    enabled: true,
    gate_reason: gate.reason,
    legal_area_lock: area?.id ?? null,
    lock_terms: area?.lock_terms ?? [],
    facets,
    queries,
  };
}

/** Drafter directive lines: keep facets separated, footnotes facet-scoped. */
export function buildFacetDirective(res: FacetExpansionResult): string[] {
  if (!res.enabled || res.facets.length === 0) return [];
  const lines: string[] = [];
  lines.push("");
  lines.push(
    "פירוק דוקטרינרי (facets) — הסוגיה מתפרקת לרכיבים הבאים. טפל בכל רכיב בנפרד, ואל תמזג ביניהם:",
  );
  for (const f of res.facets) {
    lines.push(
      `  • ${f.doctrinal_label} — סוג המקור המועדף: ${f.required_source_preference}; רמת התמיכה הצפויה: ${f.expected_support_type}`,
    );
  }
  lines.push(
    "כללי הערות שוליים לפי רכיב: כל הערת שוליים תתמוך ברכיב אחד ספציפי. אין לאחד תחת הערה אחת מקורות שאינם תומכים באותו רכיב עצמו. הערה מרובת־מקורות מותרת רק כאשר כל המקורות שבה תומכים ישירות באותו רכיב.",
  );
  lines.push(
    "אם לרכיב מסוים אין מקור ראשוני ישיר (חוק, תקנה או פסיקה מחייבת) בין המקורות שסופקו — אמור זאת במפורש באותו מקום, או נסח את הנקודה בלשון מוגבלת. ספרות אקדמית או פרשנות אינן תחליף למקור ראשוני חסר, ומקור שיש בידיך רק את פרטיו הביבליוגרפיים (ללא טקסט) אינו יכול לתמוך בקביעת הלכה או כלל.",
  );
  if (res.lock_terms.length > 0) {
    lines.push(
      `אין לבסס את הכלל בסוגיה זו על מקורות מתחומים אחרים${
        res.facets[0]?.negative_scope_terms.length
          ? ` (למשל ${res.facets[0].negative_scope_terms.slice(0, 3).join(", ")})`
          : ""
      } — התחום הרלוונטי הוא ${res.lock_terms.join(", ")}.`,
    );
  }
  return lines;
}

// ─── Coverage telemetry ─────────────────────────────────────────────────────
export interface FacetSourceView {
  candidate_id: string;
  title: string;
  snippet: string;
  source_type: string;
  role: string;
  support: string; // direct | partial | tangential | unrelated | unknown
  citable_as?: string;
  text_usability?: string;
  used: boolean;
  query_he?: string;
  facet_id?: string | null;
}

export interface FacetTelemetry {
  facet_id: string;
  parent_claim_id: string;
  doctrinal_label: string;
  legal_area: string;
  required_source_preference: FacetSourcePreference;
  expected_support_type: FacetSupportType;
  generated_queries: string[];
  sources_found: number;
  sources_used: number;
  best_support_level: string;
  primary_support_found: boolean;
  metadata_only_count: number;
  commentary_only: boolean;
  insufficiency_reason: string | null;
}

const HEB_PREFIX = /^(ו|ה|ב|ל|כ|מ|ש)+/;

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (text || "").split(/[^\u0590-\u05FFA-Za-z0-9"׳״']+/)) {
    const w = raw.replace(/["׳״']/g, "").trim();
    if (w.length < 3) continue;
    out.add(w);
    const stripped = w.replace(HEB_PREFIX, "");
    if (stripped.length >= 3) out.add(stripped);
  }
  return out;
}

const SUPPORT_ORDER = ["unknown", "unrelated", "tangential", "partial", "direct"];

function isPrimary(sv: FacetSourceView): boolean {
  const t = `${sv.source_type} ${sv.role}`.toLowerCase();
  return /statute|regulation|case|legislation|judgment/.test(t) &&
    !/scholarship|academic|article|blog|commentary/.test(t);
}

function isMetadataOnly(sv: FacetSourceView): boolean {
  if (sv.text_usability && /metadata|none|unusable/i.test(sv.text_usability)) return true;
  return (sv.snippet || "").trim().length < 60;
}

export function computeFacetCoverage(
  facets: ClaimFacet[],
  sources: FacetSourceView[],
): FacetTelemetry[] {
  return facets.map((f) => {
    const facetTokens = tokens(f.query_terms.join(" ") + " " + f.doctrinal_label);
    const matched = sources.filter((s) => {
      if (s.facet_id && s.facet_id === f.facet_id) return true;
      const st = tokens(`${s.title} ${s.snippet} ${s.query_he ?? ""}`);
      let hits = 0;
      for (const t of facetTokens) if (st.has(t)) hits += 1;
      return hits >= 3;
    });
    const used = matched.filter((s) => s.used);
    let best = "unknown";
    for (const s of matched) {
      if (SUPPORT_ORDER.indexOf(s.support) > SUPPORT_ORDER.indexOf(best)) best = s.support;
    }
    const primaryWithText = matched.filter((s) => isPrimary(s) && !isMetadataOnly(s));
    const metadataOnly = matched.filter(isMetadataOnly);
    const commentaryOnly = matched.length > 0 && primaryWithText.length === 0;
    let insufficiency: string | null = null;
    if (matched.length === 0) insufficiency = "no_sources_matched";
    else if (
      f.required_source_preference !== "scholarship_secondary" &&
      primaryWithText.length === 0
    ) {
      insufficiency = metadataOnly.length > 0 ? "metadata_only_primary" : "commentary_only";
    }
    return {
      facet_id: f.facet_id,
      parent_claim_id: f.parent_claim_id,
      doctrinal_label: f.doctrinal_label,
      legal_area: f.legal_area,
      required_source_preference: f.required_source_preference,
      expected_support_type: f.expected_support_type,
      generated_queries: f.query_terms,
      sources_found: matched.length,
      sources_used: used.length,
      best_support_level: best,
      primary_support_found: primaryWithText.length > 0,
      metadata_only_count: metadataOnly.length,
      commentary_only: commentaryOnly,
      insufficiency_reason: insufficiency,
    };
  });
}

/**
 * claim_source_match_validation_v1 — deterministic legal-area inference for a
 * free-text blob (source title + snippet, or a drafted block's text). Returns
 * an AREA_LOCKS id, or null when no area vocabulary is present.
 */
export function inferLegalAreaId(text: string): string | null {
  if (!text) return null;
  const hay = text.slice(0, 4000);
  for (const a of AREA_LOCKS) if (a.trigger.test(hay)) return a.id;
  return null;
}
