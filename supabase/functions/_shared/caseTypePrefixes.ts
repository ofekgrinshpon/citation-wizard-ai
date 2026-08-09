/**
 * Hebrew court case-type prefix dictionary.
 * Source: BIU "קיצורים של סוגי הליכים" (annex to Uniform Citation Rules):
 * https://law.biu.ac.il/sites/law/files/shared/qytsvrym_shl_svgy_hlykym.pdf
 *
 * Canonical entries use ASCII `"` and `'`. The regex builder expands them so
 * the produced pattern accepts ASCII (`"` `'`) and Hebrew typographic
 * gershayim/geresh (`״` U+05F4, `׳` U+05F3) interchangeably.
 */

export const CASE_TYPE_PREFIXES: readonly string[] = [
  // 4+ letter
  'דנג"ץ', 'בשג"ץ', 'תהוצל"פ', 'ענמ"ש', 'עבמ"ץ', 'עחה"ס',
  // 3-letter
  'בג"ץ', 'בד"א', 'בד"ם', 'בה"נ', 'בע"ם', 'בפ"מ', 'בפ"ת',
  'בר"ם', 'בר"ע', 'בר"ש', 'בש"א', 'בש"ם', 'בש"פ', 'בש"ע',
  'דב"ע', 'דנ"א', 'דנ"מ', 'דנ"פ',
  'הפ"ב', 'מק"מ',
  'סב"א', 'סק"ב', 'סע"ש', 'תע"א',
  'עא"ח', 'עב"ל', 'עד"י', 'עד"מ', 'על"ע',
  'עמ"ה', 'עמ"ח', 'עמ"י', 'עמ"מ', 'עמ"נ', 'עמ"ק', 'עמ"ש',
  'עס"ק', 'עע"א', 'עע"ם', 'עע"מ',
  'עפ"א', 'עפ"ג', 'עפ"ס', 'עק"מ', 'עק"נ', 'עק"פ', 'ער"מ',
  'עש"א', 'עש"מ', 'עש"ר', 'עש"ת',
  'עת"א', 'עת"מ', 'פל"ע', 'פש"ר',
  'רמ"ש', 'רע"א', 'רע"ב', 'רע"פ', 'רצ"פ', 'רת"ק',
  'תא"מ', 'תא"פ', 'תא"ק', 'תא"ר',
  'תב"כ', 'תב"מ', 'תב"ע', 'תב"ר',
  'תה"ג', 'תה"ס', 'תח"ח', 'תח"פ',
  'תי"א', 'תי"פ', 'תמ"ש', 'תפ"ח', 'תר"מ', 'תת"ח', 'תת"ע',
  'חס"מ', 'אפ"ח',
  // 2-letter
  'א"ב', 'א"צ', 'ב"ל', 'ב"ק', 'ב"ש', 'ג"ז', 'ד"ט', 'ד"מ', 'ד"נ',
  'ה"כ', 'ה"נ', 'ה"ע', 'ה"פ', 'ה"ת', 'ו"ע', 'ח"א', 'ח"ד', 'ח"ש', 'י"ס',
  'מ"א', 'מ"ח', 'מ"י', 'מ"מ', 'מ"ת', 'נ"ב', 'ס"ע', 'ס"ק',
  'ע"א', 'ע"ב', 'ע"ו', 'ע"מ', 'ע"פ', 'ע"ע', 'ע"ר', 'ע"ש',
  'פ"א', 'פ"ה', 'פ"מ', 'פ"פ', 'צ"ה', 'צ"ו', 'ק"ג', 'ק"פ', 'ר"ע',
  'ש"ע', 'ש"ש',
  'ת"א', 'ת"ד', 'ת"ט', 'ת"מ', 'ת"ע', 'ת"פ', 'ת"צ', 'ת"ק', 'ת"ת',
  // Apostrophe-suffix
  "ע'", "אפ'", "עז'", "עב'", "פל'", "פר'", "המ'", "גזז'",
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build alternation source. Sorted longest-first so `בר"ם` beats `ב"ר` and
 * `סע"ש` beats `ס"ע`. Expand `"` → `["״]` and `'` → `['׳]`.
 */
export function buildPrefixAlternation(): string {
  const sorted = [...CASE_TYPE_PREFIXES].sort((a, b) => b.length - a.length);
  return sorted
    .map((p) =>
      escapeRegex(p)
        .replace(/"/g, '["״]')
        .replace(/'/g, "['׳]")
    )
    .join("|");
}

/** Full docket: prefix + space + number/year. Cap1=prefix, cap2=docket. */
export const CASE_DOCKET_RE = new RegExp(
  `(${buildPrefixAlternation()})\\s+([0-9]+[\\/\\-][0-9]+(?:[\\/\\-][0-9]+)?)`
);

/** Just the prefix — for free-text input validation. */
export const CASE_TYPE_PREFIX_RE = new RegExp(`(?:${buildPrefixAlternation()})`);

/**
 * Bare docket (no case-type prefix), e.g. "5555/18" or "50358-09-16".
 * Only used as a FALLBACK when CASE_DOCKET_RE finds nothing — users often
 * paste "5555/18 חסון נ' כנסת ישראל" without the בג"ץ prefix, and without
 * this the input degrades to a party-name search that can return a
 * different case entirely.
 *
 * Guards (see findBareDocket): rejects matches preceded by a
 * pinpoint/section marker (ס', סעיף, עמ', פס', ה"ש, תק'), and rejects the
 * two-part dashed form (which is usually a page/paragraph range like 4-6).
 */
const BARE_DOCKET_SLASH_RE = /(?<![\d\/\-.])(\d{1,6}\/\d{2,4})(?![\d\/\-])/;
const BARE_DOCKET_DASH_RE = /(?<![\d\/\-.])(\d{1,6}-\d{1,2}-\d{2,4})(?![\d\/\-])/;

const PINPOINT_MARKER_RE =
  /(?:ס['׳]|סעיף|סע['׳]|עמ['׳]|עמוד|פס['׳]|פסקה|ה["״]ש|תק['׳]|תקנה|כרך|חלק)\s*$/;

export interface BareDocketMatch {
  /** The bare docket string, e.g. "5555/18". */
  docket: string;
  /** Index of the docket inside the searched text. */
  index: number;
}

/**
 * Find a bare docket in free text, applying the pinpoint-marker guard.
 * Returns null when nothing safe was found.
 */
export function findBareDocket(text: string): BareDocketMatch | null {
  for (const re of [BARE_DOCKET_SLASH_RE, BARE_DOCKET_DASH_RE]) {
    const g = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = g.exec(text)) !== null) {
      const before = text.slice(Math.max(0, m.index - 12), m.index);
      if (PINPOINT_MARKER_RE.test(before)) continue;
      return { docket: m[1], index: m.index };
    }
  }
  return null;
}

