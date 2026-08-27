/**
 * secondary_web_body_acquisition_v1 — pure helpers for the open-web
 * secondary/doctrinal acquisition lane.
 *
 * doctrinal_secondary_body_acquisition_v1 shipped a web lane that produced 0
 * successes: it fetched the candidate URL once, and most doctrinal candidates
 * point at an abstract / landing / repository record page rather than at the
 * document itself. This module supplies the missing pieces, all deterministic
 * and side-effect free:
 *
 *   - `isAccessControlledUrl` / `looksLikePaywallOrLogin` — refuse (never
 *     circumvent) paywalls, logins, CAPTCHAs and subscription databases;
 *   - `looksLikeMetadataPage` — recognise an abstract/landing page;
 *   - `extractFullTextLinks` — pull a *small* number of clearly-labelled
 *     full-text/PDF/download links from that page (same host or an official /
 *     institutional host only — no crawling, no site search);
 *   - `assessSubstantiveBody` — decide whether extracted text is a real body
 *     rather than a TOC, navigation shell, bibliography or search listing;
 *   - `remapSecondaryType` — evidence-based mapping to a doctrinal source type
 *     with a confidence, or an explicit failure reason.
 *
 * Nothing here fetches, mutates pipeline state, or touches judgment/statute
 * identity, the court relay, or source-integrity rules.
 */

export const SECONDARY_WEB_LIMITS = {
  /** Web fetches for secondary bodies per run (initial URLs + follows). */
  MAX_WEB_FETCHES: 5,
  /** Full-text link follows per candidate. */
  MAX_FULLTEXT_FOLLOWS: 2,
  /** Minimum substantive body. */
  MIN_BODY_CHARS: 800,
  /** Preferred length for article/report material. */
  PREFERRED_BODY_CHARS: 1_500,
  /** Shorter bodies are allowed only for these types, down to this floor. */
  SHORT_FORM_FLOOR: 500,
  /** Characters of a landing page scanned for full-text links. */
  MAX_LINK_SCAN_CHARS: 200_000,
} as const;

// ── access control (refuse, never bypass) ──────────────────────────────────

const ACCESS_CONTROLLED_URL_RE =
  /(\/login|\/signin|\/sign-in|\/auth\/|subscribe|subscription|paywall|checkout|\/account|\/register|\/cart)/i;

/** Databases behind subscription walls: never attempted from this lane. */
export const PAYWALLED_HOST_RE =
  /(nevo\.co\.il|takdin|pador|lawdata|psakdin|halachipedia\.pay|westlaw|lexisnexis|proquest|sciencedirect|springer|tandfonline|wiley|elsevier|jstor\.org|heinonline)/i;

/** Court / relay hosts: judgment lane only, never the secondary lane. */
export const COURT_HOST_RE = /(court\.gov\.il|supremedecisions|elyon\d?\.court)/i;

export function isAccessControlledUrl(url: string): boolean {
  return ACCESS_CONTROLLED_URL_RE.test(url);
}

const PAYWALL_TEXT_RE = new RegExp(
  [
    "purchase (this )?(article|access|pdf)",
    "buy (this )?article",
    "get access",
    "sign in to (read|continue|view)",
    "subscribe to (read|continue)",
    "members? only",
    "institutional (login|access)",
    "please log ?in",
    "enable javascript",
    "are you a robot",
    "captcha",
    "access denied",
    "לרכישת המאמר",
    "לצפייה במאמר המלא",
    "יש להתחבר",
    "כניסה למנויים",
    "מנוי בלבד",
    "הרשמה נדרשת",
  ].join("|"),
  "i",
);

export function looksLikePaywallOrLogin(text: string): boolean {
  return PAYWALL_TEXT_RE.test(text.slice(0, 6_000));
}

// ── metadata / landing page detection ──────────────────────────────────────

const METADATA_SIGNAL_RE = new RegExp(
  [
    "abstract",
    "תקציר",
    "download( full)?( text| pdf)?",
    "להורדה",
    "הורדת הקובץ",
    "צפייה בקובץ",
    "full text",
    "טקסט מלא",
    "citation",
    "doi:",
    "repository",
  ].join("|"),
  "i",
);

/**
 * A short body on a page that advertises abstract/download/full-text controls
 * is a record page, not the document. Length alone is not enough — a genuinely
 * short institutional note must not be mistaken for a landing page.
 */
export function looksLikeMetadataPage(bodyText: string, html: string): boolean {
  if (bodyText.length >= SECONDARY_WEB_LIMITS.PREFERRED_BODY_CHARS) return false;
  return METADATA_SIGNAL_RE.test(bodyText.slice(0, 4_000)) ||
    /href="[^"]*\.(pdf|docx?)(\?[^"]*)?"/i.test(html.slice(0, SECONDARY_WEB_LIMITS.MAX_LINK_SCAN_CHARS));
}

const FULLTEXT_LABEL_RE =
  /(pdf|full[\s-]?text|download|טקסט מלא|קובץ|להורדה|הורדה|למאמר המלא|גרסה מלאה|view document)/i;

const INSTITUTIONAL_HOST_RE =
  /(\.ac\.il|\.edu|\.gov\.il|knesset\.gov\.il|idi\.org\.il|mevaker\.gov\.il|boi\.org\.il|btl\.gov\.il|oecd\.org|un\.org|repository|dspace|openscholar)/i;

function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "");
    const hb = new URL(b).hostname.replace(/^www\./, "");
    return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
  } catch {
    return false;
  }
}

