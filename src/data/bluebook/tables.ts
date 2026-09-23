/**
 * Bluebook 22 abbreviation tables — isolated data, never logic.
 *
 * Conservative by design: an unknown reporter / court / journal is PRESERVED
 * as given. We never guess an abbreviation.
 *
 * Sources used: public/open citation references (Cornell Basic Legal Citation,
 * the Indigo Book, official court and journal self-descriptions). No
 * copyrighted Bluebook prose is reproduced here.
 */

/** Canonical spelling of common U.S. reporters, keyed by a normalized form. */
export const US_REPORTERS: Record<string, string> = {
  "us": "U.S.",
  "sct": "S. Ct.",
  "led": "L. Ed.",
  "led2d": "L. Ed. 2d",
  "f": "F.",
  "f2d": "F.2d",
  "f3d": "F.3d",
  "f4th": "F.4th",
  "fsupp": "F. Supp.",
  "fsupp2d": "F. Supp. 2d",
  "fsupp3d": "F. Supp. 3d",
  "fappx": "F. App'x",
  "frd": "F.R.D.",
  "a": "A.",
  "a2d": "A.2d",
  "a3d": "A.3d",
  "ne": "N.E.",
  "ne2d": "N.E.2d",
  "ne3d": "N.E.3d",
  "nw": "N.W.",
  "nw2d": "N.W.2d",
  "p": "P.",
  "p2d": "P.2d",
  "p3d": "P.3d",
  "se": "S.E.",
  "se2d": "S.E.2d",
  "so": "So.",
  "so2d": "So. 2d",
  "so3d": "So. 3d",
  "sw": "S.W.",
  "sw2d": "S.W.2d",
  "sw3d": "S.W.3d",
  "ny2d": "N.Y.2d",
  "ny3d": "N.Y.3d",
  "nys2d": "N.Y.S.2d",
  "calrptr": "Cal. Rptr.",
  "calrptr2d": "Cal. Rptr. 2d",
  "calrptr3d": "Cal. Rptr. 3d",
  "cal4th": "Cal. 4th",
  "cal5th": "Cal. 5th",
};

/**
 * Reporters whose identity already implies the deciding court, so the court is
 * omitted from the parenthetical (Bluebook convention).
 */
export const REPORTER_IMPLIES_COURT = new Set<string>([
  "U.S.",
  "S. Ct.",
  "L. Ed.",
  "L. Ed. 2d",
  "N.Y.2d",
  "N.Y.3d",
  "Cal. 4th",
  "Cal. 5th",
]);

/** Reporters that are federal-court-of-appeals / district only. */
export const FEDERAL_REPORTERS = new Set<string>([
  "F.",
  "F.2d",
  "F.3d",
  "F.4th",
  "F. App'x",
  "F. Supp.",
  "F. Supp. 2d",
  "F. Supp. 3d",
  "F.R.D.",
]);

export function normalizeReporter(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  return US_REPORTERS[key] ?? raw.trim();
}

/** Conservative court abbreviations (canonical spelling only). */
export const US_COURTS: Record<string, string> = {
  "2d cir": "2d Cir.",
  "9th cir": "9th Cir.",
  "dc cir": "D.C. Cir.",
  "sdny": "S.D.N.Y.",
  "edny": "E.D.N.Y.",
  "ndcal": "N.D. Cal.",
  "cdcal": "C.D. Cal.",
  "ddc": "D.D.C.",
  "supreme court of the united states": "U.S.",
};

export function normalizeCourt(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const trimmed = raw.trim();
  const key = trimmed.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
  if (US_COURTS[key]) return US_COURTS[key];
  // Ordinal circuit forms: "7th Circuit" → "7th Cir."
  const circuit = trimmed.match(/^(\d+(?:st|nd|rd|th))\s+Circuit$/i);
  if (circuit) return `${circuit[1].toLowerCase()} Cir.`;
  return trimmed;
}

/**
 * Journal abbreviations — conservative whitelist. Unknown titles are preserved
 * exactly as supplied (never guessed).
 */
type JurisdictionCode = "US" | "UK" | "OTHER";

/**
 * Journal metadata — conservative whitelist of high-confidence mappings.
 * Each entry: full title (lower-cased) → [abbreviation, jurisdiction of the
 * publishing institution]. Jurisdiction is display metadata only; it never
 * changes citation substance. Unknown titles are preserved exactly as supplied.
 */
