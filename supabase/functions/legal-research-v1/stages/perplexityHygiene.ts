// Perplexity source-hygiene gate (Phase 1).
// Pure deterministic evaluator that runs immediately after PPLX classification
// and *before* candidate-pool admission. Annotates every row with
// `metadata.pplx_hygiene` and decides whether to keep/downgrade/exclude.
//
// All checks are local (no network). Designed to evict Perplexity rows that
// have fabricated/empty bodies, broken URLs, generic landing-page paths, or
// generic/placeholder titles before they pollute the candidate pool.

export type PplxUrlStatus = "valid" | "fixed" | "broken" | "suspicious";
export type PplxBodyStatus = "has_body" | "thin_body" | "empty_body";
export type PplxTitleStatus = "valid" | "too_short" | "generic" | "suspicious";
export type PplxLandingStatus = "specific_document" | "generic_index" | "unknown";
export type PplxHygieneAction = "keep" | "downgrade" | "exclude";

export interface PplxHygiene {
  url_status: PplxUrlStatus;
  url_original: string;
  url_normalized: string | null;
  body_status: PplxBodyStatus;
  body_meaningful_chars: number;
  title_status: PplxTitleStatus;
  title_meaningful_chars: number;
  landing_page_status: PplxLandingStatus;
  hygiene_action: PplxHygieneAction;
  hygiene_reasons: string[];
}

export interface PplxHygieneInput {
  url: string;
  title: string;
  snippet?: string | null;
}

// --- URL helpers -----------------------------------------------------------

// Fix obvious typo: hhttp(s):// → http(s)://
function normalizeUrl(raw: string): { url: string; fixed: boolean } {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { url: "", fixed: false };
  const m = trimmed.match(/^h(https?:\/\/.*)/i);
  if (m) return { url: m[1], fixed: true };
  return { url: trimmed, fixed: false };
}

// Heuristic: detect URLs whose path contains stretches of doubled / clearly
// corrupted percent-encoding (e.g. the same %D7 segment repeated three+ times
// adjacently, or alternating %D7%XX%D7%XX runs that exceed sane Hebrew word
// lengths). Conservative — we mark suspicious, never auto-rewrite.
function urlLooksSuspicious(u: URL): boolean {
  const path = u.pathname + u.search;
  // 5+ consecutive %D[0-9A-F]%[0-9A-F]{2} pairs is normal Hebrew; only flag
  // when we see implausible run lengths (>40 such pairs) or obvious dupes
  // like %D7%A4%D7%A7%D7%95%D7%93%D7%A9%D7%AA%20%D7%9E%D7%A1%20%D7%94%D7%9B%D7%A0%D7%A1%D7%94 with
  // repeated letter substitutions (e.g. %A9 where %A1 expected, evidenced by
  // mixing legal-word stems back to back).
  const pairs = path.match(/%D[0-7]%[0-9A-F]{2}/gi) || [];
  if (pairs.length > 60) return true;
  // Repeated identical 4-pair sequences (>=2 occurrences) → suspicious.
  for (let i = 0; i + 8 <= path.length; i += 1) {
    const slice = path.slice(i, i + 24); // 4 pairs = 24 chars
    if (!/^(%D[0-7]%[0-9A-F]{2}){4}$/i.test(slice)) continue;
    const rest = path.slice(i + 24);
    if (rest.includes(slice)) return true;
  }
  return false;
}

// --- Body helpers ----------------------------------------------------------

function countMeaningfulChars(s: string | null | undefined): number {
  if (!s) return 0;
  return s.replace(/\s+/g, "").length;
}

// --- Title helpers ---------------------------------------------------------

// URL-slug-shaped titles: lowercase ASCII words joined by _ or - with no
// Hebrew letters and at least one underscore/hyphen. e.g. "state_audit_report_2023".
function looksLikeUrlSlug(t: string): boolean {
  const trimmed = t.trim();
  if (!trimmed) return false;
  if (/[\u0590-\u05FF]/.test(trimmed)) return false;
  return /^[a-z0-9]+([_\-][a-z0-9]+)+$/i.test(trimmed);
}

