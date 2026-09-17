// Deterministic Israeli case-docket detection.
//
// Scans free text for docket references (Hebrew or English aliases) and
// returns normalized DocketRef records that the required-anchor mechanism
// uses to force retrieval of the judgment itself.

export interface DocketRef {
  /** Stable slug for anchor_id, e.g. "bagatz-5555-18". */
  docket_id: string;
  /** Canonical Hebrew prefix, e.g. `בג"ץ`. */
  prefix_he: string;
  /** Optional English alias if the docket type is commonly known in English. */
  prefix_en?: string;
  /** Docket number normalized with `/` (e.g. "5555/18"). */
  number: string;
  /** All string variants that should match this docket at retrieval time. */
  variants: string[];
}

interface PrefixDef {
  slug: string;
  canonicalHe: string;
  he: string[];        // Hebrew forms (ASCII quote, gershayim, no-quote, etc.)
  en?: string[];       // English aliases (e.g. HCJ)
}

// Curated list; covers all common Supreme Court, appellate, and district
// docket types the pipeline encounters. Additive — add more as needed.
export const PREFIX_TABLE: PrefixDef[] = [
  { slug: "bagatz", canonicalHe: 'בג"ץ', he: ['בג"ץ', "בג״ץ", "בגץ"], en: ["HCJ"] },
  { slug: "dngz", canonicalHe: 'דנג"ץ', he: ['דנג"ץ', "דנג״ץ"], en: ["FHHCJ"] },
  { slug: "aa", canonicalHe: 'ע"א', he: ['ע"א', "ע״א"], en: ["CA"] },
  { slug: "ap", canonicalHe: 'ע"פ', he: ['ע"פ', "ע״פ"], en: ["CrimA"] },
  { slug: "raa", canonicalHe: 'רע"א', he: ['רע"א', "רע״א"], en: ["LCA"] },
  { slug: "rap", canonicalHe: 'רע"פ', he: ['רע"פ', "רע״פ"], en: ["LCrimA"] },
  { slug: "aam", canonicalHe: 'עע"מ', he: ['עע"מ', "עע״מ", 'עע"ם', "עע״ם"], en: ["AAA"] },
  { slug: "am", canonicalHe: 'ע"מ', he: ['ע"מ', "ע״מ"] },
  { slug: "atm", canonicalHe: 'עת"ם', he: ['עת"ם', "עת״ם", 'עת"מ', "עת״מ"] },
  { slug: "ahas", canonicalHe: 'עה"ס', he: ['עה"ס', "עה״ס", "עהס"], en: ["HCJAdmin"] },
  { slug: "dna", canonicalHe: 'דנ"א', he: ['דנ"א', "דנ״א"], en: ["FH"] },
  { slug: "dnp", canonicalHe: 'דנ"פ', he: ['דנ"פ', "דנ״פ"] },
  { slug: "bshp", canonicalHe: 'בש"פ', he: ['בש"פ', "בש״פ"] },
  { slug: "bsha", canonicalHe: 'בש"א', he: ['בש"א', "בש״א"] },
  { slug: "tpc", canonicalHe: 'תפ"ח', he: ['תפ"ח', "תפ״ח"] },
  { slug: "tms", canonicalHe: 'תמ"ש', he: ['תמ"ש', "תמ״ש"] },
  { slug: "rms", canonicalHe: 'רמ"ש', he: ['רמ"ש', "רמ״ש"] },
  { slug: "brm", canonicalHe: 'בר"ם', he: ['בר"ם', "בר״ם"] },
  { slug: "brv", canonicalHe: 'בר"ע', he: ['בר"ע', "בר״ע"] },
  { slug: "hp", canonicalHe: 'ה"פ', he: ['ה"פ', "ה״פ"] },
  { slug: "ta", canonicalHe: 'ת"א', he: ['ת"א', "ת״א"] },
  { slug: "tap", canonicalHe: 'ת"פ', he: ['ת"פ', "ת״פ"] },
  { slug: "hpb", canonicalHe: 'הפ"ב', he: ['הפ"ב', "הפ״ב"] },

  // Labour-court and administrative forms. Added because the corpus and the
  // acceptance benchmark contain them (e.g. ע"ע 478/09) and their absence made
  // a genuine labour judgment unrecognizable as a docket-bearing judgment.
  { slug: "ee", canonicalHe: 'ע"ע', he: ['ע"ע', "ע״ע"] },
  { slug: "avl", canonicalHe: 'עב"ל', he: ['עב"ל', "עב״ל"] },
  { slug: "esk", canonicalHe: 'עס"ק', he: ['עס"ק', "עס״ק"] },
  { slug: "sk", canonicalHe: 'ס"ק', he: ['ס"ק', "ס״ק"] },
  { slug: "sesh", canonicalHe: 'סע"ש', he: ['סע"ש', "סע״ש"] },
  { slug: "ab", canonicalHe: 'ע"ב', he: ['ע"ב', "ע״ב"] },
  { slug: "amn", canonicalHe: 'עמ"נ', he: ['עמ"נ', "עמ״נ"] },
  { slug: "ams", canonicalHe: 'עמ"ש', he: ['עמ"ש', "עמ״ש"] },
];

