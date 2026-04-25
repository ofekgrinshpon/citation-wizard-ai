/**
 * Chapter Citation Router (Deno-only).
 *
 * Front-end classifier + dispatcher for academic-chapter footnotes. Sits in
 * front of the legal `resolveCitation` engine so non-legal citations
 * (journal articles, books, reports, web sources …) are NOT misrouted
 * through the legal resolver and falsely logged as `missing_required`.
 *
 * Responsibilities:
 *   1. Classify each footnote into a typed `FootnoteSourceType`.
 *   2. Route by type:
 *        statute / caselaw           → existing legal resolveCitation
 *        journal_article             → shared validateArticleCitation
 *        book / book_chapter / report / web_source
 *                                    → light shape normalisation, pass-through
 *        unknown                     → explicit `skipped` with a typed reason
 *   3. Return a typed `RouteResult` so the caller can emit honest telemetry
 *      (`missing_required` only ever appears for real legal failures).
 *
 * Non-blocking: a `skipped` or `unresolved` footnote is NEVER dropped here
 * — the caller keeps the original text. Only the canonical re-emission is
 * returned for routes that have a normalised form.
 */

import { resolveCitation, type ResolveResult } from "./citationResolver.ts";
import {
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

export type SkipReason =
  | "engine_skipped_non_legal_type"
  | "unclassified_citation_shape"
  | "empty_citation";

export type RouteResult =
  | {
      route: "legal_resolver";
      sourceType: "statute" | "caselaw";
      result: ResolveResult;
    }
  | {
      route: "bibliography";
      sourceType: Exclude<FootnoteSourceType, "statute" | "caselaw" | "unknown">;
      canonical: string;
      warnings: string[];
    }
  | {
      route: "skipped";
      sourceType: FootnoteSourceType;
      reason: SkipReason;
    };

// ─── Classification regex (ordered cascade) ─────────────────────────

const STATUTE_RE =
  /(?:חוק[-\s]יסוד|\bחוק\s+|פקודת|פקודה\s+|תקנות|תקנה\s+|כללי\s+|צו\s+)/;
// Caselaw shape — quoted prefixes (בג"ץ, ע"א, רע"א, סע"ש …), unquoted
// whitelist (עב, בל, תק, …), or פ"ד / פד"ע series.
const CASELAW_RE =
  /(?:[א-ת]{1,3}["״׳']+[א-ת]{1,2}\s+\d+[\/\-]\d+|(?:^|\s)(?:עב|בל|תק|תא|תפ|הפ|המ|בש)\s+\d+[\/\-]\d+|פ["״]ד|פד["״]ע)/;
const QUOTED_TITLE_RE = /["״׳].+?["״׳]/;
const ENGLISH_VOL_PAGE_RE = /\b\d+\s+[A-Z][A-Za-z .]+\s+\d+\b/;
const BOLD_TITLE_RE = /\*\*[^*\n]{2,}\*\*|(?<!\*)\*[^*\n]{2,}\*(?!\*)/;
const REPORT_PREFIX_RE =
  /(?:^|\s)(?:דו["״׳']ח|דוח\s|מסמך\s+מדיניות|נייר\s+עמדה|נייר\s+מדיניות|דין\s+וחשבון|המרכז\s+למחקר\s+ולמידע\s+של\s+הכנסת|מ["״]מ|מרכז\s+המחקר\s+והמידע)/;
const URL_RE = /https?:\/\/\S+/i;
const WEB_MARKER_RE = /(?:נצפה\s+ב[־-]|זמין\s+ב[־-]|אוחזר\s+מ[־-])/;
const BOOK_CHAPTER_LINK_RE = /\bבתוך[\s:]/;
const HEBREW_YEAR_RE = /\(\s*הת[שׁש][א-ת]*["״׳][א-ת]["״׳]?[א-ת]?\s*\)/;
const GREG_YEAR_RE = /\((?:19|20)\d{2}\)/;

/**
 * Classify a footnote citation string into one source type.
 * Conservative cascade — first confident match wins; otherwise `unknown`.
 *
 * Order matters:
 *   1. statute (strong lexical anchors — חוק / תקנות / etc.)
 *   2. caselaw (case-prefix shape OR פ"ד series)
 *   3. journal_article (quoted title + journal token)
 *   4. book_chapter (quoted title followed by `בתוך`)
 *   5. book (bold/italic title without journal token, optional year)
 *   6. report (דו"ח / מסמך מדיניות / Knesset RM&I / …)
 *   7. web_source (raw URL, or web-marker without other source signals)
 *   8. unknown
 */
export function classifyChapterFootnote(text: string): FootnoteSourceType {
  const t = (text || "").trim();
  if (!t) return "unknown";

  // 1. Statute (most reliable lexical anchor)
  if (STATUTE_RE.test(t)) return "statute";

  // 2. Caselaw
  if (CASELAW_RE.test(t)) return "caselaw";

  // 3. Book chapter — quoted title + explicit "בתוך" link to a book
  if (QUOTED_TITLE_RE.test(t) && BOOK_CHAPTER_LINK_RE.test(t)) return "book_chapter";

  // 4. Journal article — quoted title with a Hebrew journal name OR generic
  //    journal hint OR an English Vol/Page pattern.
  const hasQuoted = QUOTED_TITLE_RE.test(t);
  const journal = findJournalInText(t);
  const hasJournalHint = JOURNAL_HINT_RE.test(t);
  if (hasQuoted && (journal || hasJournalHint)) return "journal_article";
  if (ENGLISH_VOL_PAGE_RE.test(t) && hasQuoted) return "journal_article";

  // 5. Book — bold/italic title, no journal token. Tolerate a year or no year.
  if (BOLD_TITLE_RE.test(t) && !hasJournalHint) return "book";

  // 6. Report — explicit dossier / policy / Knesset prefix.
  if (REPORT_PREFIX_RE.test(t)) return "report";

  // 7. Web source — raw URL, or aux web markers when nothing else fired.
  if (URL_RE.test(t) || WEB_MARKER_RE.test(t)) return "web_source";

  return "unknown";
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
    // Trim trailing punctuation that drafters often append after a URL.
    out = out.replace(/(https?:\/\/\S+?)[.,;]+(\s|$)/g, "$1$2");
    if (!URL_RE.test(out)) warnings.push("missing_url");
  }

  return { text: out, warnings };
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
    return { route: "skipped", sourceType: "unknown", reason: "empty_citation" };
  }

  const sourceType = classifyChapterFootnote(trimmed);

  switch (sourceType) {
    case "statute":
    case "caselaw": {
      const result = resolveCitation(trimmed, sourceType, {
        caseNumberHint: opts.caseNumberHint,
        decisionDateHint: opts.decisionDateHint,
        titleHint: opts.titleHint,
      });
      return { route: "legal_resolver", sourceType, result };
    }

    case "journal_article": {
      // The validator is local-only (no Perplexity round-trip) — it fixes
      // common drafter mistakes (e.g. `(כרך X)` wrapper, missing journal,
      // missing first page) and inserts `[חסר: …]` placeholders when a
      // mandatory rule-24 component is unrecoverable.
      const canonical = validateArticleCitation(trimmed, trimmed);
      const warnings: string[] = [];
      if (canonical.includes("[חסר: שם כתב העת]")) warnings.push("missing_journal");
      if (canonical.includes("[חסר: עמוד פתיחה]")) warnings.push("missing_first_page");
      if (canonical.includes("[חסר: שנה]")) warnings.push("missing_year");
      return { route: "bibliography", sourceType, canonical, warnings };
    }

    case "book":
    case "book_chapter":
    case "report":
    case "web_source": {
      const { text: canonical, warnings } = normaliseBibliographyShape(trimmed, sourceType);
      return { route: "bibliography", sourceType, canonical, warnings };
    }

    case "unknown":
    default:
      return {
        route: "skipped",
        sourceType: "unknown",
        reason: "unclassified_citation_shape",
      };
  }
}
