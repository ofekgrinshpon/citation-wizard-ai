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
// Note: trimDanglingQuoteFragment is intentionally NOT applied — Hebrew legal
// citations use `"` as gershayim (e.g. `ע"א`, `פ"ד`, `עע"מ`), so a naive
// quote-balance heuristic mangles legitimate text. Footnote authority over
// truncated artifacts is left to the drafter / engine layer.
export function cleanCitationText(input: string): string {
  if (!input) return input;
  let s = input;
  s = decodeHtmlEntities(s);
  s = dedupeDocketPrefix(s);
  s = normalizePunctuation(s);
  return s;
}

// Heuristic for uninformative web labels like "[DOC] nevo.co.il".
const UNINFORMATIVE_TITLE_RE = /^\s*\[(DOC|PDF|HTML)\]\s+[a-z0-9.\-]+\s*$/i;
const HOST_ONLY_RE = /^\s*(?:https?:\/\/)?(?:www\.)?[a-z0-9.\-]+\.[a-z]{2,}\s*$/i;
// Court-header / generic Hebrew document prefixes that should never become
// the citation title (e.g. raw PDF extracts that begin with "בבית המשפט העליון").
const COURT_HEADER_RE =
  /^\s*בבית[\s-]*ה?משפט\s+(העליון|המחוזי|השלום|לעניינים|לנוער|לתעבורה|לעבודה|לענייני\s+משפחה|למשפחה|המנהלי|המינהלי|לערעורים)/;
const GENERIC_DOC_LABELS = new Set([
  "פסק דין", "פסק-דין", "החלטה", "פרוטוקול",
  "פרטי מסמך", "ללא כותרת", "מסמך", "ערעור", "בקשה",
]);

/** Strip leading `[PDF]`, `[DOC]`, `[HTML]` (case-insensitive) prefixes, repeatedly. */
export function stripDocPrefixes(title: string): string {
  if (!title) return title;
  return title.replace(/^(?:\s*\[(?:PDF|DOC|HTML)\]\s*)+/i, "").trim();
}

