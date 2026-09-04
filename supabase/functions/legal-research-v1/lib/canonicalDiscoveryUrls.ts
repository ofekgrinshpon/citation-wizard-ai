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

export function collectDiscoveryUrlsFor(
  discovered: DiscoveredJudgmentUrl[],
  poolUrls: Array<{ url: string; title: string }>,
  docket: DocketRef,
  max = 2,
): string[] {
  const out: string[] = [];
  const push = (url: string | null | undefined, hay: string) => {
    const u = String(url ?? "").trim();
    if (!u || out.includes(u)) return;
    if (isGuessedCourtUrl(u)) return;
    if (!textContainsExactDocket(hay, docket) && !textContainsExactDocket(u, docket)) return;
    out.push(u);
  };
  for (const d of discovered) {
    push(d.url, `${d.title ?? ""}\n${d.url}`);
    if (out.length >= max) return out;
  }
  for (const c of poolUrls) {
    push(c.url, `${c.title}\n${c.url}`);
    if (out.length >= max) return out;
  }
  return out;
}
