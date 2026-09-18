/**
 * legal-research-v2 — research synthesis: normalization, verified projection
 * and the drafter-facing rendering.
 *
 * Hard invariant: synthesis is ORGANIZATION, never evidence. It may only
 * reference claim ids and source ids that survive in the final verified pack.
 * A substantive statement (e.g. "A disagrees with B") must exist as an
 * ordinary evidence-backed claim; the relationship merely points at it.
 */

import type {
  ResearchSynthesis,
  SynthesisRelationship,
  SynthesisRelationshipKind,
  SynthesisSection,
  SynthesisSourceRole,
  SynthesisSourceRole_Entry,
  VerifiedEvidencePack,
  VerifiedResearchSynthesis,
} from "../types.ts";

const MAX_SECTIONS = 12;
const MAX_ROLES = 40;
const MAX_RELATIONSHIPS = 24;
const MAX_CLAIM_REFS = 24;
const MAX_HEADING = 120;
const MAX_PURPOSE = 240;

const ROLES: SynthesisSourceRole[] = [
  "primary_authority",
  "scholarship_position",
  "critique",
  "historical_context",
  "comparative_material",
  "factual_context",
  "user_document",
  "other",
];

const KINDS: SynthesisRelationshipKind[] = [
  "agreement",
  "disagreement",
  "development",
  "contrast",
  "qualification",
  "application",
];

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const id = str(x, 40);
    if (id && !out.includes(id)) out.push(id);
    if (out.length >= MAX_CLAIM_REFS) break;
  }
  return out;
}

/** Tolerant sanitation: a malformed synthesis degrades to empty, never throws. */
export function normalizeResearchSynthesis(raw: unknown): ResearchSynthesis | undefined {
  const r = raw as Partial<ResearchSynthesis> | null | undefined;
  if (!r || typeof r !== "object") return undefined;

  const sections: SynthesisSection[] = (Array.isArray(r.sections) ? r.sections : [])
    .map((s) => ({
      heading: str((s as SynthesisSection)?.heading, MAX_HEADING),
      purpose: str((s as SynthesisSection)?.purpose, MAX_PURPOSE) || undefined,
      claim_ids: ids((s as SynthesisSection)?.claim_ids),
    }))
    .filter((s) => s.heading && s.claim_ids.length)
    .slice(0, MAX_SECTIONS);

  const seenRole = new Set<string>();
  const source_roles: SynthesisSourceRole_Entry[] =
    (Array.isArray(r.source_roles) ? r.source_roles : [])
      .map((e) => {
        const entry = e as SynthesisSourceRole_Entry;
        return {
          source_id: str(entry?.source_id, 40),
          role: ROLES.includes(entry?.role) ? entry.role : ("other" as SynthesisSourceRole),
          claim_ids: ids(entry?.claim_ids),
        };
      })
      .filter((e) => {
        if (!e.source_id) return false;
        const key = `${e.source_id}|${e.role}`;
        if (seenRole.has(key)) return false;
        seenRole.add(key);
        return true;
      })
      .slice(0, MAX_ROLES);

  const seenRel = new Set<string>();
  const relationships: SynthesisRelationship[] =
    (Array.isArray(r.relationships) ? r.relationships : [])
      .map((x) => {
        const rel = x as SynthesisRelationship;
        return {
          kind: rel?.kind,
          relationship_claim_id: str(rel?.relationship_claim_id, 40),
          related_claim_ids: ids(rel?.related_claim_ids),
        };
      })
      .filter((rel): rel is SynthesisRelationship => {
        if (!rel.relationship_claim_id) return false;
        if (!KINDS.includes(rel.kind)) return false;
        const key = `${rel.kind}|${rel.relationship_claim_id}|${rel.related_claim_ids.join(",")}`;
        if (seenRel.has(key)) return false;
        seenRel.add(key);
        return true;
      })
      .slice(0, MAX_RELATIONSHIPS);

  if (!sections.length && !source_roles.length && !relationships.length) return undefined;
  return { sections, source_roles, relationships };
}

export interface SynthesisProjection {
  synthesis: VerifiedResearchSynthesis | null;
  claim_refs_dropped: number;
  source_refs_dropped: number;
}

