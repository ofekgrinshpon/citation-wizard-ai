/**
 * legal-research-v2 — deterministic URL-shape classifier.
 *
 * One job: decide, from the SHAPE of a URL alone, whether it points at a
 * concrete document or at a search / portal entry point.
 *
 * Explicitly NOT a quality signal: no domains, no allowlists, no tiers, no
 * ranking. A "discovery_entry" is not rejected anywhere — it simply may never
 * consume a bounded per-authority acquisition attempt, because fetching a
 * search page can never produce the body of a named authority.
 */

export type CandidateUrlShape = "concrete_document" | "discovery_entry";

/** Path segments that mark a search / listing endpoint rather than a document. */
const SEARCH_PATH_SEGMENTS = new Set([
  "search",
  "searchresults",
  "search-results",
  "results",
  "find",
  "query",
  "advancedsearch",
]);

/** Query parameters that carry a free-text query rather than a document id. */
const FREE_TEXT_PARAMS = new Set([
  "q",
  "query",
  "search",
  "searchtext",
  "search_text",
  "freetext",
  "free_text",
  "keyword",
  "keywords",
  "term",
  "searchterm",
  "text",
]);

export function classifyCandidateUrlShape(rawUrl?: string | null): CandidateUrlShape {
  const raw = String(rawUrl ?? "").trim();
  if (!raw) return "discovery_entry";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "discovery_entry";
  }

  // SPA search routes live in the fragment ("#/search/...").
  const hash = u.hash.toLowerCase();
  if (/[#/](search|results|find)\b/.test(hash)) return "discovery_entry";

  const segments = u.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.length === 0 && !u.search) return "discovery_entry";
  if (segments.some((s) => SEARCH_PATH_SEGMENTS.has(s))) return "discovery_entry";

  let shape: CandidateUrlShape = "concrete_document";
  u.searchParams.forEach((value, key) => {
    const k = key.toLowerCase();
    const v = String(value ?? "").trim();
    if (!v) return;
    if (FREE_TEXT_PARAMS.has(k)) shape = "discovery_entry";
    // A real item id is an identifier. A free-text phrase in an id parameter
    // means the URL was synthesized from a name, i.e. a portal query.
    if (/(itemid|item_id|lawitemid|docid|doc_id)$/.test(k) && !/^[\w.\-]+$/.test(v)) {
      shape = "discovery_entry";
    }
  });
  return shape;
}

export function isConcreteDocumentUrl(url?: string | null): boolean {
  return classifyCandidateUrlShape(url) === "concrete_document";
}
