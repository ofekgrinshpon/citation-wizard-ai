/**
 * Chapter Citation Router (Deno-only).
 *
 * Front-end classifier + dispatcher for academic-chapter footnotes. Sits in
 * front of the legal `resolveCitation` engine so non-legal citations
 * (journal articles, books, reports, web sources …) are NOT misrouted
 * through the legal resolver and falsely logged as `missing_required`.
 *
 * Responsibilities:
 *   1. Classify each footnote into a typed `FootnoteSourceType` AND record
 *      WHY it was classified that way (`ClassifyReason`).
 *   2. Route by type:
 *        statute / caselaw           → existing legal resolveCitation
 *        journal_article             → shared validateArticleCitation
 *        book / book_chapter / report / web_source
 *                                    → light shape normalisation, pass-through
 *        unknown                     → explicit `skipped` with a typed reason
 *   3. Return a typed `RouteResult` so the caller can emit honest telemetry
 *      (`missing_required` only ever appears for real legal failures, and
 *      `skipped.reasons` distinguishes between truly unknown vs.
 *      recognised-but-insufficient-shape).
 *
 * Non-blocking: a `skipped` or `unresolved` footnote is NEVER dropped here
 * — the caller keeps the original text. Only the canonical re-emission is
 * returned for routes that have a normalised form.
 */

import { resolveCitation, type ResolveResult } from "./citationResolver.ts";
import {
  ARTICLE_SHAPE_FALLBACK_RE,
  findJournalInText,
  JOURNAL_HINT_RE,
  validateArticleCitation,
} from "./articleCitationValidator.ts";

export type FootnoteSourceType =
  | "statute"
  | "caselaw"
  | "journal_article"
  | "book"
  | "book_chapter"
  | "report"
  | "web_source"
  | "unknown";

/**
 * Skip / classification debug reasons.
 *
 * Distinguishes:
 *   - `unclassified_citation_shape`     truly unrecognised (no anchor at all)
 *   - `recognized_no_journal_token`     looks like an article (quoted title +
 *                                       year) but no journal name detectable
 *   - `recognized_no_anchor`            has a quoted/bold title but no
 *                                       supporting metadata (year, journal,
 *                                       volume, pages, "בתוך")
 *   - `garbled_text`                    short, no Hebrew letter clusters,
 *                                       likely OCR / rendering damage
 *   - `empty_citation`                  empty input
 *   - `engine_skipped_non_legal_type`   reserved for future use
 */
export type SkipReason =
  | "engine_skipped_non_legal_type"
  | "unclassified_citation_shape"
  | "recognized_no_journal_token"
  | "recognized_no_anchor"
  | "garbled_text"
  | "empty_citation";

/**
 * Why the classifier picked the source type it did. Pure observability —
 * surfaced into telemetry so we can audit classifier decisions without
 * re-running everything.
 */
export type ClassifyReason =
  | "statute_lexical_anchor"
  | "caselaw_prefix_shape"
  | "caselaw_bare_docket"
  | "caselaw_pd_series"
  | "book_chapter_betoch_link"
  | "journal_whitelist_hit"
  | "journal_hint_token"
  | "journal_english_vol_page"
  | "journal_shape_fallback"
  | "book_bold_title"
  | "report_prefix"
  | "web_url"
  | "web_marker"
  | "fallback_unknown";

export type RouteResult =
  | {
      route: "legal_resolver";
      sourceType: "statute" | "caselaw";
      classifyReason: ClassifyReason;
      result: ResolveResult;
    }
  | {
      route: "bibliography";
      sourceType: Exclude<FootnoteSourceType, "statute" | "caselaw" | "unknown">;
      classifyReason: ClassifyReason;
      canonical: string;
      warnings: string[];
    }
  | {
      route: "skipped";
      sourceType: FootnoteSourceType;
      classifyReason: ClassifyReason;
      reason: SkipReason;
    };

// ─── Classification regex (ordered cascade) ─────────────────────────

