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
const PREFIX_TABLE: PrefixDef[] = [
  { slug: "bagatz", canonicalHe: 'בג"ץ', he: ['בג"ץ', "בג״ץ", "בגץ"], en: ["HCJ"] },
  { slug: "dngz", canonicalHe: 'דנג"ץ', he: ['דנג"ץ', "דנג״ץ"], en: ["FHHCJ"] },
  { slug: "aa", canonicalHe: 'ע"א', he: ['ע"א', "ע״א"], en: ["CA"] },
  { slug: "ap", canonicalHe: 'ע"פ', he: ['ע"פ', "ע״פ"], en: ["CrimA"] },
  { slug: "raa", canonicalHe: 'רע"א', he: ['רע"א', "רע״א"], en: ["LCA"] },
  { slug: "rap", canonicalHe: 'רע"פ', he: ['רע"פ', "רע״פ"], en: ["LCrimA"] },
  { slug: "aam", canonicalHe: 'עע"מ', he: ['עע"מ', "עע״מ"], en: ["AAA"] },
  { slug: "am", canonicalHe: 'ע"מ', he: ['ע"מ', "ע״מ"] },
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
