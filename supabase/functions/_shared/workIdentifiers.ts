/** Explicit work identifiers are anchors, never a work title or a source kind. */
export interface WorkIdentifiers {
  text: string;
  doi?: string;
  sourceUrl?: string;
  conflicts: string[];
}

function trimToken(value: string): string {
  let token = value.replace(/[.,;]+$/, "");
  // Keep balanced parentheses that are part of a DOI; remove citation wrappers.
  while (token.endsWith(")") && (token.match(/\)/g)?.length ?? 0) > (token.match(/\(/g)?.length ?? 0)) token = token.slice(0, -1);
  return token;
}

export function normalizeDoi(value: string): string | undefined {
  let token = value.trim().replace(/^doi\s*:?\s*/i, "");
  if (/^https?:\/\//i.test(token)) {
    try {
      const url = new URL(token);
      if (url.username || url.password || url.port || !/^(?:dx\.)?doi\.org$/i.test(url.hostname)) return undefined;
      token = decodeURIComponent(url.pathname.slice(1));
    } catch { return undefined; }
  }
  // Metadata and source comparisons preserve the entire identifier suffix.
  // Citation punctuation is handled only while extracting the user's input.
  return /^10\.\d{4,9}\/[^\s<>"?#]+$/i.test(token) ? token.toLowerCase() : undefined;
}

export function normalizeWorkUrl(value: string): string | undefined {
  try {
    // Path punctuation and query values can identify different works. Only
    // URL's standard canonicalization is safe here; never trim/drop them.
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return undefined;
    // A fragment is a location inside the same page, not a different work.
    url.hash = "";
    return url.href;
  } catch { return undefined; }
}

export function extractWorkIdentifiers(raw: string): WorkIdentifiers {
  const dois = new Set<string>(), urls = new Set<string>();
  let unsupportedUrl = false;
  let text = raw.replace(/(?:\(\s*)?(?:\b(?:doi|url)\s*:?\s*)?(https?:\/\/[^\s<>"“”]+)/gi, (whole, token: string) => {
    // An explicit outer citation wrapper is distinguishable from punctuation
    // inside a query value. Remove only that known wrapper.
    if (whole.startsWith("(") && /\)[.,;]*$/.test(token)
      && (token.match(/\)/g)?.length ?? 0) > (token.match(/\(/g)?.length ?? 0)) token = token.replace(/\)[.,;]*$/, "");
    const url = normalizeWorkUrl(token);
    if (!url) { unsupportedUrl = true; return " "; }
    const doi = normalizeDoi(url);
    if (doi) dois.add(doi);
    else urls.add(url);
    return " ";
  });
  text = text.replace(/(?<![\p{L}\p{N}/=?#])(?:\(\s*)?(?:\bdoi\s*:?\s*)?(10\.\d{4,9}\/[^\s<>"“”?#]+)/giu, (whole, token: string) => {
    // A naked DOI in citation prose can end with sentence/list punctuation.
    // This cleanup is intentionally not used for authoritative metadata/URLs.
    const doi = normalizeDoi(trimToken(token));
    if (!doi) return whole;
    dois.add(doi);
    return " ";
  });
  text = text.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/^[\s,;]+|[\s,;]+$/g, "").trim();
  return {
    text, ...(dois.size ? { doi: [...dois][0] } : {}), ...(urls.size ? { sourceUrl: [...urls][0] } : {}),
    conflicts: [...(dois.size > 1 ? ["multiple_doi_anchors"] : []), ...(urls.size > 1 ? ["multiple_url_anchors"] : []),
      ...(unsupportedUrl ? ["unsupported_url_anchor"] : [])],
  };
}
