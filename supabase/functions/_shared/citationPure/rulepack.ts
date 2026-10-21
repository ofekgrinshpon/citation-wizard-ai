/**
 * D1 — rulepack capability manifest (pure, browser + Deno).
 *
 * A manifest entry describes a citation template's scope and gates; it is NOT
 * proof of country support. Only `status: "enabled"` entries describe routes
 * that already exist; `planned_disabled` entries are specifications only and
 * never render, look up or gain eligibility. Renderer ids keep the existing
 * `foreign_bluebook_v22` product id even where the rule authority is edition 21.
 */
import { FOREIGN_RULESET_ID } from "./types.ts";

export const RULEPACK_MANIFEST_VERSION = 1 as const;

/** Shared manual-choice / classification jurisdictions (citation routing only). */
export const MANUAL_CHOICE_JURISDICTIONS = ["IL", "US", "UK", "DE", "AU", "CA", "FR", "UNKNOWN"] as const;
export type ManualChoiceJurisdiction = typeof MANUAL_CHOICE_JURISDICTIONS[number];
/** Existing typed-lookup wire jurisdictions; unchanged by D1. */
export const LOOKUP_JURISDICTIONS = ["US", "UK", "OTHER", "UNKNOWN"] as const;
export type LookupJurisdiction = typeof LOOKUP_JURISDICTIONS[number];
/** Countries whose rulepacks are specified but disabled (no template, no completion). */
export const PLANNED_JURISDICTIONS = ["AU", "CA", "DE", "FR"] as const;

export type RulepackStatus = "enabled" | "planned_disabled";
export interface RulepackEntry {
  id: string;
  /** Rulepack scope; "GENERAL" = jurisdiction-independent general literature rules. */
  jurisdiction: "US" | "UK" | "GENERAL" | "UNANCHORED" | "AU" | "CA" | "DE" | "FR";
  jurisdictionId: string | null;
  subjurisdiction: string | null;
  family: string;
  template: string;
  authority: { work: string; edition: string; rules: string[]; url?: string; observed?: string };
  rendererId: string | null;
  status: RulepackStatus;
  requiredFields: string[];
  exclusions: string[];
  /** Typed-lookup kind/jurisdiction this entry already allows; null = never looked up. */
  completion: { kind: string; jurisdiction: LookupJurisdiction } | null;
  notes?: string;
}

const B21 = "Bluebook";
const OBS = "2026-10-21";
const T2 = "https://www.legalbluebook.com/bluebook/v21/tables/t2-foreign-jurisdictions/";
const enabled = (e: Omit<RulepackEntry, "status" | "rendererId" | "jurisdictionId" | "subjurisdiction" | "exclusions"> & Partial<RulepackEntry>): RulepackEntry =>
  ({ status: "enabled", rendererId: FOREIGN_RULESET_ID, jurisdictionId: null, subjurisdiction: null, exclusions: [], ...e });
const planned = (e: Omit<RulepackEntry, "status" | "rendererId" | "completion" | "subjurisdiction"> & Partial<RulepackEntry>): RulepackEntry =>
  ({ status: "planned_disabled", rendererId: null, completion: null, subjurisdiction: null, ...e });

