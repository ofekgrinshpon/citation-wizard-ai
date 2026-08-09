/**
 * Article-citation validator (Deno-only, shared).
 *
 * Extracted verbatim from `supabase/functions/bibliography-lookup/index.ts`
 * so the chapter-citation router (used by `legal-qa` for academic chapter
 * footnotes) and the uniform-citation bibliography flow can share a single
 * implementation. Logic is byte-identical to the original.
 *
 * Behaviour:
 *  - Strips a `(כרך X)` wrapper down to the bare volume token `X` (per
 *    Israeli citation rule 24, the volume must not be wrapped).
 *  - Ensures the article title is wrapped in straight double quotes when
 *    a journal token is detectable.
 *  - If the journal name is missing from the citation but appeared in the
 *    raw input, splices it back in.
 *  - If a quoted title exists but no journal can be found anywhere,
 *    inserts the explicit `[חסר: שם כתב העת]` placeholder.
 *  - If the opening page (digits after `<journal> <volume>`) is missing,
 *    inserts the `[חסר: עמוד פתיחה]` placeholder right after the volume.
 *
 * The function is intentionally idempotent — running it on already-valid
 * output is a no-op, which is important because the chapter loop may run
 * it on input that previously passed through the same check.
 */

export const HEBREW_JOURNALS: readonly string[] = [
  "משפטים",
  "עיוני משפט",
  "הפרקליט",
  "מחקרי משפט",
  "דין ודברים",
  "מאזני משפט",
  "משפט וממשל",
  "משפט ועסקים",
  "המשפט",
  "משפט חברה ותרבות",
  "עלי משפט",
  "ספר השנה של המשפט בישראל",
  // Expanded — observed in academic chapter outputs but missing from the
  // legacy whitelist. Adding them here lets the classifier route those
  // footnotes to `journal_article` instead of `unknown`.
  "רציו",
  "הסניגור",
  "תאוריה וביקורת",
  "תיאוריה וביקורת",
  "שערי משפט",
  "קרית המשפט",
  "עיוני חינוך",
  "מגמות",
  "מדינה וחברה",
  "מחקרי רגולציה",
  "ביטחון לאומי",
  "המשפט בישראל",
  "עיונים בביקורת המדינה",
  "צפון אפריקה",
];

export const JOURNAL_HINT_RE = new RegExp(
  // Whitelist OR generic "כתב עת" wording OR a Hebrew-letter volume token
  // immediately preceded by a closing quote — strong signal of an article
  // citation even when the journal name is unknown.
  `(?:${HEBREW_JOURNALS.join("|")}|כתב[\\s-]?עת)`,
);

/**
 * Generic fallback signal: a quoted (or bold) title followed by a
 * journal-like token (a short Hebrew-letter volume in the form of `יד`,
 * `כג`, `לב` …, OR a numeric volume) and a 4-digit year in parentheses.
 * Used by the classifier to recognise journal articles whose journal name
 * is not in HEBREW_JOURNALS.
 */
