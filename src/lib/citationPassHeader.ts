import { findCitationPassOffer } from "../../supabase/functions/_shared/citationPassOffers";
import type { CitationPassStatus } from "@/lib/citationPassClient";

/** Remaining sources on one pass, recovered exactly from the server's 4-decimal used ratio and the catalogue size. */
export function passSourcesRemaining(pass: CitationPassStatus): number {
  const total = findCitationPassOffer(pass.offerId)?.sourceCount ?? 0;
  return Math.max(0, total - Math.round(pass.usedRatio * total));
}

/**
 * Header summary following the server quota rule: while any settled pass is unexpired,
 * new sources draw from paid passes only (earliest expiry first) and never fall back to
 * the account's remaining free + referral sources (pooled into the count). Returns null when no paid pass applies.
 */
export function activePassSummary(passes: CitationPassStatus[], now = Date.now(), freeRemaining = 0): { remaining: number } | null {
  const live = passes.filter(p => (p.status === "active" || p.status === "exhausted") && p.expiresAt && Date.parse(p.expiresAt) > now);
  if (live.length === 0) return null;
  const remaining = live.filter(p => p.status === "active").reduce((sum, p) => sum + passSourcesRemaining(p), 0);
  // Pooled: once passes are used up, the server draws from the free + referral allowance.
  return { remaining: remaining + Math.max(0, freeRemaining) };
}
