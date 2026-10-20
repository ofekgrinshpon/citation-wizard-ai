/**
 * Shared foreign-source classification (Stage C): detected / overrides /
 * effective for all 12 workbook axes, keyed by a STABLE item key with the
 * input fingerprint tracked separately. Pure and local — no network, no
 * model text. Detection confidence is NOT legal validity; `support` only
 * reports existing renderer coverage and `validity` is never asserted.
 */
import { detectForeignSource } from "@/data/bluebook/extract";
import type { SourceType } from "@/data/abbreviations";
import {
  INSTITUTION_PROFILES,
  OTHER_UNIDENTIFIED,
  TAXONOMY_VERSION,
  getAxis,
  isFamilyId,
  isSubtypeId,
  subtypeFamily,
} from "@/data/bluebook/classification/taxonomy";
import { UK_ID, US_ROOT_ID, ancestorsOf, getEntity, isUnder, resolveEntityId } from "@/data/bluebook/classification/entities";

export const CLASSIFICATION_VERSION = 1 as const;

/** Stable chat classification key: project + message position, never the input text. */
export const chatClassificationKey = (projectId: string | undefined, i: number) => `chat:${projectId ?? "default"}:${i}`;

export type Confidence = "high" | "medium" | "low" | "none";
export type Provenance = "deterministic_detector" | "user_override" | "none";
export interface Candidate { value: string; confidence: Confidence; evidence: string }
export interface FieldEvidence<T> { value: T | null; confidence: Confidence; provenance: Provenance; evidence: string[]; candidates: Candidate[] }

/** Single-value fields: family/subtype, the two single axes, and issuer_jurisdiction ids. */
export type ScalarField =
  | "family" | "subtype" | "jurisdiction" | "subjurisdiction" | "institution_profile" | "court"
  | "publication_status" | "proceeding_status";
export type MultiField = "access_medium" | "citation_scheme" | "container";
export type FlagField = "manifestation_flags" | "edition_flags";
export type StructuredAxis = "authorship" | "treaty_parties" | "language_script" | "reproduction_archive" | "issuer_jurisdiction";
export type StructuredValue = string | string[] | boolean | null;

/**
 * UI value kinds for structured fields (field names verbatim from the
 * workbook). This is input typing only — no legal validation is implied.
 */
export const STRUCTURED_FIELD_KIND: Record<StructuredAxis, Record<string, "list" | "text" | "boolean" | "entity">> = {
  authorship: { author_list: "list", institutional_author: "text", editor_list: "list", translator_list: "list", student_author: "boolean", signed: "boolean" },
  treaty_parties: { party_list: "list", bilateral_or_multilateral: "text", us_is_party: "boolean" },
  language_script: { source_language: "text", source_script: "text", translation_language: "text", transliteration: "text", original_title: "text" },
  issuer_jurisdiction: { jurisdiction_id: "entity", subjurisdiction_id: "entity", issuer_id: "text", court_id: "entity", institution_profile_id: "entity" },
  reproduction_archive: { reproduction_form: "text", repository: "text", archive_url: "text", capture_date: "text" },
};
/** issuer_jurisdiction ids are stored in scalars; issuer_id stays structured free text. */
const ISSUER_SCALAR: Record<string, ScalarField> = {
  jurisdiction_id: "jurisdiction", subjurisdiction_id: "subjurisdiction", court_id: "court", institution_profile_id: "institution_profile",
};

export interface DetectedClassification {
  version: typeof CLASSIFICATION_VERSION;
  taxonomy: string;
  inputFingerprint: string;
  scalars: Partial<Record<ScalarField, FieldEvidence<string>>>;
  multi: Partial<Record<MultiField, FieldEvidence<string[]>>>;
}

export interface ClassificationOverrides {
  scalars?: Partial<Record<ScalarField, string | null>>;
  multi?: Partial<Record<MultiField, string[]>>;
  flags?: Partial<Record<FlagField, Record<string, boolean>>>;
  structured?: Partial<Record<StructuredAxis, Record<string, StructuredValue>>>;
  otherUnidentified?: boolean;
}

