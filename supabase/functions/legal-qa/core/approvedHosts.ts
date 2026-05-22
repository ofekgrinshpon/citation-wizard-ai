// Research Core — shared approved-host allowlists.
//
// Single source of truth for the hosts that retrieval is allowed to fetch
// from AND citation_quality is allowed to keep. Previously these lived in two
// separate files (`citations.ts` and `retrieval.ts`) and drifted: TIER_A
// scholarship hosts like SSRN/JSTOR were queried by the anchor-driven web
// pass but immediately dropped by citation_quality as `off_domain`.

export const PRIMARY_HOSTS: readonly string[] = [
  "nevo.co.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
  "takdin.co.il",
  "lite.takdin.co.il",
  "psakdin.co.il",
  "din.org.il",
  "reshumot.gov.il",
  "fs.knesset.gov.il",
  "main.knesset.gov.il",
  "knesset.gov.il",
  "justice.gov.il",
];

// Government / regulator subset of TIER_A — used for factual-anchor web queries.
export const TIER_A_GOV_HOSTS: readonly string[] = [
  "knesset.gov.il",
  "main.knesset.gov.il",
  "fs.knesset.gov.il",
  "mevaker.gov.il",
  "justice.gov.il",
  "reshumot.gov.il",
  "competition.gov.il",
  "tax.gov.il",
  "mof.gov.il",
  "supreme.court.gov.il",
  "supremedecisions.court.gov.il",
];

// Academic / scholarship subset of TIER_A — used for concept-anchor web queries.
export const TIER_A_SCHOLARSHIP_HOSTS: readonly string[] = [
  "huji.ac.il",
  "law.huji.ac.il",
  "mishpatim.huji.ac.il",
  "iyunim.huji.ac.il",
  "openscholar.huji.ac.il",
  "cris.huji.ac.il",
  "tau.ac.il",
  "law.tau.ac.il",
  "biu.ac.il",
  "law.biu.ac.il",
  "haifa.ac.il",
  "law.haifa.ac.il",
  "idi.org.il",
  "ssrn.com",
  "papers.ssrn.com",
  "jstor.org",
];

// Superset of every host the system is allowed to keep. citation_quality's
// off_domain gate consults this — it MUST contain everything retrieval queries
// (PRIMARY + GOV + SCHOLARSHIP) so we never query a host then immediately drop
// what came back from it.
export const APPROVED_SCHOLARLY_HOSTS: readonly string[] = Array.from(
  new Set([...TIER_A_SCHOLARSHIP_HOSTS]),
);

export const ALL_APPROVED_HOSTS: readonly string[] = Array.from(
  new Set([
    ...PRIMARY_HOSTS,
    ...TIER_A_GOV_HOSTS,
    ...TIER_A_SCHOLARSHIP_HOSTS,
  ]),
);

export function hostOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isApprovedHost(
  host: string,
  list: readonly string[],
): boolean {
  if (!host) return false;
  for (const h of list) if (host === h || host.endsWith("." + h)) return true;
  return false;
}