/**
 * Project the accepted memo's synthesis onto the FINAL pack — i.e. after
 * verification, accepted repair, the temporal gate and provenance handling.
 */
export function projectVerifiedSynthesis(
  synthesis: ResearchSynthesis | undefined | null,
  pack: VerifiedEvidencePack,
): SynthesisProjection {
  if (!synthesis) return { synthesis: null, claim_refs_dropped: 0, source_refs_dropped: 0 };

  const liveClaims = new Set(pack.claims.map((c) => c.claim_id));
  const liveSources = new Set<string>();
  for (const c of pack.claims) for (const s of c.sources) liveSources.add(s.source_id);

  let claim_refs_dropped = 0;
  let source_refs_dropped = 0;

  const keepClaims = (list: string[]) => {
    const kept = list.filter((id) => liveClaims.has(id));
    claim_refs_dropped += list.length - kept.length;
    return kept;
  };

  const sections = synthesis.sections
    .map((s) => ({ ...s, claim_ids: keepClaims(s.claim_ids) }))
    .filter((s) => s.claim_ids.length > 0);

  const source_roles = synthesis.source_roles
    .filter((e) => {
      if (liveSources.has(e.source_id)) return true;
      source_refs_dropped += 1;
      return false;
    })
    .map((e) => ({ ...e, claim_ids: keepClaims(e.claim_ids) }));

  const relationships = synthesis.relationships
    .filter((r) => liveClaims.has(r.relationship_claim_id))
    .map((r) => ({ ...r, related_claim_ids: keepClaims(r.related_claim_ids) }))
    .filter((r) => r.related_claim_ids.length > 0);

  const dropped_rel = synthesis.relationships.length - relationships.length;
  claim_refs_dropped += dropped_rel > 0 ? dropped_rel : 0;

  const empty = !sections.length && !source_roles.length && !relationships.length;
  return {
    synthesis: empty ? null : { sections, source_roles, relationships },
    claim_refs_dropped,
    source_refs_dropped,
  };
}

const ROLE_HE: Record<SynthesisSourceRole, string> = {
  primary_authority: "דין ראשוני (פסיקה/חקיקה)",
  scholarship_position: "עמדה בספרות המחקרית",
  critique: "ביקורת",
  historical_context: "הקשר היסטורי",
  comparative_material: "חומר השוואתי",
  factual_context: "הקשר עובדתי",
  user_document: "מסמך שצורף על ידי המשתמש",
  other: "אחר",
};

const KIND_HE: Record<SynthesisRelationshipKind, string> = {
  agreement: "הסכמה",
  disagreement: "מחלוקת",
  development: "התפתחות לאורך זמן",
  contrast: "ניגוד/השוואה",
  qualification: "סיוג",
  application: "יישום",
};

/** Compact, organizational-only block handed to the drafter. */
export function renderSynthesisForDrafter(s: VerifiedResearchSynthesis | null): string {
  if (!s) return "";
  const parts: string[] = [];
  if (s.sections.length) {
    parts.push(
      `ממדים/נושאים שזוהו במחקר (הצעה ארגונית בלבד):\n${
        s.sections
          .map((x) =>
            `- ${x.heading}${x.purpose ? ` — ${x.purpose}` : ""} [${x.claim_ids.join(", ")}]`
          )
          .join("\n")
      }`,
    );
  }
  if (s.source_roles.length) {
    parts.push(
      `אופי המקורות:\n${
        s.source_roles
          .map((e) =>
            `- ${e.source_id}: ${ROLE_HE[e.role]}${e.claim_ids.length ? ` [${e.claim_ids.join(", ")}]` : ""}`
          )
          .join("\n")
      }`,
    );
  }
  if (s.relationships.length) {
    parts.push(
      `יחסים בין טענות מאומתות:\n${
        s.relationships
          .map((r) =>
            `- ${KIND_HE[r.kind]}: ${r.relationship_claim_id} ↔ ${r.related_claim_ids.join(", ")}`
          )
          .join("\n")
      }`,
    );
  }
  if (!parts.length) return "";
  return `מבנה המחקר המאומת (ארגון בלבד — אינו ראיה ואינו מוסיף תוכן מהותי):\n${parts.join("\n\n")}`;
}
