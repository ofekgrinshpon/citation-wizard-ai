/**
 * Deterministic source-integrity / authority-tier classification.
 *
 * Runs at candidate-admission time (before the verifier) and is re-derived for
 * drafter input sources. Pure host/path/shape heuristics — no doctrine names,
 * no landmark-case lists, no synonym dictionaries, no LLM call.
 *
 * Purpose: when the planner asks for a source *type* (binding judgment,
 * official statute text), admission must be able to tell apart:
 *   - actual judgment text
 *   - judgment index / pagination / court-spokesperson listing
 *   - official statute text
 *   - a consolidated statute mirror (e.g. Wikisource) — still citable statute
 *   - scholarship
 *   - blog / commentary
 *   - search page / placeholder / malformed URL
 */

export const AUTHORITY_TIERS = [
  "official_primary",
  "statute_mirror",
  "primary_mirror",
  "index_or_listing",
  "secondary_commentary",
  "non_authority",
  "unknown",
] as const;
export type AuthorityTier = typeof AUTHORITY_TIERS[number];

export const TEXT_USABILITIES = [
  "full_text",
  "substantive_excerpt",
  "metadata_only",
  "listing_page",
  "unknown",
] as const;
export type TextUsability = typeof TEXT_USABILITIES[number];

export const CITABLE_AS = [
  "judgment",
  "statute",
  "scholarship",
  "commentary",
  "not_citable",
  "unknown",
] as const;
export type CitableAs = typeof CITABLE_AS[number];

export interface SourceIntegrity {
  authority_tier: AuthorityTier;
  text_usability: TextUsability;
  citable_as: CitableAs;
  integrity_flags: string[];
  /** Hard reject before the verifier (placeholder / malformed / search page). */
  reject: boolean;
  reject_reason?: string;
  /** Set when the incoming source_type over-claims authority. */
  downgrade_reason?: string;
  /** Deterministic judgment-document detection (PDF/DOCX/judgment page). */
  is_judgment_document?: boolean;
  /** Snippet carries operative judgment/holding language. */
  has_holding_text?: boolean;
}

export interface IntegrityInput {
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  source_type?: string | null;
  role?: string | null;
}

const CASE_TYPES = new Set(["caselaw", "supreme_court_il", "case", "court_case", "judgment"]);
const STATUTE_TYPES = new Set([
  "israeli_law",
  "statute",
  "regulation",
  "legislation",
  "official_primary",
]);
const SCHOLARSHIP_TYPES = new Set([
  "journal_article",
  "article",
  "scholarship",
  "book",
  "thesis",
]);
const COMMENTARY_TYPES = new Set(["blog", "news", "commentary", "web", "other"]);

// Official Israeli primary-law / judgment hosts.
const OFFICIAL_HOSTS = [
  "knesset.gov.il",
  "main.knesset.gov.il",
  "fs.knesset.gov.il",
  "reshumot.gov.il",
  "justice.gov.il",
  "court.gov.il",
  "supreme.court.gov.il",
  "elyon1.court.gov.il",
  "elyon2.court.gov.il",
  "nevo.co.il",
  "takdin.co.il",
];

const STATUTE_MIRROR_HOSTS = ["wikisource.org", "he.wikisource.org", "wikitext.org"];

const COMMENTARY_HOSTS = [
  "wikipedia.org",
  "medium.com",
  "blogspot.com",
  "wordpress.com",
  "facebook.com",
  "linkedin.com",
  "ynet.co.il",
  "walla.co.il",
  "calcalist.co.il",
  "globes.co.il",
  "haaretz.co.il",
  "themarker.com",
];

const SEARCH_HOSTS = ["google.com", "google.co.il", "bing.com", "duckduckgo.com", "yandex.com"];

const PLACEHOLDER_PATTERNS = [
  /\/stable\/sample\b/i,
  /\bexample\.(com|org|net)\b/i,
  /\b(sample|placeholder|dummy|lorem|test123|xxxx)\b/i,
  // SSRN / repository abstract ids that are zero or an obvious dummy sequence.
  /[?&/]abstract(_?id)?=?0+\b/i,
  /[?&/]abstract(_?id)?=?(123456789|1234567890?|987654321)\b/i,
  /\/abstract=?(0|123456789)\b/i,
  // Generic all-zero numeric identifier in any id-like query param.
  /[?&](abstract_?id|paper_?id|doc_?id|docid|id|itemid|lawitemid|caseid)=0+(&|$)/i,
  // All-zero numeric path segment (e.g. /papers/0000000).
  /\/0+(\/|$)/,
];