/** Array frozen; entry status is read at decision time (tests toggle and restore it). */
export const RULEPACK_MANIFEST: readonly RulepackEntry[] = Object.freeze([
  // Existing routes (migrated, unchanged behavior).
  enabled({ id: "us.case.reported", jurisdiction: "US", jurisdictionId: "us", family: "case", template: "reported US decision", authority: { work: B21, edition: "21", rules: ["R10"] }, requiredFields: ["caseName", "volume", "reporter", "firstPage", "year"], completion: { kind: "case", jurisdiction: "US" } }),
  enabled({ id: "us.case.unreported", jurisdiction: "US", jurisdictionId: "us", family: "case", template: "US unreported/slip/pending decision (local only)", authority: { work: B21, edition: "21", rules: ["R10.8.1"] }, requiredFields: ["caseName", "docket", "court", "decisionDate"], completion: null, notes: "Database identifier optional; no reporter volume/page." }),
  enabled({ id: "us.constitution", jurisdiction: "US", jurisdictionId: "us", family: "constitution", template: "U.S./state constitution provision (local only)", authority: { work: B21, edition: "21", rules: ["R11"] }, requiredFields: ["jurisdiction", "division"], completion: null }),
  enabled({ id: "us.statute", jurisdiction: "US", jurisdictionId: "us", family: "statute", template: "U.S.C. code section", authority: { work: B21, edition: "21", rules: ["R12"] }, requiredFields: ["titleNumber", "code", "section", "year"], completion: { kind: "statute", jurisdiction: "US" } }),
  enabled({ id: "uk.case", jurisdiction: "UK", jurisdictionId: "t2:united-kingdom", subjurisdiction: "t2:united-kingdom/england-and-wales", family: "case", template: "UK neutral/reported decision", authority: { work: B21, edition: "21", rules: ["T2.43"] }, requiredFields: ["caseName"], completion: { kind: "case", jurisdiction: "UK" } }),
  enabled({ id: "uk.statute", jurisdiction: "UK", jurisdictionId: "t2:united-kingdom", family: "statute", template: "UK Act (year, chapter)", authority: { work: B21, edition: "21", rules: ["T2.43"] }, requiredFields: ["statuteName", "year"], completion: { kind: "statute", jurisdiction: "UK" } }),
  enabled({ id: "unanchored.case", jurisdiction: "UNANCHORED", family: "case", template: "case-shaped input without jurisdiction anchor (lookup resolves US/UK only)", authority: { work: B21, edition: "21", rules: ["R10"] }, requiredFields: ["caseName"], completion: { kind: "case", jurisdiction: "UNKNOWN" }, notes: "Lookup may only ground US/UK identity; never a country claim." }),
  ...(["book", "book_chapter", "journal_article"] as const).map(family => enabled({ id: `general.${family}`, jurisdiction: "GENERAL", family, template: family, authority: { work: B21, edition: "21", rules: family === "journal_article" ? ["R16"] : ["R15"] }, requiredFields: family === "book_chapter" ? ["chapterTitle", "bookTitle"] : family === "book" ? ["bookTitle"] : ["articleTitle", "journal"], completion: { kind: family, jurisdiction: "OTHER" } })),
  ...(["unpublished_manuscript", "thesis", "newspaper", "internet"] as const).map(family => enabled({ id: `general.${family}`, jurisdiction: "GENERAL", family, template: family, authority: { work: B21, edition: "21", rules: family === "newspaper" ? ["R16.6"] : family === "internet" ? ["R18"] : ["R17.2"] }, requiredFields: [], completion: null, notes: "Local formatting only." })),
  // Planned, disabled: specifications only (no template, no completion).
  enabled({ completion: null, id: "au.case.reported", jurisdiction: "AU", jurisdictionId: "t2:australia", family: "case", template: "CLR / FCR reported case", authority: { work: B21, edition: "21", rules: ["T2.2"], url: `${T2}t2-2-australia`, observed: OBS }, requiredFields: ["caseName", "reporterYear", "reporterVolume", "reporter", "firstPage"], exclusions: ["state reporters", "unknown parallel reports"], notes: "T2.2 italicizes party names." }),
  enabled({ completion: null, id: "au.case.neutral", jurisdiction: "AU", jurisdictionId: "t2:australia", family: "case", template: "HCA / FCA neutral citation with supplied date", authority: { work: B21, edition: "21", rules: ["T2.2"], url: `${T2}t2-2-australia`, observed: OBS }, requiredFields: ["caseName", "neutralYear", "court", "neutralNumber", "decisionDate"], exclusions: ["FCAFC", "other courts"] }),
  enabled({ completion: null, id: "au.statute.cth", jurisdiction: "AU", jurisdictionId: "t2:australia", family: "statute", template: "Commonwealth Act (Cth)", authority: { work: B21, edition: "21", rules: ["T2.2"], url: `${T2}t2-2-australia`, observed: OBS }, requiredFields: ["statuteName", "enactmentYear"], exclusions: ["state/territory statutes", "bills", "regulations"], notes: "T2.2 italicizes statute title and year." }),
  enabled({ completion: null, id: "ca.case.scc_neutral", jurisdiction: "CA", jurisdictionId: "t2:canada", family: "case", template: "SCC neutral citation (optional modern S.C.R. parallel)", authority: { work: B21, edition: "21", rules: ["T2.6"], url: `${T2}t2-6-canada`, observed: OBS }, requiredFields: ["caseName", "neutralYear", "neutralNumber"], exclusions: ["provincial courts", "CanLII", "Quicklaw"] }),
  enabled({ completion: null, id: "ca.case.scr", jurisdiction: "CA", jurisdictionId: "t2:canada", family: "case", template: "standalone modern S.C.R. report", authority: { work: B21, edition: "21", rules: ["T2.6"], url: `${T2}t2-6-canada`, observed: OBS }, requiredFields: ["caseName", "reporterYear", "reporterVolume", "reporter", "firstPage"], exclusions: ["provincial courts", "pre-1975 SCR"] }),
  enabled({ completion: null, id: "ca.statute.federal", jurisdiction: "CA", jurisdictionId: "t2:canada", family: "statute", template: "R.S.C. / S.C. federal statute", authority: { work: B21, edition: "21", rules: ["T2.6"], url: `${T2}t2-6-canada`, observed: OBS }, requiredFields: ["statuteName", "code", "revisionYear", "chapter"], exclusions: ["provincial statutes", "regulations"] }),
  planned({ id: "de.case.reported", jurisdiction: "DE", jurisdictionId: "t2:germany-federal-republic-of", family: "case", template: "BGH / BVerfG reported (BGHZ, BVerfGE)", authority: { work: B21, edition: "21", rules: ["T2.14", "R20"], url: `${T2}t2-14-germany-federal-republic-of`, observed: OBS }, requiredFields: ["court", "decisionDate", "reporter", "volume", "firstPage"], exclusions: [], notes: "Expanded reporter small caps; court identity roman." }),
  planned({ id: "de.case.unpublished", jurisdiction: "DE", jurisdictionId: "t2:germany-federal-republic-of", family: "case", template: "BGH unpublished decision by docket", authority: { work: B21, edition: "21", rules: ["T2.14", "R20"], url: `${T2}t2-14-germany-federal-republic-of`, observed: OBS }, requiredFields: ["court", "decisionDate", "docket"], exclusions: [] }),
  planned({ id: "de.statute.code", jurisdiction: "DE", jurisdictionId: "t2:germany-federal-republic-of", family: "statute", template: "BGB / HGB code provision", authority: { work: B21, edition: "21", rules: ["T2.14", "R20"], url: `${T2}t2-14-germany-federal-republic-of`, observed: OBS }, requiredFields: ["code", "section"], exclusions: ["Länder law"], notes: "Code identity small caps (R20)." }),
  planned({ id: "fr.case.cass", jurisdiction: "FR", jurisdictionId: "t2:france-republic-of", family: "case", template: "Cass. selected civ./crim. chambers with Bull.", authority: { work: B21, edition: "21", rules: ["T2.13", "R20"], url: `${T2}t2-13-france-republic-of`, observed: OBS }, requiredFields: ["court", "chamber", "decisionDate", "reporter", "bulletinPart", "decisionNumber"], exclusions: ["Cass. oc./soc. — source table anomaly unresolved"] }),
  planned({ id: "fr.statute.code", jurisdiction: "FR", jurisdictionId: "t2:france-republic-of", family: "statute", template: "Code civil / Code de commerce article", authority: { work: B21, edition: "21", rules: ["T2.13", "R20"], url: `${T2}t2-13-france-republic-of`, observed: OBS }, requiredFields: ["code", "section"], exclusions: [] }),
]);