// Generic-pattern detection: exact placeholders or trivially repeated phrases.
function looksGeneric(t: string): boolean {
  const trimmed = t.trim();
  if (!trimmed) return true;
  // Repeated phrase: "X - X"
  const parts = trimmed.split(/\s+-\s+/);
  if (parts.length === 2 && parts[0].trim() === parts[1].trim() && parts[0].trim().length > 0) {
    return true;
  }
  // Plain format placeholders.
  if (/^(PDF|HTML|DOC|DOCX|XLS|XLSX|TXT)$/i.test(trimmed)) return true;
  return false;
}

// --- Landing-page detection -----------------------------------------------

// A "specific document" has any reliable identifier:
//   - file extension (.pdf, .doc, .docx, .html with id)
//   - numeric IDs in path (e.g. /laws/2000943, /n12/15072040)
//   - query strings with id-like keys (lawitemid, abstract_id, id=, item=, path=)
//   - long unique-looking slug tail with digits
function classifyLanding(u: URL): PplxLandingStatus {
  const path = u.pathname;
  const search = u.search;
  if (!path || path === "/") return "generic_index";
  if (/\.(pdf|doc|docx|rtf|txt|xlsx|xls|csv)$/i.test(path)) return "specific_document";
  if (/[?&](lawitemid|abstract_id|item|id|file|path|docid|paperid)=/i.test(search)) {
    return "specific_document";
  }
  // Numeric ID segments of length >= 4 anywhere in the path.
  if (/\/\d{4,}\b/.test(path)) return "specific_document";
  // A clear unique slug + digit tail (e.g. /pages/incident.aspx?rid=7596) — covered by search check.
  // Path with >=3 segments where the last is long AND contains digits or
  // mixed case (camelCase/PascalCase IDs). All-lowercase snake_case words
  // are explicitly NOT treated as "specific" — the user flagged this as the
  // common landing-page shape (e.g. /state_audit_reports).
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 3) {
    const last = segments[segments.length - 1];
    const hasMixedCase = /[a-z]/.test(last) && /[A-Z]/.test(last);
    if (last.length >= 12 && hasMixedCase && !/^(index|home|main|page|list)/i.test(last)) {
      return "specific_document";
    }
  }
  // Otherwise: if all segments are short ASCII/Hebrew words → likely an index page.
  if (segments.every((s) => s.length <= 32 && !/\d{4,}/.test(s))) {
    return "generic_index";
  }
  return "unknown";
}

// --- Main evaluator --------------------------------------------------------

