/**
 * Shared foreign-source classification (Stage C): detected / overrides /
 * effective, keyed by item and input fingerprint. Pure and local — no
 * network, no model text. Detection confidence is NOT legal validity:
 * `support` reports renderer support only and `validity` is never asserted.
 */
import { detectForeignSource } from "@/data/bluebook/extract";
import {
  INSTITUTION_PROFILES,
  OTHER_UNIDENTIFIED,
  TAXONOMY_VERSION,
  getAxis,
  isFamilyId,
  isSubtypeId,
  subtypeFamily,
} from "@/data/bluebook/classification/taxonomy";
import { ancestorsOf, getEntity, isEntityId } from "@/data/bluebook/classification/entities";

export const CLASSIFICATION_VERSION = 1 as const;

export type Confidence = "high" | "medium" | "low" | "none";
export type Provenance = "deterministic_detector" | "user_override" | "none";

export interface Candidate { value: string; confidence: Confidence; evidence: string }
export interface FieldEvidence<T> {
  value: T | null;
  confidence: Confidence;
  provenance: Provenance;
  evidence: string[];
  candidates: Candidate[];
}

/** Scalar fields (single value) and multi/boolean axis fields. */
export type ScalarField =
  | "family" | "subtype" | "jurisdiction" | "subjurisdiction" | "institution_profile"
  | "publication_status" | "proceeding_status";
export type MultiField = "access_medium" | "citation_scheme" | "container";
export type FlagField = "manifestation_flags" | "edition_flags";

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
  /** Explicit "אחר / לא זוהה" choice. */
  otherUnidentified?: boolean;
}

export interface EffectiveClassification {
  scalars: Partial<Record<ScalarField, string>>;
  multi: Partial<Record<MultiField, string[]>>;
  flags: Partial<Record<FlagField, Record<string, boolean>>>;
  otherUnidentified: boolean;
  source: Partial<Record<ScalarField | MultiField | FlagField, Provenance>>;
}

export interface ClassificationRecord {
  version: typeof CLASSIFICATION_VERSION;
  itemKey: string;
  inputFingerprint: string;
  detected: DetectedClassification;
  overrides: ClassificationOverrides;
  /** Input changed after a manual choice: user must keep or reset. */
  needsReview: boolean;
  /** Effective key the current output corresponds to (null = unknown). */
  generatedWith: string | null;
  outputFingerprint: string | null;
  updatedAt: number;
}

export function fingerprintInput(input: string): string {
  const s = (input ?? "").normalize("NFC").trim().replace(/\s+/g, " ");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `f1:${s.length}:${h.toString(16)}`;
}