export interface EffectiveClassification {
  scalars: Partial<Record<ScalarField, string>>;
  multi: Partial<Record<MultiField, string[]>>;
  flags: Partial<Record<FlagField, Record<string, boolean>>>;
  structured: Partial<Record<StructuredAxis, Record<string, StructuredValue>>>;
  otherUnidentified: boolean;
  source: Partial<Record<string, Provenance>>;
}

export interface ClassificationRecord {
  version: typeof CLASSIFICATION_VERSION;
  itemKey: string;
  /** Fingerprint the user's choices were last confirmed against. */
  inputFingerprint: string;
  detected: DetectedClassification;
  overrides: ClassificationOverrides;
  needsReview: boolean;
  /** Effective key + input of the last output this record vouches for. */
  generatedWith: string | null;
  generatedInput: string | null;
  updatedAt: number;
}

export function fingerprintInput(input: string): string {
  const s = (input ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `f1:${s.length}:${h.toString(16)}`;
}

const ev = <T,>(value: T | null, confidence: Confidence, evidence: string[], candidates: Candidate[] = []): FieldEvidence<T> => ({
  value, confidence: value === null ? "none" : confidence, provenance: value === null ? "none" : "deterministic_detector", evidence, candidates,
});

const KIND_TO_SUBTYPE: Record<string, string> = {
  case: "decision.judgment",
  constitution: "constitution.constitution",
  statute: "normative_instrument.statute",
  journal_article: "periodical.article",
  book: "nonperiodical.book",
  book_chapter: "collection_component.chapter",
  internet: "web_native.page",
};

/** Deterministic detection. Language, script, host and publisher are never jurisdiction evidence. */
export function detectClassification(raw: string): DetectedClassification {
  const text = (raw ?? "").trim();
  const scalars: DetectedClassification["scalars"] = {};
  const multi: DetectedClassification["multi"] = {};
  let d = text ? detectForeignSource(text) : null;
  const withoutUrl = text.replace(/,?\s*https?:\/\/\S+\s*$/i, "").trim();
  if ((!d || d.kind === "internet") && withoutUrl && withoutUrl !== text) {
    const alt = detectForeignSource(withoutUrl);
    if (alt && alt.kind !== "internet") d = alt;
  }
  if (d) {
    const sub = KIND_TO_SUBTYPE[d.kind];
    const conf: Confidence = d.confidence === "deterministic" ? "high" : "low";
    if (sub) {
      scalars.subtype = ev(sub, conf, [`shape:${d.kind}`]);
      scalars.family = ev(subtypeFamily(sub) ?? null, conf, [`shape:${d.kind}`]);
    }
    const legal = d.kind === "case" || d.kind === "statute" || d.kind === "constitution";
    if (legal && d.jurisdiction === "US") {
      scalars.jurisdiction = ev(US_ROOT_ID, conf, [d.kind === "statute" ? "code:U.S.C." : d.kind === "constitution" ? "U.S. CONST." : "reporter:US"]);
    } else if (legal && d.jurisdiction === "UK") {
      const f = d.fields as { neutral?: string; reporter?: string };
      const explicitUk = /\b(?:UK|United Kingdom|England|Wales|Scotland|Northern Ireland)\b/.test(text);
      if (d.kind === "case" && (f.neutral || f.reporter) && conf === "high") scalars.jurisdiction = ev(UK_ID, "high", [f.neutral ? "neutral_citation" : "uk_report_series"]);
      else if (explicitUk) scalars.jurisdiction = ev(UK_ID, "medium", ["explicit_uk_term"]);
      else scalars.jurisdiction = ev<string>(null, "none", [], [{ value: UK_ID, confidence: "low", evidence: "chapter_number_shape" }]);
    }
    if (d.kind === "case") {
      const f = d.fields as { neutral?: string; reporter?: string; parallel?: string };
      const schemes: string[] = [];
      if (f.neutral) schemes.push("neutral_citation");
      if (f.reporter || f.parallel) schemes.push("reporter_locator");
      if (schemes.length) multi.citation_scheme = ev(schemes, conf, schemes.map((s) => `field:${s}`));
    }
  }
  if (/https?:\/\/\S+/i.test(text)) multi.access_medium = ev(["web"], "medium", ["url_present"]);
  if (/\bpending\b/i.test(text)) scalars.proceeding_status = ev("pending", "low", ["term:pending"]);
  return { version: CLASSIFICATION_VERSION, taxonomy: TAXONOMY_VERSION, inputFingerprint: fingerprintInput(text), scalars, multi };
}

export function hasOverrides(o: ClassificationOverrides): boolean {
  return !!o.otherUnidentified
    || Object.values(o.scalars ?? {}).some((v) => v !== undefined)
    || Object.values(o.multi ?? {}).some((v) => v !== undefined)
    || Object.values(o.flags ?? {}).some((v) => v && Object.keys(v).length > 0)
    || Object.values(o.structured ?? {}).some((v) => v && Object.keys(v).length > 0);
}

const SCALAR_KEYS: ScalarField[] = ["family", "subtype", "jurisdiction", "subjurisdiction", "institution_profile", "court", "publication_status", "proceeding_status"];

export function computeEffective(det: DetectedClassification, o: ClassificationOverrides): EffectiveClassification {
  const out: EffectiveClassification = { scalars: {}, multi: {}, flags: {}, structured: {}, otherUnidentified: !!o.otherUnidentified, source: {} };
  for (const k of SCALAR_KEYS) {
    if (o.scalars && o.scalars[k] !== undefined) {
      const v = o.scalars[k];
      if (v) out.scalars[k] = v;
      out.source[k] = "user_override";
    } else if (det.scalars[k]?.value) {
      out.scalars[k] = det.scalars[k]!.value!;
      out.source[k] = "deterministic_detector";
    }
  }
  if (out.otherUnidentified) { delete out.scalars.family; delete out.scalars.subtype; }
  if (out.scalars.subtype && subtypeFamily(out.scalars.subtype) !== out.scalars.family) delete out.scalars.subtype;
  if (out.scalars.subjurisdiction && out.scalars.jurisdiction
      && !ancestorsOf(out.scalars.subjurisdiction).some((a) => a.id === out.scalars.jurisdiction)) delete out.scalars.subjurisdiction;
  for (const k of ["access_medium", "citation_scheme", "container"] as MultiField[]) {
    if (o.multi?.[k] !== undefined) { out.multi[k] = [...o.multi[k]!]; out.source[k] = "user_override"; }
    else if (det.multi[k]?.value) { out.multi[k] = [...det.multi[k]!.value!]; out.source[k] = "deterministic_detector"; }
  }
  for (const k of ["manifestation_flags", "edition_flags"] as FlagField[]) {
    if (o.flags?.[k]) { out.flags[k] = { ...o.flags[k] }; out.source[k] = "user_override"; }
  }
  for (const [axis, fields] of Object.entries(o.structured ?? {})) {
    if (fields && Object.keys(fields).length) { out.structured[axis as StructuredAxis] = { ...fields }; out.source[axis] = "user_override"; }
  }
  const issuer: Record<string, StructuredValue> = { ...(out.structured.issuer_jurisdiction ?? {}) };
  for (const [f, s] of Object.entries(ISSUER_SCALAR)) issuer[f] = out.scalars[s] ?? null;
  out.structured.issuer_jurisdiction = issuer;
  return out;
}

/** Full 12-axis contract view; unspecified values are null, never guessed. */
export function axisContract(e: EffectiveClassification) {
  const nullFields = (axis: StructuredAxis) => Object.fromEntries(Object.keys(STRUCTURED_FIELD_KIND[axis]).map((f) => [f, e.structured[axis]?.[f] ?? null]));
  const flagFields = (k: FlagField) => Object.fromEntries((getAxis(k)?.values ?? []).map((v) => [v, e.flags[k]?.[v] ?? null]));
  return {
    publication_status: e.scalars.publication_status ?? null,
    proceeding_status: e.scalars.proceeding_status ?? null,
    citation_scheme: e.multi.citation_scheme ?? null,
    access_medium: e.multi.access_medium ?? null,
    container: e.multi.container ?? null,
    manifestation_flags: flagFields("manifestation_flags"),
    edition_flags: flagFields("edition_flags"),
    authorship: nullFields("authorship"),
    treaty_parties: nullFields("treaty_parties"),
    language_script: nullFields("language_script"),
    issuer_jurisdiction: nullFields("issuer_jurisdiction"),
    reproduction_archive: nullFields("reproduction_archive"),
  };
}

export function effectiveKey(e: EffectiveClassification): string {
  const sortObj = (o: Record<string, unknown>): unknown => Object.keys(o).sort().map((k) => {
    const v = o[k];
    return [k, Array.isArray(v) ? [...v].sort() : v && typeof v === "object" ? sortObj(v as Record<string, unknown>) : v];
  });
  return JSON.stringify([sortObj(e.scalars), sortObj(e.multi), sortObj(e.flags), sortObj(e.structured as Record<string, unknown>), e.otherUnidentified]);
}

export type SupportStatus = "renderer_partial" | "unsupported" | "unidentified";
export interface SupportReport { status: SupportStatus; validity: "not_assessed"; message: string }

const underUs = (id?: string) => isUnder(id, US_ROOT_ID);
const underUk = (id?: string) => isUnder(id, UK_ID);

/**
 * Map an effective classification to the EXISTING engine's source type.
 * Supported only where the deterministic renderer already exists; any other
 * combination is generated generically (never U.S.) with a visible warning.
 */
export function engineRouteFor(e: EffectiveClassification): { sourceType: SourceType; supported: boolean } {
  const sub = e.scalars.subtype;
  const fam = e.scalars.family;
  const jur = e.scalars.subjurisdiction ?? e.scalars.jurisdiction;
  if (e.otherUnidentified || !fam) return { sourceType: "foreign", supported: false };
  if (sub === "decision.judgment" && underUs(jur)) return { sourceType: "foreign_case_us", supported: true };
  if (sub === "decision.judgment" && underUk(jur)) return { sourceType: "foreign_case_other", supported: true };
  if (sub === "normative_instrument.statute" && underUs(jur)) return { sourceType: "foreign_statute_us", supported: true };
  if (sub === "normative_instrument.statute" && underUk(jur)) return { sourceType: "foreign_statute_uk", supported: true };
  if (sub === "constitution.constitution" && underUs(jur)) return { sourceType: "foreign_constitution", supported: true };
  if (sub === "periodical.article") return { sourceType: "foreign_journal_article", supported: true };
  if (sub === "nonperiodical.book") return { sourceType: "foreign_book", supported: true };
  if (sub === "collection_component.chapter") return { sourceType: "foreign_book_chapter", supported: true };
  if (sub === "web_native.page") return { sourceType: "foreign_internet", supported: true };
  if (fam === "decision") return { sourceType: "foreign_case_other", supported: false };
  return { sourceType: "foreign", supported: false };
}

export function supportFor(e: EffectiveClassification): SupportReport {
  if (e.otherUnidentified || !e.scalars.family) {
    return { status: "unidentified", validity: "not_assessed", message: "סוג המקור לא זוהה. הקלט נשמר וניתן לערוך ולייצא אותו." };
  }
  return engineRouteFor(e).supported
    ? { status: "renderer_partial", validity: "not_assessed", message: "קיימת תמיכה חלקית בעיצוב האוטומטי. יש לבדוק את האזכור ידנית." }
    : { status: "unsupported", validity: "not_assessed", message: "שילוב זה עדיין לא נתמך בעיצוב האוטומטי. הנתונים נשמרים לעריכה ולייצוא." };
}

export const UNSUPPORTED_GENERATION_WARNING =
  "הסיווג שנבחר עדיין לא נתמך בעיצוב האוטומטי: האזכור הופק כמקור לועזי כללי ויש לבדוק אותו ידנית.";

export interface GenerationPlan {
  itemKey: string;
  sourceType: SourceType;
  supported: boolean;
  warning?: string;
  effectiveKey: string;
  inputFingerprint: string;
}

/** Plan for an EXPLICIT generation. Null when the user made no choice (existing behaviour). */
export function planGeneration(rec: ClassificationRecord | undefined, input: string): GenerationPlan | null {
  if (!rec || !hasOverrides(rec.overrides)) return null;
  const detected = detectClassification(input);
  const eff = computeEffective(detected, rec.overrides);
  const route = engineRouteFor(eff);
  return {
    itemKey: rec.itemKey,
    sourceType: route.sourceType,
    supported: route.supported,
    ...(route.supported ? {} : { warning: UNSUPPORTED_GENERATION_WARNING }),
    effectiveKey: effectiveKey(eff),
    inputFingerprint: detected.inputFingerprint,
  };
}

// ---------- Record lifecycle (pure) ----------

export function createRecord(itemKey: string, input: string, now = Date.now()): ClassificationRecord {
  const detected = detectClassification(input);
  return {
    version: CLASSIFICATION_VERSION, itemKey, inputFingerprint: detected.inputFingerprint, detected, overrides: {}, needsReview: false,
    // The pre-existing output came from the existing engine on this input with no choice applied.
    generatedWith: effectiveKey(computeEffective(detected, {})), generatedInput: detected.inputFingerprint, updatedAt: now,
  };
}

/** Same input keeps choices; changed input keeps them in needs-review. Output text never certifies freshness. */
export function reconcileRecord(rec: ClassificationRecord | undefined, itemKey: string, input: string, now = Date.now()): ClassificationRecord {
  if (!rec || rec.itemKey !== itemKey) return createRecord(itemKey, input, now);
  const fp = fingerprintInput(input);
  let next: ClassificationRecord = { ...rec, detected: detectClassification(input) };
  if (fp !== rec.inputFingerprint) {
    next = { ...next, needsReview: hasOverrides(rec.overrides), updatedAt: now };
    if (!next.needsReview) next = { ...next, inputFingerprint: fp };
  } else if (rec.needsReview) {
    next = { ...next, needsReview: false };
  }
  return next;
}

/** Only a successful explicit generation that used `plan` may record provenance. */
export function markGenerated(rec: ClassificationRecord, plan: Pick<GenerationPlan, "effectiveKey" | "inputFingerprint">, now = Date.now()): ClassificationRecord {
  return { ...rec, generatedWith: plan.effectiveKey, generatedInput: plan.inputFingerprint, updatedAt: now };
}

export function applyOverride(rec: ClassificationRecord, patch: ClassificationOverrides, now = Date.now()): ClassificationRecord {
  const o = rec.overrides;
  const structured: ClassificationOverrides["structured"] = { ...o.structured };
  for (const [axis, fields] of Object.entries(patch.structured ?? {})) {
    structured[axis as StructuredAxis] = { ...(o.structured?.[axis as StructuredAxis] ?? {}), ...fields };
  }
  const merged: ClassificationOverrides = {
    scalars: { ...o.scalars, ...patch.scalars },
    multi: { ...o.multi, ...patch.multi },
    flags: { ...o.flags, ...patch.flags },
    structured,
    otherUnidentified: patch.otherUnidentified ?? o.otherUnidentified,
  };
  if (patch.scalars?.family !== undefined) merged.otherUnidentified = false;
  if (patch.otherUnidentified) merged.scalars = { ...merged.scalars, family: undefined, subtype: undefined };
  if (patch.scalars && "jurisdiction" in patch.scalars && !("subjurisdiction" in patch.scalars)) merged.scalars = { ...merged.scalars, subjurisdiction: undefined };
  return { ...rec, overrides: sanitizeOverrides(merged), updatedAt: now };
}

export const keepAfterInputChange = (rec: ClassificationRecord, now = Date.now()): ClassificationRecord =>
  ({ ...rec, needsReview: false, inputFingerprint: rec.detected.inputFingerprint, updatedAt: now });
export const resetOverrides = (rec: ClassificationRecord, now = Date.now()): ClassificationRecord =>
  ({ ...rec, overrides: {}, needsReview: false, inputFingerprint: rec.detected.inputFingerprint, updatedAt: now });

export function isOutputStale(rec: ClassificationRecord): boolean {
  const current = effectiveKey(computeEffective(rec.detected, rec.overrides));
  return rec.generatedWith !== current || rec.generatedInput !== rec.detected.inputFingerprint;
}

// ---------- Validation for persistence ----------

const INSTITUTION_IDS = new Set(INSTITUTION_PROFILES.map((p) => p.id));
const isInternationalEntity = (v: string) => v.startsWith("intl:") && !!getEntity(v);
const SCALAR_VALIDATORS: Record<ScalarField, (v: string) => string | undefined> = {
  family: (v) => (isFamilyId(v) ? v : undefined),
  subtype: (v) => (isSubtypeId(v) ? v : undefined),
  jurisdiction: (v) => resolveEntityId(v),
  subjurisdiction: (v) => resolveEntityId(v),
  court: (v) => { const r = resolveEntityId(v); return r && isInternationalEntity(r) ? r : undefined; },
  institution_profile: (v) => (INSTITUTION_IDS.has(v) ? v : undefined),
  publication_status: (v) => (getAxis("publication_status")?.values.includes(v) ? v : undefined),
  proceeding_status: (v) => (getAxis("proceeding_status")?.values.includes(v) ? v : undefined),
};
const MAX_TEXT = 2000;
const MAX_LIST = 50;
const cleanText = (v: unknown) => (typeof v === "string" ? v.slice(0, MAX_TEXT) : undefined);

export function sanitizeOverrides(raw: unknown): ClassificationOverrides {
  const out: ClassificationOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (r.scalars && typeof r.scalars === "object") {
    const s: ClassificationOverrides["scalars"] = {};
    for (const [k, v] of Object.entries(r.scalars as Record<string, unknown>)) {
      const val = SCALAR_VALIDATORS[k as ScalarField];
      if (!val) continue;
      if (v === null) s[k as ScalarField] = null;
      else if (typeof v === "string") { const ok = val(v); if (ok) s[k as ScalarField] = ok; }
    }
    out.scalars = s;
  }
  if (r.multi && typeof r.multi === "object") {
    const m: ClassificationOverrides["multi"] = {};
    for (const k of ["access_medium", "citation_scheme", "container"] as MultiField[]) {
      const v = (r.multi as Record<string, unknown>)[k];
      const allowed = getAxis(k)?.values ?? [];
      if (Array.isArray(v)) m[k] = [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))];
    }
    out.multi = m;
  }
  if (r.flags && typeof r.flags === "object") {
    const f: ClassificationOverrides["flags"] = {};
    for (const k of ["manifestation_flags", "edition_flags"] as FlagField[]) {
      const v = (r.flags as Record<string, unknown>)[k];
      const allowed = getAxis(k)?.values ?? [];
      if (v && typeof v === "object") {
        f[k] = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([n, b]) => allowed.includes(n) && typeof b === "boolean")) as Record<string, boolean>;
      }
    }
    out.flags = f;
  }
  if (r.structured && typeof r.structured === "object") {
    const st: ClassificationOverrides["structured"] = {};
    for (const [axis, kinds] of Object.entries(STRUCTURED_FIELD_KIND) as [StructuredAxis, Record<string, string>][]) {
      const src = (r.structured as Record<string, unknown>)[axis];
      if (!src || typeof src !== "object") continue;
      const fields: Record<string, StructuredValue> = {};
      for (const [f, kind] of Object.entries(kinds)) {
        if (!(f in (src as object))) continue;
        if (axis === "issuer_jurisdiction" && f in ISSUER_SCALAR) continue; // lives in scalars
        const v = (src as Record<string, unknown>)[f];
        if (v === null) fields[f] = null;
        else if (kind === "boolean" && typeof v === "boolean") fields[f] = v;
        else if (kind === "list" && Array.isArray(v)) fields[f] = v.map(cleanText).filter((x): x is string => x !== undefined).slice(0, MAX_LIST);
        else if (kind === "text" && typeof v === "string") fields[f] = cleanText(v)!;
      }
      if (Object.keys(fields).length) st[axis] = fields;
    }
    out.structured = st;
  }
  if (r.otherUnidentified === true) out.otherUnidentified = true;
  return out;
}

export { OTHER_UNIDENTIFIED, getEntity };
