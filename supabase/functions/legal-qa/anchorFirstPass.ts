// Step 3 — Anchor-first citation priority (V3 deep).
//
// Pure TS, no LLM call. Two helpers:
//
//   1. `sortAllowedIdsByTier(...)` — sort a claim's allowed contract ids so
//      verified seminal anchors (statute/regulation/basic-law, then leading
//      anchored cases) come first in the drafter prompt's "מקורות מותרים".
//
//   2. `enforceAnchorFirst(...)` — runs AFTER `parseMarkers` and BEFORE
//      `buildFootnotes`. For every claim that has a verified tier-1/2 anchor
//      in its allowed set, ensure that anchor is the FIRST id inside the
//      `[cite:...]` token group(s) the drafter wrote for that claim.
//
// Hard rules (matches the narrowed Step 3 scope):
//   • Only reorder cite markers within the same verified claim/source map.
//   • Never insert an anchor into an unrelated sentence (only into a marker
//     that already cites at least one source belonging to the same claim).
//   • Never cite an anchor that failed verification — we only ever promote
//     ids that already appear in `ledger.entries[].sources` (those have
//     `support ∈ {direct, partial}`).
//   • Cap each touched cite group at 2 ids: [anchor, one secondary].

import type { Ledger } from "./ledger.ts";
import type { ContractSourceCard, ParseMarkersResult, ParsedMarker } from "./cardClaimContract.ts";

// ─── Tier classifier ────────────────────────────────────────────────

export type Tier = 1 | 2 | 3 | 4 | 5;

const TIER1_TYPES = new Set([
  "statute", "statute_section", "legislation",
  "regulation", "regulations",
  "basic_law", "basic_law_section",
]);
const TIER2_TYPES = new Set([
  "leading_case", "case_law", "caselaw", "judgment", "supreme_court",
]);
const TIER3_TYPES = new Set([
  "committee_report", "report", "government_report",
]);
const TIER4_TYPES = new Set([
  "academic", "article", "book", "secondary", "encyclopedia",
]);

/**
 * Tier 1 — verified statute/regulation/basic-law section.
 * Tier 2 — verified leading case WITH a planner-anchor id (i.e. it was an
 *          expected authority that survived verification).
 * Tier 3 — verified supporting case / committee report.
 * Tier 4 — verified academic / secondary commentary.
 * Tier 5 — everything else.
 */
export function classifyTier(sourceType: string, hasAnchorId: boolean): Tier {
  const t = (sourceType || "").toLowerCase().trim();
  if (TIER1_TYPES.has(t)) return 1;
  if (TIER2_TYPES.has(t)) return hasAnchorId ? 2 : 3;
  if (TIER3_TYPES.has(t)) return 3;
  if (TIER4_TYPES.has(t)) return 4;
  return 5;
}

export interface AllowedSourceInfo {
  contractId: string;
  sourceType: string;
  hasAnchorId: boolean;
}

/**
 * Stable sort: anchor-first by tier, original drafter-prompt order broken
 * only when tier strictly improves.
 */
export function sortAllowedIdsByTier(infos: AllowedSourceInfo[]): string[] {
  return [...infos]
    .map((info, i) => ({ info, i, tier: classifyTier(info.sourceType, info.hasAnchorId) }))
    .sort((a, b) => (a.tier - b.tier) || (a.i - b.i))
    .map((x) => x.info.contractId);
}

// ─── Post-draft anchor-first enforcement ────────────────────────────

export type AnchorFirstAction = "promoted" | "added" | "kept" | "no_anchor_available";

export interface AnchorFirstPerClaim {
  claim_id: string;
  action: AnchorFirstAction;
  anchor_id?: string;
  before_order: string[];
  after_order: string[];
}

export interface AnchorFirstResult {
  body: string;
  totals: {
    promoted: number;
    added: number;
    kept: number;
    no_anchor_available: number;
  };
  per_claim: AnchorFirstPerClaim[];
}

interface ClaimContext {
  claimId: string;
  /** All allowed contract ids for this claim (subset of cards). */
  allowedIds: Set<string>;
  /** Tier-sorted priority list of allowed ids (tier 1 → tier 5). */
  priorityIds: string[];
  /** Top tier-1/2 id if any, else undefined. */
  topAnchorId?: string;
  /** Anchor id (planner-side, e.g. "A3") associated with topAnchorId. */
  topPlannerAnchorId?: string;
}

const CITE_TOKEN_RE = /\[cite:\s*(S\d+(?:\s*,\s*S\d+)*)\s*\]/g;