const JOURNALS: Record<string, [string, JurisdictionCode]> = {
  // — United States (M1) —
  "yale law journal": ["Yale L.J.", "US"],
  "harvard law review": ["Harv. L. Rev.", "US"],
  "columbia law review": ["Colum. L. Rev.", "US"],
  "stanford law review": ["Stan. L. Rev.", "US"],
  "university of chicago law review": ["U. Chi. L. Rev.", "US"],
  "michigan law review": ["Mich. L. Rev.", "US"],
  "california law review": ["Calif. L. Rev.", "US"],
  "new york university law review": ["N.Y.U. L. Rev.", "US"],
  "virginia law review": ["Va. L. Rev.", "US"],
  "cornell law review": ["Cornell L. Rev.", "US"],
  "georgetown law journal": ["Geo. L.J.", "US"],
  "northwestern university law review": ["Nw. U. L. Rev.", "US"],
  "university of pennsylvania law review": ["U. Pa. L. Rev.", "US"],
  "duke law journal": ["Duke L.J.", "US"],
  "texas law review": ["Tex. L. Rev.", "US"],
  "journal of law and economics": ["J.L. & Econ.", "US"],
  "journal of legal studies": ["J. Legal Stud.", "US"],
  "journal of political economy": ["J. Pol. Econ.", "US"],
  "american journal of international law": ["Am. J. Int'l L.", "US"],
  "law and contemporary problems": ["Law & Contemp. Probs.", "US"],
  // — United States (M2A) —
  "ucla law review": ["UCLA L. Rev.", "US"],
  "vanderbilt law review": ["Vand. L. Rev.", "US"],
  "minnesota law review": ["Minn. L. Rev.", "US"],
  "iowa law review": ["Iowa L. Rev.", "US"],
  "fordham law review": ["Fordham L. Rev.", "US"],
  "notre dame law review": ["Notre Dame L. Rev.", "US"],
  "boston university law review": ["B.U. L. Rev.", "US"],
  "william and mary law review": ["Wm. & Mary L. Rev.", "US"],
  "emory law journal": ["Emory L.J.", "US"],
  "supreme court review": ["Sup. Ct. Rev.", "US"],
  "harvard international law journal": ["Harv. Int'l L.J.", "US"],
  "yale journal of international law": ["Yale J. Int'l L.", "US"],
  "harvard journal of law and public policy": ["Harv. J.L. & Pub. Pol'y", "US"],
  // — United Kingdom —
  "modern law review": ["Mod. L. Rev.", "UK"],
  "cambridge law journal": ["Cambridge L.J.", "UK"],
  "oxford journal of legal studies": ["Oxford J. Legal Stud.", "UK"],
  "law quarterly review": ["L.Q. Rev.", "UK"],
  "international and comparative law quarterly": ["Int'l & Compar. L.Q.", "UK"],
  "legal studies": ["Legal Stud.", "UK"],
};

export const JOURNAL_ABBREVIATIONS: Record<string, string> = Object.fromEntries(
  Object.entries(JOURNALS).map(([k, [abbr]]) => [k, abbr]),
);

const ABBREV_KEY = (s: string) => s.toLowerCase().replace(/[^a-z0-9&']/g, "");
const JURISDICTION_BY_ABBREV: Record<string, JurisdictionCode> = Object.fromEntries(
  Object.values(JOURNALS).map(([abbr, j]) => [ABBREV_KEY(abbr), j]),
);

/**
 * Jurisdiction of a KNOWN journal (by full title or canonical abbreviation).
 * Unknown journals → "OTHER". Never inferred from author or URL.
 */
export function journalJurisdiction(raw: string | undefined): JurisdictionCode {
  if (!raw) return "OTHER";
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (JOURNALS[t]) return JOURNALS[t][1];
  return JURISDICTION_BY_ABBREV[ABBREV_KEY(raw)] ?? "OTHER";
}

/** Already-abbreviated forms we accept unchanged. */
const ABBREV_SHAPE = /(?:\bL\.\s?(?:Rev|J)\b|\bJ\.\b|\bRev\.\b|\bQ\.\b|&)/;

export function normalizeJournalName(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  const hit = JOURNAL_ABBREVIATIONS[trimmed.toLowerCase()];
  if (hit) return hit;
  // Unknown journal → preserve the safe original. Never guess.
  return trimmed;
}

export function isKnownJournal(raw: string | undefined): boolean {
  if (!raw) return false;
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return !!JOURNAL_ABBREVIATIONS[t] || !!JURISDICTION_BY_ABBREV[ABBREV_KEY(raw)] || ABBREV_SHAPE.test(raw);
}

/** Traditional UK Law Reports series supported deterministically (M2A). */
export const UK_REPORT_SERIES = ["AC", "QB", "KB", "Ch", "Fam", "WLR", "All ER"] as const;
/** Series that carry a volume number inside the year, e.g. "[1990] 1 WLR 1". */
export const UK_VOLUMED_SERIES = new Set<string>(["WLR", "All ER"]);
/** Court parentheticals accepted after a traditional report citation. */
export const UK_REPORT_COURTS = ["HL", "CA", "PC", "UKSC", "QB", "KB", "Ch", "Fam", "Comm", "Div Ct", "Civ Div", "Crim Div"] as const;

/** UK neutral-citation court codes supported in Milestone 1. */
export const UK_NEUTRAL_COURTS = ["UKSC", "UKHL", "UKPC", "EWCA", "EWHC"] as const;

/** Month names used for Bluebook internet dates (e.g. "Mar. 22, 2019"). */
export const BLUEBOOK_MONTHS = [
  "Jan.", "Feb.", "Mar.", "Apr.", "May", "June",
  "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec.",
];
