/**
 * web_source_usability_and_authority_selection_v1 (fix 2) — helper isolated
 * from the acquisition stage so it stays dependency-light and testable.
 *
 * Selects official URLs that DISCOVERY actually returned for a given docket.
 * Guessed court URLs remain suppressed; identity is still proven downstream
 * inside the fetched body.
 */

import { textContainsExactDocket, type DocketRef } from "../stages/docketDetection.ts";
import { isGuessedCourtUrl } from "./judgmentUrlEligibility.ts";

export interface DiscoveredJudgmentUrl {
  url: string;
  title?: string | null;
  discovery_source: string;
}

/**
 * canonical_registry_discovery_and_representative_source_use_v1: URLs produced
 * by targeted canonical-registry discovery were already screened for this exact
 * docket (guessed URLs, listing pages and off-host results rejected there), so
 * they are accepted here even when the search result carried no title. Identity
 * is still proven inside the fetched body downstream.
 */
const TARGETED_DISCOVERY_SOURCES = new Set(["canonical_registry_discovery"]);

export function collectDiscoveryUrlsFor(
  discovered: DiscoveredJudgmentUrl[],
  poolUrls: Array<{ url: string; title: string }>,
  docket: DocketRef,
  max = 2,
): string[] {
  const out: string[] = [];
  const push = (url: string | null | undefined, hay: string, targeted = false) => {
    const u = String(url ?? "").trim();
    if (!u || out.includes(u)) return;
    if (isGuessedCourtUrl(u)) return;
    if (!targeted && !textContainsExactDocket(hay, docket) && !textContainsExactDocket(u, docket)) {
      return;
    }
    out.push(u);
  };
  for (const d of discovered) {
    push(
      d.url,
      `${d.title ?? ""}\n${d.url}`,
      // canonical_body_acquisition_and_csm_survival_v1 — the targeted bypass is
      // removed: the discovered-URL list is shared across authorities, so an
      // untagged URL leaked one authority's judgment into another's probe.
      false && TARGETED_DISCOVERY_SOURCES.has(String(d.discovery_source ?? "")),
    );
    if (out.length >= max) return out;
  }
  for (const c of poolUrls) {
    push(c.url, `${c.title}\n${c.url}`);
    if (out.length >= max) return out;
  }
  return out;
}