export function isUninformativeLabel(title?: string): boolean {
  if (!title) return false;
  const raw = title.trim();
  if (!raw) return false;
  if (UNINFORMATIVE_TITLE_RE.test(raw)) return true;
  // Strip [PDF]/[DOC]/[HTML] prefixes before evaluating the remainder.
  const t = stripDocPrefixes(raw);
  if (!t) return true;
  if (HOST_ONLY_RE.test(t)) return true;
  if (COURT_HEADER_RE.test(t)) return true;
  const compact = t.replace(/[.,;:"״׳']/g, "").trim();
  if (GENERIC_DOC_LABELS.has(compact)) return true;
  return false;
}

// ─── Source-type normalization ───────────────────────────────────────────
// Coerces internal / external aliases into the canonical set used by the
// citation engine. Anything not in the map passes through untouched.
const SOURCE_TYPE_NORMALIZE: Record<string, string> = {
  // Caselaw aliases
  supreme_court_il: "caselaw",
  case_law: "caselaw",
  case_law_database: "caselaw",
  case_law_published: "caselaw",
  published_caselaw: "caselaw",
  caselaw: "caselaw",
  // Statute aliases
  israeli_law: "statute",
  legislation_primary: "statute",
  primary_legislation: "statute",
  statute: "statute",
  legislation: "statute",
  // Basic law
  basic_law: "basic_law",
  // Regulations
  legislation_secondary: "regulation",
  secondary_legislation: "regulation",
  regulation: "regulation",
  // Journal articles
  journal: "journal_article",
  journal_article: "journal_article",
  article: "journal_article",
};

export function normalizeSourceType(raw: string | undefined): string {
  const key = (raw || "").toLowerCase().trim();
  if (!key) return "";
  return SOURCE_TYPE_NORMALIZE[key] ?? key;
}

// ─── Bare-reporter detection ─────────────────────────────────────────────
// A bare reporter looks like `פ"ד מט(4) 221` (optionally followed by a
// parenthesized host or year) WITHOUT a docket prefix and WITHOUT a parties
// separator (`X נ' Y`). These cannot stand alone as final case citations per
// Rule 18.
const REPORTER_RE = /פ["״]ד\s+[א-ת]+(?:\s*\(\s*\d+\s*\))?\s+\d+/;
const PARTIES_SEP_RE = /\sנ['׳]\s/;

// Lazy-import to avoid circular pull from cleanup helpers.
import { CASE_TYPE_PREFIX_RE, CASE_DOCKET_RE } from "../../_shared/caseTypePrefixes.ts";

export function isBareReporter(text: string): boolean {
  if (!text) return false;
  if (!REPORTER_RE.test(text)) return false;
  if (CASE_TYPE_PREFIX_RE.test(text)) return false;
  if (PARTIES_SEP_RE.test(text)) return false;
  return true;
}

// Scan title/citation/snippet for a docket like `בג"ץ 1234/56` or
// `18225-06-25` with a prefix. Returns the first prefix+docket match.
export function extractDocketFromText(text: string): { prefix: string; docket: string } | null {
  if (!text) return null;
  const m = text.match(CASE_DOCKET_RE);
  if (!m) return null;
  return { prefix: m[1], docket: m[2] };
}

// Scan for parties: `<X> נ' <Y>` — returns trimmed party strings.
//
// Loosened (Pass B):
//   • tolerates Hebrew typographic quotes `״ ׳` AND ASCII `" '` inside
//     party names (e.g. `בע"מ`, `חב' פלוני`)
//   • accepts `נ׳ / נ' / נ"` as the separator
//   • strips a leading docket prefix + number when present
//   • sanity-check: both sides ≥ 2 chars and contain ≥ 1 Hebrew letter
const PREFIX_THEN_DOCKET_RE =
  /^[\u0590-\u05FFא-תa-zA-Z"״׳']{1,6}\s+\d{1,6}[-\/]\d{1,6}(?:[-\/]\d{1,4})?\s+/;
const PARTIES_CAPTURE_RE = /(.+?)\s+נ['׳"״]\s+(.+?)(?=\s*$|\s*\((?:\d{4}|פ["״]ד))/;
export function extractPartiesFromText(text: string): { party1: string; party2: string } | null {
  if (!text) return null;
  // Try a stripped variant first (works for titles like "בג"ץ 910/86 רסלר נ' שר הביטחון").
  const stripped = text.trim().replace(PREFIX_THEN_DOCKET_RE, "");
  for (const cand of [stripped, text]) {
    // Stop at the first sentence break to avoid spanning multiple cases.
    const segment = cand.split(/[\n.;]|,\s+(?=[א-ת])/)[0] || cand;
    const m = segment.match(PARTIES_CAPTURE_RE);
    if (!m) continue;
    const p1 = m[1].trim().replace(/^.*?\d+[-\/]\d+\s+/, "").trim();
    const p2 = m[2].trim().replace(/\s*\(.*$/, "").trim();
    if (p1.length < 2 || p2.length < 2) continue;
    if (!/[\u0590-\u05FF]/.test(p1) || !/[\u0590-\u05FF]/.test(p2)) continue;
    return { party1: p1, party2: p2 };
  }
  return null;
}

// Scan for a year (4 digits, 1900–2099).
const YEAR_RE = /\b(19\d{2}|20\d{2})\b/;
export function extractYearFromText(text: string): string | undefined {
  if (!text) return undefined;
  const m = text.match(YEAR_RE);
  return m ? m[1] : undefined;
}

// Scan for a full date dd.mm.yyyy or yyyy-mm-dd.
const FULLDATE_RE = /\b(\d{1,2}\.\d{1,2}\.\d{4})\b/;
const ISODATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
export function extractFullDateFromText(text: string): string | undefined {
  if (!text) return undefined;
  const m = text.match(FULLDATE_RE);
  if (m) return m[1];
  const iso = text.match(ISODATE_RE);
  if (iso) return `${parseInt(iso[3], 10)}.${parseInt(iso[2], 10)}.${iso[1]}`;
  return undefined;
}

// ─── Pass B helper: extractCaseFieldsFromLedgerSource ────────────────────
// Combine title + citation + snippet + url into a deterministic field set
// for bare-reporter rebuild. No LLM. Returns whatever it could find.
export interface CaseFieldsFromSource {
  prefix?: string;
  docket?: string;
  party1?: string;
  party2?: string;
  year?: string;
  fullDate?: string;
}
export function extractCaseFieldsFromLedgerSource(ls: {
  title?: string;
  citation?: string;
  snippet?: string;
  url?: string;
}): CaseFieldsFromSource {
  const out: CaseFieldsFromSource = {};
  const titleText = ls.title || "";
  const citationText = ls.citation || "";
  const snippetText = ls.snippet || "";
  // Docket: title preferred, then citation, then snippet.
  for (const src of [titleText, citationText, snippetText]) {
    if (out.docket) break;
    const dk = extractDocketFromText(src);
    if (dk) { out.prefix = dk.prefix; out.docket = dk.docket; }
  }
  // Parties: title preferred, then snippet, then citation.
  for (const src of [titleText, snippetText, citationText]) {
    if (out.party1 && out.party2) break;
    const p = extractPartiesFromText(src);
    if (p) { out.party1 = p.party1; out.party2 = p.party2; }
  }
  // Year / date: citation preferred (often "(1995)"), then snippet, then title.
  for (const src of [citationText, snippetText, titleText]) {
    if (!out.fullDate) {
      const d = extractFullDateFromText(src);
      if (d) out.fullDate = d;
    }
    if (!out.year) {
      const y = extractYearFromText(src);
      if (y) out.year = y;
    }
  }
  return out;
}

// ─── Journal-article pipe-artifact handling ──────────────────────────────
// Some upstream fetchers emit composite labels like
//   `כותרת המאמר | שם המחבר (כרך)` or `כותרת | מחבר | 2018`.
// Detect and split deterministically. Returns null if not a pipe artifact.
const PIPE_RE = /\s\|\s/;
export function isPipeArtifact(text: string): boolean {
  return PIPE_RE.test(text || "");
}

export interface PipeParseResult {
  title?: string;
  author?: string;
  volume?: string;
  year?: string;
  /** True when we recovered at least title + (author OR year). */
  ok: boolean;
}

export function parsePipeArtifact(text: string): PipeParseResult {
  if (!text || !isPipeArtifact(text)) return { ok: false };
  const parts = text.split(PIPE_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false };
  const out: PipeParseResult = { ok: false };
  out.title = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    // Volume often appears as "(N)" or "כרך N".
    const volM = p.match(/\((\d+)\)|כרך\s+([\dא-ת]+)/);
    if (volM) out.volume = volM[1] || volM[2];
    // Year — 4 digits.
    const yM = p.match(YEAR_RE);
    if (yM && !out.year) out.year = yM[1];
    // Otherwise treat as author if not yet set and not pure numeric.
    if (!out.author && !/^\d+$/.test(p) && !volM) {
      out.author = p.replace(/\s*\(\d+\)\s*$/, "").trim();
    }
  }
  out.ok = !!(out.title && (out.author || out.year));
  return out;
}

