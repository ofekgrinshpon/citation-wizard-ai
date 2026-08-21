// class_unknown_primary_shape_rescue_v1
//
// Narrow admission fix: a source that the domain classifier could not place
// ("unknown") but which carries an unambiguous Israeli judgment shape
// (recognised case-type prefix + docket) in its TITLE or URL is re-routed to
// the case-law lane instead of being dropped as `class_unknown_not_admitted_*`.
//
// Deliberate limits:
// - Only `unknown` is rescued. Blog / law-firm / news / publisher domains are
//   already classified elsewhere and are never touched here.
// - The docket must appear in title or URL. A snippet mention is not enough
//   (that is how SEO/commentary pages name-drop judgments).
// - Commentary/article/news shaped titles or URL paths are refused.
// - Rescue = admission only. The verifier, the metadata-only holding gate and
//   the source-integrity classifier all still run downstream.

/** Recognised Israeli case-type prefix immediately followed by a docket. */
const CASE_PREFIX_DOCKET_RE =
  /(?:בג["״']?ץ|דנג["״']?ץ|בשג["״']?ץ|עע["״']?מ|עע["״']?ם|ע["״']?א|ע["״']?פ|ע["״']?מ|ע["״']?ע|ע["״']?ב|רע["״']?א|רע["״']?פ|רע["״']?ב|דנ["״']?א|דנ["״']?פ|דנ["״']?מ|בש["״']?פ|בש["״']?א|בר["״']?ם|בר["״']?ע|תמ["״']?ש|תלה["״']?מ|תפ["״']?ח|רמ["״']?ש|עמ["״']?ש|עת["״']?מ|עס["״']?ק|סע["״']?ש|דב["״']?ע|עב["״']?ל|ה["״']?פ|ת["״']?א|ת["״']?פ|ת["״']?ק|עה["״']?ס)\s*(?:\([^)]{1,40}\)\s*)?(\d{1,6}(?:[\/\-]\d{1,4}){1,2})/;

/** Docket-only pattern used to confirm the numeric shape in URLs. */
const DOCKET_RE = /\b\d{1,6}[\/\-]\d{2,4}(?:[\/\-]\d{1,4})?\b/;

/** Titles that are plainly secondary writing rather than a judgment. */
const COMMENTARY_TITLE_RE =
  /(?:מאמר|בלוג|טור|פרשנות|סקירה|ניוזלטר|עדכון לקוחות|מדריך|שאלות ותשובות|מה זה|כל מה שצריך לדעת|עורך דין|עו["״']?ד|משרד עורכי דין|ייעוץ משפטי|צור קשר|blog|article|news|newsletter|guide|faq|opinion|column)/i;

/** URL paths that mark blog / news / marketing surfaces. */
const COMMENTARY_PATH_RE =
  /\/(?:blog|news|article|articles|magazine|column|press|media|about|contact|service|services|category|tag|author|faq|guide)(?:\/|$|\.)/i;

export interface PrimaryShapeRescue {
  rescued: boolean;
  /** Always "unknown" when rescued — preserved for telemetry. */
  original_classification: "unknown";
  rescue_reason: "primary_authority_shape";
  rescued_as: "judgment";
  /** The docket string that triggered the rescue. */
  matched_docket: string;
  /** Where the shape was found. */
  matched_in: "title" | "url";
}

export interface RescueInput {
  url: string;
  title: string;
  snippet?: string;
}

/**
 * Decide whether an `unknown`-class source has unambiguous judgment shape.
 * Returns null when it should stay dropped.
 */
export function detectPrimaryAuthorityShape(input: RescueInput): PrimaryShapeRescue | null {
  const title = (input.title || "").trim();
  const url = (input.url || "").trim();
  if (!title && !url) return null;

  let decodedUrl = url;
  try { decodedUrl = decodeURIComponent(url); } catch { /* keep raw */ }

  // Negative guards first — commentary/news/marketing shapes never rescue.
  if (COMMENTARY_TITLE_RE.test(title)) return null;
  let path = "";
  try { path = new URL(url).pathname; } catch { path = url; }
  if (COMMENTARY_PATH_RE.test(path)) return null;

  const titleMatch = title.match(CASE_PREFIX_DOCKET_RE);
  if (titleMatch) {
    return {
      rescued: true,
      original_classification: "unknown",
      rescue_reason: "primary_authority_shape",
      rescued_as: "judgment",
      matched_docket: titleMatch[1],
      matched_in: "title",
    };
  }

  const urlMatch = decodedUrl.match(CASE_PREFIX_DOCKET_RE);
  if (urlMatch && DOCKET_RE.test(decodedUrl)) {
    return {
      rescued: true,
      original_classification: "unknown",
      rescue_reason: "primary_authority_shape",
      rescued_as: "judgment",
      matched_docket: urlMatch[1],
      matched_in: "url",
    };
  }

  return null;
}
