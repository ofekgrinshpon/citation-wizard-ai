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
  /** source_label_quality_v1 — classification before the label-quality pass. */
  classification_before?: CitableAs;
  /** source_label_quality_v1 — why the classification was changed. */
  classification_reason?: string;
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
  // Government portal: specific decision/statute files are official primary;
  // dynamiccollectors / pagination pages are caught earlier as listings.
  "gov.il",
];

/** Mirrors that republish full judgment text (not official, still primary text). */
const JUDGMENT_MIRROR_HOSTS = ["psakdin.co.il", "din.co.il", "pador.co.il", "lawdata.co.il"];

/** Docket pattern (Israeli court case numbers). */
const DOCKET_RE =
  /(בג["״']?ץ|בגץ|עע["״']?ם|ע["״']?א|רע["״']?א|ע["״']?פ|רע["״']?פ|בש["״']?פ|בש["״']?א|ע["״']?מ|עה["״']?ס|תמ["״']?ש|ת["״']?א|ה["״']?פ|עב["״']?ל|ע["״']?ע|דנ["״']?א|דנג["״']?ץ)\s*\d{1,5}\s*\/\s*\d{2,4}/;

/** Court / judgment vocabulary that marks an actual decision document. */
const JUDGMENT_PHRASE_RE =
  /(פסק[\s-]?דין|פסק[\s-]?הדין|פסה["״']?ד|בית\s+המשפט\s+העליון|בבית\s+המשפט|בית\s+הדין\s+ה|כב['״]?\s*השופט|בפני\s+כב|השופט[ת]?\s+\S|החלטה\s+בבקשה|בשבתו\s+כבית)/;

/** URL shapes that point at a decision file / decision viewer. */
const JUDGMENT_URL_RE =
  /(supremedecisions|\/verdict|\/verdicts|\/judg?ments?|\/pskdin|\/psakdin|\/decisions?\/|piskei|hachlatot)/i;

/** Operative holding language inside the snippet. */
const HOLDING_TEXT_RE =
  /(אנו\s+פוסקים|הערעור\s+(מתקבל|נדחה)|העתירה\s+(מתקבלת|נדחית)|ניתן\s+היום|אשר\s+על\s+כן|לפיכך\s|נפסק\s+כי|קובע[ת]?\s+כי|הלכה\s+ש|בדעת\s+(רוב|מיעוט)|דעת\s+הרוב)/;

function detectJudgmentDocument(
  u: URL | null,
  title: string,
  snippet: string,
  sourceType: string,
  listing: boolean,
): { is_judgment: boolean; has_holding_text: boolean; official_host: boolean } {
  const has_holding_text = HOLDING_TEXT_RE.test(snippet) || HOLDING_TEXT_RE.test(title);
  if (listing) return { is_judgment: false, has_holding_text, official_host: false };

  const host = u ? hostOf(u) : "";
  const official_host = !!host && hostMatches(host, OFFICIAL_HOSTS);
  const mirror_host = !!host && hostMatches(host, JUDGMENT_MIRROR_HOSTS);
  let hay = `${title} ${snippet}`;
  let urlPath = "";
  if (u) {
    try {
      urlPath = decodeURIComponent(`${u.pathname}${u.search}`);
    } catch {
      urlPath = `${u.pathname}${u.search}`;
    }
    hay += ` ${urlPath}`;
  }

  const hostJudgment =
    /supremedecisions\.court\.gov\.il|elyon[12]\.court\.gov\.il/.test(host) ||
    (!!u && JUDGMENT_URL_RE.test(urlPath));
  const hasDocket = DOCKET_RE.test(hay);
  const hasPhrase = JUDGMENT_PHRASE_RE.test(`${title} ${snippet}`);
  const fileDoc = !!u && /\.(pdf|docx?|rtf)$/i.test(u.pathname);
  const caseType = CASE_TYPES.has(sourceType);

  // source_label_quality_v1 — judgment shape must be identity-bearing.
  // Courtroom vocabulary alone ("פסק דין", "בית המשפט העליון") never suffices.
  const hasParties = /\sנ['׳"״]?\s|\sנגד\s/.test(`${title} ${snippet}`);
  const casePrefix = CASE_PREFIX_RE.test(`${title} ${snippet}`);
  const identityParams = JUDGMENT_IDENTITY_PARAM_RE.test(urlPath);
  const strongJudgmentIdentity = hasDocket ||
    (casePrefix && hasParties) ||
    (hostJudgment && identityParams);

  const is_judgment = strongJudgmentIdentity &&
    (hostJudgment || official_host || mirror_host || fileDoc || caseType || hasPhrase);

  return { is_judgment, has_holding_text, official_host };
}

/** Recognized Israeli case prefixes (without a docket number). */
const CASE_PREFIX_RE =
  /(^|\s)(בג["״׳']?ץ|בגץ|דנג["״׳']?ץ|דנ["״׳']?א|ע["״׳']?א|רע["״׳']?א|ע["״׳']?פ|רע["״׳']?פ|בש["״׳']?פ|עע["״׳']?ם|עה["״׳']?ס|תמ["״׳']?ש|ע["״׳']?מ)(\s|$)/;

/** Official judgment endpoints carrying an identity-bearing parameter. */
const JUDGMENT_IDENTITY_PARAM_RE =
  /[?&](case|caseid|casenum|casenumber|filenumber|fileno|verdictid|docid|decisionid|id)=[\w%.\-]{3,}/i;


const STATUTE_MIRROR_HOSTS = ["wikisource.org", "he.wikisource.org", "wikitext.org"];

// ── source_label_quality_v1 — statute / scholarship title shapes ───────────
/** A real statute title starts with a statutory noun. */
const STATUTE_TITLE_SHAPE_RE =
  /(^|["״׳'(\s])(חוק[- ]יסוד|חוק|פקודת|פקודה|תקנות|צו|כללי|תקנון|הצעת\s+חוק)\s/;

/** URL shapes of official law texts / statute databases. */
const STATUTE_URL_SHAPE_RE =
  /(lawitemid|lawsuggestionssearch|\/laws?\/|\/chok|\/legislation\/|reshumot|\/takanot|wikisource)/i;

/** Indicators that the body really is official statutory text. */
const OFFICIAL_STATUTE_TEXT_RE = /(נוסח\s+מלא|ספר\s+החוקים|רשומות|תיקון\s+מס|סעיף\s+\d)/;

/** Scholarship / research-paper shape (author, research centre, paper files). */
const SCHOLARSHIP_SHAPE_RE =
  /(מרכז\s+המחקר\s+והמידע|ממ["״]מ|מסמך\s+רקע|נייר\s+עמדה|סקירה\s+משווה|מחקר\s+השוואתי|כתב\s+עת|עיוני\s+משפט|משפט\s+וממשל|הפרקליט|מאמר|רשימה\s+אקדמית|working\s+paper|abstract)/i;


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

  // ── Judgment typing (deterministic) ───────────────────────────────────────
  // A real decision file/page is a judgment regardless of how the upstream
  // source_type labelled it (gov.il PDFs/DOCX were previously demoted to
  // commentary). Listing/pagination pages never reach here.
  const judg = detectJudgmentDocument(u, title, snippet, sourceType, tier === "index_or_listing");
  if (judg.is_judgment) {
    flags.push("judgment_document");
    if (judg.has_holding_text) flags.push("holding_text_present");
    if (tier === "secondary_commentary" || tier === "unknown") {
      tier = judg.official_host ? "official_primary" : "primary_mirror";
      flags.push("judgment_tier_promoted");
    }
  }

  let usability = classifyUsability(tier, snippet, u);
  if (judg.is_judgment && judg.has_holding_text && usability === "metadata_only") {
    usability = "substantive_excerpt";
  }

  // ── citable_as ────────────────────────────────────────────────────────────
  let citable: CitableAs = "unknown";
  if ((tier as AuthorityTier) === "index_or_listing" || (tier as AuthorityTier) === "non_authority") {
    citable = "not_citable";
  } else if (judg.is_judgment) {
    citable = "judgment";
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

  // ── source_label_quality_v1 — title shape overrides host ─────────────────
  // A gov.il / official host alone can never make a document a statute, and a
  // case-typed source without judgment identity can never be a judgment.
  const classification_before = citable;
  let classification_reason: string | undefined;
  const hay = `${title} ${snippet}`;
  const statuteShape = STATUTE_TITLE_SHAPE_RE.test(title) ||
    (!!u && STATUTE_URL_SHAPE_RE.test(u.href)) ||
    (STATUTE_TITLE_SHAPE_RE.test(hay) && OFFICIAL_STATUTE_TEXT_RE.test(hay));
  const scholarshipShape = SCHOLARSHIP_SHAPE_RE.test(hay) ||
    /\.(pdf|docx?)$/i.test(title.trim()) ||
    /(^|\/)(research|pubs?|publications?|papers?|lst|articles?)(\/|_)/i.test(u?.pathname ?? "");

  if (citable === "statute" && tier !== "statute_mirror" && !statuteShape) {
    citable = scholarshipShape ? "scholarship" : "commentary";
    classification_reason = "statute_requires_title_shape_not_host";
    flags.push("statute_label_rejected_host_only");
  } else if (citable === "judgment" && !judg.is_judgment) {
    citable = scholarshipShape ? "scholarship" : "commentary";
    classification_reason = "judgment_requires_docket_or_case_identity";
    flags.push("judgment_label_rejected_no_identity");
  } else if (
    (citable === "statute" || citable === "unknown") &&
    scholarshipShape && !statuteShape && !judg.is_judgment
  ) {
    citable = "scholarship";
    classification_reason = "scholarship_shape_overrides_official_host";
    flags.push("scholarship_shape_detected");
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
    is_judgment_document: judg.is_judgment,
    has_holding_text: judg.has_holding_text,
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
