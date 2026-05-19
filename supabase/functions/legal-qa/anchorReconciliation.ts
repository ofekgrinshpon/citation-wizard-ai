// Research V2 — Anchor → Claim reconciliation.
//
// Attaches DoctrinalAnchors discovered by AnswerMap to ResearchPlan claims.
// Produces a per-claim query map that claimRetrieval consumes to fire extra
// authority-targeted searches in the local DB. Orphan anchors (no plausible
// claim attachment) are TELEMETRY-ONLY in this version — no auto-creation
// of new claims yet.

import type { ResearchPlan, V2Claim } from "./researchPlan.ts";
import type { AnswerMap, DoctrinalAnchor } from "./answerMap.ts";

export interface AnchorClaimAttachment {
  claimId: string;
  anchorId: string;
  reason: "hint" | "lexical" | "seminal_low_overlap" | "seminal_first_claim" | "fallback_first";
}

export interface ReconciliationTelemetry {
  attachments: Array<{ claim_id: string; anchor_id: string; anchor_name: string; reason: string; centrality: string }>;
  orphan_anchors: Array<{ anchor_id: string; anchor_name: string; centrality: string; type: string }>;
  claims_with_anchor_support: string[];
  anchors_per_claim: Record<string, number>;
  queries_per_claim: Record<string, number>;
  query_cap_per_claim: number;
}

export interface AnchorQueryOwner {
  query: string;
  anchorId: string;
}

export interface ReconcileResult {
  /** Per-claim list of extra search queries to fire (deduped, capped). */
  byClaim: Map<string, string[]>;
  /** Per-claim list of anchor IDs attached (for ledger-side telemetry). */
  anchorsByClaim: Map<string, string[]>;
  /** Per-claim list of (query → anchorId) ownership for tagging candidates. */
  queryOwnersByClaim: Map<string, AnchorQueryOwner[]>;
  telemetry: ReconciliationTelemetry;
}

const HEB_STOPWORDS = new Set([
  "של", "על", "עם", "אם", "או", "את", "זה", "זו", "הוא", "היא", "מה", "מי",
  "איך", "למה", "כי", "גם", "רק", "כל", "כמו", "יותר", "לא", "כן", "בין",
  "אבל", "אך", "יש", "אין", "לפי", "לפני", "אחרי", "אצל", "מן", "אל", "עד",
  "ה", "ב", "ל", "מ", "ו", "ש",
]);

function toTokens(s: string): Set<string> {
  return new Set(
    (s || "")
      .normalize("NFKC")
      .replace(/["׳״'`.,;:?!()\[\]{}\-]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !HEB_STOPWORDS.has(t)),
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit++;
  // Jaccard-ish, biased to anchor presence.
  return hit / Math.min(a.size, b.size);
}

function pickClaimForAnchor(
  anchor: DoctrinalAnchor,
  claims: V2Claim[],
  claimTokens: Map<string, Set<string>>,
): { claimId: string; reason: "hint" | "lexical" } | null {
  if (anchor.claim_hint && anchor.claim_hint.length > 0) {
    const hit = anchor.claim_hint.find((id) => claims.some((c) => c.id === id));
    if (hit) return { claimId: hit, reason: "hint" };
  }
  const anchorTokens = toTokens(`${anchor.name} ${anchor.purpose} ${anchor.statute ?? ""}`);
  if (!anchorTokens.size) return null;
  let bestId: string | null = null;
  let bestScore = 0;
  for (const c of claims) {
    const ct = claimTokens.get(c.id)!;
    const s = overlapScore(anchorTokens, ct);
    if (s > bestScore) {
      bestScore = s;
      bestId = c.id;
    }
  }
  // Require non-trivial overlap to attach. Below threshold → orphan.
  if (bestId && bestScore >= 0.15) return { claimId: bestId, reason: "lexical" };
  return null;
}

export interface ReconcileAnchorsArgs {
  plan: ResearchPlan;
  answerMap: AnswerMap;
  depth: "fast" | "deep";
  /** Max extra queries to inject per claim. Default 3 deep / 2 fast. */
  queryCapPerClaim?: number;
}

export function reconcileAnchors(args: ReconcileAnchorsArgs): ReconcileResult {
  const { plan, answerMap, depth } = args;
  const queryCapPerClaim = args.queryCapPerClaim ?? (depth === "deep" ? 3 : 2);

  const claimTokens = new Map<string, Set<string>>();
  for (const c of plan.claims) {
    claimTokens.set(c.id, toTokens(`${c.statement} ${(c.search_targets || []).join(" ")}`));
  }

  const byClaim = new Map<string, string[]>();
  const anchorsByClaim = new Map<string, string[]>();
  const queryOwnersByClaim = new Map<string, AnchorQueryOwner[]>();
  const attachments: ReconciliationTelemetry["attachments"] = [];
  const orphan_anchors: ReconciliationTelemetry["orphan_anchors"] = [];

  for (const anchor of answerMap.doctrinal_anchors) {
    const pick = pickClaimForAnchor(anchor, plan.claims, claimTokens);
    if (!pick) {
      orphan_anchors.push({
        anchor_id: anchor.id,
        anchor_name: anchor.name,
        centrality: anchor.centrality,
        type: anchor.type,
      });
      continue;
    }
    attachments.push({
      claim_id: pick.claimId,
      anchor_id: anchor.id,
      anchor_name: anchor.name,
      reason: pick.reason,
      centrality: anchor.centrality,
    });

    // Inject anchor queries into the claim's bucket (deduped, capped).
    const bucket = byClaim.get(pick.claimId) ?? [];
    const anchorList = anchorsByClaim.get(pick.claimId) ?? [];
    const owners = queryOwnersByClaim.get(pick.claimId) ?? [];
    for (const q of anchor.queries) {
      const norm = q.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
      if (!norm) continue;
      if (bucket.some((existing) => existing.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase() === norm)) continue;
      if (bucket.length >= queryCapPerClaim) break;
      const trimmed = q.trim();
      bucket.push(trimmed);
      owners.push({ query: trimmed, anchorId: anchor.id });
    }
    if (!anchorList.includes(anchor.id)) anchorList.push(anchor.id);
    byClaim.set(pick.claimId, bucket);
    anchorsByClaim.set(pick.claimId, anchorList);
    queryOwnersByClaim.set(pick.claimId, owners);
  }

  const queries_per_claim: Record<string, number> = {};
  const anchors_per_claim: Record<string, number> = {};
  for (const c of plan.claims) {
    queries_per_claim[c.id] = byClaim.get(c.id)?.length ?? 0;
    anchors_per_claim[c.id] = anchorsByClaim.get(c.id)?.length ?? 0;
  }

  return {
    byClaim,
    anchorsByClaim,
    queryOwnersByClaim,
    telemetry: {
      attachments,
      orphan_anchors,
      claims_with_anchor_support: [...anchorsByClaim.keys()].filter((id) => (anchorsByClaim.get(id)?.length ?? 0) > 0),
      anchors_per_claim,
      queries_per_claim,
      query_cap_per_claim: queryCapPerClaim,
    },
  };
}