export const ARTICLE_SHAPE_FALLBACK_RE =
  /(?:["״][^"״\n]{2,}["״]|\*\*[^*\n]{2,}\*\*)[^\n]*?\s+(?:[א-ת]{1,4}|\d{1,3})\s*(?:\(\s*(?:19|20)\d{2}\s*\)|,\s*(?:19|20)\d{2})/;

export function findJournalInText(text: string): string | null {
  for (const j of HEBREW_JOURNALS) {
    if (text.includes(j)) return j;
  }
  return null;
}

export function validateArticleCitation(
  citation: string,
  rawSource: string,
): string {
  if (!citation) return citation;
  const rawJournal = findJournalInText(rawSource);
  const citJournal = findJournalInText(citation);
  const looksLikeArticle =
    /["'״׳].+?["'״׳]/.test(citation) ||
    rawJournal !== null ||
    JOURNAL_HINT_RE.test(citation);
  if (!looksLikeArticle) return citation;

  let out = citation.trim();

  // 1. Strip "(כרך X)" → bare X
  out = out.replace(/\(\s*כרך\s+([^)]+?)\s*\)/g, "$1");

  // 2. Ensure quotes around title when we have a journal token to anchor on
  const journal = citJournal || rawJournal;
  if (journal && !/["״]/.test(out)) {
    const idx = out.indexOf(journal);
    if (idx > 0) {
      const before = out.slice(0, idx).trimEnd();
      const after = out.slice(idx);
      const tokens = before.split(/\s+/);
      if (tokens.length >= 3) {
        const splitAt = Math.max(1, Math.min(tokens.length - 1, Math.ceil(tokens.length * 0.4)));
        const authorBlock = tokens.slice(0, splitAt).join(" ");
        const titleBlock = tokens.slice(splitAt).join(" ").replace(/[,]\s*$/, "");
        out = `${authorBlock} "${titleBlock}" ${after}`.replace(/\s+/g, " ").trim();
      }
    }
  }

  // 3. Splice journal name back if missing but raw input had it
  if (!citJournal && rawJournal && !out.includes(rawJournal)) {
    const closingQuote = out.lastIndexOf('"');
    if (closingQuote > 0 && closingQuote < out.length - 1) {
      out = `${out.slice(0, closingQuote + 1)} ${rawJournal}${out.slice(closingQuote + 1)}`;
    } else {
      out = `${out} ${rawJournal}`;
    }
  } else if (!citJournal && !rawJournal && /["״].+?["״]/.test(out)) {
    const closingQuote = out.lastIndexOf('"');
    if (closingQuote > 0) {
      out = `${out.slice(0, closingQuote + 1)} [חסר: שם כתב העת]${out.slice(closingQuote + 1)}`;
    }
  }

  // 4. Ensure opening page exists after the volume.
  const finalJournal = findJournalInText(out);
  if (finalJournal) {
    const re = new RegExp(`${finalJournal}\\s+([^\\s()]+)(?:\\s+([^\\s()]+))?`);
    const m = out.match(re);
    if (m) {
      const tokenAfterVolume = m[2] || "";
      const hasPageDigits = /^\d+$/.test(tokenAfterVolume);
      if (!hasPageDigits && !out.includes("[חסר: עמוד פתיחה]")) {
        const insertion = `${finalJournal} ${m[1]} [חסר: עמוד פתיחה]`;
        out = out.replace(`${finalJournal} ${m[1]}`, insertion);
      }
    }
  }

  out = out.replace(/\s+/g, " ").trim();
  return out;
}

/**
 * Rule 24.11 / 23.7 — editors belong inside the trailing parentheses, before
 * the year, never in the book-author slot (between the article title and the
 * book title).
 *
 * Detects `<names> עורך/עורכת/עורכים/עורכות` occurring right after the closing
 * quote of the article title and splices it into the trailing parentheses.
 * Idempotent: a citation whose editors are already inside the parentheses is
 * returned unchanged.
 */
const EDITOR_ROLE = "עורכים|עורכות|עורכת|עורך";

export function normalizeEditorPlacement(citation: string): string {
  if (!citation) return citation;
  let out = citation;

  // Only act on lines that look like an article-in-book: quoted title present.
  const quoteRe = /["״][^"״\n]{2,}["״]/;
  if (!quoteRe.test(out)) return out;

  const misplaced = new RegExp(
    `(["״][^"״\\n]{2,}["״]\\s*)((?:[^"״()\\n]{2,120}?)\\s(?:${EDITOR_ROLE})(?:\\s+ראשי)?)\\s+`,
    "u",
  );
  const m = out.match(misplaced);
  if (!m) return out;

  const editorPhrase = m[2].trim().replace(/^[,\s]+|[,\s]+$/g, "");
  if (!editorPhrase) return out;

  // Remove from the misplaced position.
  const withoutEditors = out.replace(misplaced, "$1");

  // Splice into the trailing parentheses (before the year), or create them.
  const parenRe = /\(([^()]*)\)\s*\.?\s*$/u;
  const pm = withoutEditors.match(parenRe);
  if (pm) {
    const inner = pm[1].trim();
    if (new RegExp(EDITOR_ROLE, "u").test(inner)) return out; // already there
    const merged = inner ? `${editorPhrase} ${inner}` : editorPhrase;
    out = withoutEditors.replace(parenRe, `(${merged}).`);
  } else {
    out = `${withoutEditors.replace(/\s*\.?\s*$/, "")} (${editorPhrase}).`;
  }

  return out.replace(/\s+/g, " ").replace(/\s+\./g, ".").trim();
}