const PLANNED_PREFIX: Record<string, ManualChoiceJurisdiction> = {
  "t2:australia": "AU", "t2:canada": "CA", "t2:france-republic-of": "FR", "t2:germany-federal-republic-of": "DE",
};
/** Classification jurisdiction id → manual-choice jurisdiction. Unlisted ids stay UNKNOWN (never US/IL). */
export function rulepackJurisdictionFromId(id: string | undefined): ManualChoiceJurisdiction | null {
  if (!id) return null;
  if (id === "us" || id.startsWith("us:")) return "US";
  if (id === "t2:united-kingdom" || id.startsWith("t2:united-kingdom/")) return "UK";
  if (id === "t2:israel") return "IL";
  for (const [p, j] of Object.entries(PLANNED_PREFIX)) if (id === p || id.startsWith(`${p}/`)) return j;
  return "UNKNOWN";
}
export function isManualChoiceJurisdiction(v: unknown): v is ManualChoiceJurisdiction {
  return typeof v === "string" && (MANUAL_CHOICE_JURISDICTIONS as readonly string[]).includes(v);
}
export function isPlannedJurisdiction(j: unknown): j is typeof PLANNED_JURISDICTIONS[number] {
  return typeof j === "string" && (PLANNED_JURISDICTIONS as readonly string[]).includes(j) && !RULEPACK_MANIFEST.some(e => e.jurisdiction === j && e.status === "enabled");
}
/** Enabled template for a jurisdiction/family; planned packs never qualify. */
export function enabledRulepack(jurisdiction: string, family: string): RulepackEntry | null {
  return RULEPACK_MANIFEST.find(e => e.status === "enabled" && e.jurisdiction === jurisdiction && e.family === family) ?? null;
}
/** Existing typed-lookup eligibility, expressed through the manifest. */
/** Planner wire-plan eligibility: an enabled completion with exactly this wire jurisdiction. */
export function rulepackLookupEligible(kind: string, jurisdiction: string): boolean {
  return RULEPACK_MANIFEST.some(e => e.status === "enabled" && e.completion?.kind === kind && e.completion.jurisdiction === jurisdiction);
}
/** Wire version handling: absent = legacy v1 compatible; any other value is unsupported (fail closed). */
export function readRulepackVersion(v: unknown): "current" | "legacy" | "unsupported" {
  return v === undefined ? "legacy" : v === RULEPACK_MANIFEST_VERSION ? "current" : "unsupported";
}
export const PLANNED_RULEPACK_WARNING = "כללי האזכור לתחום השיפוט שנבחר מתוכננים אך עדיין אינם זמינים; הקלט נשמר ללא השלמה וללא חיפוש. ניתן לעצב ידנית או לבחור תחום שיפוט נתמך.";

