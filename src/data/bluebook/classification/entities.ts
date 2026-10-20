/**
 * Entity registry. Stable entity ids (e.g. "t2:united-kingdom") are
 * independent of edition-specific table locators ({ ed21: "T2.43",
 * ed22: "T2.46" }), so numbering differences never change identity.
 *
 * - Edition-21 T2 identity: the verified 44-entry list from workbook v3
 *   (sheet "T2 מקוון21", observed 2026-10-19) plus its 7 numbered headings.
 *   The first four headings are GROUPS (not enumerated states); only the
 *   three UK legal systems are selectable edition-21 subdivisions.
 * - Edition-22 publisher-index entries are preserved separately (own
 *   provenance, ed22 locator only); exact-name matches share one entity.
 * - T1.5 Tribal Nations are excluded (separate edition-22 decision).
 * - Membership is NOT parser or renderer coverage.
 */
import data from "./entitiesIndex.json";

export interface EntityProvenance { edition: 21 | 22; source: string | null; verified_status: string; observed?: string; note?: string }
export interface RegistryEntity {
  id: string;
  name: string;
  parent: string | null;
  type: string;
  locators: { ed21?: string; ed22?: string };
  provenance: EntityProvenance[];
  legacy_ids: string[];
  aliases: string[];
  selectable: boolean;
}

const D = data as unknown as { provenance: { note: string; legacy_id_map: Record<string, string> }; entries: RegistryEntity[] };
export const ENTITY_PROVENANCE = D.provenance;
export const ENTITIES: readonly RegistryEntity[] = D.entries;
const BY_ID = new Map(ENTITIES.map((e) => [e.id, e]));
const LEGACY = D.provenance.legacy_id_map;

export const getEntity = (id: string | undefined | null) => (id ? BY_ID.get(id) : undefined);
export const childrenOf = (id: string) => ENTITIES.filter((e) => e.parent === id);
export const isEntityId = (v: unknown): v is string => typeof v === "string" && BY_ID.has(v);
/** Map an id stored by an earlier build (edition-22 inventory id) to the stable id. */
export const resolveEntityId = (v: unknown): string | undefined =>
  typeof v !== "string" ? undefined : BY_ID.has(v) ? v : LEGACY[v];
export const byLocator = (edition: "ed21" | "ed22", loc: string) => ENTITIES.find((e) => e.locators[edition] === loc);

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

export const isUnder = (id: string | undefined, root: string) => !!id && (id === root || ancestorsOf(id).some((a) => a.id === root));

/** Selectable subdivisions only (groups are shown as context, never chosen). */
export const subdivisionsOf = (id: string) => childrenOf(id).filter((c) => c.selectable);
export const subdivisionGroupsOf = (id: string) => childrenOf(id).filter((c) => c.type === "subdivision_group");

export const US_ROOT_ID = "us";
export const UK_ID = "t2:united-kingdom";
export const US_STATES_AND_DC = ENTITIES.filter((e) => e.type === "us_state_or_dc");
export const US_OTHER = ENTITIES.filter((e) => e.type === "us_other_jurisdiction");
/** Edition-21 verified T2 identity list (44). */
export const FOREIGN_JURISDICTIONS_ED21 = ENTITIES.filter((e) => e.parent === null && e.type === "foreign_jurisdiction" && e.locators.ed21);
/** Edition-22 index entries with no exact edition-21 name match (kept separate). */
export const FOREIGN_JURISDICTIONS_ED22_ONLY = ENTITIES.filter((e) => e.parent === null && e.type === "foreign_jurisdiction" && !e.locators.ed21);
/** Actual international institutions / organization headings (distinct from profile groups). */
export const INTERNATIONAL_ENTITIES = ENTITIES.filter((e) => e.id.startsWith("intl:"));

export function searchEntities(q: string, pool: readonly RegistryEntity[] = ENTITIES): RegistryEntity[] {
  const n = q.trim().toLowerCase();
  if (!n) return [...pool];
  return pool.filter((e) => e.name.toLowerCase().includes(n) || e.aliases.some((a) => a.toLowerCase().includes(n)));
}