export function evaluatePerplexityHygiene(input: PplxHygieneInput): PplxHygiene {
  const reasons: string[] = [];
  const titleRaw = (input.title || "").trim();
  const snippetChars = countMeaningfulChars(input.snippet);
  const titleChars = countMeaningfulChars(titleRaw);

  // 1. URL ------------------------------------------------------------------
  const { url: urlFixed, fixed } = normalizeUrl(input.url);
  let url_status: PplxUrlStatus = "valid";
  let url_normalized: string | null = urlFixed || null;
  if (!urlFixed) {
    url_status = "broken";
    reasons.push("url_empty");
  } else {
    try {
      const parsed = new URL(urlFixed);
      if (fixed) {
        url_status = "fixed";
        reasons.push("url_fixed_double_h");
      }
      if (urlLooksSuspicious(parsed)) {
        url_status = "suspicious";
        reasons.push("url_suspicious_encoding");
      }
      url_normalized = parsed.toString();
    } catch {
      url_status = "broken";
      reasons.push("url_unparseable");
      url_normalized = null;
    }
  }

  // 2. Body -----------------------------------------------------------------
  let body_status: PplxBodyStatus;
  if (snippetChars === 0) {
    body_status = "empty_body";
    reasons.push("body_empty");
  } else if (snippetChars < 50) {
    body_status = "thin_body";
    reasons.push("body_thin");
  } else {
    body_status = "has_body";
  }

  // 3. Landing page ---------------------------------------------------------
  let landing_page_status: PplxLandingStatus = "unknown";
  if (url_normalized && url_status !== "broken") {
    try {
      landing_page_status = classifyLanding(new URL(url_normalized));
    } catch {
      landing_page_status = "unknown";
    }
  }
  if (landing_page_status === "generic_index") reasons.push("url_generic_index");

  // 4. Title ----------------------------------------------------------------
  let title_status: PplxTitleStatus = "valid";
  if (titleChars < 4) {
    title_status = "too_short";
    reasons.push("title_too_short");
  } else if (looksLikeUrlSlug(titleRaw)) {
    title_status = "suspicious";
    reasons.push("title_url_slug");
  } else if (looksGeneric(titleRaw)) {
    title_status = "generic";
    reasons.push("title_generic");
  }

  // 5. Action matrix --------------------------------------------------------
  //
  // The user explicitly asked: do NOT exclude based on path shape alone. We
  // therefore require *multiple* signals to combine before excluding on
  // landing-page grounds.
  let hygiene_action: PplxHygieneAction = "keep";

  // Hard excludes.
  if (url_status === "broken") {
    hygiene_action = "exclude";
    reasons.push("exclude_broken_url");
  } else if (title_status === "too_short" && body_status !== "has_body") {
    hygiene_action = "exclude";
    reasons.push("exclude_short_title_no_body");
  } else if (title_status === "suspicious" && body_status === "empty_body") {
    // URL-slug title + empty body → strong "fabricated landing page" signal.
    hygiene_action = "exclude";
    reasons.push("exclude_slug_title_empty_body");
  } else if (
    body_status === "empty_body" &&
    landing_page_status === "generic_index" &&
    (title_status !== "valid" || url_status === "suspicious")
  ) {
    // Multi-signal exclude: empty body AND generic-index URL AND
    // (weak title OR suspicious URL).
    hygiene_action = "exclude";
    reasons.push("exclude_empty_body_generic_index");
  } else if (
    body_status === "thin_body" &&
    landing_page_status === "generic_index" &&
    title_status !== "valid"
  ) {
    hygiene_action = "downgrade";
    reasons.push("downgrade_thin_body_generic_index_weak_title");
  } else if (body_status === "empty_body" && landing_page_status === "generic_index") {
    // Empty body + generic-index URL alone → downgrade, not exclude.
    hygiene_action = "downgrade";
    reasons.push("downgrade_empty_body_generic_index");
  } else if (title_status === "suspicious") {
    hygiene_action = "downgrade";
    reasons.push("downgrade_suspicious_title");
  } else if (title_status === "generic" && body_status !== "has_body") {
    hygiene_action = "downgrade";
    reasons.push("downgrade_generic_title_no_body");
  } else if (url_status === "suspicious" && body_status !== "has_body") {
    hygiene_action = "downgrade";
    reasons.push("downgrade_suspicious_url_no_body");
  }

  return {
    url_status,
    url_original: input.url,
    url_normalized,
    body_status,
    body_meaningful_chars: snippetChars,
    title_status,
    title_meaningful_chars: titleChars,
    landing_page_status,
    hygiene_action,
    hygiene_reasons: reasons,
  };
}

// --- Source-type normalization --------------------------------------------

// Known canonical source_type values used downstream. We keep this very tight
// and bias to "other" whenever uncertain — the user explicitly asked us not
// to invent pseudo-types just because PPLX returned a plausible string.
const KNOWN_SOURCE_TYPES = new Set<string>([
  "statute",
  "regulation",
  "legislation",
  "case",
  "caselaw",
  "academic",
  "report",
  "government_report",
  "other",
]);

export interface SourceTypeNormalization {
  normalized: string;
  raw: string;
  was_normalized: boolean;
}

