// core_authority_registry_v1 — Stage 1 (curated doctrine → canonical authority
// seeding) + Stage 2(a) (statute-title normalisation).
//
// Principle (non-negotiable): the registry seeds *search queries only*. It
// never forces a citation, never forces a holding, and never bypasses
// source-integrity, the verifier, body acquisition, sufficiency, the
// metadata-only holding gate, or the footnote invariant. Everything it adds is
// an ordinary Query that must survive every existing gate on its own merits.

import { AnalyzerOutput, Query, SourceRole } from "../lib/types.ts";
import type { ClaimFacet } from "./claimFacetExpansion.ts";

export const CORE_AUTHORITY_REGISTRY_VERSION = "core_authority_registry_v1";

/** Hard cap: at most this many registry-seeded queries per run. */
export const MAX_REGISTRY_QUERIES = 2;

/**
 * source_nomination_v1 supersedes the hand-maintained landmark-case list as
 * the recall mechanism. Case seeding is kept in the code purely as telemetry
 * so nomination quality can be compared against the old list; it no longer
 * injects queries. Statute-title normalisation (Stage 2a) stays active — it is
 * bounded linguistic normalisation, not case recall.
 */
export const CASE_SEEDING_MODE: "query_seeding" | "telemetry_only" = "telemetry_only";

export type AuthorityKind = "case" | "statute";

export interface CanonicalAuthority {
  authority_id: string;
  kind: AuthorityKind;
  /** Human label used in telemetry and (name+docket) query construction. */
  label: string;
  /** Docket for judgments (e.g. `6821/93`), absent for statutes. */
  docket?: string;
  /** Tokens used to detect presence in planner queries and in retrieved rows. */
  match_terms: string[];
  role: SourceRole;
  expected_source_type: "case" | "statute";
  /** Ready-made retrieval query (name+docket preferred where available). */
  query_he: string;
}

export interface DoctrineEntry {
  doctrine_id: string;
  /** Doctrinal label (Hebrew) shown in telemetry. */
  label: string;
  area: string;
  /** Fires on the question text + claims + facet labels. */
  trigger: RegExp;
  /** Lower number = matched first when several doctrines fire. */
  priority: number;
  canonical_authorities: CanonicalAuthority[];
}

const A = (a: CanonicalAuthority) => a;

