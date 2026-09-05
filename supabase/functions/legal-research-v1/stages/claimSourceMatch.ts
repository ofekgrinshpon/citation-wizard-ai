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
  academicTopicalFit,
  type AcademicAuthorityAlignmentReport,
  blockAllowsReferenceOnly,
  CATEGORY_TO_ROLE,
  classifyAcademicSourceRoles,
  emptyAcademicAuthorityAlignment,
  guardPrimaryLanguage,
  isBibliographyOnlySource,
  isCategoricalClaim,
  isStrongPartial,
} from "./academicAuthorityAlignment.ts";

import {
  type AuthorityOverstatement,
  AUTHORITY_OVERSTATEMENT_LIMITATION_HE,
  categoryAccepts,
  type ClaimSupportCategory,
  isAcademicClaimCategory,
  deriveClaimCategory,
  profileSource,
  type SourceSupportProfile,
} from "./claimSupportCategory.ts";
import {
  calibrateNonAcademicCategory,
  type CsmLegalAreaEquivalenceRow,
  evaluateAreaEquivalence,
  type NonAcademicClaimCategoryRow,
} from "./nonAcademicBinding.ts";
import {
  type BindingKind,
  emptyRebindingSummary,
  evaluateBinding,
  type RebindingSummary,
  selectBlockRefs,
} from "./claimSourceRebinding.ts";

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
  | "insufficient_authority_for_claim_category"
  /** academic_citation_authority_alignment_v1 */
  | "partial_support_for_categorical_claim"
  | "off_topic_for_academic_claim";

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
  /** claim_source_rebinding_v1 telemetry. */
  rebinding: RebindingSummary;
  /** academic_citation_authority_alignment_v1 telemetry. */
  academic_authority_alignment?: AcademicAuthorityAlignmentReport;

  /** non_academic_source_binding_and_csm_v1 telemetry. */
  csm_legal_area_equivalence?: CsmLegalAreaEquivalenceRow[];
  non_academic_claim_category_calibration?: NonAcademicClaimCategoryRow[];

  /** academic_utilization_stabilization_v1 — refs kept as reading pointers
   *  only (bibliography-only academic items in literature/framing blocks). */
  reference_only_refs?: string[];

  /** canonical_body_acquisition_and_csm_survival_v1 telemetry. */
  canonical_survival?: CanonicalSurvivalRow[];
  canonical_survival_summary?: {
    considered: number;
    survived: number;
    reanchored: number;
    dropped_without_anchor: number;
  };
}

/** canonical_body_acquisition_and_csm_survival_v1 — one row per body-acquired
 *  canonical authority / directly relevant doctrinal work. */
export interface CanonicalSurvivalRow {
  ref: string;
  title: string;
  kind: "canonical_authority" | "direct_scholarship";
  survived_csm: boolean;
  reanchored: boolean;
  reanchor_block_index: number | null;
  reanchor_evidence: "block_text_names_source" | "verified_claim_tag_match" | null;
  drop_reason: string | null;
}

/**
 * Distinctive strings that prove a sentence is talking about this source:
 * its docket (all Hebrew quote variants) and a long party/author token.
 */