export interface FullTextLink {
  url: string;
  label: string;
  reason: "file_extension" | "labelled_fulltext";
  same_host: boolean;
}

/**
 * Extract at most `MAX_FULLTEXT_FOLLOWS` clearly-linked full-text files from a
 * landing page. Only same-site links, or links on an official/institutional
 * host, are ever returned. This is deliberately not a crawler: one page, no
 * recursion, no site search.
 */
export function extractFullTextLinks(html: string, pageUrl: string): FullTextLink[] {
  const scan = html.slice(0, SECONDARY_WEB_LIMITS.MAX_LINK_SCAN_CHARS);
  const out: FullTextLink[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(scan)) !== null) {
    const rawHref = m[1].trim();
    const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!rawHref || /^(mailto:|javascript:|tel:)/i.test(rawHref)) continue;
    let abs: string;
    try {
      abs = new URL(rawHref, pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    if (isAccessControlledUrl(abs)) continue;
    if (PAYWALLED_HOST_RE.test(abs) || COURT_HOST_RE.test(abs)) continue;

    const isFile = /\.(pdf|docx?|rtf)(\?|$)/i.test(abs);
    const labelled = FULLTEXT_LABEL_RE.test(label) || FULLTEXT_LABEL_RE.test(rawHref);
    if (!isFile && !labelled) continue;

    const same = sameSite(abs, pageUrl);
    if (!same && !INSTITUTIONAL_HOST_RE.test(abs)) continue;

    seen.add(abs);
    out.push({
      url: abs,
      label: label.slice(0, 120),
      reason: isFile ? "file_extension" : "labelled_fulltext",
      same_host: same,
    });
  }
  // Real files before merely-labelled links; same host before off host.
  out.sort((a, b) => {
    const fa = a.reason === "file_extension" ? 0 : 1;
    const fb = b.reason === "file_extension" ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return (a.same_host ? 0 : 1) - (b.same_host ? 0 : 1);
  });
  return out.slice(0, SECONDARY_WEB_LIMITS.MAX_FULLTEXT_FOLLOWS);
}

// ── substantive body validation ────────────────────────────────────────────

const LISTING_RE =
  /(search results|תוצאות חיפוש|no results|לא נמצאו תוצאות|results found|page \d+ of \d+)/i;
const TOC_RE = /(תוכן ענינים|תוכן העניינים|table of contents)/i;
const NAV_ONLY_RE = /(skip to (main )?content|תפריט ראשי|עמוד הבית|כל הזכויות שמורות)/i;

/** Types where a shorter body can still be a complete document. */
const SHORT_FORM_TYPES = new Set([
  "doctrinal_commentary",
  "policy_report",
  "regulator_report",
]);

export interface SubstantiveAssessment {
  substantive: boolean;
  chars: number;
  threshold: number;
  reason: string;
}

export function assessSubstantiveBody(
  text: string,
  mappedType?: string | null,
): SubstantiveAssessment {
  const body = (text || "").trim();
  const chars = body.length;
  const short = SHORT_FORM_TYPES.has(String(mappedType ?? ""));
  const threshold = short
    ? SECONDARY_WEB_LIMITS.SHORT_FORM_FLOOR
    : SECONDARY_WEB_LIMITS.MIN_BODY_CHARS;

  const no = (reason: string): SubstantiveAssessment => ({
    substantive: false,
    chars,
    threshold,
    reason,
  });

  if (chars < threshold) return no("below_min_body_chars");
  if (looksLikePaywallOrLogin(body)) return no("paywall_or_login_page");
  if (LISTING_RE.test(body.slice(0, 3_000))) return no("search_or_listing_page");

  const head = body.slice(0, 4_000);
  // Table of contents / navigation shells: many short lines, little prose.
  const lines = head.split("\n").filter((l) => l.trim().length > 0);
  const shortLines = lines.filter((l) => l.trim().length < 60).length;
  const lineRatio = lines.length ? shortLines / lines.length : 0;
  const longestParagraph = body
    .split(/\n{1,}/)
    .reduce((max, p) => Math.max(max, p.trim().length), 0);
  if (longestParagraph < 200 && lineRatio > 0.85) {
    return no(TOC_RE.test(head) ? "table_of_contents_only" : "navigation_or_link_shell");
  }
  if (NAV_ONLY_RE.test(head) && longestParagraph < 200) return no("navigation_or_link_shell");

  // Bibliography-only: dense citation lines, no running prose.
  const citationish = lines.filter((l) => /\d{4}\)|\bvol\b|עמ'|כרך/i.test(l)).length;
  if (lines.length >= 8 && citationish / lines.length > 0.7 && longestParagraph < 300) {
    return no("bibliography_only");
  }

  return {
    substantive: true,
    chars,
    threshold,
    reason: chars >= SECONDARY_WEB_LIMITS.PREFERRED_BODY_CHARS
      ? "substantive_full_body"
      : "substantive_short_body",
  };
}