export function enforceAnchorFirst(args: {
  body: string;
  parse: ParseMarkersResult;
  ledger: Ledger;
  cards: ContractSourceCard[];
  /** documentId → contractId map (built in researchV2Pipeline). */
  docIdToContract: Map<string, string>;
}): AnchorFirstResult {
  const { body, parse, ledger, cards, docIdToContract } = args;

  // contractId → card lookup for source_type
  const cardById = new Map<string, ContractSourceCard>();
  for (const c of cards) if (c.contractId) cardById.set(c.contractId, c);

  // Build per-claim context.
  const claimContexts: ClaimContext[] = [];
  for (const entry of ledger.entries) {
    const infos: Array<AllowedSourceInfo & { plannerAnchorId?: string }> = [];
    for (const s of entry.sources) {
      const cid = docIdToContract.get(s.documentId);
      if (!cid) continue;
      const card = cardById.get(cid);
      if (!card) continue;
      infos.push({
        contractId: cid,
        sourceType: (s.sourceType || card.source_type || "").toLowerCase(),
        hasAnchorId: !!s.anchorId,
        plannerAnchorId: s.anchorId,
      });
    }
    if (infos.length === 0) continue;
    const priorityIds = sortAllowedIdsByTier(infos);
    const allowedSet = new Set(priorityIds);
    // Top tier-1/2 anchor:
    let topAnchorId: string | undefined;
    let topPlannerAnchorId: string | undefined;
    for (const info of infos) {
      const tier = classifyTier(info.sourceType, info.hasAnchorId);
      if (tier <= 2) {
        // Walk priorityIds to pick the FIRST tier-≤2 by sorted order.
        for (const pid of priorityIds) {
          const pinfo = infos.find((x) => x.contractId === pid);
          if (!pinfo) continue;
          if (classifyTier(pinfo.sourceType, pinfo.hasAnchorId) <= 2) {
            topAnchorId = pid;
            topPlannerAnchorId = pinfo.plannerAnchorId;
            break;
          }
        }
        break;
      }
    }
    claimContexts.push({
      claimId: entry.claimId,
      allowedIds: allowedSet,
      priorityIds,
      topAnchorId,
      topPlannerAnchorId,
    });
  }

  // Determine which marker "belongs" to which claim (max-overlap heuristic).
  // Returns the index of the chosen claim context, or -1.
  function ownerForMarker(marker: ParsedMarker): number {
    let bestIdx = -1;
    let bestOverlap = 0;
    let tiedAtBest = false;
    for (let i = 0; i < claimContexts.length; i++) {
      const ctx = claimContexts[i];
      let overlap = 0;
      for (const id of marker.validSourceIds) if (ctx.allowedIds.has(id)) overlap++;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
        tiedAtBest = false;
      } else if (overlap === bestOverlap && overlap > 0) {
        tiedAtBest = true;
      }
    }
    // Ties → skip (don't enforce ambiguously).
    return tiedAtBest ? -1 : bestIdx;
  }

  // For each claim with a verified anchor, find its first owned marker and
  // enforce. Plan rewrites keyed by marker position so we apply once.
  type Rewrite = {
    start: number;
    end: number;
    newText: string;
  };
  const rewrites: Rewrite[] = [];
  const perClaim: AnchorFirstPerClaim[] = [];
  const claimActedOn = new Set<string>();

  for (const marker of parse.markers) {
    const ownerIdx = ownerForMarker(marker);
    if (ownerIdx < 0) continue;
    const ctx = claimContexts[ownerIdx];
    if (claimActedOn.has(ctx.claimId)) continue; // one enforcement per claim
    if (!ctx.topAnchorId) continue; // handled in "no_anchor_available" sweep below

    const current = marker.validSourceIds.slice();
    const before = current.slice();
    let action: AnchorFirstAction;
    let newIds: string[];

    if (current[0] === ctx.topAnchorId) {
      action = "kept";
      newIds = current;
    } else if (current.includes(ctx.topAnchorId)) {
      action = "promoted";
      // Move anchor to front, keep ONE secondary after it (first non-anchor
      // id from the original marker).
      const secondary = current.find((id) => id !== ctx.topAnchorId);
      newIds = secondary ? [ctx.topAnchorId, secondary] : [ctx.topAnchorId];
    } else {
      action = "added";
      // Prepend anchor; keep first existing id as the single secondary slot.
      const secondary = current[0];
      newIds = secondary ? [ctx.topAnchorId, secondary] : [ctx.topAnchorId];
    }

    claimActedOn.add(ctx.claimId);
    perClaim.push({
      claim_id: ctx.claimId,
      action,
      anchor_id: ctx.topPlannerAnchorId ?? ctx.topAnchorId,
      before_order: before,
      after_order: newIds,
    });

    if (action !== "kept") {
      const newText = `[cite:${newIds.join(",")}]`;
      rewrites.push({
        start: marker.position,
        end: marker.position + marker.raw.length,
        newText,
      });
    }
  }

  // Record claims with no verified tier-1/2 anchor at all (audit only).
  for (const ctx of claimContexts) {
    if (claimActedOn.has(ctx.claimId)) continue;
    if (ctx.topAnchorId) continue;
    perClaim.push({
      claim_id: ctx.claimId,
      action: "no_anchor_available",
      before_order: [],
      after_order: [],
    });
  }

  // Apply rewrites right-to-left so offsets stay valid.
  let outBody = body;
  rewrites.sort((a, b) => b.start - a.start);
  for (const r of rewrites) {
    outBody = outBody.slice(0, r.start) + r.newText + outBody.slice(r.end);
  }

  const totals = {
    promoted: perClaim.filter((p) => p.action === "promoted").length,
    added: perClaim.filter((p) => p.action === "added").length,
    kept: perClaim.filter((p) => p.action === "kept").length,
    no_anchor_available: perClaim.filter((p) => p.action === "no_anchor_available").length,
  };

  return { body: outBody, totals, per_claim: perClaim };
}

// Suppress unused-import warning for the regex (kept for parity with parser).
void CITE_TOKEN_RE;
