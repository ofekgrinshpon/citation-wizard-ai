// Deterministic Knesset-term resolution.
//
// Rule-15 decision citations sometimes name the Knesset term ("הכנסת ה-12").
// The drafting model has no grounded source for that ordinal and will invent
// one (the Harari decision of 13.6.1950 was rendered as "הכנסת ה-12" when it
// belongs to the First Knesset). The term is a pure function of the decision
// date, so it is derived here and never taken from the model.
//
// Dates are the swearing-in date of each Knesset; a term runs until the day
// before the next Knesset is sworn in.

export interface KnessetTerm {
  /** Ordinal number of the Knesset (1-based). */
  ordinal: number;
  /** ISO date the Knesset was sworn in. */
  start: string;
  /** ISO date the following Knesset was sworn in, or null for the current one. */
  end: string | null;
}

/** Provisional State Council: 14.5.1948 until the First Knesset convened. */
export const PROVISIONAL_COUNCIL = {
  start: "1948-05-14",
  end: "1949-02-14",
  label: "מועצת המדינה הזמנית",
} as const;

export const KNESSET_TERMS: KnessetTerm[] = [
  { ordinal: 1, start: "1949-02-14", end: "1951-08-20" },
  { ordinal: 2, start: "1951-08-20", end: "1955-08-15" },
  { ordinal: 3, start: "1955-08-15", end: "1959-11-30" },
  { ordinal: 4, start: "1959-11-30", end: "1961-09-04" },
  { ordinal: 5, start: "1961-09-04", end: "1965-11-22" },
  { ordinal: 6, start: "1965-11-22", end: "1969-11-17" },
  { ordinal: 7, start: "1969-11-17", end: "1974-01-21" },
  { ordinal: 8, start: "1974-01-21", end: "1977-06-13" },
  { ordinal: 9, start: "1977-06-13", end: "1981-07-20" },
  { ordinal: 10, start: "1981-07-20", end: "1984-08-13" },
  { ordinal: 11, start: "1984-08-13", end: "1988-11-21" },
  { ordinal: 12, start: "1988-11-21", end: "1992-07-13" },
  { ordinal: 13, start: "1992-07-13", end: "1996-06-17" },
  { ordinal: 14, start: "1996-06-17", end: "1999-06-07" },
  { ordinal: 15, start: "1999-06-07", end: "2003-02-17" },
  { ordinal: 16, start: "2003-02-17", end: "2006-04-17" },
  { ordinal: 17, start: "2006-04-17", end: "2009-02-24" },
  { ordinal: 18, start: "2009-02-24", end: "2013-02-05" },
  { ordinal: 19, start: "2013-02-05", end: "2015-03-31" },
  { ordinal: 20, start: "2015-03-31", end: "2019-04-30" },
  { ordinal: 21, start: "2019-04-30", end: "2019-10-03" },
  { ordinal: 22, start: "2019-10-03", end: "2020-03-16" },
  { ordinal: 23, start: "2020-03-16", end: "2021-04-06" },
  { ordinal: 24, start: "2021-04-06", end: "2022-11-15" },
  { ordinal: 25, start: "2022-11-15", end: null },
];

/** Hebrew ordinal spellings used in citations, e.g. "הכנסת השלוש-עשרה". */
const HEBREW_ORDINALS: Record<number, string> = {
  1: "הראשונה",
  2: "השנייה",
  3: "השלישית",
  4: "הרביעית",
  5: "החמישית",
  6: "השישית",
  7: "השביעית",
  8: "השמינית",
  9: "התשיעית",
  10: "העשירית",
};

/**
 * Parse a Hebrew-style date: d.m.yyyy / dd.mm.yyyy, also tolerating
 * "13/6/1950" and "13.6.50" (two-digit years are rejected as ambiguous).
 */
export function parseDecisionDate(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1948 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso;
}

/**
 * Resolve the Knesset term ordinal for a date. Returns null when the date is
 * unparsable, precedes the First Knesset, or falls outside the table.
 */
