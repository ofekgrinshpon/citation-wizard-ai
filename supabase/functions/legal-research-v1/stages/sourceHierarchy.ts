// research_pack_hierarchy_v1 — deterministic legal-research hierarchy for the
// final pack (used_sources / footnotes / citation order).
//
// Scope: pool composition read-only, used_sources selection, footnote
// assembly, ordering and telemetry. This module does NOT touch retrieval,
// discovery, acquisition, verifier, sufficiency, drafter model or prompt.

export interface HierarchySourceLike {
  candidate_id: string;
  title: string;
  url: string | null;
  source_type: string;
  role?: string;
  best_support?: string;
  citable_as?: string;
  text_usability?: string;
  authority_tier?: string;
  is_judgment_document?: boolean;
  has_holding_text?: boolean;
  synthesis_role?: string;
}

export type HierarchyClass = "primary" | "secondary" | "other";

export const HIERARCHY_TIERS = [
  "usable_judgment", // 1
  "statute_or_regulation", // 2
  "official_other", // 3
  "metadata_only_judgment", // 4
  "scholarship", // 5
  "commentary", // 6
  "other", // 7
] as const;
export type HierarchyTier = typeof HIERARCHY_TIERS[number];

const USABLE_TEXT = new Set(["full_text", "substantive_excerpt", "holding_text"]);

const STATUTE_TYPE_RE = /(statute|law|legislation|regulation|takanot|תקנות|חוק)/i;

export function hierarchyTierOf(s: HierarchySourceLike): HierarchyTier {
  const citable = (s.citable_as ?? "unknown").toLowerCase();
  const usability = (s.text_usability ?? "unknown").toLowerCase();
  const tier = (s.authority_tier ?? "unknown").toLowerCase();

  const isJudgment = citable === "judgment" || s.is_judgment_document === true;
  if (isJudgment) {
    if (USABLE_TEXT.has(usability) || s.has_holding_text === true) return "usable_judgment";
    return "metadata_only_judgment";
  }
  if (
    citable === "statute" ||
    tier === "statute_mirror" ||
    STATUTE_TYPE_RE.test(s.source_type || "")
  ) {
    return "statute_or_regulation";
  }
  if (citable === "scholarship") return "scholarship";
  if (citable === "commentary") return "commentary";
  if (tier === "official_primary" || tier === "primary_mirror") return "official_other";
  if (tier === "secondary_commentary") return "commentary";
  return "other";
}

export function tierRank(t: HierarchyTier): number {
  return HIERARCHY_TIERS.indexOf(t) + 1;
}

export function hierarchyClassOf(t: HierarchyTier): HierarchyClass {
  switch (t) {
    case "usable_judgment":
    case "statute_or_regulation":
    case "official_other":
      return "primary";
    case "scholarship":
    case "commentary":
      return "secondary";
    default:
      return "other"; // metadata_only_judgment / other are never primary authority
  }
}

/** A usable primary authority for the invariant checks. */
export function isUsablePrimary(s: HierarchySourceLike): boolean {
  return hierarchyClassOf(hierarchyTierOf(s)) === "primary";
}

const VERDICT_ORDER: Record<string, number> = { direct: 0, partial: 1, tangential: 2 };
const ROLE_ORDER: Record<string, number> = {
  leading_candidate: 0,
  applying_candidate: 1,
  limiting_or_distinguishing_candidate: 2,
  statutory_background: 3,
  secondary_commentary: 4,
  unknown: 5,
};

export function hierarchySortKey(
  s: HierarchySourceLike,
  originalIndex: number,
): [number, number, number, number] {
  return [
    tierRank(hierarchyTierOf(s)),
    VERDICT_ORDER[(s.best_support ?? "partial").toLowerCase()] ?? 3,
    ROLE_ORDER[s.synthesis_role ?? "unknown"] ?? 5,
    originalIndex,
  ];
}

export function compareHierarchy(
  a: HierarchySourceLike,
  ai: number,
  b: HierarchySourceLike,
  bi: number,
): number {
  const ka = hierarchySortKey(a, ai);
  const kb = hierarchySortKey(b, bi);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return ka[i] - kb[i];
  }
  return 0;
}

export function orderByHierarchy<T extends HierarchySourceLike>(list: T[]): T[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort((x, y) => compareHierarchy(x.s, x.i, y.s, y.i))
    .map((x) => x.s);
}

// ── Statute identity dedup ────────────────────────────────────────────────

const SECTION_RE = /סעיף\s*(\d+[א-ת]?)|\bs(?:ec)?\.?\s*(\d+[a-z]?)\b/i;

function normalizeLegalTitle(t: string): string {
  return (t || "")
    .replace(/["'`׳״]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(/סעיף\s*\d+[א-ת]?/g, " ")
    .replace(/[-–—,.:;|]/g, " ")
    .replace(/\b(ויקיטקסט|נבו|wikisource|nevo|the marker|גוגל)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Legal identity key for statutes/regulations; empty when not applicable. */
export function statuteIdentityKey(s: HierarchySourceLike): string {
  if (hierarchyTierOf(s) !== "statute_or_regulation") return "";
  const base = normalizeLegalTitle(s.title);
  if (!base) return "";
  const m = (s.title || "").match(SECTION_RE);
  const section = m ? (m[1] ?? m[2] ?? "") : "";
  return `${base}§${section}`;
}

/** Higher is better when collapsing statute mirrors. */
export function statuteMirrorRank(s: HierarchySourceLike): number {
  const tier = (s.authority_tier ?? "unknown").toLowerCase();
  if (tier === "official_primary") return 3;
  if (tier === "statute_mirror") return 2;
  if (tier === "primary_mirror") return 1;
  return 0;
}
