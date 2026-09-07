// query_sensitive_document_dedupe_v1
//
// Canonical URL normalization (host+path) collapses every document served by
// one endpoint into a single dedupe key. When the query string is the document
// identity (`/maamar.asp?id=...`), genuinely different legal documents are
// then dropped as `dup_url` before any later stage can use them.
//
// This module does NOT change the canonical URL key. It is a narrow collision
// guard: when two candidates share a canonical URL key but their concrete URLs
// differ by non-tracking query parameters, it inspects existing document /
// authority identity evidence and decides whether they are the same document.
//
// Fail-closed: a query difference alone is never evidence of distinctness.
// Only positive identity disagreement preserves two records.
//
// Pure module: no network, no model calls.

import { detectJudgmentEvidence } from "./documentEvidenceClassification.ts";

/** Params that carry no document identity anywhere. */
const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "gclid", "fbclid", "msclkid", "yclid", "dclid", "twclid", "igshid",
  "ref", "referrer", "referer", "source", "src", "campaign",
  "session", "sessionid", "sid", "jsessionid", "phpsessid", "aspxauth",
  "sscid", "mc_cid", "mc_eid", "_ga", "_gl", "hsa_acc", "hsctatracking",
  "cache", "cb", "_", "t", "ts", "timestamp", "rand", "v", "ver",
  "lang", "hl", "locale", "print", "share", "from", "trk", "spm",
]);

/** Query params that typically address a specific document. */
const IDENTITY_LIKE_PARAM_RE =
  /^(id|.*_?id|.*id\d*|doc|docid|document|documentid|file|filename|fileid|item|itemid|article|articleid|maamar|no|num|number|case|caseid|verdict|verdictid|psak|skn|key|q)$/i;

