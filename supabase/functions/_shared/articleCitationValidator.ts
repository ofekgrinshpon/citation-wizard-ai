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
];

export const JOURNAL_HINT_RE = new RegExp(
  `(?:${HEBREW_JOURNALS.join("|")}|כתב[\\s-]?עת)`,
);

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