/** Academic / repository hosts where a real paper identifier is mandatory. */
const ACADEMIC_ID_HOSTS = ["ssrn.com", "papers.ssrn.com", "jstor.org", "researchgate.net", "academia.edu"];

/** True when an academic host URL carries no plausible non-zero paper identifier. */
function lacksRealAcademicId(u: URL): boolean {
  const host = hostOf(u);
  if (!hostMatches(host, ACADEMIC_ID_HOSTS)) return false;
  const hay = `${u.pathname}${u.search}`;
  const nums = hay.match(/\d+/g) ?? [];
  const meaningful = nums.filter((n) => Number(n) > 0 && n.length >= 4);
  if (meaningful.length > 0) return false;
  // DOI-style or slug identifiers are acceptable too.
  if (/10\.\d{4,}\//.test(hay)) return false;
  return true;
}


function hostOf(u: URL): string {
  return u.hostname.replace(/^www\./i, "").toLowerCase();
}

function hostMatches(host: string, list: string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

function isPaginationOrListing(u: URL): boolean {
  const path = u.pathname.toLowerCase();
  const search = u.search.toLowerCase();
  if (/[?&](skip|offset|page|pagenumber|start)=\d+/.test(search)) return true;
  if (/dynamiccollectors/.test(path)) return true;
  if (/spokmanship|spokesmanship/.test(path)) return true;
  if (/padiarchive\.aspx/.test(path)) return true;
  if (/\/(search|results|browse|catalog|archive|index|list|tags?|category)(\/|$)/.test(path)) {
    return true;
  }
  if (/[?&](q|query|search|keyword|freetext)=/.test(search)) return true;
  return false;
}

function isSpecificDocument(u: URL): boolean {
  const path = u.pathname.toLowerCase();
  if (/\.(pdf|doc|docx|rtf|txt)$/.test(path)) return true;
  if (/\/\d{4,}(\/|$|\.)/.test(path)) return true;
  if (/[?&](lawitemid|docid|caseid|item|itemid|id|file|path|msgid)=\w+/i.test(u.search)) {
    // A raw archive id on a listing page is still a listing page — the caller
    // checks isPaginationOrListing first.
    return true;
  }
  return false;
}

function meaningfulChars(s: string | null | undefined): number {
  return (s ?? "").replace(/\s+/g, "").length;
}

function classifyUsability(
  tier: AuthorityTier,
  snippet: string | null | undefined,
  url: URL | null,
): TextUsability {
  if (tier === "index_or_listing") return "listing_page";
  const n = meaningfulChars(snippet);
  const bigDoc = !!url && /\.(pdf|docx?)$/i.test(url.pathname);
  if (n >= 700 || (bigDoc && n >= 300)) return "full_text";
  if (n >= 180) return "substantive_excerpt";
  if (n > 0) return "metadata_only";
  return "unknown";
}

/**
 * Classify a candidate/source for authority tier, text usability and what it
 * can legitimately be cited as.
 */
export function classifySourceIntegrity(input: IntegrityInput): SourceIntegrity {
  const flags: string[] = [];
  const rawUrl = (input.url ?? "").trim();
  const sourceType = String(input.source_type ?? "").toLowerCase();
  const title = String(input.title ?? "");
  const snippet = input.snippet ?? "";

  let u: URL | null = null;
  if (rawUrl) {
    try {
      u = new URL(rawUrl);
      if (!/^https?:$/.test(u.protocol)) u = null;
    } catch {
      u = null;
    }
  }

  // ── Hard rejects: malformed / placeholder / search-result URLs ────────────
  if (rawUrl && !u) {
    return {
      authority_tier: "non_authority",
      text_usability: "unknown",
      citable_as: "not_citable",
      integrity_flags: ["malformed_url"],
      reject: true,
      reject_reason: "malformed_url",
    };
  }
  if (u) {
    const host = hostOf(u);
    if (hostMatches(host, SEARCH_HOSTS)) {
      return {
        authority_tier: "non_authority",
        text_usability: "listing_page",
        citable_as: "not_citable",
        integrity_flags: ["search_engine_result"],
        reject: true,
        reject_reason: "search_engine_result",
      };
    }
    const full = u.href;
    if (PLACEHOLDER_PATTERNS.some((re) => re.test(full))) {
      return {
        authority_tier: "non_authority",
        text_usability: "unknown",
        citable_as: "not_citable",
        integrity_flags: ["placeholder_url"],
        reject: true,
        reject_reason: "placeholder_url",
      };
    }
    if (lacksRealAcademicId(u)) {
      return {
        authority_tier: "non_authority",
        text_usability: "unknown",
        citable_as: "not_citable",
        integrity_flags: ["placeholder_url", "academic_url_without_identifier"],
        reject: true,
        reject_reason: "academic_url_without_identifier",
      };
    }
  }


  // ── Tier ──────────────────────────────────────────────────────────────────
  let tier: AuthorityTier = "unknown";
  const host = u ? hostOf(u) : "";
  const listing = u ? isPaginationOrListing(u) : false;

  if (u && listing) {
    tier = "index_or_listing";
    flags.push("listing_or_pagination_page");
  } else if (host && hostMatches(host, STATUTE_MIRROR_HOSTS)) {
    tier = "statute_mirror";
    flags.push("consolidated_statute_mirror");
  } else if (host && hostMatches(host, OFFICIAL_HOSTS)) {
    const specific = !!u && isSpecificDocument(u);
    // A bare host / section root (e.g. https://www.nevo.co.il/) is a portal
    // entry point, not a document — treat it as an index page.
    const bareHost = !!u && (u.pathname === "/" || u.pathname === "");
    tier = specific ? "official_primary" : bareHost ? "index_or_listing" : "primary_mirror";
    if (tier === "primary_mirror") flags.push("official_host_non_specific_path");
    if (tier === "index_or_listing") flags.push("official_host_bare_root");

  } else if (host && hostMatches(host, COMMENTARY_HOSTS)) {
    tier = "secondary_commentary";
  } else if (SCHOLARSHIP_TYPES.has(sourceType)) {
    tier = "secondary_commentary";
  } else if (host) {
    tier = "secondary_commentary";
  }

  // Even on a non-listing path, a title that is obviously an index/list page.
  if (tier !== "index_or_listing" && /^(רשימת|ארכיון|תוצאות חיפוש|חיפוש)\b/.test(title.trim())) {
    tier = "index_or_listing";
    flags.push("listing_title");
  }

  const usability = classifyUsability(tier, snippet, u);

  // ── citable_as ────────────────────────────────────────────────────────────
  let citable: CitableAs = "unknown";
  if ((tier as AuthorityTier) === "index_or_listing" || (tier as AuthorityTier) === "non_authority") {
    citable = "not_citable";
  } else if (tier === "statute_mirror") {
    citable = "statute";
  } else if (CASE_TYPES.has(sourceType)) {
    citable = tier === "secondary_commentary" ? "commentary" : "judgment";
  } else if (STATUTE_TYPES.has(sourceType)) {
    citable = tier === "secondary_commentary" ? "commentary" : "statute";
  } else if (SCHOLARSHIP_TYPES.has(sourceType)) {
    citable = "scholarship";
  } else if (COMMENTARY_TYPES.has(sourceType)) {
    citable = tier === "official_primary" || tier === "primary_mirror" ? "unknown" : "commentary";
  }

  // ── downgrade reason (source_type over-claims authority) ─────────────────
  let downgrade_reason: string | undefined;
  if (CASE_TYPES.has(sourceType) && citable !== "judgment") {
    downgrade_reason =
      tier === "index_or_listing"
        ? "caselaw_type_on_listing_page"
        : "caselaw_type_without_judgment_authority";
  } else if (STATUTE_TYPES.has(sourceType) && citable !== "statute") {
    downgrade_reason =
      tier === "index_or_listing"
        ? "statute_type_on_listing_page"
        : "statute_type_without_official_text";
  }

  return {
    authority_tier: tier,
    text_usability: usability,
    citable_as: citable,
    integrity_flags: flags,
    reject: false,
    downgrade_reason,
  };
}

/**
 * Whether a classified source can satisfy the role the planner asked for.
 * Conservative: listing/placeholder pages never satisfy an authority role.
 */
export function canSatisfyRole(integrity: SourceIntegrity, role: string | null | undefined): boolean {
  const r = String(role ?? "");
  if (integrity.citable_as === "not_citable") return false;
  if (r === "binding_case_law" || r === "persuasive_case_law") {
    return (
      integrity.citable_as === "judgment" &&
      (integrity.text_usability === "full_text" ||
        integrity.text_usability === "substantive_excerpt")
    );
  }
  if (r === "primary_statute" || r === "regulation") {
    return integrity.citable_as === "statute";
  }
  if (r === "scholarship") {
    return integrity.citable_as === "scholarship" || integrity.citable_as === "commentary";
  }
  return true;
}

/** Ranking helper: higher is a stronger lead source. */
export function tierRank(tier: AuthorityTier): number {
  switch (tier) {
    case "official_primary":
      return 5;
    case "primary_mirror":
      return 4;
    case "statute_mirror":
      return 3;
    case "secondary_commentary":
      return 2;
    case "unknown":
      return 1;
    default:
      return 0; // index_or_listing / non_authority
  }
}