const ev = <T,>(value: T | null, confidence: Confidence, evidence: string[], candidates: Candidate[] = []): FieldEvidence<T> => ({
  value,
  confidence: value === null ? "none" : confidence,
  provenance: value === null ? "none" : "deterministic_detector",
  evidence,
  candidates,
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

/** Supplied registry ids used for detector results. */
const US_ID = "T1";
const UK_ID = "T2.46";

/**
 * Deterministic detection. Language, script, host and publisher are never
 * jurisdiction evidence; literature families never get a detected country.
 */
export function detectClassification(raw: string): DetectedClassification {
  const text = (raw ?? "").trim();
  const scalars: DetectedClassification["scalars"] = {};
  const multi: DetectedClassification["multi"] = {};
  let d = text ? detectForeignSource(text) : null;
  // A traditional source that happens to be online is not a web-native item.
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
    const legalFamily = d.kind === "case" || d.kind === "statute" || d.kind === "constitution";
    if (legalFamily && d.jurisdiction === "US") {
      scalars.jurisdiction = ev(US_ID, conf, [d.kind === "statute" ? "code:U.S.C." : d.kind === "constitution" ? "U.S. CONST." : "reporter:US"]);
    } else if (legalFamily && d.jurisdiction === "UK") {
      const f = d.fields as { neutral?: string; reporter?: string };
      const explicitUk = /\b(?:UK|United Kingdom|England|Wales|Scotland|Northern Ireland)\b/.test(text);
      if (d.kind === "case" && (f.neutral || f.reporter) && conf === "high") {
        scalars.jurisdiction = ev(UK_ID, "high", [f.neutral ? "neutral_citation" : "uk_report_series"]);
      } else if (explicitUk) {
        scalars.jurisdiction = ev(UK_ID, "medium", ["explicit_uk_term"]);
      } else {
        // e.g. "Example Act 2020, c. 7": chapter shape alone is not UK proof.
        scalars.jurisdiction = ev<string>(null, "none", [], [{ value: UK_ID, confidence: "low", evidence: "chapter_number_shape" }]);
      }
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
    || Object.values(o.flags ?? {}).some((v) => v && Object.keys(v).length > 0);
}

export function computeEffective(det: DetectedClassification, o: ClassificationOverrides): EffectiveClassification {
  const out: EffectiveClassification = { scalars: {}, multi: {}, flags: {}, otherUnidentified: !!o.otherUnidentified, source: {} };
  const scalarKeys: ScalarField[] = ["family", "subtype", "jurisdiction", "subjurisdiction", "institution_profile", "publication_status", "proceeding_status"];
  for (const k of scalarKeys) {
    if (o.scalars && k in o.scalars && o.scalars[k] !== undefined) {
      const v = o.scalars[k];
      if (v) out.scalars[k] = v;
      out.source[k] = "user_override";
    } else if (det.scalars[k]?.value) {
      out.scalars[k] = det.scalars[k]!.value!;
      out.source[k] = "deterministic_detector";
    }
  }
  if (out.otherUnidentified) { delete out.scalars.family; delete out.scalars.subtype; }
  // A subtype only stands under its own family; family choice never touches jurisdiction.
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
  return out;
}

export function effectiveKey(e: EffectiveClassification): string {
  const sortObj = (o: Record<string, unknown>) => Object.keys(o).sort().map((k) => [k, o[k]]);
  return JSON.stringify([
    sortObj(e.scalars),
    sortObj(Object.fromEntries(Object.entries(e.multi).map(([k, v]) => [k, [...(v ?? [])].sort()]))),
    sortObj(Object.fromEntries(Object.entries(e.flags).map(([k, v]) => [k, sortObj(v ?? {})]))),
    e.otherUnidentified,
  ]);
}

export type SupportStatus = "renderer_partial" | "unsupported" | "unidentified";
export interface SupportReport {
  status: SupportStatus;
  /** Legal validity is never inferred from detection, model text or menu choice. */
  validity: "not_assessed";
  message: string;
}

function underUs(id?: string) { return !!id && (id === US_ID || ancestorsOf(id).some((a) => a.id === US_ID)); }
function underUk(id?: string) { return !!id && (id === UK_ID || ancestorsOf(id).some((a) => a.id === UK_ID)); }

/** Existing deterministic renderer families (Stage A/B engine), nothing more. */
export function supportFor(e: EffectiveClassification): SupportReport {
  const sub = e.scalars.subtype;
  const jur = e.scalars.subjurisdiction ?? e.scalars.jurisdiction;
  if (e.otherUnidentified || !e.scalars.family) {
    return { status: "unidentified", validity: "not_assessed", message: "סוג המקור לא זוהה. הקלט נשמר וניתן לערוך ולייצא אותו." };
  }
  const partial =
    (sub === "decision.judgment" && (underUs(jur) || underUk(jur))) ||
    (sub === "normative_instrument.statute" && (underUs(jur) || underUk(jur))) ||
    (sub === "constitution.constitution" && underUs(jur)) ||
    sub === "periodical.article" || sub === "nonperiodical.book" ||
    sub === "collection_component.chapter" || sub === "web_native.page";
  return partial
    ? { status: "renderer_partial", validity: "not_assessed", message: "קיימת תמיכה חלקית בעיצוב האוטומטי. יש לבדוק את האזכור ידנית." }
    : { status: "unsupported", validity: "not_assessed", message: "שילוב זה עדיין לא נתמך בעיצוב האוטומטי. הנתונים נשמרים לעריכה ולייצוא." };
}

// ---------- Record lifecycle (pure) ----------

export function createRecord(itemKey: string, input: string, output: string | null, now = Date.now()): ClassificationRecord {
  const detected = detectClassification(input);
  return {
    version: CLASSIFICATION_VERSION,
    itemKey,
    inputFingerprint: detected.inputFingerprint,
    detected,
    overrides: {},
    needsReview: false,
    generatedWith: effectiveKey(computeEffective(detected, {})),
    outputFingerprint: output == null ? null : fingerprintInput(output),
    updatedAt: now,
  };
}

/** Same-input redetection keeps overrides; changed input flags review, never drops them. */
export function reconcileRecord(rec: ClassificationRecord | undefined, itemKey: string, input: string, output: string | null, now = Date.now()): ClassificationRecord {
  if (!rec || rec.itemKey !== itemKey) return createRecord(itemKey, input, output, now);
  const fp = fingerprintInput(input);
  // Detection is derived and always recomputed from the current input.
  let next: ClassificationRecord = { ...rec, detected: detectClassification(input) };
  if (fp !== rec.inputFingerprint) {
    next = { ...next, needsReview: hasOverrides(rec.overrides), updatedAt: now };
    if (!next.needsReview) next = { ...next, inputFingerprint: fp };
  } else if (rec.needsReview) {
    next = { ...next, needsReview: false };
  }
  const outFp = output == null ? null : fingerprintInput(output);
  if (outFp !== next.outputFingerprint) {
    // Output was regenerated by the existing explicit operation.
    next = { ...next, outputFingerprint: outFp, generatedWith: effectiveKey(computeEffective(next.detected, next.overrides)), updatedAt: now };
  }
  return next;
}

export function applyOverride(rec: ClassificationRecord, patch: ClassificationOverrides, now = Date.now()): ClassificationRecord {
  const o = rec.overrides;
  const merged: ClassificationOverrides = {
    scalars: { ...o.scalars, ...patch.scalars },
    multi: { ...o.multi, ...patch.multi },
    flags: { ...o.flags, ...patch.flags },
    otherUnidentified: patch.otherUnidentified ?? o.otherUnidentified,
  };
  if (patch.scalars?.family !== undefined) merged.otherUnidentified = false;
  if (patch.otherUnidentified) merged.scalars = { ...merged.scalars, family: undefined, subtype: undefined };
  // Choosing a top-level jurisdiction clears an incompatible subjurisdiction override.
  if (patch.scalars && "jurisdiction" in patch.scalars && !("subjurisdiction" in patch.scalars)) {
    merged.scalars = { ...merged.scalars, subjurisdiction: undefined };
  }
  return { ...rec, overrides: sanitizeOverrides(merged), updatedAt: now };
}

export function keepAfterInputChange(rec: ClassificationRecord, now = Date.now()): ClassificationRecord {
  return { ...rec, needsReview: false, inputFingerprint: rec.detected.inputFingerprint, updatedAt: now };
}

export function resetOverrides(rec: ClassificationRecord, now = Date.now()): ClassificationRecord {
  return { ...rec, overrides: {}, needsReview: false, inputFingerprint: rec.detected.inputFingerprint, updatedAt: now };
}

export function isOutputStale(rec: ClassificationRecord): boolean {
  return rec.generatedWith !== null && rec.generatedWith !== effectiveKey(computeEffective(rec.detected, rec.overrides));
}

// ---------- Validation for persistence ----------

const SCALAR_VALIDATORS: Record<ScalarField, (v: string) => boolean> = {
  family: isFamilyId,
  subtype: isSubtypeId,
  jurisdiction: isEntityId,
  subjurisdiction: isEntityId,
  institution_profile: (v) => getInstitutionIds().has(v),
  publication_status: (v) => !!getAxis("publication_status")?.values.includes(v),
  proceeding_status: (v) => !!getAxis("proceeding_status")?.values.includes(v),
};
const INSTITUTION_IDS = new Set(INSTITUTION_PROFILES.map((p) => p.id));
const getInstitutionIds = () => INSTITUTION_IDS;

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
      else if (typeof v === "string" && val(v)) s[k as ScalarField] = v;
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
  if (r.otherUnidentified === true) out.otherUnidentified = true;
  return out;
}

export { OTHER_UNIDENTIFIED, getEntity };
