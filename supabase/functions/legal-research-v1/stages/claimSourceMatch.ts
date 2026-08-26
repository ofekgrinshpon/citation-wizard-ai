// claim_source_match_validation_v1 — per-block claim/facet source gating.
//
// Problem: the verifier binds a source to a *specific* (candidate_id, claim_id)
// pair, but the drafter receives a flat pool (s1..sN) and may attach any ref to
// any block. That produces answers where a central legal proposition is
// footnoted to a source that was only verified for another claim, another legal
// area, or only as background/commentary.
//
// This stage runs AFTER structured validation and BEFORE footnote building.
// It never adds citations and never touches retrieval, the planner, the
// verifier, classification, or footnote rendering — it only drops source_refs
// that cannot legitimately support the block they are attached to, and reports
// what was dropped so the drafter answer can be limited accordingly.

import type { StructuredBlock, StructuredDraft } from "./structuredValidation.ts";
import type { DrafterInputSource } from "./drafter.ts";
import { inferLegalAreaId } from "./claimFacetExpansion.ts";
import {
  type AuthorityOverstatement,
  AUTHORITY_OVERSTATEMENT_LIMITATION_HE,
  categoryAccepts,
  type ClaimSupportCategory,
  deriveClaimCategory,
  profileSource,
  type SourceSupportProfile,
} from "./claimSupportCategory.ts";

export type PropositionType =
  | "black_letter_rule"
  | "application"
  | "background"
  | "practical_guidance"
  | "limitation";

export type SupportSubtypeTag =
  | "direct_rule"
  | "application"
  | "analogy"
  | "background"
  | "commentary";

export type MismatchReason =
  | "claim_mismatch"
  | "commentary_in_substantive_block"
  | "analogical_for_black_letter"
  | "unrelated_legal_area"
  | "insufficient_authority_for_claim_category";

export interface DroppedSourceRef {
  ref: string;
  block_index: number;
  reason: MismatchReason;
  block_claim_id?: string | null;
  source_claim_ids?: string[];
  block_legal_area?: string | null;
  source_legal_area?: string | null;
  /** substance_based_doctrinal_sufficiency_v1 */
  claim_category?: ClaimSupportCategory;
}

export interface ClaimSupportCategoryEntry {
  block_index: number;
  category: ClaimSupportCategory;
  basis: string;
  kept_refs: string[];
  support_levels: string[];
}

export interface ClaimSourceMatchReport {
  applied: boolean;
  /** doctrinal_sufficiency_telemetry_persistence_v1 — set on branches that
   *  return before this stage runs. Absent/false means the stage ran. */
  stage_not_run?: boolean;
  stage_not_run_reason?: string;
  source_ref_mismatch_count: number;
  dropped_source_refs: DroppedSourceRef[];
  mismatch_reason: MismatchReason[];
  unsupported_block_count: number;
  limitation_added: boolean;
  primary_support_by_main_claim: boolean;
  commentary_only_claims: string[];
  tagged_block_count: number;
  /** substance_based_doctrinal_sufficiency_v1 telemetry. */
  claim_categories: ClaimSupportCategoryEntry[];
  authority_overstatements: AuthorityOverstatement[];
  secondary_supported_block_count: number;
  primary_supported_block_count: number;
}


const SUBSTANTIVE: PropositionType[] = ["black_letter_rule", "application", "practical_guidance"];

/** Hebrew limitation appended when central propositions lost their support. */
export const CLAIM_SUPPORT_LIMITATION_HE =
  "\n\n**מגבלת ביסוס:** חלק מהקביעות שלעיל נותרו ללא מקור בר-ציטוט שאומת ישירות לאותה טענה. " +
  "מקורות שאותרו בנושא סמוך, מקורות רקע או ספרות פרשנית אינם מצוטטים כאן כאסמכתה ישירה. " +
  "יש לאמת קביעות אלה מול המקור הראשוני (חקיקה או פסק דין) לפני הסתמכות.";

