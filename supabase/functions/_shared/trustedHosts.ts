/**
 * Shared trusted-host lists for Perplexity citation gating.
 *
 * TRUSTED_LEGAL  — high-authority Israeli legal/court/database sources.
 *                  This is the Tier-1 allowlist. Behaviour-equivalent to the
 *                  per-callsite `search_domain_filter` arrays in
 *                  `citation-chat/index.ts`. Do NOT widen this list — Tier-1
 *                  must keep its current source hierarchy.
 *
 * TRUSTED_PUB    — curated academic/policy publishers admitted ONLY by the
 *                  Tier-2 fallback (`citation-chat` open-web retry) after
 *                  Tier-1 returns no usable citations. Validated against the
 *                  perplexity-openweb-experiment results.
 *                  Explicitly excluded for now: Wikipedia, Scribd, mako PDFs,
 *                  a7.org, lawprofsforum, law-firm blogs, podcasts.
 *
 * isTrustedHost(url, set)  — host-or-subdomain match against the chosen set
 *                  (default = LEGAL ∪ PUB).
 */

export const TRUSTED_LEGAL: readonly string[] = [
  "nevo.co.il",
  "court.gov.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  "knesset.gov.il",
  "reshumot.gov.il",
  "gov.il",
];

export const TRUSTED_PUB: readonly string[] = [
  // Law-faculty journals
  "taulawreview.sites.tau.ac.il",
  "lawjournal.huji.ac.il",
  "law.haifa.ac.il",
  "law.tau.ac.il",
  "law.huji.ac.il",
  "law.biu.ac.il",
  "law.idc.ac.il",
  "law.colman.ac.il",
  // Faculty / institutional hosts
  "tau.ac.il",
  "huji.ac.il",
  "biu.ac.il",
  "haifa.ac.il",
  "openu.ac.il",
  "idc.ac.il",
  "colman.ac.il",
  "mishpat.ac.il",
  // Policy / library
  "idi.org.il",
  "nli.org.il",
  "main.knesset.gov.il",
  "fs.knesset.gov.il",
  // Academic working-paper archive
  "papers.ssrn.com",
  "ssrn.com",
];

export function hostOf(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isTrustedHost(
  url: unknown,
  set: readonly string[] = [...TRUSTED_LEGAL, ...TRUSTED_PUB],
): boolean {
  const host = hostOf(url);
  if (!host) return false;
  return set.some((d) => host === d || host.endsWith("." + d));
}

export function countTrustedCitations(
  citations: unknown,
  set: readonly string[] = [...TRUSTED_LEGAL, ...TRUSTED_PUB],
): number {
  if (!Array.isArray(citations)) return 0;
  let n = 0;
  for (const u of citations) if (isTrustedHost(u, set)) n++;
  return n;
}

export function untrustedHosts(
  citations: unknown,
  set: readonly string[] = [...TRUSTED_LEGAL, ...TRUSTED_PUB],
): string[] {
  if (!Array.isArray(citations)) return [];
  const out: string[] = [];
  for (const u of citations) {
    const h = hostOf(u);
    if (h && !set.some((d) => h === d || h.endsWith("." + d))) out.push(h);
  }
  return out;
}