// Hebrew statute anchors. We deliberately allow a single-letter Hebrew
// prefix (ב/ל/ה/מ) before `חוק` because Israeli citations very often appear
// as `לחוק שירות המדינה` / `בחוק העונשין`.
const STATUTE_RE =
  /(?:חוק[-\s]יסוד|(?:^|[^א-ת])[בלהמ]?חוק\s+|פקודת|פקודה\s+|תקנות|תקנה\s+|כללי\s+|צו\s+|הצעת\s+חוק)/;
// Caselaw shape — quoted prefixes (בג"ץ, ע"א, רע"א, סע"ש …) or unquoted
// whitelist (עב, בל, תק, …).
const CASELAW_PREFIX_RE =
  /(?:[א-ת]{1,3}["״׳']+[א-ת]{1,2}\s+\d+[\/\-]\d+|(?:^|\s)(?:עב|בל|תק|תא|תפ|הפ|המ|בש)\s+\d+[\/\-]\d+)/;
const CASELAW_PD_SERIES_RE = /פ["״]ד|פד["״]ע/;
// Bare-docket pattern (e.g. `54321-03-25`) — common when the drafter drops
// the בג"ץ/ע"א prefix in a short-form citation.
//
// v3 tightening: REQUIRE that a court-name token (`בית המשפט`, `בית הדין`,
// `בתי המשפט`, `בתי הדין`, `בג"ץ`, `העליון`, `המחוזי`, `השלום`, `לעבודה`,
// `לענייני`) appears within ~80 chars of the docket. This kills the
// false-positive where statutory subsection patterns like `26(2) ו-(4)`
// matched the bare-docket shape and bled into the caselaw bucket.
const CASELAW_BARE_DOCKET_SHAPE_RE =
  /(?:^|[\s(])\d{3,6}[-\/]\d{1,2}[-\/]\d{2,4}(?:[\s).,]|$)/;
const COURT_NAME_TOKEN_RE =
  /(?:בית\s+המשפט|בית\s+הדין|בתי\s+המשפט|בתי\s+הדין|בג["״]ץ|העליון|המחוזי|השלום|לעבודה|לענייני|הצבאי)/;
function looksLikeBareDocket(t: string): boolean {
  const m = t.match(CASELAW_BARE_DOCKET_SHAPE_RE);
  if (!m) return false;
  const idx = m.index ?? 0;
  // Look at a ±80-char window around the docket for a court-name token.
  const start = Math.max(0, idx - 80);
  const end = Math.min(t.length, idx + (m[0]?.length ?? 0) + 80);
  return COURT_NAME_TOKEN_RE.test(t.slice(start, end));
}
const QUOTED_TITLE_RE = /["״׳][^"״׳\n]{2,}["״׳]/;
const ENGLISH_VOL_PAGE_RE = /\b\d+\s+[A-Z][A-Za-z .]+\s+\d+\b/;
const BOLD_TITLE_RE = /\*\*[^*\n]{2,}\*\*|(?<!\*)\*[^*\n]{2,}\*(?!\*)/;
// Report prefixes — `מ"מ` removed because it false-positives on quoted
// fragments like `מ"מבחן המטרה"`. The Knesset RM&I full name is enough.
const REPORT_PREFIX_RE =
  /(?:^|\s)(?:דו["״׳']ח\s|דוח\s|מסמך\s+מדיניות|נייר\s+עמדה|נייר\s+מדיניות|דין\s+וחשבון|המרכז\s+למחקר\s+ולמידע\s+של\s+הכנסת|מרכז\s+המחקר\s+והמידע)/;
const URL_RE = /https?:\/\/\S+/i;
const WEB_MARKER_RE = /(?:נצפה\s+ב[־-]|זמין\s+ב[־-]|אוחזר\s+מ[־-])/;
const BOOK_CHAPTER_LINK_RE = /\bבתוך[\s:]/;
const HEBREW_YEAR_RE = /\(\s*הת[שׁש][א-ת]*["״׳][א-ת]["״׳]?[א-ת]?\s*\)/;
const GREG_YEAR_RE = /\((?:19|20)\d{2}\)/;
// Cheap "is this Hebrew text at all?" — used to flag garbled output.
const HEBREW_LETTER_RUN_RE = /[א-ת]{3,}/;

export interface ClassificationOutcome {
  type: FootnoteSourceType;
  reason: ClassifyReason;
}

/**
 * Classify a footnote citation string into one source type and report the
 * reason. Conservative cascade — first confident match wins.
 *
 * Order:
 *   1. statute (lexical anchors — חוק / תקנות / הצעת חוק / etc.)
 *   2. caselaw (prefix shape, פ"ד series, OR bare docket)
 *   3. book_chapter (quoted title + "בתוך")
 *   4. journal_article cascade:
 *        4a. whitelisted journal name + quoted/bold title
 *        4b. generic "כתב עת" hint + quoted/bold title
 *        4c. English Vol/Page + quoted title
 *        4d. shape fallback — quoted/bold title + Hebrew/numeric volume + year
 *   5. book (bold title, no journal)
 *   6. report (prefix)
 *   7. web_source (URL or web marker)
 *   8. unknown
 */
export function classifyChapterFootnoteWithReason(
  text: string,
): ClassificationOutcome {
  const t = (text || "").trim();
  if (!t) return { type: "unknown", reason: "fallback_unknown" };

  if (STATUTE_RE.test(t)) return { type: "statute", reason: "statute_lexical_anchor" };

  if (CASELAW_PREFIX_RE.test(t)) {
    return { type: "caselaw", reason: "caselaw_prefix_shape" };
  }
  if (CASELAW_PD_SERIES_RE.test(t)) {
    return { type: "caselaw", reason: "caselaw_pd_series" };
  }
  // Bare docket only fires if (a) the rest of the string isn't statute-like
  // AND (b) a court-name token sits within ~80 chars of the docket. Without
  // (b), statutory subsection patterns like `26(2) ו-(4)` were leaking into
  // the caselaw bucket and reaching the legal resolver as `extract_failed`.
  if (looksLikeBareDocket(t) && !STATUTE_RE.test(t)) {
    return { type: "caselaw", reason: "caselaw_bare_docket" };
  }

  if (QUOTED_TITLE_RE.test(t) && BOOK_CHAPTER_LINK_RE.test(t)) {
    return { type: "book_chapter", reason: "book_chapter_betoch_link" };
  }

  const hasQuoted = QUOTED_TITLE_RE.test(t);
  const hasBoldTitle = BOLD_TITLE_RE.test(t);
  const journal = findJournalInText(t);
  const hasJournalHint = JOURNAL_HINT_RE.test(t);

  if ((hasQuoted || hasBoldTitle) && journal) {
    return { type: "journal_article", reason: "journal_whitelist_hit" };
  }
  if ((hasQuoted || hasBoldTitle) && hasJournalHint) {
    return { type: "journal_article", reason: "journal_hint_token" };
  }
  if (ENGLISH_VOL_PAGE_RE.test(t) && hasQuoted) {
    return { type: "journal_article", reason: "journal_english_vol_page" };
  }
  if (ARTICLE_SHAPE_FALLBACK_RE.test(t)) {
    return { type: "journal_article", reason: "journal_shape_fallback" };
  }

  if (hasBoldTitle && !hasJournalHint) {
    return { type: "book", reason: "book_bold_title" };
  }

  if (REPORT_PREFIX_RE.test(t)) return { type: "report", reason: "report_prefix" };

  if (URL_RE.test(t)) return { type: "web_source", reason: "web_url" };
  if (WEB_MARKER_RE.test(t)) return { type: "web_source", reason: "web_marker" };

  return { type: "unknown", reason: "fallback_unknown" };
}

/** Backwards-compatible thin wrapper. */
export function classifyChapterFootnote(text: string): FootnoteSourceType {
  return classifyChapterFootnoteWithReason(text).type;
}

// ─── Light bibliography normalisers (no network) ─────────────────────

interface NormaliseResult {
  text: string;
  warnings: string[];
}

/**
 * Idempotent shape cleanup for non-article bibliography items.
 * Adds `[חסר: שנה]` if no Hebrew/Gregorian year is present (for books and
 * reports — the most common drafter omission). Trims/collapses whitespace.
 * Quote canonicalisation is left to the article validator path.
 */
function normaliseBibliographyShape(
  text: string,
  type: "book" | "book_chapter" | "report" | "web_source",
): NormaliseResult {
  const warnings: string[] = [];
  let out = text.trim().replace(/\s+/g, " ");

  if (type === "book" || type === "book_chapter" || type === "report") {
    const hasYear = HEBREW_YEAR_RE.test(out) || GREG_YEAR_RE.test(out);
    if (!hasYear && !out.includes("[חסר: שנה]")) {
      out = `${out} [חסר: שנה]`;
      warnings.push("missing_year");
    }
  }

  if (type === "web_source") {
    out = out.replace(/(https?:\/\/\S+?)[.,;]+(\s|$)/g, "$1$2");
    if (!URL_RE.test(out)) warnings.push("missing_url");
  }

  return { text: out, warnings };
}

/**
 * Decide WHY a footnote ended up as `unknown` so the caller can split
 * `skipped.reasons` into actionable buckets instead of one undifferentiated
 * `unclassified_citation_shape`.
 */
function diagnoseUnknown(text: string): SkipReason {
  const t = text.trim();
  const hasHebrew = HEBREW_LETTER_RUN_RE.test(t);
  const hasQuoted = QUOTED_TITLE_RE.test(t);
  const hasBold = BOLD_TITLE_RE.test(t);
  const hasYear = HEBREW_YEAR_RE.test(t) || GREG_YEAR_RE.test(t);

  if (t.length < 30 && !hasHebrew) return "garbled_text";
  if ((hasQuoted || hasBold) && hasYear) return "recognized_no_journal_token";
  if (hasQuoted || hasBold) return "recognized_no_anchor";

  return "unclassified_citation_shape";
}

// ─── Public API ──────────────────────────────────────────────────────

export interface RouteOptions {
  /** Optional `case_number` hint (mirrors `resolveCitation` opts). */
  caseNumberHint?: string;
  /** Optional `decision_date` hint. */
  decisionDateHint?: string;
  /** Optional source-card title — used by the legal resolver as a fallback. */
  titleHint?: string;
}

/**
 * Classify and route a single chapter footnote.
 * The returned `RouteResult` tells the caller exactly how to update the
 * footnote (overwrite the citation, leave it, or just record the skip).
 */
export function routeChapterFootnote(
  text: string,
  opts: RouteOptions = {},
): RouteResult {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return {
      route: "skipped",
      sourceType: "unknown",
      classifyReason: "fallback_unknown",
      reason: "empty_citation",
    };
  }

  const { type: sourceType, reason: classifyReason } =
    classifyChapterFootnoteWithReason(trimmed);

  switch (sourceType) {
    case "statute":
    case "caselaw": {
      const result = resolveCitation(trimmed, sourceType, {
        caseNumberHint: opts.caseNumberHint,
        decisionDateHint: opts.decisionDateHint,
        titleHint: opts.titleHint,
      });
      return { route: "legal_resolver", sourceType, classifyReason, result };
    }

    case "journal_article": {
      const canonical = validateArticleCitation(trimmed, trimmed);
      const warnings: string[] = [];
      if (canonical.includes("[חסר: שם כתב העת]")) warnings.push("missing_journal");
      if (canonical.includes("[חסר: עמוד פתיחה]")) warnings.push("missing_first_page");
      if (canonical.includes("[חסר: שנה]")) warnings.push("missing_year");
      return { route: "bibliography", sourceType, classifyReason, canonical, warnings };
    }

    case "book":
    case "book_chapter":
    case "report":
    case "web_source": {
      const { text: canonical, warnings } = normaliseBibliographyShape(trimmed, sourceType);
      return { route: "bibliography", sourceType, classifyReason, canonical, warnings };
    }

    case "unknown":
    default:
      return {
        route: "skipped",
        sourceType: "unknown",
        classifyReason,
        reason: diagnoseUnknown(trimmed),
      };
  }
}