// Build a single Hebrew alternation. Prefixes with ASCII `"` or Hebrew `״`
// may appear literally; the no-quote form (e.g. `בגץ`) also matches.
const HEB_PREFIX_ALT = PREFIX_TABLE.flatMap((p) => p.he).map(escapeRe).sort((a, b) => b.length - a.length).join("|");
const EN_PREFIX_ALT = PREFIX_TABLE.flatMap((p) => p.en ?? []).map(escapeRe).sort((a, b) => b.length - a.length).join("|");

// Optional court descriptor between prefix and docket number, e.g.
// ע"מ (מחוזי ת"א) 61908-05-19. We do not include it in the normalized docket;
// it is only tolerated so the actual docket anchor is not missed.
const COURT_DESCRIPTOR_RE_SRC = String.raw`(?:\s*\([^)]{1,40}\))?`;

// Number shapes we accept:  1234/56, 1234-56, 39040-12-21
const NUM_RE_SRC = String.raw`\d{1,6}(?:[\/\-]\d{1,4}){1,2}`;

const HEB_DOCKET_RE = new RegExp(`(${HEB_PREFIX_ALT})${COURT_DESCRIPTOR_RE_SRC}\\s*(${NUM_RE_SRC})`, "g");

// Un-punctuated forms users type in free text (`בגץ 5555/18`, `עא 6821/93`).
// Deliberately narrow: only distinctive abbreviations, and only when not glued
// to another Hebrew word (a single attached prefix letter ב/ל/ו/ה/ש/כ/מ is ok).
const NOQUOTE_MAP: Record<string, string> = {
  "בגץ": 'בג"ץ',
  "דנגץ": 'דנג"ץ',
  "עא": 'ע"א',
  "עפ": 'ע"פ',
  "רעא": 'רע"א',
  "רעפ": 'רע"פ',
  "עעם": 'עע"מ',
  "עעמ": 'עע"מ',
  "עתם": 'עת"ם',
  "עתמ": 'עת"ם',
  "דנא": 'דנ"א',
  "דנפ": 'דנ"פ',
  "בשפ": 'בש"פ',
  "בשא": 'בש"א',
  "תמש": 'תמ"ש',
  "ברם": 'בר"ם',
  "עהס": 'עה"ס',
  "עע": 'ע"ע',
  "עבל": 'עב"ל',
  "סעש": 'סע"ש',
  "עמנ": 'עמ"נ',
  "עמש": 'עמ"ש',
};
const NOQUOTE_ALT = Object.keys(NOQUOTE_MAP)
  .sort((a, b) => b.length - a.length)
  .map(escapeRe)
  .join("|");
const NOQUOTE_DOCKET_RE = new RegExp(
  `(?<![\\u0590-\\u05FF])[\u05D1\u05DC\u05D5\u05D4\u05E9\u05DB\u05DE]?(${NOQUOTE_ALT})${COURT_DESCRIPTOR_RE_SRC}\\s*(${NUM_RE_SRC})`,
  "g",
);
const EN_DOCKET_RE = new RegExp(`\\b(${EN_PREFIX_ALT})\\s*(${NUM_RE_SRC})\\b`, "gi");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findPrefixDef(raw: string): PrefixDef | undefined {
  const r = raw.trim();
  for (const p of PREFIX_TABLE) {
    if (p.he.includes(r)) return p;
    if (p.en?.some((e) => e.toLowerCase() === r.toLowerCase())) return p;
  }
  return undefined;
}