export function identityTokens(s: { title?: string; display_title?: string }): string[] {
  const title = String(s.display_title ?? s.title ?? "");
  const out: string[] = [];
  const docket = title.match(/\d{1,6}\s*\/\s*\d{2,4}/);
  if (docket) out.push(docket[0].replace(/\s+/g, ""), docket[0]);
  for (const w of title.split(/[\s,\.\(\)"\u05f4\u05f3']+/)) {
    if (w.length >= 5 && /[\u0590-\u05ff]/.test(w)) out.push(w);
  }
  return [...new Set(out)].slice(0, 6);
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
  /** claim_source_rebinding_v1 — verifier's own statement of what it supports. */
  supported_points: string[];
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
    supported_points: Array.isArray(s.supported_points) ? s.supported_points : [],
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
  opts?: {
    mainClaimIds?: string[];
    limitedDoctrinalAnswer?: boolean;
    /** academic_citation_authority_alignment_v1 */
    academicMode?: boolean;
    question?: string;
  },
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
    rebinding: emptyRebindingSummary(),
  };
  const academicMode = opts?.academicMode === true;
  const areaEquivalenceRows: CsmLegalAreaEquivalenceRow[] = [];
  const categoryCalibrationRows: NonAcademicClaimCategoryRow[] = [];
  if (!academicMode) {
    report.csm_legal_area_equivalence = areaEquivalenceRows;
    report.non_academic_claim_category_calibration = categoryCalibrationRows;
  }
  const align = emptyAcademicAuthorityAlignment();
  align.applied = academicMode;
  if (academicMode) report.academic_authority_alignment = align;
  if (!draft) return { draft, report, limitation_text: "" };
  report.rebinding.applied = true;
  const sourceByRef = new Map(inputSources.map((s) => [s.ref, s]));


  const metas = inputSources.map(buildSourceMatchMeta);
  const byRef = new Map(metas.map((m) => [m.ref, m]));
  const profiles = new Map<string, SourceSupportProfile>(
    inputSources.map((s) => [s.ref, profileSource(s)]),
  );
  report.applied = true;

  // academic_utilization_stabilization_v1 — role map + question, computed once.
  const question = String(opts?.question ?? "");
  const eligibleRefsGlobal = new Set(
    inputSources.filter((s) => profiles.get(s.ref)?.doctrinal_authority === true).map((s) => s.ref),
  );
  const rolesGlobal = academicMode
    ? classifyAcademicSourceRoles(inputSources, eligibleRefsGlobal)
    : null;
  const referenceOnlyRefs = new Set<string>();
  const hasRole = (ref: string, category: ClaimSupportCategory): boolean => {
    const role = CATEGORY_TO_ROLE[category];
    if (!role) return false;
    if (rolesGlobal?.by_role[role]?.includes(ref)) return true;
    // bibliography-only items play the background/framing role by nature.
    const src = sourceByRef.get(ref);
    return role === "doctrinal_background_source" && !!src && isBibliographyOnlySource(src);
  };

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
    const derived = deriveClaimCategory({
      declared: typeof declared === "string" ? declared : null,
      propositionType: ptype,
      text: typeof (b as unknown as Record<string, unknown>).text === "string"
        ? String((b as unknown as Record<string, unknown>).text)
        : "",
      academicMode,
    });
    const { basis, remapped_from } = derived;
    let category = derived.category;
    // non_academic_source_binding_and_csm_v1 — a generic doctrine paragraph is
    // not a court holding. Blocks that name a judgment or assert a holding keep
    // the strict primary requirement.
    if (!academicMode) {
      const calibrated = calibrateNonAcademicCategory({
        block_id: `b${idx}`,
        category,
        basis,
        text: typeof (b as unknown as Record<string, unknown>).text === "string"
          ? String((b as unknown as Record<string, unknown>).text)
          : "",
      });
      if (calibrated.row) {
        categoryCalibrationRows.push(calibrated.row);
        category = calibrated.category as ClaimSupportCategory;
      }
    }
    const academicCategory = isAcademicClaimCategory(category);
    const doctrinalCategory = category === "doctrinal_synthesis" ||
      category === "scholarly_commentary" || category === "contextual_background" ||
      academicCategory;
    if (academicMode) {
      align.academic_claim_categories_used[category] =
        (align.academic_claim_categories_used[category] ?? 0) + 1;
      if (remapped_from) {
        align.declared_categories_remapped++;
        align.declared_category_remaps.push({
          block_index: idx,
          from: remapped_from,
          to: category,
          basis,
        });
        if (category === "court_holding" || category === "statutory") {
          align.declared_categories_kept_primary++;
        }
      }
    }

    const overstatementDrops: string[] = [];

    const kept: string[] = [];
    const blockBindings = new Map<string, BindingKind>();
    const blockText = typeof (b as unknown as Record<string, unknown>).text === "string"
      ? String((b as unknown as Record<string, unknown>).text)
      : "";

    // academic_utilization_stabilization_v1 — per-block support context.
    const fitOf = new Map<string, boolean>();
    if (academicMode) {
      for (const ref of b.source_refs) {
        const s = sourceByRef.get(ref);
        if (s) fitOf.set(ref, academicTopicalFit(question, blockText, s).fit);
      }
    }
    const betterDirectAvailable = academicMode &&
      b.source_refs.some((r) => {
        const mm = byRef.get(r);
        const pp = profiles.get(r);
        return !!mm && mm.verifier_verdict === "direct" && fitOf.get(r) === true &&
          !!(pp?.doctrinal_authority || pp?.judgment_authority || pp?.statutory_authority);
      });



    for (const ref of b.source_refs) {
      const m = byRef.get(ref);
      if (!m) {
        // user-document refs and registry refs are not verifier-bound.
        kept.push(ref);
        continue;
      }
      let reason: MismatchReason | null = null;

      // Rule A — claim/facet binding (claim_source_rebinding_v1).
      // A ref is dropped only when no substantive binding exists at all;
      // pure id-space divergence no longer costs a good source.
      const src0 = sourceByRef.get(ref);
      const prof0 = profiles.get(ref);
      const decision = evaluateBinding({
        block_index: idx,
        claim_id: tags.claim_id,
        facet_id: tags.facet_id,
        proposition_type: ptype,
        claim_category: category,
        legal_area: tags.legal_area,
        text: blockText,
        academic_mode: academicMode,
      }, {
        ref,
        verified_claim_ids: m.verified_claim_ids,
        facet_ids: m.facet_ids,
        supported_points: m.supported_points,
        legal_area: m.legal_area,
        verifier_verdict: m.verifier_verdict,
        body_acquired: m.body_acquired,
        title: String(src0?.title ?? ""),
        snippet: String(src0?.snippet ?? ""),
        topical_fit_passed: fitOf.get(ref) === true,
        is_secondary_academic: !m.is_primary &&
          (prof0?.doctrinal_authority === true || isBibliographyOnlySource(src0!)),
      });
      blockBindings.set(ref, decision.binding);
      report.rebinding.decisions.push(decision);
      if (academicMode && decision.reason === "shared_title_subject_terms") {
        align.hebrew_rebinding.push({
          attempted: true,
          source_id: ref,
          title: String(src0?.title ?? ""),
          old_binding_result: "unbound",
          new_binding_result: decision.binding,
          reason: decision.reason,
          title_topic_match: true,
          verifier_verdict: m.verifier_verdict,
          topical_fit: fitOf.get(ref) === true,
        });
      }

      switch (decision.binding) {
        case "exact":
          report.rebinding.bound_exact++;
          break;
        case "facet":
          report.rebinding.bound_facet++;
          break;
        case "topical":
          report.rebinding.bound_topical++;
          break;
        case "area_direct":
          report.rebinding.bound_area_direct++;
          break;
        default:
          report.rebinding.unbound++;
      }

      // What the pre-rebinding string-identity rule would have done.
      const legacyMismatch = !!(
        blockClaim && m.verified_claim_ids.length > 0 &&
        !m.verified_claim_ids.includes(blockClaim) &&
        !(tags.facet_id && m.facet_ids.includes(tags.facet_id))
      );
      if (legacyMismatch) report.rebinding.claim_mismatch_drops_before++;

      if (decision.binding === "unbound") {
        reason = "claim_mismatch";
        report.rebinding.claim_mismatch_drops_after++;
      } else if (legacyMismatch) {
        report.rebinding.rebound_ref_count++;
      }


      // Rule B — background/commentary only for background/limitation blocks.
      // Relaxed (substance_based_doctrinal_sufficiency_v1) for doctrinal /
      // scholarly / background categories when the source is an eligible
      // acquired doctrinal secondary. Court-holding claims are unaffected.
      const prof = profiles.get(ref);
      const doctrinalEligible = prof?.doctrinal_authority === true;
      const roleMatch = academicMode && hasRole(ref, category);
      const strongPartial = academicMode &&
        isStrongPartial({
          verdict: m.verifier_verdict,
          topicalFitPassed: fitOf.get(ref) === true,
          roleMatch,
          betterDirectAvailable,
        });
      let referenceOnly = false;
      if (
        !reason && substantive &&
        (m.support_subtype === "background" || m.support_subtype === "commentary") &&
        !m.is_primary &&
        !(doctrinalCategory && doctrinalEligible)
      ) {
        // academic_utilization_stabilization_v1 — a genuine bibliography-only
        // academic item may stay in a literature/framing block as a reading
        // pointer. It never supports a substantive legal proposition.
        const bibOnly = academicMode && !!src0 && isBibliographyOnlySource(src0) &&
          blockAllowsReferenceOnly(category, blockText) &&
          fitOf.get(ref) === true &&
          (m.verifier_verdict === "direct" || strongPartial);
        if (bibOnly) {
          referenceOnly = true;
          referenceOnlyRefs.add(ref);
          align.bib_reference_uses.push({
            source_title: String(src0?.title ?? ""),
            block_category: category,
            reference_only: true,
            reason: "bibliography_only_reading_pointer",
          });
        } else {
          reason = "commentary_in_substantive_block";
          if (academicMode && !!src0 && isBibliographyOnlySource(src0)) {
            align.bib_reference_uses.push({
              source_title: String(src0.title ?? ""),
              block_category: category,
              reference_only: false,
              reason: fitOf.get(ref) === true
                ? "block_does_not_allow_reference_only"
                : "off_topic",
            });
          }
        }
      }


      // Rule C — analogical / same-domain never carries a black-letter rule.
      if (!reason && !referenceOnly && ptype === "black_letter_rule" && m.support_subtype === "analogy") {
        reason = "analogical_for_black_letter";
      }

      // Rule D — unrelated legal area on a central proposition.
      if (
        !reason && !referenceOnly && substantive && tags.legal_area && m.legal_area &&
        tags.legal_area !== m.legal_area
      ) {
        // academic_utilization_stabilization_v1 — academic writing legitimately
        // crosses doctrinal areas (constitutional ↔ administrative ↔ family).
        // For academic, non-primary claim categories the area mismatch is
        // demoted to a warning when the source is on topic and plays the role
        // the block needs. Holdings/statutory blocks keep the hard rule.
        const override = academicMode && academicCategory &&
          fitOf.get(ref) === true && roleMatch &&
          (m.verifier_verdict === "direct" || strongPartial);
        if (academicMode) {
          align.rule_d_area_overrides.push({
            source_id: ref,
            title: String(src0?.title ?? ""),
            block_category: category,
            source_legal_area: m.legal_area,
            block_legal_area: tags.legal_area,
            topical_fit_passed: fitOf.get(ref) === true,
            overridden: override,
            final_decision: override ? "kept_with_warning" : "dropped",
          });
        }

        // non_academic_source_binding_and_csm_v1 — controlled public-law
        // adjacency. Requires doctrine-term overlap; never crosses families.
        let equivalence = false;
        if (!academicMode) {
          const row = evaluateAreaEquivalence({
            claim_id: String(tags.claim_id ?? tags.facet_id ?? `b${idx}`),
            block_area: tags.legal_area,
            source_area: m.legal_area,
            block_text: blockText,
            source_text: `${src0?.title ?? ""} ${src0?.snippet ?? ""}`,
          });
          areaEquivalenceRows.push(row);
          equivalence = row.equivalence_applied;
        }

        if (!override && !equivalence) reason = "unrelated_legal_area";
      }

      // Rule E (substance_based_doctrinal_sufficiency_v1) — the claim's
      // substance category defines the authority level it needs. A court
      // holding cannot rest on secondary material; a statutory claim cannot
      // rest on commentary alone.
      if (!reason && !referenceOnly && prof && !categoryAccepts(category, prof)) {
        reason = "insufficient_authority_for_claim_category";
        if (
          (category === "court_holding" || category === "statutory") && prof.doctrinal_authority
        ) {
          overstatementDrops.push(ref);
          if (academicMode) align.doctrinal_secondary_refs_rejected_for_primary_claims++;
        }
      }


      // academic_citation_authority_alignment_v1
      if (academicMode && !reason && !referenceOnly && prof?.doctrinal_authority && !m.is_primary) {
        // (a) `partial` support may carry cautious wording only.
        if (m.verifier_verdict !== "direct" && isCategoricalClaim(blockText)) {
          reason = "partial_support_for_categorical_claim";
          align.partial_support_refs_dropped++;
        } else if (m.verifier_verdict !== "direct" && m.verifier_verdict !== "partial") {
          reason = "insufficient_authority_for_claim_category";
        } else {
          // (b) subject-matter fit: a generally-legal source that shares no
          // subject vocabulary with the question may not be cited.
          const bindingKind = blockBindings.get(ref);
          const strongBinding = bindingKind === "exact" || bindingKind === "facet";
          const fit = academicTopicalFit(String(opts?.question ?? ""), blockText, sourceByRef.get(ref)!);
          if (!strongBinding && !fit.fit) {
            reason = "off_topic_for_academic_claim";
            align.off_topic_refs_dropped++;
          }
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

    // claim_source_rebinding_v1 — prefer the strongest binding / highest
    // authority refs and cap per-block citations to avoid footnote inflation.
    const selection = selectBlockRefs(kept, {
      bindings: blockBindings,
      profiles,
      sources: sourceByRef,
      claim_category: category,
    });
    const finalRefs = selection.refs;
    report.rebinding.capped_ref_count += selection.dropped.length;

    if (b.source_refs.length > 0 && finalRefs.length === 0 && substantive) {
      report.unsupported_block_count++;
    }

    // substance_based_doctrinal_sufficiency_v1 — per-block category telemetry
    // + authority-overstatement detection.
    const keptProfiles = finalRefs.map((r) => profiles.get(r)).filter(Boolean) as SourceSupportProfile[];

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
      basis.includes("docket_identity_escalation") && finalRefs.length > 0 &&
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
      kept_refs: finalRefs,
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

    // academic_citation_authority_alignment_v1 — conservative primary-language
    // guard: only for academic runs, and only for blocks that ended up with no
    // acquired primary support.
    let outText = blockText;
    if (academicMode && !hasPrimary) {
      const guarded = guardPrimaryLanguage(blockText, idx);
      if (guarded.report) {
        align.primary_language_blocks++;
        align.primary_language_details.push(guarded.report);
        if (guarded.report.action === "rewritten") {
          align.unsupported_primary_language_suppressed++;
          outText = guarded.text;
        }
      }
    }
    if (academicMode) {
      align.doctrinal_secondary_refs_allowed += keptProfiles.filter((p) =>
        p.doctrinal_authority && !p.judgment_authority && !p.statutory_authority
      ).length;
    }

    const outBlock = { ...b, source_refs: finalRefs } as StructuredBlock;
    if (academicMode && outText !== blockText) {
      (outBlock as unknown as Record<string, unknown>).text = outText;
    }
    blocks.push(outBlock);
  });

  // ── canonical_body_acquisition_and_csm_survival_v1 ────────────────────────
  // A canonical authority whose real body was acquired, or a directly relevant
  // doctrinal work, must not disappear silently. If such a source ended up in
  // no block, look for an EXISTING sentence that genuinely evidences it — the
  // block text names its docket/case, or the block's claim/facet tags overlap
  // the claims the verifier already bound to this source. Only then is the ref
  // re-attached. No new text, no new claim, no relaxation for anything else.
  const survival: CanonicalSurvivalRow[] = [];
  const finalRefSet = new Set(
    blocks.flatMap((blk) => ("source_refs" in blk ? (blk.source_refs ?? []) : [])),
  );
  for (const s of inputSources) {
    const prof = profiles.get(s.ref);
    const bodyAcquired = s.body_acquired === true ||
      /full_text|substantive_excerpt/.test(String(s.text_usability ?? ""));
    const canonical = bodyAcquired &&
      (Boolean((s as unknown as Record<string, unknown>).canonical_authority_id) ||
        prof?.judgment_authority === true || prof?.statutory_authority === true);
    const directScholarship = bodyAcquired && prof?.doctrinal_authority === true;
    if (!canonical && !directScholarship) continue;
    const row: CanonicalSurvivalRow = {
      ref: s.ref,
      title: s.title,
      kind: canonical ? "canonical_authority" : "direct_scholarship",
      survived_csm: finalRefSet.has(s.ref),
      reanchored: false,
      reanchor_block_index: null,
      reanchor_evidence: null,
      drop_reason: null,
    };
    if (row.survived_csm) {
      survival.push(row);
      continue;
    }
    const drops = report.dropped_source_refs.filter((d) => d.ref === s.ref);
    row.drop_reason = drops[0]?.reason ?? "not_emitted_by_drafter";
    // Hard safety reasons are never reanchored.
    if (drops.some((d) => d.reason === "unrelated_legal_area")) {
      row.drop_reason = "unrelated_legal_area";
      survival.push(row);
      continue;
    }
    const identity = identityTokens(s);
    const sourceClaims = new Set([
      ...(s.verified_claim_ids ?? []),
      ...(s.facet_ids ?? []),
    ]);
    let anchored = false;
    for (let i = 0; i < blocks.length && !anchored; i++) {
      const blk = blocks[i] as unknown as Record<string, unknown>;
      if (blk.kind === "heading" || !("source_refs" in blk)) continue;
      const text = typeof blk.text === "string" ? blk.text : "";
      if (!text) continue;
      const tags = readBlockTags(blocks[i], metas);
      const tagHit = Boolean(
        (tags.claim_id && sourceClaims.has(tags.claim_id)) ||
          (tags.facet_id && sourceClaims.has(tags.facet_id)),
      );
      const textHit = identity.some((tok) => text.includes(tok));
      if (!textHit && !tagHit) continue;
      const refs = Array.isArray(blk.source_refs) ? (blk.source_refs as string[]) : [];
      if (refs.includes(s.ref)) {
        anchored = true;
        break;
      }
      blk.source_refs = [...refs, s.ref];
      anchored = true;
      row.reanchored = true;
      row.survived_csm = true;
      row.reanchor_block_index = i;
      row.reanchor_evidence = textHit ? "block_text_names_source" : "verified_claim_tag_match";
    }
    if (!anchored) {
      row.drop_reason = row.kind === "canonical_authority"
        ? "canonical_authority_no_valid_anchor"
        : "direct_scholarship_no_valid_anchor";
    }
    survival.push(row);
  }
  report.canonical_survival = survival;
  report.canonical_survival_summary = {
    considered: survival.length,
    survived: survival.filter((r) => r.survived_csm).length,
    reanchored: survival.filter((r) => r.reanchored).length,
    dropped_without_anchor: survival.filter((r) => !r.survived_csm).length,
  };



  for (const [claim, s] of claimSupport) {
    if (s.any && !s.primary) report.commentary_only_claims.push(claim);
  }
  const mainClaims = opts?.mainClaimIds ?? [];
  report.primary_support_by_main_claim = mainClaims.length > 0
    ? mainClaims.some((c) => claimSupport.get(c)?.primary === true)
    : [...claimSupport.values()].some((s) => s.primary);

  if (academicMode) {
    align.commentary_only_claims_kept = [...report.commentary_only_claims];
    const eligibleRefs = new Set(
      inputSources.filter((s2) => profiles.get(s2.ref)?.doctrinal_authority === true).map((s2) => s2.ref),
    );
    const roles = classifyAcademicSourceRoles(inputSources, eligibleRefs);
    align.source_roles_filled = roles.filled;
    align.source_roles_missing = roles.missing;
    align.source_refs_emitted = draft.blocks.reduce(
      (n, blk) => n + (("source_refs" in blk) ? (blk.source_refs?.length ?? 0) : 0),
      0,
    );
    align.refs_kept_by_claim_source_match = report.claim_categories.reduce(
      (n, c) => n + c.kept_refs.length,
      0,
    );
    align.refs_dropped_by_authority_category = report.dropped_source_refs.filter((d) =>
      d.reason === "insufficient_authority_for_claim_category"
    ).length;

    // academic_utilization_stabilization_v1 — coverage of substantive blocks.
    const finalRefsAll = new Set(report.claim_categories.flatMap((c) => c.kept_refs));
    report.reference_only_refs = [...referenceOnlyRefs].filter((r) => finalRefsAll.has(r));
    const cov = align.source_coverage;
    const reasons = new Set<string>();
    for (const entry of report.claim_categories) {
      const blk = draft.blocks[entry.block_index];
      if (!blk || blk.kind === "heading" || !("source_refs" in blk)) continue;
      const text = String((blk as unknown as Record<string, unknown>).text ?? "");
      if (text.trim().length < 80) continue;
      cov.substantive_blocks++;
      const available = inputSources.some((s2) => {
        const p2 = profiles.get(s2.ref);
        return !!p2 && categoryAccepts(entry.category, p2) &&
          academicTopicalFit(question, text, s2).fit;
      });
      if (available) cov.blocks_with_available_source++;
      if (entry.kept_refs.length > 0) cov.blocks_with_source_ref++;
      else if (available) {
        cov.blocks_missing_ref_despite_available_source++;
        const dropped = report.dropped_source_refs.filter((d) => d.block_index === entry.block_index);
        if (dropped.length > 0) for (const d of dropped) reasons.add(d.reason);
        else reasons.add("no_ref_emitted_by_drafter");
      }
    }
    cov.reason = [...reasons];
  }


  let limitation_text = "";
  // claim_source_rebinding_v1 — proportional limitation: a caveat is added only
  // when a substantive block actually lost all of its support, not merely
  // because some ref was dropped while the block kept direct support.
  if (report.unsupported_block_count > 0) {
    limitation_text = CLAIM_SUPPORT_LIMITATION_HE;
    report.limitation_added = true;
  } else if (
    report.commentary_only_claims.length > 0 && !opts?.limitedDoctrinalAnswer && !academicMode
  ) {
    limitation_text = COMMENTARY_ONLY_LIMITATION_HE;
    report.limitation_added = true;
  }

  if (report.authority_overstatements.length > 0) {
    limitation_text += AUTHORITY_OVERSTATEMENT_LIMITATION_HE;
    report.limitation_added = true;
  }

  return { draft: { blocks }, report, limitation_text };
}

