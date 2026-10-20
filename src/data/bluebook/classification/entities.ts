/**
 * Entity registry (T1 / T2 / T3 / international-rule headings) built only
 * from the supplied jurisdiction index (publisher v22 index browse). Each
 * entry keeps its supplied id, parent, verification status and source URL.
 *
 * - Listing an entity is NOT parser or renderer coverage.
 * - Aliases come only from the supplied `source_label_raw`; none are invented.
 * - T1.5 Tribal Nation rows / R22 are excluded: a separate edition-22 decision.
 * - The supplied T2 index lists 47 direct entries; the plan's edition-21
 *   figure (44) is not reconcilable from supplied data and stays unverified.
 */
import data from "./entitiesIndex.json";

export interface RegistryEntity {
  id: string;
  name: string;
  parent: string | null;
  type: string;
  verified_status: string;
  source_label_raw: string | null;
  source: string | null;
}

const D = data as unknown as { provenance: Record<string, unknown>; entries: RegistryEntity[] };
export const ENTITY_PROVENANCE = D.provenance;
export const ENTITIES: readonly RegistryEntity[] = D.entries;
const BY_ID = new Map(ENTITIES.map((e) => [e.id, e]));

export const getEntity = (id: string | undefined) => (id ? BY_ID.get(id) : undefined);
export const childrenOf = (id: string) => ENTITIES.filter((e) => e.parent === id);
export const isEntityId = (v: unknown): v is string => typeof v === "string" && BY_ID.has(v);

export function ancestorsOf(id: string): RegistryEntity[] {
  const out: RegistryEntity[] = [];
  let cur = BY_ID.get(id);
  while (cur?.parent) {
    const p = BY_ID.get(cur.parent);
    if (!p) break;
    out.push(p);
    cur = p;
  }
  return out;
}

/** Leaf-ish subdivisions (headings and named units) beneath an entity. */
export function subdivisionsOf(id: string): RegistryEntity[] {
  const direct = childrenOf(id);
  return direct.flatMap((c) => (c.type === "foreign_subjurisdiction_heading" && childrenOf(c.id).length ? [c, ...childrenOf(c.id)] : [c]));
}

export function aliasesOf(e: RegistryEntity): string[] {
  return e.source_label_raw && e.source_label_raw !== e.name ? [e.source_label_raw] : [];
}

/** Top-level jurisdiction choices: US (T1.3 states+DC, T1.4), T2 entries, international. */
export const US_STATES_AND_DC = ENTITIES.filter((e) => e.parent === "T1.3");
export const US_OTHER = ENTITIES.filter((e) => e.parent === "T1.4");
export const FOREIGN_JURISDICTIONS = ENTITIES.filter((e) => e.parent === "T2" && e.type === "foreign_jurisdiction_index_entry");
export const INTERNATIONAL_ENTITIES = ENTITIES.filter((e) => e.id.startsWith("R21") || e.id.startsWith("T3."));

export function searchEntities(q: string, pool: readonly RegistryEntity[] = ENTITIES): RegistryEntity[] {
  const n = q.trim().toLowerCase();
  if (!n) return [...pool];
  return pool.filter((e) => e.name.toLowerCase().includes(n) || aliasesOf(e).some((a) => a.toLowerCase().includes(n)));
}