function normalizeNumber(n: string): string {
  // Prefer canonical `/`-separated form for display, `-`-separated for slug.
  return n.replace(/-/g, "/");
}

function buildVariants(def: PrefixDef, number: string): string[] {
  const nSlash = number.replace(/-/g, "/");
  const nDash = number.replace(/\//g, "-");
  const out = new Set<string>();
  for (const h of def.he) {
    out.add(`${h} ${nSlash}`);
    out.add(`${h} ${nDash}`);
    out.add(`${h}${nSlash}`);
  }
  for (const e of def.en ?? []) {
    out.add(`${e} ${nSlash}`);
    out.add(`${e} ${nDash}`);
  }
  // Number-only variant, useful for URL/citation string search
  // (retrieval scopes it to case rows to avoid false positives).
  out.add(nSlash);
  out.add(nDash);
  return [...out];
}

/** Detect all dockets in a piece of free text. De-duplicated by docket_id. */
export function detectDockets(text: string): DocketRef[] {
  const src = String(text ?? "");
  if (!src) return [];
  const found = new Map<string, DocketRef>();

  const push = (prefixRaw: string, numberRaw: string) => {
    const def = findPrefixDef(prefixRaw);
    if (!def) return;
    const number = normalizeNumber(numberRaw);
    const docket_id = `${def.slug}-${number.replace(/\//g, "-")}`;
    if (found.has(docket_id)) return;
    const en = def.en?.[0];
    found.set(docket_id, {
      docket_id,
      prefix_he: def.canonicalHe,
      prefix_en: en,
      number,
      variants: buildVariants(def, number),
    });
  };

  for (const m of src.matchAll(HEB_DOCKET_RE)) push(m[1], m[2]);
  for (const m of src.matchAll(EN_DOCKET_RE)) push(m[1], m[2]);
  for (const m of src.matchAll(NOQUOTE_DOCKET_RE)) push(NOQUOTE_MAP[m[1]] ?? m[1], m[2]);
  return [...found.values()];
}

/**
 * Convenience: given a candidate's title/snippet/url and a set of docket refs
 * (from the originating query or question), report whether any docket string
 * variant appears verbatim. Case-insensitive for English.
 */
export function candidateMatchesDocket(
  fields: { title?: string | null; snippet?: string | null; url?: string | null },
  dockets: DocketRef[],
): boolean {
  if (dockets.length === 0) return false;
  const hay = `${fields.title ?? ""}\n${fields.snippet ?? ""}\n${fields.url ?? ""}`;
  const hayLower = hay.toLowerCase();
  for (const d of dockets) {
    for (const v of d.variants) {
      if (v.length < 4) continue; // skip pure number-only shorter than 4 chars
      if (/^[A-Za-z]/.test(v)) {
        if (hayLower.includes(v.toLowerCase())) return true;
      } else if (hay.includes(v)) {
        return true;
      }
    }
  }
  return false;
}

// ─── Strict normalized docket matching (specific-case authority resolution) ──
//
// The permissive `candidateMatchesDocket` above accepts any verbatim variant
// anywhere in title/snippet/url. Specific-case mode needs a stricter, quote-
// and-separator-insensitive comparison so that:
//   * `בג"ץ 6698/95`, `בג״ץ 6698/95`, `בגצ 6698/95`, `בג ץ 06698/95`,
//     `HCJ 6698/95` and `בג"ץ 6698-95` all match the same docket;
//   * a mere topical mention inside a commentary snippet does not.

/** Quote/gershayim/whitespace-insensitive normalization of arbitrary text. */
export function normalizeDocketText(s: string): string {
  return String(s ?? "")
    .replace(/[\u0022\u0027\u05F3\u05F4\u2018\u2019\u201C\u201D`´]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Strip leading zeros from each numeric segment: `06698/095` → `6698/95`. */
function stripLeadingZeros(num: string): string {
  return num.split(/[\/\-]/).map((p) => p.replace(/^0+(?=\d)/, "")).join("/");
}

/**
 * Canonical normalized form of a docket: `<slug>:<num-with-slashes-no-zeros>`.
 * Example: `bagatz:6698/95`.
 */
export function normalizedDocketId(d: DocketRef): string {
  const slug = d.docket_id.replace(/-\d.*$/, "");
  return `${slug}:${stripLeadingZeros(d.number)}`;
}

/** All normalized string forms that count as an exact reference to `d`. */
export function normalizedDocketVariants(d: DocketRef): string[] {
  const def = PREFIX_TABLE.find((p) => d.docket_id.startsWith(`${p.slug}-`));
  const prefixes = [
    ...(def ? def.he : [d.prefix_he]),
    ...(def?.en ?? (d.prefix_en ? [d.prefix_en] : [])),
  ].map((p) => normalizeDocketText(p));
  const bare = stripLeadingZeros(d.number);
  const numbers = new Set<string>([bare, bare.replace(/\//g, "-"), bare.replace(/\//g, " / ")]);
  const out = new Set<string>();
  for (const p of new Set(prefixes)) {
    for (const n of numbers) {
      out.add(`${p} ${n}`);
      out.add(`${p}${n}`);
    }
  }
  return [...out];
}

/**
 * Strict exact-docket predicate. Only the fields the caller passes are
 * searched — specific-case mode intentionally passes title/url/citation and
 * NOT commentary snippets.
 */
export function textContainsExactDocket(text: string | null | undefined, d: DocketRef): boolean {
  const raw = String(text ?? "");
  if (!raw) return false;
  // Normalize, then also strip leading zeros inside numbers found in the text.
  const hay = normalizeDocketText(raw).replace(/\b0+(\d)/g, "$1");
  return normalizedDocketVariants(d).some((v) => hay.includes(v));
}

/** Strict variant of `candidateMatchesDocket` over explicit fields. */
export function fieldsContainExactDocket(
  fields: Array<string | null | undefined>,
  dockets: DocketRef[],
): boolean {
  return dockets.some((d) => fields.some((f) => textContainsExactDocket(f, d)));
}

/**
 * Normalized (quote-stripped) proceeding-type tokens for every docket prefix
 * this module knows, e.g. `עא`, `בגץ`, `עע`. Used by authority corroboration
 * to tell "the body carries a DIFFERENT proceeding type" (a contradiction)
 * apart from "the body simply does not repeat the proceeding type here".
 */
export const PROCEEDING_TOKENS: ReadonlySet<string> = new Set(
  PREFIX_TABLE.flatMap((p) => p.he).map((h) =>
    h.replace(/[\u0022\u0027\u05F3\u05F4\u2018\u2019\u201C\u201D]/g, "").toLowerCase()
  ),
);

// ─── Body-only canonical document identity (body_only_identity_v1) ──────────
//
// Authority promotion may never rest on a title, a filename or a discovery
// label: those CLAIM an identity, they do not CONFIRM one. Confirmation may
// come only from the extracted document body, and only from its own identity
// (header) zone — a wrong judgment that merely cites the expected case deep
// inside its text must not inherit that case's identity.
//
// Hebrew PDF extraction frequently reverses token order inside the header, so
// `רע"א 3365/20` arrives as `3365/20 א"ער`. The detector below recognises that
// narrow, deterministic shape from the same prefix table, instead of reversing
// arbitrary text (which would manufacture false identities).

/**
 * Reversed prefix forms, built from the table (never from arbitrary text).
 *
 * Two shapes occur in real Hebrew PDF extraction:
 *   - segment reversal around the gershayim — `רע"א` → `א"רע` (the shape the
 *     production Supreme Court PDFs actually produce);
 *   - full character reversal — `רע"א` → `א"ער`.
 */
const REVERSED_PREFIX_MAP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const QUOTE = /(["\u05F4'\u05F3])/;
  for (const p of PREFIX_TABLE) {
    for (const h of p.he) {
      const forms = new Set<string>();
      forms.add([...h].reverse().join(""));
      const parts = h.split(QUOTE);
      if (parts.length === 3) forms.add(`${parts[2]}${parts[1]}${parts[0]}`);
      for (const f of forms) if (f !== h) map[f] = p.canonicalHe;
    }
  }
  return map;
})();

const REVERSED_PREFIX_ALT = Object.keys(REVERSED_PREFIX_MAP)
  .map(escapeRe)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** `3365/20 א"ער` — number first, prefix characters reversed. */
const REVERSED_DOCKET_RE = new RegExp(
  `(${NUM_RE_SRC})\\s{0,3}(${REVERSED_PREFIX_ALT})(?![\\u0590-\\u05FF])`,
  "g",
);

/** `3365/20 רע"א` — number first, prefix NOT reversed. */
const NUMBER_FIRST_DOCKET_RE = new RegExp(
  `(${NUM_RE_SRC})\\s{0,3}(${HEB_PREFIX_ALT})(?![\\u0590-\\u05FF])`,
  "g",
);

export interface BodyDocketDetection {
  refs: DocketRef[];
  /** A reversed / number-first Hebrew-PDF form contributed at least one ref. */
  reversed_used: boolean;
}

/**
 * Document-body docket detection: the normal detector PLUS the narrowly
 * defined Hebrew-PDF extraction forms. Deliberately NOT used for user
 * questions or search routing — only for confirming what a document IS.
 */
export function detectDocketsInDocumentBody(text: string): BodyDocketDetection {
  const src = String(text ?? "");
  const found = new Map<string, DocketRef>();
  let reversed_used = false;

  for (const ref of detectDockets(src)) found.set(ref.docket_id, ref);

  const pushCanonical = (canonicalHe: string, numberRaw: string) => {
    const def = findPrefixDef(canonicalHe);
    if (!def) return;
    const number = normalizeNumber(numberRaw);
    const docket_id = `${def.slug}-${number.replace(/\//g, "-")}`;
    if (found.has(docket_id)) return;
    found.set(docket_id, {
      docket_id,
      prefix_he: def.canonicalHe,
      prefix_en: def.en?.[0],
      number,
      variants: buildVariants(def, number),
    });
    reversed_used = true;
  };

  for (const m of src.matchAll(REVERSED_DOCKET_RE)) {
    pushCanonical(REVERSED_PREFIX_MAP[m[2]] ?? "", m[1]);
  }
  for (const m of src.matchAll(NUMBER_FIRST_DOCKET_RE)) {
    const def = findPrefixDef(m[2]);
    if (def) pushCanonical(def.canonicalHe, m[1]);
  }

  return { refs: [...found.values()], reversed_used };
}

/** Default identity (header) zone when no page map is available. */
export const IDENTITY_ZONE_CHARS = 4_000;
/** More distinct dockets than this in the header zone ⇒ ambiguous identity. */
export const MAX_PRIMARY_DOCKETS = 3;

export interface PrimaryDocketAssessment {
  /** Canonical ids (`raa:3365/20`) confirmed in the document's identity zone. */
  primary_docket_ids: string[];
  /** Canonical ids anywhere in the body (incidental citations included). */
  body_docket_ids: string[];
  identity_zone_chars: number;
  reversed_pdf_detected: boolean;
  ambiguous: boolean;
}

/**
 * Deterministic assessment of what the document itself IS, from its body only.
 * `identity_zone_chars` should be the end offset of the first extracted page
 * when a page map exists.
 */
export function assessPrimaryDocumentDocket(
  text: string,
  opts: { identity_zone_chars?: number } = {},
): PrimaryDocketAssessment {
  const body = String(text ?? "");
  const zoneEnd = Math.min(
    body.length,
    Math.max(600, opts.identity_zone_chars ?? IDENTITY_ZONE_CHARS),
  );
  const zone = body.slice(0, zoneEnd);

  const full = detectDocketsInDocumentBody(body);
  const head = detectDocketsInDocumentBody(zone);
  const primary = head.refs.map(normalizedDocketId);

  return {
    primary_docket_ids: primary,
    body_docket_ids: full.refs.map(normalizedDocketId),
    identity_zone_chars: zoneEnd,
    reversed_pdf_detected: head.reversed_used || full.reversed_used,
    ambiguous: primary.length > MAX_PRIMARY_DOCKETS,
  };
}

/** Canonical ids for a free-text authority expectation (`רע"א 3365/20`). */
export function canonicalDocketIdsOf(text: string): string[] {
  return detectDockets(String(text ?? "")).map(normalizedDocketId);
}