const GENERAL_FAMILIES = new Set(["book", "book_chapter", "journal_article", "unpublished_manuscript", "thesis", "newspaper", "internet"]);
/**
 * The single capability decision used by planner and server: an enabled entry
 * for (family, jurisdiction) permits local formatting; its completion permits
 * typed lookup. General literature is jurisdiction-independent; case
 * jurisdictions other than US/UK resolve to the unanchored entry.
 */
export function rulepackCapability(family: string, jurisdiction: string, templateId?: string): { local: boolean; lookup: boolean; lookupJurisdiction: LookupJurisdiction | null } {
  const scope = GENERAL_FAMILIES.has(family) ? "GENERAL" : ["US", "UK", "AU", "CA"].includes(jurisdiction) ? jurisdiction
    : family === "case" && (jurisdiction === "OTHER" || jurisdiction === "UNKNOWN") ? "UNANCHORED" : null;
  const entries = scope ? RULEPACK_MANIFEST.filter(e => e.status === "enabled" && e.jurisdiction === scope && e.family === family && (scope !== "AU" && scope !== "CA" || e.id === templateId)) : [];
  const completion = entries.find(e => e.completion)?.completion ?? null;
  return { local: entries.length > 0, lookup: !!completion, lookupJurisdiction: completion?.jurisdiction ?? null };
}
export function isGeneralFamily(family: string | null | undefined): boolean {
  return !!family && GENERAL_FAMILIES.has(family);
}
export const DISABLED_RULEPACK_WARNING = "תבנית האזכור לסוג המקור ולתחום השיפוט אינה זמינה; הקלט נשמר ללא השלמה וללא חיפוש.";
