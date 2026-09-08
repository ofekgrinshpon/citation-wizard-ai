/**
 * legal-research-v2 — deterministic SOURCE IDENTITY evidence.
 *
 * Two different verification jobs must never be confused:
 *
 *   SOURCE IDENTITY  — "this stored body really is בע\"מ 4623/04 / article X".
 *   CLAIM EVIDENCE   — "this passage supports proposition Z".
 *
 * This module only serves the first one. It derives a small, bounded, LITERAL
 * window from the stored body (caption / docket / parties / court, or academic
 * front matter) and answers identity questions against the WHOLE stored body,
 * so identity never fails merely because the identifying text sits outside the
 * substantive excerpt the agent happened to read.
 *
 * Everything here is deterministic. No model, no similarity, no URL trust:
 * search metadata may help FIND a document, it can never VERIFY one.
 */

const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u00ad\ufeff]/g;
const QUOTES = /[\u05f4\u201c\u201d\u201e\u2033"]/g; // ״ “ ” „ ″ "
const APOS = /[\u05f3\u2018\u2019\u02bc'`]/g; // ׳ ‘ ’ ʼ ' `
const DASHES = /[\u05be\u2010-\u2015\u2212-]/g; // maqaf, hyphens, dashes
const SPACES = /[\u00a0\u2000-\u200a\u202f\u205f\u3000\t]/g;

/** Safe, lossless-for-comparison normalization. The original text is kept. */
export function normalizeIdentityText(raw: string): string {
  return (raw ?? "")
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(SPACES, " ")
    .replace(QUOTES, '"')
    .replace(APOS, "'")
    .replace(DASHES, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comparison form: normalized, with quotes/apostrophes/dashes dropped entirely. */
export function identityKey(raw: string): string {
  return normalizeIdentityText(raw).replace(/["'\-.]/g, "").replace(/\s+/g, " ").trim();
}

export const DOCKET_NUMBER_RE = /\d{1,6}\s*\/\s*\d{2,4}/;

/**
 * Canonical docket key: prefix letters without punctuation + bare number.
 * בע"מ 4623/04 · בע״מ 4623/04 · בעמ 4623/04 · בע'מ 4623 / 04 → "בעמ 4623/04"
 */
export function normalizeDocketKey(raw: string): string | null {
  const norm = normalizeIdentityText(raw);
  const num = norm.match(DOCKET_NUMBER_RE)?.[0]?.replace(/\s+/g, "");
  if (!num) return null;
  const prefix = identityKey(norm.slice(0, norm.indexOf(num.split("/")[0])))
    .replace(/[^\u0590-\u05ff\w ]/g, "")
    .trim()
    .split(/\s+/)
    .pop() ?? "";
  return `${prefix} ${num}`.trim();
}

/** Bare docket number (no prefix), e.g. "4623/04". */
export function docketNumberOf(raw: string): string | null {
  return normalizeIdentityText(raw).match(DOCKET_NUMBER_RE)?.[0]?.replace(/\s+/g, "") ?? null;
}

/**
 * Does the stored body itself establish this docket? Prefix variants and
 * spacing/quote differences are tolerated; the NUMBER must be literally there.
 */
export function bodyHasDocket(body: string, docket: string): boolean {
  const num = docketNumberOf(docket);
  if (!num) return false;
  const nBody = normalizeIdentityText(body).replace(/\s*\/\s*/g, "/");
  if (!nBody.includes(num)) return false;
  const key = normalizeDocketKey(docket);
  const prefix = key?.split(" ")[0] ?? "";
  if (!prefix) return true;
  // Prefix, if the caller supplied one, must appear near an occurrence of the number.
  const flat = identityKey(nBody).replace(/\s*\/\s*/g, "/");
  let at = flat.indexOf(num);
  while (at >= 0) {
    if (flat.slice(Math.max(0, at - 24), at).includes(prefix)) return true;
    at = flat.indexOf(num, at + 1);
  }
  return false;
}

const TITLE_STOPWORDS = new Set([
  "של","על","עם","או","גם","אל","כי","זה","היא","הוא","אשר","בין","לפי","the","and","for","with","from","that","this",
]);

/** Material words of a title: content-bearing tokens only. */
export function titleTokens(title: string): string[] {
  return identityKey(title)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !TITLE_STOPWORDS.has(w));
}

/**
 * Bounded title matching for academic sources: identity passes only when every
 * material title word is LITERALLY present in the document body (line breaks
 * inside the printed title are therefore harmless).
 */
export function bodyHasTitle(
  body: string,
  title: string,
  opts: { minTokens?: number } = {},
): { ok: boolean; matched: string[]; missing: string[] } {
  const tokens = titleTokens(title);
  const flat = identityKey(body);
  const matched: string[] = [];
  const missing: string[] = [];
  for (const t of tokens) (flat.includes(t) ? matched : missing).push(t);
  const minTokens = opts.minTokens ?? 2;
  return { ok: tokens.length >= minTokens && missing.length === 0, matched, missing };
}

export type IdentityKind = "judgment" | "academic" | "statute" | "unknown";

export interface IdentityEvidence {
  kind: IdentityKind;
  /** Literal text copied from the acquired body. Identity proof only. */
  window: string;
  /** Deterministic identity signals found in the body. */
  signals: string[];
}

const COURT_NAMES = [
  "בית המשפט העליון",
  "בית המשפט המחוזי",
  "בית משפט לענייני משפחה",
  "בית המשפט לענייני משפחה",
  "בית הדין הרבני הגדול",
  "בית הדין הרבני האזורי",
  "בית הדין הארצי לעבודה",
  "בית הדין האזורי לעבודה",
  "בית משפט השלום",
];

const JOURNAL_HINTS = ["משפטים", "עיוני משפט", "המשפט", "משפט ועסקים", "מחקרי משפט", "דין ודברים", "law review", "journal"];
const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i;
const PARTIES_RE = /([^\n]{2,60}?)\s+נ['׳]\s+([^\n]{2,60})/;
const AUTHOR_RE = /^[\u0590-\u05ff' "\-]{2,40}\*?$/;

export const IDENTITY_WINDOW_CHARS = 900;

/**
 * Derive the identity window from the acquired body. Judgments identify
 * themselves in the caption/first page; academic work in its front matter.
 * Always literal text — never a description, never model output.
 */
export function extractIdentityEvidence(text: string, title = ""): IdentityEvidence {
  const body = text ?? "";
  const head = body.slice(0, 6_000);
  const nHead = normalizeIdentityText(head);
  const signals: string[] = [];

  const docket = nHead.match(DOCKET_NUMBER_RE)?.[0]?.replace(/\s+/g, "") ?? null;
  if (docket) signals.push(`docket:${docket}`);
  const court = COURT_NAMES.find((c) => nHead.includes(c));
  if (court) signals.push(`court:${court}`);
  const parties = nHead.match(PARTIES_RE);
  if (parties) signals.push(`parties:${parties[0].slice(0, 80).trim()}`);
  const doi = head.match(DOI_RE)?.[0];
  if (doi) signals.push(`doi:${doi}`);
  const journal = JOURNAL_HINTS.find((j) => nHead.toLowerCase().includes(j.toLowerCase()));
  if (journal) signals.push(`publication:${journal}`);
  const author = head
    .split("\n")
    .map((l) => l.trim())
    .slice(0, 40)
    .find((l) => l.length >= 4 && l.length <= 40 && AUTHOR_RE.test(l) && /\s/.test(l));
  if (author && !docket) signals.push(`author_line:${author}`);

  // Window: the caption region around the docket for judgments, otherwise the
  // document's front matter. Both are verbatim slices of the stored body.
  let window: string;
  if (docket) {
    const at = head.indexOf(docket.split("/")[0]);
    const from = Math.max(0, at - 300);
    window = head.slice(from, from + IDENTITY_WINDOW_CHARS);
  } else {
    window = head.slice(0, IDENTITY_WINDOW_CHARS);
  }

  const kind: IdentityKind = docket || court || parties
    ? "judgment"
    : doi || journal || author
    ? "academic"
    : /חוק\s|תקנות\s|פקודת\s/.test(nHead) || /חוק|תקנות/.test(normalizeIdentityText(title))
    ? "statute"
    : "unknown";

  return { kind, window: window.trim(), signals };
}