export interface CollisionCandidateLike {
  candidate_id: string;
  title: string;
  source_url?: string | null;
  snippet?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CollisionIdentity {
  docket: string | null;
  authority_id: string | null;
  statute_id: string | null;
  case_id: string | null;
  title_norm: string;
  signals: string[];
}

export interface UrlCollisionRow {
  normalized_url_key: string;
  original_urls: string[];
  query_differences: string[];
  candidate_titles: string[];
  normalized_dockets: Array<string | null>;
  authority_ids: Array<string | null>;
  identity_signals: string[];
  decision: "collapse" | "preserve_distinct";
  reason: string;
  candidate_ids: string[];
}

export function normalizeDocket(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw)
    .replace(/[\u2010-\u2015]/g, "-")
    .match(/(\d{1,6})\s*[-\/]\s*(\d{2,4})/);
  if (!m) return null;
  const year = m[2].slice(-2);
  const prefixMatch = String(raw).match(
    /(בג"?״?ץ|דנג"?״?ץ|ע"?״?א|ע"?״?פ|רע"?״?א|רע"?״?פ|עע"?״?מ|עה"?״?ס|דנ"?״?א|דנ"?״?פ|בש"?״?פ|בש"?״?א|תמ"?״?ש|רמ"?״?ש|בר"?״?ם|בר"?״?ע|ת"?״?א|ת"?״?פ|HCJ|CA|CrimA|LCA|LCrimA)/i,
  );
  const prefix = prefixMatch ? prefixMatch[1].replace(/["״]/g, "").toLowerCase() : "";
  return `${prefix}:${Number(m[1])}/${year}`;
}

function normTitle(t: string): string {
  return (t || "")
    .toLowerCase()
    .replace(/["׳'`״]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickString(meta: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!meta) return null;
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** Meaningful (non-tracking) query params of a URL, sorted. */
export function meaningfulQueryParams(rawUrl: string | null | undefined): Array<[string, string]> {
  if (!rawUrl) return [];
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return [];
  }
  const out: Array<[string, string]> = [];
  for (const [name, value] of u.searchParams.entries()) {
    const n = name.toLowerCase().trim();
    if (!n || TRACKING_PARAMS.has(n)) continue;
    const v = (value ?? "").trim().toLowerCase();
    if (!v) continue;
    out.push([n, v]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

/** Names of non-tracking params whose presence/value differs between two URLs. */
export function queryDifferences(
  a: string | null | undefined,
  b: string | null | undefined,
): string[] {
  const ma = new Map(meaningfulQueryParams(a));
  const mb = new Map(meaningfulQueryParams(b));
  const names = new Set([...ma.keys(), ...mb.keys()]);
  const diff: string[] = [];
  for (const n of names) {
    if (ma.get(n) !== mb.get(n)) diff.push(n);
  }
  return diff.sort();
}

function identityLikeDiff(diff: string[]): string[] {
  return diff.filter((n) => IDENTITY_LIKE_PARAM_RE.test(n));
}

/** Deterministic document/authority identity evidence already available. */
export function collisionIdentity(c: CollisionCandidateLike): CollisionIdentity {
  const signals: string[] = [];
  const meta = c.metadata;
  let docket = normalizeDocket(c.title);
  if (docket) signals.push("docket_in_title");
  if (!docket) {
    const metaDocket = pickString(meta, ["docket", "normalized_docket", "docket_display", "case_docket"]);
    docket = normalizeDocket(metaDocket);
    if (docket) signals.push("docket_in_metadata");
  }
  if (!docket) {
    const ev = detectJudgmentEvidence({
      url: c.source_url ?? "",
      title: c.title ?? "",
      snippet: c.snippet ?? "",
    });
    if (ev) {
      docket = normalizeDocket(ev.docket);
      if (docket) signals.push(`document_evidence:${ev.signals.join("|")}`);
    }
  }
  const authority_id = pickString(meta, [
    "exact_authority_id",
    "authority_id",
    "authority_key",
    "canonical_authority_id",
    "exact_authority",
    "authority_name",
  ]);
  if (authority_id) signals.push("authority_id");
  const statute_id = pickString(meta, ["statute_id", "statute_key", "law_id", "section_key"]);
  if (statute_id) signals.push("statute_id");
  const case_id = pickString(meta, ["case_id", "court_case_id", "verdict_id"]);
  if (case_id) signals.push("case_id");
  return {
    docket,
    authority_id,
    statute_id,
    case_id,
    title_norm: normTitle(c.title),
    signals,
  };
}

/** Token-overlap based "materially different title" test. */
export function titlesMateriallyDifferent(a: string, b: string): boolean {
  const ta = new Set(a.split(" ").filter((w) => w.length > 1));
  const tb = new Set(b.split(" ").filter((w) => w.length > 1));
  if (ta.size < 3 || tb.size < 3) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  const union = ta.size + tb.size - inter;
  const jaccard = union ? inter / union : 1;
  return jaccard < 0.4;
}

export interface CollisionDecision {
  decision: "collapse" | "preserve_distinct";
  reason: string;
  query_differences: string[];
  identity_signals: string[];
  identities: [CollisionIdentity, CollisionIdentity];
}

/**
 * Decide whether two candidates sharing one canonical URL key are the same
 * document. Conservative: collapse unless identity evidence positively shows
 * two different documents.
 */
export function resolveUrlCollision(
  kept: CollisionCandidateLike,
  incoming: CollisionCandidateLike,
): CollisionDecision {
  const diff = queryDifferences(kept.source_url, incoming.source_url);
  const ia = collisionIdentity(kept);
  const ib = collisionIdentity(incoming);
  const identity_signals = [
    ...ia.signals.map((s) => `a:${s}`),
    ...ib.signals.map((s) => `b:${s}`),
  ];
  const base = { query_differences: diff, identity_signals, identities: [ia, ib] as [CollisionIdentity, CollisionIdentity] };

  if (diff.length === 0) {
    return { ...base, decision: "collapse", reason: "no_meaningful_query_difference" };
  }

  // Strong identity disagreement overrides URL-key equality.
  if (ia.docket && ib.docket && ia.docket !== ib.docket) {
    return { ...base, decision: "preserve_distinct", reason: "docket_disagreement" };
  }
  if (ia.docket && ib.docket && ia.docket === ib.docket) {
    return { ...base, decision: "collapse", reason: "same_docket_identity" };
  }
  if (ia.authority_id && ib.authority_id && ia.authority_id !== ib.authority_id) {
    return { ...base, decision: "preserve_distinct", reason: "authority_identity_disagreement" };
  }
  if (ia.case_id && ib.case_id && ia.case_id !== ib.case_id) {
    return { ...base, decision: "preserve_distinct", reason: "case_identity_disagreement" };
  }
  if (ia.statute_id && ib.statute_id && ia.statute_id !== ib.statute_id) {
    return { ...base, decision: "preserve_distinct", reason: "statute_identity_disagreement" };
  }
  if (
    (ia.authority_id && ib.authority_id && ia.authority_id === ib.authority_id) ||
    (ia.case_id && ib.case_id && ia.case_id === ib.case_id) ||
    (ia.statute_id && ib.statute_id && ia.statute_id === ib.statute_id)
  ) {
    return { ...base, decision: "collapse", reason: "same_authority_identity" };
  }

  // One side carries a docket the other plainly lacks in an otherwise
  // differently-titled document addressed by a different document id.
  const idDiff = identityLikeDiff(diff);
  if (idDiff.length > 0 && titlesMateriallyDifferent(ia.title_norm, ib.title_norm)) {
    return {
      ...base,
      decision: "preserve_distinct",
      reason: `document_id_param_and_title_divergence:${idDiff.join(",")}`,
    };
  }

  return { ...base, decision: "collapse", reason: "insufficient_identity_evidence" };
}
