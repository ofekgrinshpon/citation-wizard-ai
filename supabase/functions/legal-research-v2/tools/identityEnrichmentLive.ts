/**
 * legal-research-v2 — live backends for same-work IDENTITY enrichment.
 *
 * Every response here is used for ONE purpose: deciding whether a candidate is
 * another copy of the same work. Nothing fetched here is extracted, stored in
 * the EvidenceStore, quoted, verified or cited. Metadata services are never
 * scholarship.
 */

import { publicHeaders } from "../vendor/officialFetch.ts";
import { isSafeFetchUrl } from "../shared/urlSafety.ts";
import { ENRICHMENT_LIMITS, type EnrichmentDeps, normalizeDoi } from "./identityEnrichment.ts";

async function getText(url: string, headers: Record<string, string>): Promise<string | undefined> {
  if (!isSafeFetchUrl(url)) return undefined;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ENRICHMENT_LIMITS.TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: ctrl.signal });
    if (!res.ok) return undefined;
    const body = await res.text();
    return body.slice(0, ENRICHMENT_LIMITS.MAX_HTML_BYTES);
  } catch {
    return undefined;
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url: string): Promise<Record<string, unknown> | undefined> {
  const text = await getText(url, {
    Accept: "application/json",
    "User-Agent": "ReLex/1.0 (identity-metadata; mailto:support@relexlm.com)",
  });
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Bounded, public, identity-only metadata backends. */
export function liveEnrichmentDeps(): EnrichmentDeps {
  const seenDoi = new Set<string>();
  const seenTitle = new Set<string>();
  const seenPage = new Set<string>();

  return {
    async fetchHtml(url) {
      const key = url.toLowerCase();
      if (seenPage.has(key)) return undefined;
      seenPage.add(key);
      const html = await getText(url, publicHeaders(url, { Accept: "text/html,*/*" }));
      return html && /<meta\b/i.test(html) ? html : undefined;
    },

    async fetchDoiMetadata(doi) {
      const clean = normalizeDoi(doi);
      if (!clean || seenDoi.has(clean)) return undefined;
      seenDoi.add(clean);
      const rec = await getJson(`https://api.crossref.org/works/${encodeURIComponent(clean)}`);
      const msg = (rec as { message?: Record<string, unknown> } | undefined)?.message;
      return msg ?? undefined;
    },

    async fetchTitleMetadata(title, hint) {
      const key = title.toLowerCase().slice(0, 120);
      if (seenTitle.has(key)) return undefined;
      seenTitle.add(key);
      const q = new URLSearchParams({
        "query.bibliographic": [title, hint.author ?? "", hint.year ?? ""].filter(Boolean).join(" "),
        rows: "1",
        select: "DOI,title,author,container-title,issued",
      });
      const rec = await getJson(`https://api.crossref.org/works?${q.toString()}`);
      const items = (rec as { message?: { items?: Record<string, unknown>[] } } | undefined)
        ?.message?.items;
      const first = Array.isArray(items) ? items[0] : undefined;
      return first ? { service: "crossref", record: first } : undefined;
    },
  };
}