// ── source-type remap ──────────────────────────────────────────────────────

export const SECONDARY_MAPPED_TYPES = [
  "legal_article",
  "scholarship",
  "book_or_chapter",
  "doctrinal_commentary",
  "institutional_report",
  "regulator_report",
  "policy_report",
] as const;
export type SecondaryMappedType = typeof SECONDARY_MAPPED_TYPES[number];

const SIG = {
  article:
    /(מאמר|כתב עת|רבעון|עיוני משפט|משפטים|הפרקליט|משפט וממשל|עלי משפט|מחקרי משפט|journal|law review)/i,
  book: /(ספר|כרך|מהדורה|הוצאת|בתוך:|עורכ|chapter|\bed\.\b)/i,
  report:
    /(דו"ח|דוח |דין וחשבון|נייר עמדה|מחקר מדיניות|מרכז המחקר והמידע|ממ"מ|מבקר המדינה|report|working paper)/i,
  regulator: /(רשות ניירות ערך|בנק ישראל|רשות התחרות|הרשות להגנת הפרטיות|רשות שוק ההון|regulator|supervisor)/i,
  commentary: /(פרשנות|פירוש|הערה|סקירה|ניתוח|בעקבות|מאת|commentary|note on)/i,
  academicHost: /(\.ac\.il|\.edu|repository|dspace|openscholar|journals?\.)/i,
  mmmHost: /(knesset\.gov\.il|mevaker\.gov\.il|idi\.org\.il|oecd\.org|un\.org)/i,
  regulatorHost: /(isa\.gov\.il|boi\.org\.il|competition\.gov\.il|gov\.il\/he\/departments)/i,
};

export interface SecondaryTypeRemap {
  mapped: boolean;
  original_type: string;
  mapped_type: SecondaryMappedType | null;
  evidence: string[];
  confidence: "high" | "medium" | "low";
  failure_reason: string | null;
}

/**
 * Decide the doctrinal type of an acquired body from provenance + content.
 * Returns `mapped: false` (and the candidate stays non-citable) when the
 * evidence does not support any doctrinal type.
 */
export function remapSecondaryType(input: {
  originalType?: string | null;
  title?: string | null;
  finalUrl?: string | null;
  bodyText: string;
}): SecondaryTypeRemap {
  const original = String(input.originalType ?? "").toLowerCase();
  const url = String(input.finalUrl ?? "");
  const hay = `${input.title ?? ""}\n${input.bodyText.slice(0, 6_000)}`;
  const evidence: string[] = [];

  if (SIG.report.test(hay)) evidence.push("report_signal");
  if (SIG.regulator.test(hay)) evidence.push("regulator_signal");
  if (SIG.article.test(hay)) evidence.push("article_signal");
  if (SIG.book.test(hay)) evidence.push("book_signal");
  if (SIG.commentary.test(hay)) evidence.push("commentary_signal");
  if (SIG.academicHost.test(url)) evidence.push("academic_host");
  if (SIG.mmmHost.test(url)) evidence.push("institutional_host");
  if (SIG.regulatorHost.test(url)) evidence.push("regulator_host");

  const fail = (reason: string): SecondaryTypeRemap => ({
    mapped: false,
    original_type: original || "(empty)",
    mapped_type: null,
    evidence,
    confidence: "low",
    failure_reason: reason,
  });

  if (evidence.length === 0) return fail("no_doctrinal_evidence");

  let mapped: SecondaryMappedType;
  if (evidence.includes("regulator_signal") || evidence.includes("regulator_host")) {
    mapped = "regulator_report";
  } else if (evidence.includes("report_signal")) {
    mapped = evidence.includes("institutional_host") ? "institutional_report" : "policy_report";
  } else if (evidence.includes("book_signal")) {
    mapped = "book_or_chapter";
  } else if (evidence.includes("article_signal")) {
    mapped = "legal_article";
  } else if (evidence.includes("academic_host")) {
    mapped = "scholarship";
  } else if (evidence.includes("institutional_host")) {
    mapped = "institutional_report";
  } else {
    mapped = "doctrinal_commentary";
  }

  const contentSignals = evidence.filter((e) => e.endsWith("_signal")).length;
  const hostSignals = evidence.length - contentSignals;
  const confidence: SecondaryTypeRemap["confidence"] = contentSignals >= 1 && hostSignals >= 1
    ? "high"
    : contentSignals >= 1
    ? "medium"
    : "low";

  if (confidence === "low" && mapped === "doctrinal_commentary") {
    return fail("insufficient_evidence_for_commentary");
  }

  return {
    mapped: true,
    original_type: original || "(empty)",
    mapped_type: mapped,
    evidence,
    confidence,
    failure_reason: null,
  };
}

/** Stable content hash for cache/persistence bookkeeping. */
export async function contentHash(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