export function normalizePerplexitySourceType(
  raw: string | undefined | null,
  classifiedSourceClass: string | undefined,
): SourceTypeNormalization {
  const rawTrim = String(raw ?? "").trim();
  // If PPLX returned an empty string, fall back to class-driven mapping.
  if (!rawTrim) {
    const fromClass = mapClassToSourceType(classifiedSourceClass);
    return {
      normalized: fromClass,
      raw: "",
      was_normalized: fromClass !== "other",
    };
  }
  // Strong domain-class signals override the raw PPLX tag. When our own
  // URL/title classifier already decided the source is legislation or an
  // official court judgment, do not let a generic raw tag ("web", "pdf",
  // "document", etc.) collapse it into "other". Downstream lead_ref/statute
  // guards depend on these labels being correct (B3 §6 regression).
  if (classifiedSourceClass === "legislation") {
    return { normalized: "legislation", raw: rawTrim, was_normalized: true };
  }
  if (classifiedSourceClass === "official_primary" || classifiedSourceClass === "court_case") {
    return { normalized: "caselaw", raw: rawTrim, was_normalized: true };
  }
  const lower = rawTrim.toLowerCase();
  // Already known canonical value.
  if (KNOWN_SOURCE_TYPES.has(lower)) {
    return { normalized: lower, raw: rawTrim, was_normalized: false };
  }
  // High-confidence mappings only.
  if (/(^|[_\-])report(\b|s)/.test(lower)) {
    return { normalized: "government_report", raw: rawTrim, was_normalized: true };
  }
  if (/^(annual|state_audit|performance|periodic).*report/.test(lower)) {
    return { normalized: "government_report", raw: rawTrim, was_normalized: true };
  }
  if (/^(judgment|decision|verdict|psak|פסק)/.test(lower)) {
    return { normalized: "caselaw", raw: rawTrim, was_normalized: true };
  }
  if (/^(article|paper|book|journal|chapter)/.test(lower)) {
    return { normalized: "academic", raw: rawTrim, was_normalized: true };
  }
  if (lower === "legal_db" || lower === "legal database" || lower === "legal-database") {
    const fromClass = mapClassToSourceType(classifiedSourceClass);
    return {
      normalized: fromClass,
      raw: rawTrim,
      was_normalized: true,
    };
  }
  // Conservative fallback: do NOT create pseudo-types.
  return { normalized: "other", raw: rawTrim, was_normalized: true };
}

function mapClassToSourceType(cls: string | undefined): string {
  switch (cls) {
    case "legislation":
      return "legislation";
    case "official_primary":
    case "court_case":
      return "caselaw";
    case "academic":
    case "publisher":
      return "academic";
    case "government_report":
      return "government_report";
    default:
      return "other";
  }
}

// --- Aggregate counters ----------------------------------------------------

export interface PplxHygieneCounts {
  total: number;
  keep: number;
  downgrade: number;
  exclude: number;
  // Per-reason counts (sparse — only reasons we actually saw).
  reasons: Record<string, number>;
  report_only_mode: boolean;
  would_exclude_in_report_only: number;
}

export function emptyHygieneCounts(reportOnly: boolean): PplxHygieneCounts {
  return {
    total: 0,
    keep: 0,
    downgrade: 0,
    exclude: 0,
    reasons: {},
    report_only_mode: reportOnly,
    would_exclude_in_report_only: 0,
  };
}

export function accumulateHygieneCounts(
  counts: PplxHygieneCounts,
  h: PplxHygiene,
): void {
  counts.total += 1;
  counts[h.hygiene_action] += 1;
  for (const r of h.hygiene_reasons) {
    counts.reasons[r] = (counts.reasons[r] ?? 0) + 1;
  }
}

export function isReportOnlyMode(): boolean {
  return (Deno.env.get("PPLX_HYGIENE_REPORT_ONLY") ?? "").trim() === "1";
}
