/**
 * web_source_usability_and_authority_selection_v1 — fix 4.
 *
 * Source-priority layer. Given the already-planned per-claim source lists, it
 * ranks sources deterministically and reorders the preferred list so the most
 * authoritative, most directly-on-point material leads, and one representative
 * per role is always kept (rather than three near-duplicates of one class).
 *
 * Priority order (highest first):
 *   1. direct primary authority on point (statute / judgment with direct support)
 *   2. canonical or official primary authority (official origin, body acquired)
 *   3. role-compatible secondary (scholarship / institutional, on topic)
 *   4. general or comparative background
 *
 * Never adds a source, never changes footnote caps, never forces a citation.
 */

import type { DrafterInputSource } from "./drafter.ts";
import { classifySource } from "./topicAwareAlignment.ts";

export const AUTHORITY_PRIORITY_VERSION = "web_source_usability_and_authority_selection_v1";

export type AuthorityTier =
  | "direct_primary"
  | "canonical_primary"
  | "role_compatible_secondary"
  | "general_background";

export interface RankedAuthority {
  ref: string;
  tier: AuthorityTier;
  score: number;
  source_class: string;
  comparative_only: boolean;
  reason: string;
}

export interface AuthorityPriorityRow {
  claim_id: string;
  ranked: RankedAuthority[];
  representative_by_class: Record<string, string>;
  reordered: boolean;
  omitted: Array<{ ref: string; reason: string }>;
}

export interface AuthorityPriorityReport {
  version: string;
  rows: AuthorityPriorityRow[];
  tier_counts: Record<string, number>;
}

const TIER_SCORE: Record<AuthorityTier, number> = {
  direct_primary: 100,
  canonical_primary: 75,
  role_compatible_secondary: 50,
  general_background: 25,
};

function isComparativeOnly(s: DrafterInputSource): boolean {
  const md = (s as unknown as { metadata?: Record<string, unknown> }).metadata ?? {};
  return md.comparative_only === true ||
    (typeof md.web_jurisdiction === "string" && md.web_jurisdiction !== "israeli");
}

export function tierOf(s: DrafterInputSource): { tier: AuthorityTier; reason: string } {
  const cls = classifySource(s);
  const primary = cls === "statute" || cls === "judgment";
  const comparative = isComparativeOnly(s);
  if (primary && !comparative && s.best_support === "direct") {
    return { tier: "direct_primary", reason: "primary_authority_direct_support" };
  }
  if (primary && !comparative && (s.body_acquired === true || s.authority_tier === "official")) {
    return { tier: "canonical_primary", reason: "official_or_body_acquired_primary" };
  }
  if (cls === "academic" || cls === "institutional") {
    return { tier: "role_compatible_secondary", reason: "on_topic_secondary_material" };
  }
  return {
    tier: "general_background",
    reason: comparative ? "comparative_or_foreign_background" : "general_background",
  };
}

export interface AuthorityPriorityInput {
  claims: Array<{ claim_id: string }>;
  sources: DrafterInputSource[];
  /** Mutated in place: per-claim preferred refs, reordered by priority. */
  preferredByClaim: Map<string, string[]>;
}

export function applyAuthorityPriority(
  input: AuthorityPriorityInput,
): AuthorityPriorityReport {
  const byRef = new Map(input.sources.map((s) => [s.ref, s]));
  const rows: AuthorityPriorityRow[] = [];
  const tier_counts: Record<string, number> = {};

  for (const c of input.claims) {
    const preferred = input.preferredByClaim.get(c.claim_id) ?? [];
    if (preferred.length === 0) continue;
    const ranked: RankedAuthority[] = [];
    const omitted: Array<{ ref: string; reason: string }> = [];
    preferred.forEach((ref, idx) => {
      const s = byRef.get(ref);
      if (!s) {
        omitted.push({ ref, reason: "source_not_in_pack" });
        return;
      }
      const { tier, reason } = tierOf(s);
      tier_counts[tier] = (tier_counts[tier] ?? 0) + 1;
      ranked.push({
        ref,
        tier,
        // Stable ordering: tier first, original plan order as tiebreak.
        score: TIER_SCORE[tier] - idx,
        source_class: classifySource(s),
        comparative_only: isComparativeOnly(s),
        reason,
      });
    });
    ranked.sort((a, b) => b.score - a.score);

    // One representative per class leads; the rest keep their ranked order.
    const representative_by_class: Record<string, string> = {};
    const leads: RankedAuthority[] = [];
    const rest: RankedAuthority[] = [];
    for (const r of ranked) {
      if (!representative_by_class[r.source_class]) {
        representative_by_class[r.source_class] = r.ref;
        leads.push(r);
      } else rest.push(r);
    }
    const nextOrder = [...leads, ...rest].map((r) => r.ref);
    const reordered = nextOrder.join("|") !== preferred.join("|");
    input.preferredByClaim.set(c.claim_id, nextOrder);
    rows.push({
      claim_id: c.claim_id,
      ranked,
      representative_by_class,
      reordered,
      omitted,
    });
  }
  return { version: AUTHORITY_PRIORITY_VERSION, rows, tier_counts };
}
