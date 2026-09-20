/**
 * legal-research-v2 — bounded same-work recovery
 * (source_equivalence_recovery_v1).
 *
 * One failed URL is not one failed source. When a source we already identified
 * cannot be acquired at the URL we found it at, this module builds ONE bounded
 * rediscovery query for the SAME work, and decides — deterministically —
 * whether a candidate found that way really is the same work.
 *
 * What this module is NOT:
 *   • not evidence. A matched candidate still has to be fetched, extracted,
 *     document-checked and verified exactly like any other body;
 *   • not a trust layer. No host is "good"; publicly accessible copies only;
 *   • not a paywall, login or CAPTCHA workaround. It looks for another PUBLIC
 *     copy of the same public document, nothing else.
 */

export interface WorkIdentity {
  title?: string;
  authors?: string[];
  year?: string;
  journal?: string;
  doi?: string;
}

/** Normalize for comparison: case, punctuation, Hebrew/Latin quotes, spacing. */
function norm(v: string | undefined): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/["'“”«»׳״]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(v: string | undefined): string[] {
  return norm(v).split(" ").filter((t) => t.length > 2);
}

/** Jaccard overlap of the significant title tokens. */
export function titleSimilarity(a: string | undefined, b: string | undefined): number {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function surnames(authors: string[] | undefined): Set<string> {
  const out = new Set<string>();
  for (const a of authors ?? []) {
    for (const part of norm(a).split(" ")) if (part.length > 2) out.add(part);
  }
  return out;
}

export interface EquivalenceVerdict {
  same_work: boolean;
  basis:
    | "doi_exact"
    | "title_and_author"
    | "title_and_year"
    | "title_only_insufficient"
    | "title_mismatch"
    | "insufficient_identity";
  title_similarity: number;
}

/**
 * Is `candidate` another copy of `wanted`?
 *
 * Deliberately strict: a similar-looking title alone NEVER merges two
 * documents. A DOI match is decisive; otherwise a high title overlap must be
 * confirmed by a shared author surname or a matching publication year.
 */
export function isSameWork(wanted: WorkIdentity, candidate: WorkIdentity): EquivalenceVerdict {
  const sim = titleSimilarity(wanted.title, candidate.title);
  const wd = norm(wanted.doi), cd = norm(candidate.doi);
  if (wd && cd) {
    return { same_work: wd === cd, basis: "doi_exact", title_similarity: sim };
  }
  if (!wanted.title || !candidate.title) {
    return { same_work: false, basis: "insufficient_identity", title_similarity: sim };
  }
  if (sim < 0.7) return { same_work: false, basis: "title_mismatch", title_similarity: sim };

  const wa = surnames(wanted.authors), ca = surnames(candidate.authors);
  let sharedAuthor = false;
  for (const s of wa) if (ca.has(s)) sharedAuthor = true;
  if (sharedAuthor) return { same_work: true, basis: "title_and_author", title_similarity: sim };
  if (wanted.year && candidate.year && wanted.year === candidate.year) {
    return { same_work: true, basis: "title_and_year", title_similarity: sim };
  }
  return { same_work: false, basis: "title_only_insufficient", title_similarity: sim };
}

/** Publishing venues that are never an acceptable "alternative copy". */
const FORBIDDEN_COPY_HOST_RE =
  /(sci-hub|libgen|z-lib|annas-archive|bookfi|pirate|\.onion$)/i;

export function isAcceptableAlternativeHost(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return !FORBIDDEN_COPY_HOST_RE.test(h);
  } catch {
    return false;
  }
}

/**
 * ONE bounded rediscovery query for the same work. No doctrinal broadening, no
 * synonym expansion — the query names the work, not the topic.
 */
export function buildAlternativeCopyQuery(identity: WorkIdentity): string | null {
  const title = (identity.title ?? "").trim();
  if (identity.doi) return `"${identity.doi}"`;
  if (title.length < 8) return null;
  const author = (identity.authors ?? [])[0]?.trim();
  const bits = [`"${title.slice(0, 120)}"`, author ?? "", identity.year ?? "", "pdf"]
    .filter(Boolean);
  return bits.join(" ").trim();
}