export const COMMENTARY_ONLY_LIMITATION_HE =
  "\n\n**מגבלת ביסוס:** התמיכה שאותרה לחלק מהטענות היא ספרותית/פרשנית בלבד, ללא מקור ראשוני " +
  "(חקיקה או פסיקה מחייבת) שאומת לאותה טענה. יש להתייחס לניסוח בזהירות ולאמת מול המקור הראשוני.";

// ─── Source-side metadata ───────────────────────────────────────────────────

export interface SourceMatchMeta {
  ref: string;
  verified_claim_ids: string[];
  facet_ids: string[];
  legal_area: string | null;
  support_subtype: SupportSubtypeTag;
  verifier_verdict: string;
  source_type: string;
  body_acquired: boolean;
  is_primary: boolean;
}

function isPrimaryCitable(s: DrafterInputSource): boolean {
  const c = String(s.citable_as ?? "");
  return c === "statute" || c === "regulation" || c === "judgment";
}

/** Derive the match metadata carried alongside each drafter source. */
export function buildSourceMatchMeta(s: DrafterInputSource): SourceMatchMeta {
  return {
    ref: s.ref,
    verified_claim_ids: s.verified_claim_ids ?? s.claim_ids ?? [],
    facet_ids: s.facet_ids ?? [],
    legal_area: s.legal_area ?? inferLegalAreaId(`${s.title} ${s.snippet ?? ""}`),
    support_subtype: (s.support_subtype as SupportSubtypeTag) ?? "background",
    verifier_verdict: String(s.verifier_verdict ?? s.best_support ?? "partial"),
    source_type: s.source_type,
    body_acquired: s.body_acquired === true,
    is_primary: isPrimaryCitable(s),
  };
}

// ─── Block-side tags ────────────────────────────────────────────────────────

interface BlockTags {
  claim_id: string | null;
  facet_id: string | null;
  proposition_type: PropositionType | null;
  legal_area: string | null;
}

function readBlockTags(b: StructuredBlock, sources: SourceMatchMeta[]): BlockTags {
  const o = b as unknown as Record<string, unknown>;
  const pt = typeof o.proposition_type === "string" ? o.proposition_type : null;
  const proposition_type = (
    pt && ["black_letter_rule", "application", "background", "practical_guidance", "limitation"]
        .includes(pt)
      ? pt
      : null
  ) as PropositionType | null;
  const claim_id = typeof o.claim_id === "string" && o.claim_id.trim() ? o.claim_id.trim() : null;
  const facet_id = typeof o.facet_id === "string" && o.facet_id.trim() ? o.facet_id.trim() : null;
  const declaredArea = typeof o.legal_area === "string" && o.legal_area.trim()
    ? o.legal_area.trim()
    : null;
  const text = typeof o.text === "string" ? o.text : "";
  const legal_area = inferLegalAreaId(declaredArea ?? "") ?? inferLegalAreaId(text) ??
    // fall back to the dominant area of the pool, so a block is never judged
    // against an area the run never had.
    (sources.find((s) => s.legal_area)?.legal_area ?? null);
  return { claim_id, facet_id, proposition_type, legal_area };
}

/** facet ids look like `<claim_id>::f<N>` — recover the parent claim. */
function parentClaimOfFacet(facet_id: string): string | null {
  const i = facet_id.indexOf("::");
  return i > 0 ? facet_id.slice(0, i) : null;
}

// ─── The gate ───────────────────────────────────────────────────────────────