export function knessetTermForDate(rawDate: string): number | null {
  const iso = parseDecisionDate(rawDate);
  if (!iso) return null;
  for (const t of KNESSET_TERMS) {
    if (iso >= t.start && (t.end === null || iso < t.end)) return t.ordinal;
  }
  return null;
}

/** True when the date falls in the Provisional State Council period. */
export function isProvisionalCouncilDate(rawDate: string): boolean {
  const iso = parseDecisionDate(rawDate);
  if (!iso) return false;
  return iso >= PROVISIONAL_COUNCIL.start && iso < PROVISIONAL_COUNCIL.end;
}

/** Render "הכנסת ה-13" / "הכנסת הראשונה" style labels. */
export function knessetLabel(ordinal: number, style: "numeric" | "hebrew" = "numeric"): string {
  if (style === "hebrew" && HEBREW_ORDINALS[ordinal]) {
    return `הכנסת ${HEBREW_ORDINALS[ordinal]}`;
  }
  return `הכנסת ה-${ordinal}`;
}

/**
 * Matches a Knesset ordinal in drafted text:
 *   "הכנסת ה-12", "הכנסת ה12", "הכנסת ה־12", "הכנסת השלישית"
 */
const NUMERIC_TERM_RE = /הכנסת\s+ה[־\-]?\s*(\d{1,2})/g;
const HEBREW_TERM_RE = new RegExp(
  `הכנסת\\s+(${Object.values(HEBREW_ORDINALS).join("|")})`,
  "g",
);

export interface TermNormalizationResult {
  text: string;
  /** What happened, for telemetry. */
  action: "none" | "corrected" | "stripped";
  claimed: number | null;
  resolved: number | null;
}

function hebrewOrdinalToNumber(word: string): number | null {
  for (const [k, v] of Object.entries(HEBREW_ORDINALS)) {
    if (v === word) return Number(k);
  }
  return null;
}

/**
 * Post-response guard. When a drafted citation names a Knesset term:
 *  - if the line carries a full date, recompute the term and correct a mismatch;
 *  - if there is no date to anchor it, remove the ordinal rather than leave an
 *    unverifiable claim ("הכנסת ה-12" → "הכנסת").
 */
export function normalizeKnessetTerm(line: string): TermNormalizationResult {
  if (!/הכנסת\s+ה/.test(line)) {
    return { text: line, action: "none", claimed: null, resolved: null };
  }

  let claimed: number | null = null;
  NUMERIC_TERM_RE.lastIndex = 0;
  const numericMatch = NUMERIC_TERM_RE.exec(line);
  HEBREW_TERM_RE.lastIndex = 0;
  const hebrewMatch = HEBREW_TERM_RE.exec(line);
  const style: "numeric" | "hebrew" = numericMatch ? "numeric" : "hebrew";

  if (numericMatch) claimed = Number(numericMatch[1]);
  else if (hebrewMatch) claimed = hebrewOrdinalToNumber(hebrewMatch[1]);

  if (claimed === null) {
    return { text: line, action: "none", claimed: null, resolved: null };
  }

  const dateMatch = line.match(/\d{1,2}[./-]\d{1,2}[./-]\d{4}/);
  const resolved = dateMatch ? knessetTermForDate(dateMatch[0]) : null;

  const replaceTerm = (replacement: string): string => {
    NUMERIC_TERM_RE.lastIndex = 0;
    HEBREW_TERM_RE.lastIndex = 0;
    return line
      .replace(NUMERIC_TERM_RE, replacement)
      .replace(HEBREW_TERM_RE, replacement);
  };

  if (resolved === null) {
    // No verified date to anchor the ordinal — drop it.
    return {
      text: replaceTerm("הכנסת").replace(/\s{2,}/g, " "),
      action: "stripped",
      claimed,
      resolved: null,
    };
  }

  if (resolved === claimed) {
    return { text: line, action: "none", claimed, resolved };
  }

  return {
    text: replaceTerm(knessetLabel(resolved, style)),
    action: "corrected",
    claimed,
    resolved,
  };
}
