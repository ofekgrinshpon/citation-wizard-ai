/**
 * Foreign-source taxonomy — exact final workbook v3 extraction (sheet
 * "ממשק ומשפחות 21"). Labels, conditions and provenance are verbatim; this
 * module only parses the axis value list (fields_raw) and the cardinality
 * marker (last line of conditions_raw). Nothing is inferred or added.
 *
 * Audit baseline is edition 21; this is independent of the existing
 * `foreign_bluebook_v22` renderer identifier, which is not renamed.
 */
import workbook from "./workbookV3.json";

export interface WorkbookRow {
  id: string;
  parent_id: string | null;
  label: string;
  kind: string;
  fields_raw: string | null;
  conditions_raw: string | null;
  status: string;
  baseline_edition: number;
  source_row: number;
}

export type AxisCardinality = "single" | "multi" | "independent_booleans" | "structured_fields";

export interface TaxonomyAxis extends WorkbookRow {
  values: string[];
  cardinality: AxisCardinality;
}

const W = workbook as unknown as {
  provenance: { library_file_id: string; version: number; sheet: string; source_sha256: string; note: string };
  families: WorkbookRow[];
  subtypes: WorkbookRow[];
  independent_axes: WorkbookRow[];
  institution_profiles: WorkbookRow[];
};

export const TAXONOMY_PROVENANCE = W.provenance;
export const TAXONOMY_VERSION = `workbook-v${W.provenance.version}` as const;

export const FAMILIES: readonly WorkbookRow[] = W.families;
export const SUBTYPES: readonly WorkbookRow[] = W.subtypes;
export const INSTITUTION_PROFILES: readonly WorkbookRow[] = W.institution_profiles;

function parseCardinality(raw: string | null): AxisCardinality {
  const last = (raw ?? "").trim().split("\n").pop()?.trim();
  if (last === "single" || last === "multi" || last === "independent_booleans" || last === "structured_fields") return last;
  throw new Error(`workbook axis without cardinality marker: ${raw}`);
}

export const AXES: readonly TaxonomyAxis[] = W.independent_axes.map((a) => ({
  ...a,
  values: (a.fields_raw ?? "").split("\n").map((v) => v.trim()).filter(Boolean),
  cardinality: parseCardinality(a.conditions_raw),
}));

export type FamilyId = string;
export type SubtypeId = string;

const FAMILY_IDS = new Set(FAMILIES.map((f) => f.id));
const SUBTYPE_BY_ID = new Map(SUBTYPES.map((s) => [s.id, s]));
const AXIS_BY_ID = new Map(AXES.map((a) => [a.id, a]));

export const isFamilyId = (v: unknown): v is FamilyId => typeof v === "string" && FAMILY_IDS.has(v);
export const isSubtypeId = (v: unknown): v is SubtypeId => typeof v === "string" && SUBTYPE_BY_ID.has(v);
export const subtypeFamily = (id: SubtypeId): FamilyId | undefined => SUBTYPE_BY_ID.get(id)?.parent_id ?? undefined;
export const subtypesOf = (family: FamilyId): WorkbookRow[] => SUBTYPES.filter((s) => s.parent_id === family);
export const getAxis = (id: string): TaxonomyAxis | undefined => AXIS_BY_ID.get(id);
export const familyLabel = (id: string | undefined) => FAMILIES.find((f) => f.id === id)?.label;
export const subtypeLabel = (id: string | undefined) => (id ? SUBTYPE_BY_ID.get(id)?.label : undefined);

/** UI-only option id: always available, never a taxonomy family. */
export const OTHER_UNIDENTIFIED = "other_unidentified" as const;

/**
 * Families for which a jurisdiction/issuer choice is presented by default.
 * Books, collection parts, periodicals, unpublished, web-native and
 * audiovisual items do not require a country (plan §3); the choice remains
 * available as optional there.
 */
export const JURISDICTION_EXPECTED_FAMILIES: ReadonlySet<FamilyId> = new Set([
  "decision",
  "proceeding_document",
  "constitution",
  "normative_instrument",
  "legislative_material",
  "administrative_material",
  "treaty",
  "institutional_record",
]);

/** Families where an international institution profile group is relevant. */
export const INSTITUTION_FAMILIES: ReadonlySet<FamilyId> = new Set(["decision", "proceeding_document", "treaty", "institutional_record"]);
