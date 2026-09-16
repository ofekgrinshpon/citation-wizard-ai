/**
 * legal-research-v2 — verification forensics (evaluation/reporting only).
 *
 * Deterministic reconstruction of the per-claim verification chain from data
 * the run already produced: the memo the agent wrote and the verification
 * outcome that judged it. It makes NO judgement of its own, changes no
 * verdict, and is never shown to the end user.
 */

import type { MemoClaim, RejectedPair, ResearchMemo, VerificationOutcome } from "../types.ts";

export interface ForensicEvidenceRow {
  claim_id: string;
  proposition: string;
  importance: "core" | "supporting";
  source_id: string;
  quoted_span: string;
  locator: string | null;
  /** Deterministic stage outcomes, from the rejection stage when rejected. */
  body_read: "ok" | "failed" | "unknown";
  identity: "ok" | "failed" | "unknown";
  span: "ok" | "failed" | "unknown";
  support_verdict: "supports" | "supports_partially" | "does_not_support" | "not_reached";
  support_reason: string;
  claim_outcome: "verified" | "partially_supported" | "rejected";
  rejection_reason?: string;
}

const STAGE_ORDER = ["readable", "identity", "span", "support", "temporal"] as const;

function stageOf(r: RejectedPair): string {
  if (r.stage) return r.stage;
  switch (r.reason) {
    case "unknown_source_id":
    case "fetch_failed":
    case "empty_body":
    case "not_actual_document":
      return "readable";
    case "identity_mismatch":
      return "identity";
    case "span_not_found":
    case "span_too_short":
      return "span";
    default:
      return "support";
  }
}

function mark(reached: number, stageIndex: number, failedAt: number | null) {
  if (failedAt !== null && failedAt === stageIndex) return "failed" as const;
  if (stageIndex < reached) return "ok" as const;
  return "unknown" as const;
}

export function buildVerificationForensics(
  memo: ResearchMemo | null | undefined,
  verification: VerificationOutcome | null | undefined,
): ForensicEvidenceRow[] {
  if (!memo || !verification) return [];
  const rows: ForensicEvidenceRow[] = [];
  const verified = new Map(verification.pack.claims.map((c) => [c.claim_id, c]));

  for (const claim of memo.claims as MemoClaim[]) {
    const v = verified.get(claim.claim_id);
    for (const ev of claim.evidence ?? []) {
      const rejection = verification.rejected.find(
        (r) => r.claim_id === claim.claim_id && r.source_id === ev.source_id,
      );
      const vSource = v?.sources.find((s) => s.source_id === ev.source_id);
      const failedAt = rejection ? STAGE_ORDER.indexOf(stageOf(rejection) as never) : null;
      const reached = rejection ? (failedAt < 0 ? 4 : failedAt) : 4;
      rows.push({
        claim_id: claim.claim_id,
        proposition: claim.proposition,
        importance: claim.importance,
        source_id: ev.source_id,
        quoted_span: vSource?.verified_span ?? ev.quoted_span,
        locator: ev.locator ?? null,
        body_read: mark(reached, 0, failedAt),
        identity: mark(reached, 1, failedAt),
        span: mark(reached, 2, failedAt),
        support_verdict: rejection
          ? (rejection.reason === "support_does_not_support" ? "does_not_support" : "not_reached")
          : v
          ? (v.support_status === "supported" ? "supports" : "supports_partially")
          : "not_reached",
        support_reason: rejection?.detail ?? (v ? "accepted by support verifier" : ""),
        claim_outcome: v
          ? (v.support_status === "supported" ? "verified" : "partially_supported")
          : "rejected",
        rejection_reason: rejection?.reason,
      });
    }
  }
  return rows;
}