export function applyClaimSourceMatch(
  draft: StructuredDraft | null,
  inputSources: DrafterInputSource[],
  opts?: { mainClaimIds?: string[]; limitedDoctrinalAnswer?: boolean },
): { draft: StructuredDraft | null; report: ClaimSourceMatchReport; limitation_text: string } {
  const report: ClaimSourceMatchReport = {
    applied: false,
    source_ref_mismatch_count: 0,
    dropped_source_refs: [],
    mismatch_reason: [],
    unsupported_block_count: 0,
    limitation_added: false,
    primary_support_by_main_claim: false,
    commentary_only_claims: [],
    tagged_block_count: 0,
    claim_categories: [],
    authority_overstatements: [],
    secondary_supported_block_count: 0,
    primary_supported_block_count: 0,
  };
  if (!draft) return { draft, report, limitation_text: "" };

  const metas = inputSources.map(buildSourceMatchMeta);
  const byRef = new Map(metas.map((m) => [m.ref, m]));
  const profiles = new Map<string, SourceSupportProfile>(
    inputSources.map((s) => [s.ref, profileSource(s)]),
  );
  report.applied = true;

  const claimSupport = new Map<string, { primary: boolean; any: boolean }>();
  const blocks: StructuredBlock[] = [];


  draft.blocks.forEach((b, idx) => {
    if (b.kind === "heading" || !("source_refs" in b)) {
      blocks.push(b);
      return;
    }
    const tags = readBlockTags(b, metas);
    if (tags.claim_id || tags.facet_id || tags.proposition_type) report.tagged_block_count++;

    const blockClaim = tags.claim_id ??
      (tags.facet_id ? parentClaimOfFacet(tags.facet_id) : null);
    const ptype: PropositionType = tags.proposition_type ?? "application";
    const substantive = SUBSTANTIVE.includes(ptype);

    // substance_based_doctrinal_sufficiency_v1 — substance category for this
    // block (declared tag → proposition substance → docket-identity escalation).
    const declared = (b as unknown as Record<string, unknown>).claim_category;
    const { category, basis } = deriveClaimCategory({
      declared: typeof declared === "string" ? declared : null,
      propositionType: ptype,
      text: typeof (b as unknown as Record<string, unknown>).text === "string"
        ? String((b as unknown as Record<string, unknown>).text)
        : "",
    });
    const doctrinalCategory = category === "doctrinal_synthesis" ||
      category === "scholarly_commentary" || category === "contextual_background";
    const overstatementDrops: string[] = [];

    const kept: string[] = [];

    for (const ref of b.source_refs) {
      const m = byRef.get(ref);
      if (!m) {
        // user-document refs and registry refs are not verifier-bound.
        kept.push(ref);
        continue;
      }
      let reason: MismatchReason | null = null;

      // Rule A — claim/facet binding.
      if (
        blockClaim && m.verified_claim_ids.length > 0 &&
        !m.verified_claim_ids.includes(blockClaim) &&
        !(tags.facet_id && m.facet_ids.includes(tags.facet_id))
      ) {
        reason = "claim_mismatch";
      }

      // Rule B — background/commentary only for background/limitation blocks.
      // Relaxed (substance_based_doctrinal_sufficiency_v1) for doctrinal /
      // scholarly / background categories when the source is an eligible
      // acquired doctrinal secondary. Court-holding claims are unaffected.
      const prof = profiles.get(ref);
      const doctrinalEligible = prof?.doctrinal_authority === true;
      if (
        !reason && substantive &&
        (m.support_subtype === "background" || m.support_subtype === "commentary") &&
        !m.is_primary &&
        !(doctrinalCategory && doctrinalEligible)
      ) {
        reason = "commentary_in_substantive_block";
      }


      // Rule C — analogical / same-domain never carries a black-letter rule.
      if (!reason && ptype === "black_letter_rule" && m.support_subtype === "analogy") {
        reason = "analogical_for_black_letter";
      }

      // Rule D — unrelated legal area on a central proposition.
      if (
        !reason && substantive && tags.legal_area && m.legal_area &&
        tags.legal_area !== m.legal_area
      ) {
        reason = "unrelated_legal_area";
      }

      // Rule E (substance_based_doctrinal_sufficiency_v1) — the claim's
      // substance category defines the authority level it needs. A court
      // holding cannot rest on secondary material; a statutory claim cannot
      // rest on commentary alone.
      if (!reason && prof && !categoryAccepts(category, prof)) {
        reason = "insufficient_authority_for_claim_category";
        if (category === "court_holding" && prof.doctrinal_authority) {
          overstatementDrops.push(ref);
        }
      }

      if (reason) {
        report.source_ref_mismatch_count++;
        if (!report.mismatch_reason.includes(reason)) report.mismatch_reason.push(reason);
        report.dropped_source_refs.push({
          ref,
          block_index: idx,
          reason,
          block_claim_id: blockClaim,
          source_claim_ids: m.verified_claim_ids.slice(0, 6),
          block_legal_area: tags.legal_area,
          source_legal_area: m.legal_area,
          claim_category: category,
        });
        continue;
      }


      kept.push(ref);
      if (blockClaim) {
        const cur = claimSupport.get(blockClaim) ?? { primary: false, any: false };
        cur.any = true;
        if (m.is_primary && (m.support_subtype === "direct_rule" || m.support_subtype === "application")) {
          cur.primary = true;
        }
        claimSupport.set(blockClaim, cur);
      }
    }

    if (b.source_refs.length > 0 && kept.length === 0 && substantive) {
      report.unsupported_block_count++;
    }

    // substance_based_doctrinal_sufficiency_v1 — per-block category telemetry
    // + authority-overstatement detection.
    const keptProfiles = kept.map((r) => profiles.get(r)).filter(Boolean) as SourceSupportProfile[];
    const hasPrimary = keptProfiles.some((p) => p.judgment_authority || p.statutory_authority);
    const onlySecondary = keptProfiles.length > 0 && !hasPrimary &&
      keptProfiles.every((p) => p.doctrinal_authority || p.background_only);
    if (hasPrimary) report.primary_supported_block_count++;
    else if (onlySecondary) report.secondary_supported_block_count++;

    if (category === "court_holding" && overstatementDrops.length > 0) {
      report.authority_overstatements.push({
        block_index: idx,
        category,
        reason: "court_holding_supported_only_by_secondary",
        refs_dropped: overstatementDrops,
      });
    }
    if (
      basis.includes("docket_identity_escalation") && kept.length > 0 &&
      !keptProfiles.some((p) => p.judgment_authority)
    ) {
      report.authority_overstatements.push({
        block_index: idx,
        category,
        reason: "docket_identity_without_judgment_body",
        refs_dropped: [],
      });
    }

    report.claim_categories.push({
      block_index: idx,
      category,
      basis,
      kept_refs: kept,
      support_levels: keptProfiles.map((p) =>
        p.judgment_authority
          ? "judgment"
          : p.statutory_authority
          ? "statute"
          : p.doctrinal_authority
          ? "doctrinal_secondary"
          : "background"
      ),
    });

    blocks.push({ ...b, source_refs: kept } as StructuredBlock);
  });

  for (const [claim, s] of claimSupport) {
    if (s.any && !s.primary) report.commentary_only_claims.push(claim);
  }
  const mainClaims = opts?.mainClaimIds ?? [];
  report.primary_support_by_main_claim = mainClaims.length > 0
    ? mainClaims.some((c) => claimSupport.get(c)?.primary === true)
    : [...claimSupport.values()].some((s) => s.primary);

  let limitation_text = "";
  if (report.unsupported_block_count > 0 || report.source_ref_mismatch_count > 0) {
    limitation_text = CLAIM_SUPPORT_LIMITATION_HE;
    report.limitation_added = true;
  } else if (report.commentary_only_claims.length > 0 && !opts?.limitedDoctrinalAnswer) {
    limitation_text = COMMENTARY_ONLY_LIMITATION_HE;
    report.limitation_added = true;
  }
  if (report.authority_overstatements.length > 0) {
    limitation_text += AUTHORITY_OVERSTATEMENT_LIMITATION_HE;
    report.limitation_added = true;
  }

  return { draft: { blocks }, report, limitation_text };
}

