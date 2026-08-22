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
  | "unrelated_legal_area";

export interface DroppedSourceRef {
  ref: string;
  block_index: number;
  reason: MismatchReason;
  block_claim_id?: string | null;
  source_claim_ids?: string[];
  block_legal_area?: string | null;
  source_legal_area?: string | null;
}

export interface ClaimSourceMatchReport {
  applied: boolean;
  source_ref_mismatch_count: number;
  dropped_source_refs: DroppedSourceRef[];
  mismatch_reason: MismatchReason[];
  unsupported_block_count: number;
  limitation_added: boolean;
  primary_support_by_main_claim: boolean;
  commentary_only_claims: string[];
  tagged_block_count: number;
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
  opts?: { mainClaimIds?: string[] },
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
  };
  if (!draft) return { draft, report, limitation_text: "" };

  const metas = inputSources.map(buildSourceMatchMeta);
  const byRef = new Map(metas.map((m) => [m.ref, m]));
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
      if (
        !reason && substantive &&
        (m.support_subtype === "background" || m.support_subtype === "commentary") &&
        !m.is_primary
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
  } else if (report.commentary_only_claims.length > 0) {
    limitation_text = COMMENTARY_ONLY_LIMITATION_HE;
    report.limitation_added = true;
  }

  return { draft: { blocks }, report, limitation_text };
}