// ─── Stage 1: curated doctrine registry ─────────────────────────────────────
export const DOCTRINE_REGISTRY: DoctrineEntry[] = [
  {
    doctrine_id: "proportionality",
    label: "מבחני המידתיות",
    area: "constitutional",
    priority: 1,
    trigger: /(מידתיות|פסקת\s+ההגבלה|מבחן\s+האמצעי\s+שפגיעתו\s+פחותה|מידתיות\s+במובן\s+הצר)/,
    canonical_authorities: [
      A({
        authority_id: "basic_law_dignity_s8",
        kind: "statute",
        label: "חוק-יסוד: כבוד האדם וחירותו, סעיף 8 (פסקת ההגבלה)",
        match_terms: ["כבוד האדם וחירותו", "פסקת ההגבלה"],
        role: "primary_statute",
        expected_source_type: "statute",
        query_he: "חוק-יסוד: כבוד האדם וחירותו סעיף 8 פסקת ההגבלה נוסח",
      }),
      A({
        authority_id: "hcj_6821_93_mizrahi",
        kind: "case",
        label: "בג\"ץ 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי",
        docket: "6821/93",
        match_terms: ["6821/93", "בנק המזרחי"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "בג\"ץ 6821/93 בנק המזרחי המאוחד נ' מגדל כפר שיתופי מבחני המידתיות",
      }),
      A({
        authority_id: "hcj_1715_97_investment_managers",
        kind: "case",
        label: "בג\"ץ 1715/97 לשכת מנהלי ההשקעות נ' שר האוצר",
        docket: "1715/97",
        match_terms: ["1715/97", "לשכת מנהלי ההשקעות"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "בג\"ץ 1715/97 לשכת מנהלי ההשקעות בישראל נ' שר האוצר מבחני המידתיות",
      }),
    ],
  },
  {
    doctrine_id: "reasonableness",
    label: "עילת הסבירות",
    area: "public_law_hcj",
    priority: 2,
    trigger: /(עילת\s+הסבירות|סביר(ות|ה)\s+מינהלית|חוסר\s+סבירות\s+קיצוני|מתחם\s+הסבירות)/,
    canonical_authorities: [
      A({
        authority_id: "hcj_389_80_dapei_zahav",
        kind: "case",
        label: "בג\"ץ 389/80 דפי זהב נ' רשות השידור",
        docket: "389/80",
        match_terms: ["389/80", "דפי זהב"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "בג\"ץ 389/80 דפי זהב בע\"מ נ' רשות השידור עילת הסבירות",
      }),
      A({
        authority_id: "hcj_935_89_ganor",
        kind: "case",
        label: "בג\"ץ 935/89 גנור נ' היועץ המשפטי לממשלה",
        docket: "935/89",
        match_terms: ["935/89", "גנור"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "בג\"ץ 935/89 גנור נ' היועץ המשפטי לממשלה סבירות שיקול הדעת",
      }),
      A({
        authority_id: "hcj_5658_23_reasonableness_amendment",
        kind: "case",
        label: "בג\"ץ 5658/23 (ביטול עילת הסבירות)",
        docket: "5658/23",
        match_terms: ["5658/23", "התנועה למען איכות השלטון"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "בג\"ץ 5658/23 תיקון חוק-יסוד השפיטה ביטול עילת הסבירות",
      }),
    ],
  },
  {
    doctrine_id: "rabbinical_civil_property",
    label: "בית הדין הרבני וחלוקת רכוש לפי הדין האזרחי",
    area: "family_property",
    priority: 3,
    // Court phrase tolerates the missing definite article ("בית דין רבני")
    // and plural forms. Over-trigger control: a civil-property signal
    // (רכוש/ממון/שיתוף/איזון משאבים/חלוקת רכוש) must appear within 80 chars —
    // generic גט/כתובה/גירושין questions therefore never trigger.
    trigger:
      /((?:בית|בתי)[\s\u05be-]+ה?דין[\s\u05be-]+ה?רבני(?:ים)?)[\s\S]{0,80}(רכוש|ממון|שיתוף|איזון)|((רכוש|ממון|שיתוף|איזון)[\s\S]{0,80}((?:בית|בתי)[\s\u05be-]+ה?דין[\s\u05be-]+ה?רבני(?:ים)?))|הלכת\s+בבלי/,
    canonical_authorities: [
      A({
        authority_id: "hcj_1000_92_bavli",
        kind: "case",
        label: "בג\"ץ 1000/92 בבלי נ' בית הדין הרבני הגדול",
        docket: "1000/92",
        match_terms: ["1000/92", "בבלי"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "בג\"ץ 1000/92 בבלי נ' בית הדין הרבני הגדול הלכת השיתוף",
      }),
      A({
        authority_id: "hcj_8638_03_sima_amir",
        kind: "case",
        label: "בג\"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול",
        docket: "8638/03",
        match_terms: ["8638/03", "סימה אמיר"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "בג\"ץ 8638/03 סימה אמיר נ' בית הדין הרבני הגדול בירושלים",
      }),
      A({
        authority_id: "law_spousal_property",
        kind: "statute",
        label: "חוק יחסי ממון בין בני זוג, תשל\"ג-1973",
        match_terms: ["יחסי ממון בין בני זוג"],
        role: "primary_statute",
        expected_source_type: "statute",
        query_he: "חוק יחסי ממון בין בני זוג, תשל\"ג-1973 איזון משאבים נוסח",
      }),
      A({
        authority_id: "law_rabbinical_jurisdiction",
        kind: "statute",
        label: "חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי\"ג-1953",
        match_terms: ["שיפוט בתי דין רבניים"],
        role: "primary_statute",
        expected_source_type: "statute",
        query_he: "חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי\"ג-1953 נוסח",
      }),
    ],
  },
  {
    doctrine_id: "precontractual_good_faith",
    label: "תום לב במשא ומתן — סעיף 12 לחוק החוזים",
    area: "contracts",
    priority: 4,
    trigger: /(תום\s+לב[\s\S]{0,40}(משא\s+ומתן|מו["״']?מ)|סעיף\s*12[\s\S]{0,30}חוק\s+החוזים|חובה\s+קדם[- ]חוזית)/,
    canonical_authorities: [
      A({
        authority_id: "contracts_law_s12",
        kind: "statute",
        label: "חוק החוזים (חלק כללי), תשל\"ג-1973, סעיף 12",
        match_terms: ["חוק החוזים (חלק כללי)", "סעיף 12"],
        role: "primary_statute",
        expected_source_type: "statute",
        query_he: "חוק החוזים (חלק כללי), תשל\"ג-1973 סעיף 12 תום לב במשא ומתן נוסח",
      }),
      A({
        authority_id: "dn_7_81_pnidar",
        kind: "case",
        label: "ד\"נ 7/81 פנידר נ' קסטרו",
        docket: "7/81",
        match_terms: ["7/81", "פנידר", "קסטרו"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "ד\"נ 7/81 פנידר נ' קסטרו תום לב במשא ומתן",
      }),
      A({
        authority_id: "ca_6370_00_kal_binyan",
        kind: "case",
        label: "ע\"א 6370/00 קל בנין בע\"מ נ' ע.ר.מ. רעננה",
        docket: "6370/00",
        match_terms: ["6370/00", "קל בנין"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "ע\"א 6370/00 קל בנין בע\"מ נ' ע.ר.מ. רעננה לביצוע פרויקטים תום לב",
      }),
    ],
  },
  {
    doctrine_id: "piercing_corporate_veil",
    label: "הרמת מסך — סעיף 6 לחוק החברות",
    area: "companies",
    priority: 5,
    trigger: /(הרמת\s+מסך|ייחוס\s+חוב[\s\S]{0,30}בעל\s+מניות|סעיף\s*6[\s\S]{0,30}חוק\s+החברות)/,
    canonical_authorities: [
      A({
        authority_id: "companies_law_s6",
        kind: "statute",
        label: "חוק החברות, תשנ\"ט-1999, סעיף 6",
        match_terms: ["חוק החברות", "סעיף 6"],
        role: "primary_statute",
        expected_source_type: "statute",
        query_he: "חוק החברות, תשנ\"ט-1999 סעיף 6 הרמת מסך נוסח",
      }),
      A({
        authority_id: "ca_4263_04_mishmar_haemek",
        kind: "case",
        label: "ע\"א 4263/04 קיבוץ משמר העמק נ' עו\"ד מנור",
        docket: "4263/04",
        match_terms: ["4263/04", "משמר העמק"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "ע\"א 4263/04 קיבוץ משמר העמק נ' עו\"ד מנור הרמת מסך",
      }),
      A({
        authority_id: "ca_2773_04_atar_nitzba",
        kind: "case",
        label: "ע\"א 2773/04 עטר נ' נצבא חברה להתנחלות",
        docket: "2773/04",
        match_terms: ["2773/04", "נצבא"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "ע\"א 2773/04 עטר נ' נצבא חברה להתנחלות בע\"מ הרמת מסך",
      }),
    ],
  },
  {
    doctrine_id: "selective_enforcement",
    label: "אכיפה בררנית",
    area: "public_law_hcj",
    priority: 6,
    trigger: /(אכיפה\s+בררנית|אכיפה\s+סלקטיבית|הפליה\s+באכיפה)/,
    canonical_authorities: [
      A({
        authority_id: "hcj_6396_96_zakin",
        kind: "case",
        label: "בג\"ץ 6396/96 זקין נ' ראש עיריית באר-שבע",
        docket: "6396/96",
        match_terms: ["6396/96", "זקין"],
        role: "binding_case_law",
        expected_source_type: "case",
        query_he: "בג\"ץ 6396/96 זקין נ' ראש עיריית באר שבע אכיפה בררנית",
      }),
    ],
  },
];

// ─── Stage 2(a): statute-title normalisation ────────────────────────────────
interface StatuteAlias {
  alias: RegExp;
  /** Exact statutory title. */
  canonical: string;
  /** Detects that the exact title is already present (skip rewrite). */
  present: RegExp;
}

const STATUTE_ALIASES: StatuteAlias[] = [
  {
    alias: /חוק\s+יחסי\s+ממון(?!\s+בין\s+בני\s+זוג)/g,
    canonical: "חוק יחסי ממון בין בני זוג, תשל\"ג-1973",
    present: /חוק\s+יחסי\s+ממון\s+בין\s+בני\s+זוג/,
  },
  {
    alias: /חוק\s+בתי\s+הדין\s+הרבניים/g,
    canonical: "חוק שיפוט בתי דין רבניים (נישואין וגירושין), תשי\"ג-1953",
    present: /חוק\s+שיפוט\s+בתי\s+דין\s+רבניים/,
  },
  {
    alias: /חוק\s+החוזים(?!\s*\()/g,
    canonical: "חוק החוזים (חלק כללי), תשל\"ג-1973",
    present: /חוק\s+החוזים\s*\(חלק\s+כללי\)/,
  },
  {
    alias: /חוק\s+החברות(?!\s*,\s*תשנ)/g,
    canonical: "חוק החברות, תשנ\"ט-1999",
    present: /חוק\s+החברות\s*,\s*תשנ["״']?ט/,
  },
  {
    alias: /חוק\s+המאבק\s+בטרור(?!\s*,\s*תשע)/g,
    canonical: "חוק המאבק בטרור, תשע\"ו-2016",
    present: /חוק\s+המאבק\s+בטרור\s*,\s*תשע["״']?ו/,
  },
];

/**
 * Normalize a bare statute title (not a query) to its exact statutory title.
 * Shared with the nominated-statute acquisition lane so a nomination like
 * "חוק יחסי ממון" is looked up / validated under the canonical title.
 */
export function normalizeStatuteTitleText(
  title: string | null | undefined,
): { normalized: string; changed: boolean } {
  let text = String(title ?? "");
  const before = text;
  for (const a of STATUTE_ALIASES) {
    if (a.present.test(text)) continue;
    a.alias.lastIndex = 0;
    if (!a.alias.test(text)) continue;
    a.alias.lastIndex = 0;
    text = text.replace(a.alias, a.canonical);
  }
  return { normalized: text.trim(), changed: text.trim() !== before.trim() };
}

export interface StatuteNormalizationReport {
  applied: boolean;
  rewritten_count: number;
  rewrites: Array<{ before: string; after: string }>;
}

/**
 * Rewrite informal statute names inside planner query text to the exact
 * statutory title. Query text only — roles, targets and claim bindings are
 * untouched, and nothing else in the pipeline is affected.
 */
export function normalizeStatuteTitles<T extends { query_he: string }>(
  queries: T[],
): { queries: T[]; report: StatuteNormalizationReport } {
  const rewrites: Array<{ before: string; after: string }> = [];
  const out = queries.map((q) => {
    let text = q.query_he ?? "";
    for (const a of STATUTE_ALIASES) {
      if (a.present.test(text)) continue;
      a.alias.lastIndex = 0;
      if (!a.alias.test(text)) continue;
      a.alias.lastIndex = 0;
      text = text.replace(a.alias, a.canonical);
    }
    if (text !== q.query_he) {
      rewrites.push({ before: q.query_he, after: text });
      return { ...q, query_he: text };
    }
    return q;
  });
  return {
    queries: out,
    report: {
      applied: rewrites.length > 0,
      rewritten_count: rewrites.length,
      rewrites: rewrites.slice(0, 10),
    },
  };
}

// ─── Seeding ────────────────────────────────────────────────────────────────
export interface SeededAuthorityTelemetry {
  authority_id: string;
  label: string;
  kind: AuthorityKind;
  docket: string | null;
  role: SourceRole;
  source_type_expected: string;
  query_he: string | null;
  skipped_because_already_present: boolean;
  retrieved: boolean;
  admitted: boolean;
  body_acquired: boolean;
  used: boolean;
}

export interface CoreAuthorityRegistryResult {
  registry_version: string;
  triggered: boolean;
  doctrine_id: string | null;
  doctrine_label: string | null;
  matched_facet: string | null;
  trigger_reason: string;
  area: string | null;
  authority_candidates: string[];
  queries: Query[];
  queries_added: number;
  skipped_because_already_present: string[];
  authorities: SeededAuthorityTelemetry[];
}

function haystack(question: string, analyzer: AnalyzerOutput, facets: ClaimFacet[]): string {
  return [
    question,
    analyzer.legal_area ?? "",
    ...(analyzer.claims ?? []).map((c) => c.text_he),
    ...facets.map((f) => `${f.doctrinal_label} ${f.query_terms.join(" ")}`),
  ].join(" \n ");
}

function alreadyPresent(auth: CanonicalAuthority, existing: string[]): boolean {
  return existing.some((q) => auth.match_terms.some((t) => q.includes(t)));
}

/**
 * Seed at most MAX_REGISTRY_QUERIES name-anchored retrieval queries for the
 * single highest-priority doctrine that fires. Planner queries are preserved
 * as-is; duplicates of authorities the planner already named are skipped.
 */
export function seedCoreAuthorityQueries(
  question: string,
  analyzer: AnalyzerOutput,
  facets: ClaimFacet[],
  existingQueries: Array<{ query_he: string }>,
): CoreAuthorityRegistryResult {
  const base: CoreAuthorityRegistryResult = {
    registry_version: CORE_AUTHORITY_REGISTRY_VERSION,
    triggered: false,
    doctrine_id: null,
    doctrine_label: null,
    matched_facet: null,
    trigger_reason: "no_doctrine_match",
    area: null,
    authority_candidates: [],
    queries: [],
    queries_added: 0,
    skipped_because_already_present: [],
    authorities: [],
  };

  const hay = haystack(question, analyzer, facets);
  const matches = DOCTRINE_REGISTRY.filter((d) => d.trigger.test(hay))
    .sort((a, b) => a.priority - b.priority);
  const doctrine = matches[0];
  if (!doctrine) return base;

  const matchedFacet = facets.find((f) => doctrine.trigger.test(f.doctrinal_label))?.facet_id ??
    null;
  const existing = existingQueries.map((q) => q.query_he ?? "");

  const authorities: SeededAuthorityTelemetry[] = [];
  const queries: Query[] = [];
  const skipped: string[] = [];
  const claimId = analyzer.claims?.[0]?.claim_id ?? "C1";

  for (const auth of doctrine.canonical_authorities) {
    const present = alreadyPresent(auth, existing);
    const room = queries.length < MAX_REGISTRY_QUERIES;
    const seed = !present && room && CASE_SEEDING_MODE === "query_seeding";
    if (present) skipped.push(auth.authority_id);
    authorities.push({
      authority_id: auth.authority_id,
      label: auth.label,
      kind: auth.kind,
      docket: auth.docket ?? null,
      role: auth.role,
      source_type_expected: auth.expected_source_type,
      query_he: seed ? auth.query_he : null,
      skipped_because_already_present: present,
      retrieved: false,
      admitted: false,
      body_acquired: false,
      used: false,
    });
    if (!seed) continue;
    queries.push({
      claim_id: claimId,
      role: auth.role,
      query_he: auth.query_he,
      targets: ["local_db", "perplexity"],
      expected_source_type: auth.expected_source_type,
      reason: `core_authority_registry:${doctrine.doctrine_id}:${auth.authority_id}`,
      metadata: {
        core_authority_registry: true,
        registry_version: CORE_AUTHORITY_REGISTRY_VERSION,
        doctrine_id: doctrine.doctrine_id,
        authority_id: auth.authority_id,
        matched_facet: matchedFacet,
      },
    } as Query);
  }

  return {
    ...base,
    triggered: queries.length > 0 || authorities.length > 0,
    doctrine_id: doctrine.doctrine_id,
    doctrine_label: doctrine.label,
    matched_facet: matchedFacet,
    trigger_reason: `doctrine_trigger_match:${doctrine.doctrine_id}`,
    area: doctrine.area,
    authority_candidates: doctrine.canonical_authorities.map((a) => a.authority_id),
    queries,
    queries_added: queries.length,
    skipped_because_already_present: skipped,
    authorities,
  };
}

// ─── Outcome telemetry (observability only) ─────────────────────────────────
export interface AuthorityOutcomeInput {
  candidates: Array<{
    candidate_id: string;
    title?: string | null;
    snippet?: string | null;
    source_url?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  usableIds: Set<string>;
  usedCandidateIds: Set<string>;
}

function authorityMatchesRow(
  auth: SeededAuthorityTelemetry,
  registryAuth: CanonicalAuthority | undefined,
  text: string,
): boolean {
  const terms = registryAuth?.match_terms ?? [auth.label];
  return terms.some((t) => t && text.includes(t));
}

/**
 * Fill retrieved/admitted/body_acquired/used flags for each seeded authority.
 * Pure measurement: nothing here changes admission, citation or drafting.
 */
export function computeAuthorityOutcomes(
  result: CoreAuthorityRegistryResult,
  input: AuthorityOutcomeInput,
): CoreAuthorityRegistryResult {
  if (!result.triggered) return result;
  const doctrine = DOCTRINE_REGISTRY.find((d) => d.doctrine_id === result.doctrine_id);
  const authorities = result.authorities.map((a) => {
    const registryAuth = doctrine?.canonical_authorities.find(
      (x) => x.authority_id === a.authority_id,
    );
    let retrieved = false;
    let admitted = false;
    let bodyAcquired = false;
    let used = false;
    for (const c of input.candidates) {
      const text = `${c.title ?? ""} ${c.source_url ?? ""} ${c.snippet ?? ""}`;
      if (!authorityMatchesRow(a, registryAuth, text)) continue;
      retrieved = true;
      if (input.usableIds.has(c.candidate_id)) admitted = true;
      const md = c.metadata ?? {};
      const usability = String(md.text_usability ?? "");
      if (
        md.body_acquired === true || md.has_body_text === true ||
        (usability && !/metadata|none|unusable/i.test(usability))
      ) bodyAcquired = true;
      if (input.usedCandidateIds.has(c.candidate_id)) used = true;
    }
    return { ...a, retrieved, admitted, body_acquired: bodyAcquired, used };
  });
  return { ...result, authorities };
}
