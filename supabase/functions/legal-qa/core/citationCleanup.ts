// Research Core v1 — deterministic citation text cleanup.
//
// Mirrors (does NOT import) the cleanup behaviors used by the existing
// Batch Footnote Builder. Used only inside Core (citations.ts + footnotes.ts).
// No LLM calls. Idempotent.
//
// Examples:
//   'בר"מ 5202/20 בר"מ 5202/20 פלוני נ\' אלמוני' → 'בר"מ 5202/20 פלוני נ\' אלמוני'
//   'עע"מ 7734/18 עע"מ 7734/18 …'                → 'עע"מ 7734/18 …'
//   '…&#8217;…&quot;…'                          → '…\u2019…"…'
//   '… ,. ,, '                                  → '. , '
//   '… "תחילת ציטוט שלא נסגר'                   → '…'  (dangling quote trimmed)

import { buildPrefixAlternation } from "../../_shared/caseTypePrefixes.ts";

// ─── HTML entity decoding ─────────────────────────────────────────────────
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
};

function decodeHtmlEntities(s: string): string {
  if (!s || s.indexOf("&") === -1) return s;
  return s
    .replace(/&#(\d+);/g, (_m, d) => {
      const n = parseInt(d, 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => {
      const n = parseInt(h, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m;
    })
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

// ─── Duplicate docket / procedure-prefix dedupe ──────────────────────────
// Matches "<prefix> <num>/<num>" repeated consecutively (with optional
// whitespace/punctuation between) and collapses to a single occurrence.
const PREFIX_ALT = buildPrefixAlternation();
const DOCKET_RE = new RegExp(
  `((?:${PREFIX_ALT})\\s+\\d{1,6}\\/\\d{2,4})` + // group 1: prefix + docket
    `(?:[\\s,;:.\\-–]+\\1)+`, // same group repeats
  "g",
);

function dedupeDocketPrefix(s: string): string {
  if (!s) return s;
  let prev: string;
  let cur = s;
  // Idempotency: re-run until stable (handles 3+ repeats).
  let guard = 0;
  do {
    prev = cur;
    cur = cur.replace(DOCKET_RE, "$1");
    guard++;
  } while (cur !== prev && guard < 4);
  return cur;
}

// ─── Punctuation normalization ───────────────────────────────────────────
function normalizePunctuation(s: string): string {
  if (!s) return s;
  return s
    .replace(/,{2,}/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\.{2,}(?!\.)/g, ".") // ".." → "."  (preserve "..." ellipsis)
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([;:])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]+\.$/g, ".")
    .trim();
}

// ─── Trailing broken-quote fragment trim ─────────────────────────────────
// If the string ends with an unbalanced opening quote followed by a short
// dangling fragment, drop the fragment back to the previous sentence boundary.
function trimDanglingQuoteFragment(s: string): string {
  if (!s) return s;
  // Count straight + curly quotes; if unbalanced and tail looks truncated, trim.
  const quotes = (s.match(/["\u201C\u201D\u2018\u2019]/g) || []).length;
  if (quotes % 2 === 0) return s;
  // Find last quote position; if it is in the tail (last 80 chars) and not
  // followed by a closing quote, drop everything from that quote onward.
  const lastQuoteIdx = Math.max(
    s.lastIndexOf('"'),
    s.lastIndexOf("\u201C"),
    s.lastIndexOf("\u2018"),
  );
  if (lastQuoteIdx < 0) return s;
  if (s.length - lastQuoteIdx > 200) return s; // not a tail-truncation
  const trimmed = s.slice(0, lastQuoteIdx).replace(/[\s,;:–-]+$/u, "");
  // Ensure we end with a period.
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

// ─── Public API ──────────────────────────────────────────────────────────
export function cleanCitationText(input: string): string {
  if (!input) return input;
  let s = input;
  s = decodeHtmlEntities(s);
  s = dedupeDocketPrefix(s);
  s = trimDanglingQuoteFragment(s);
  s = normalizePunctuation(s);
  return s;
}

// Heuristic for uninformative web labels like "[DOC] nevo.co.il".
const UNINFORMATIVE_TITLE_RE = /^\s*\[(DOC|PDF|HTML)\]\s+[a-z0-9.\-]+\s*$/i;
export function isUninformativeLabel(title?: string): boolean {
  if (!title) return false;
  const t = title.trim();
  if (!t) return false;
  if (UNINFORMATIVE_TITLE_RE.test(t)) return true;
  return false;
}
