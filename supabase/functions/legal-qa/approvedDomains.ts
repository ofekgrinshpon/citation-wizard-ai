// Approved-domain allowlist for Legal QA V3.
//
// Reconciles the two existing lists that V2 inherited:
//   • ORIENTATION_DOMAINS (answerMap.ts) — wide, used only for the orientation
//     Perplexity pass; never promoted to citations.
//   • TRUSTED_LEGAL_DOMAINS (index.ts)   — narrow URL allowlist + Perplexity
//     search_domain_filter for the citation-tier pass.
//
// V3 collapses both into a single two-tier list:
//   • Tier A — citation-tier (primary sources). May be promoted to footnotes
//     when the candidate is citation-shaped AND the URL is on Tier A.
//   • Tier B — orientation-only (research institutes, encyclopedic).
//     Discovery hints only; NEVER promoted to citations. Hits are logged to
//     `anchor_discovery_hints` and then dropped from candidate pools.
//
// Both tiers fit inside Perplexity's hard `search_domain_filter` cap (≤20).
// Tier A drives the citation pass; Tier B drives the orientation pass.
//
// Subdomain matching: `citationTier()` and `isApprovedUrl()` accept the exact
// host AND any subdomain (so `mishpatim.tau.ac.il` matches `tau.ac.il`).

// ─── Tier A — citation-tier (primary sources) ─────────────────────────────
// 19 entries, 1 headroom under the 20-cap.
export const TIER_A_DOMAINS: readonly string[] = [
  // Caselaw — courts + major caselaw DBs (7)
  "nevo.co.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  // Legislation / official primary (3)
  "knesset.gov.il",        // covers main.* and fs.*
  "reshumot.gov.il",       // official gazette (ס"ח / ק"ת)
  "justice.gov.il",        // AG opinions, legislative drafts
  // Regulators / policy government bodies (4)
  "mevaker.gov.il",        // State Comptroller
  "competition.gov.il",    // Competition Authority
  "tax.gov.il",            // Tax Authority
  "mof.gov.il",            // Ministry of Finance
  // Academic primary (2)
  "ssrn.com",              // covers papers.ssrn.com
  "jstor.org",
  // Israeli law journals (3) — covered via university subdomains
  "tau.ac.il",             // covers mishpatim.tau.ac.il, law.tau.ac.il
  "huji.ac.il",            // covers law.huji.ac.il
  "biu.ac.il",             // covers law.biu.ac.il
];

// ─── Tier B — orientation-only (research institutes, encyclopedic) ────────
// Hits are logged for plan-anchor discovery hints but DROPPED before the
// citation pool. Never become footnotes.
export const TIER_B_DOMAINS: readonly string[] = [
  "idi.org.il",            // Israel Democracy Institute
  "taubcenter.org.il",     // Taub Center
  "daat.ac.il",            // Jewish-law encyclopedic
  "sefaria.org",           // classical sources reference
  "gov.il",                // generic gov.il (non-primary press/announcements)
];

// Defensive: each tier independently must stay ≤20 (Perplexity cap).
export const TIER_A_DOMAIN_FILTER: readonly string[] = TIER_A_DOMAINS.slice(0, 20);
export const TIER_B_DOMAIN_FILTER: readonly string[] = TIER_B_DOMAINS.slice(0, 20);

const TIER_A_SET = new Set(TIER_A_DOMAINS);
const TIER_B_SET = new Set(TIER_B_DOMAINS);

function hostMatches(host: string, list: readonly string[], set: Set<string>): boolean {
  if (set.has(host)) return true;
  for (const allowed of list) {
    if (host.endsWith("." + allowed)) return true;
  }
  return false;
}

/**
 * Returns the citation tier for a URL:
 *   "A"  → citation-tier (primary), may become a footnote.
 *   "B"  → orientation-only (discovery hint), NEVER becomes a footnote.
 *   null → not on any approved list; drop.
 *
 * Tier A wins ties (a host appearing on both lists is treated as A).
 */
export function citationTier(url: string): "A" | "B" | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (hostMatches(host, TIER_A_DOMAINS, TIER_A_SET)) return "A";
    if (hostMatches(host, TIER_B_DOMAINS, TIER_B_SET)) return "B";
    return null;
  } catch {
    return null;
  }
}

/** Convenience: true iff the URL is on Tier A or Tier B. */
export function isApprovedUrl(url: string): boolean {
  return citationTier(url) !== null;
}
