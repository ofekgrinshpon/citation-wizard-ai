/**
 * judgment body form — deterministic, pure, network-free.
 *
 * Ported (as close to verbatim as the V2 import boundary allows) from
 * legal-research-v1/stages/localCaselawListingGate.ts. The V1 classifier was
 * audited against 534 real local judgment bodies and is the proven signal for
 * "is this text a judgment body, an abridged summary, a metadata stub, or a
 * listing page?".
 *
 * V2 adds nothing but a *local* structure probe: the caption-window check used
 * by authority corroboration to tell a judgment body apart from an article
 * that merely cites the docket. No scoring framework, no domain logic.
 */

export type JudgmentBodyClass =
  | "substantive_judgment_body"
  | "partial_judgment_summary"
  | "metadata_only"
  | "listing_or_index_body";

// ── V1 regex set (verbatim) ────────────────────────────────────────────────
const OPENER_RE = /(ל\s?פני\s+(כבוד|הרכב)|בפני\s+(כבוד|הרכב)|בבית\s+המשפט)/;
const DECISION_HEADER_RE = /(פסק\s*דין|גזר\s*דין|הכרעת\s*דין|החלטה)/;
const PARTY_RE = /(המערער|המשיב|העותר|המבקש|הנאשם|התובע|הנתבע|מאשימה)/;
const VS_RE = /\sנגד\s|\sנ'\s|\sנ׳\s/;
const DOCKET_RE =
  /(בג"?ץ|בג״ץ|ע"?א|רע"?א|ע"?פ|רע"?פ|בש"?א|עה"?ס|עע"?ם|ד"?נ|תמ"?ש|ת"?א)\s*\d{1,6}\/\d{2,4}(?!\d)/;

const LISTING_VOCAB = [
  /תוצאות\s*חיפוש/g,
  /לצפייה/g,
  /עמוד\s*הבא/g,
  /עמוד\s*קודם/g,
  /הצג\s*עוד/g,
  /סנן/g,
  /תוצאות\s*נוספות/g,
];

const SUMMARY_RE = /(תקציר\s*(פסק\s*דין|החלטה)?|הודעה\s*לתקשורת|דובר(ות)?\s*בתי\s*המשפט)/;

const SUBSTANTIVE_MIN_CHARS = 2000;
const PARTIAL_MIN_CHARS = 900;

function countMatches(text: string, re: RegExp): number {
  return (text.match(re) || []).length;
}

/** Pure, deterministic classification from already-available text (V1 rule). */
export function classifyLocalCaselawBody(
  args: { title: string; text: string; case_number: string | null; body_chars: number },
): {
  classification: JudgmentBodyClass;
  positive: string[];
  negative: string[];
  reason: string;
} {
  const text = args.text || "";
  const hay = `${args.title || ""}\n${text}`;
  const positive: string[] = [];
  const negative: string[] = [];

  if (args.case_number && args.case_number.trim()) positive.push("case_number_column");
  if (DOCKET_RE.test(hay)) positive.push("docket_pattern");
  if (OPENER_RE.test(text)) positive.push("formal_judgment_opener");
  if (DECISION_HEADER_RE.test(text)) positive.push("decision_header");
  if (PARTY_RE.test(text)) positive.push("party_role_terms");
  if (VS_RE.test(hay)) positive.push("party_block_vs");

  let listingHits = 0;
  for (const re of LISTING_VOCAB) listingHits += countMatches(text, new RegExp(re.source, "g"));
  if (listingHits > 0) negative.push(`listing_vocabulary_x${listingHits}`);
  if (args.body_chars < PARTIAL_MIN_CHARS) negative.push("very_short_text");

  const judgmentMarkers = positive.length;

  if (listingHits >= 5 && judgmentMarkers < 4) {
    negative.push("listing_vocabulary_dominant");
    return {
      classification: "listing_or_index_body",
      positive,
      negative,
      reason: "listing_vocabulary_dominant_with_few_judgment_markers",
    };
  }

  const hasIdentity = positive.includes("case_number_column") ||
    positive.includes("docket_pattern") ||
    positive.includes("formal_judgment_opener");

  if (args.body_chars < 400 || judgmentMarkers === 0) {
    return {
      classification: "metadata_only",
      positive,
      negative,
      reason: args.body_chars < 400 ? "body_below_metadata_floor" : "no_judgment_signals",
    };
  }

  if (args.body_chars >= SUBSTANTIVE_MIN_CHARS && hasIdentity && judgmentMarkers >= 2) {
    return {
      classification: "substantive_judgment_body",
      positive,
      negative,
      reason: "substantive_body_with_judgment_identity",
    };
  }

  if (args.body_chars >= PARTIAL_MIN_CHARS && hasIdentity) {
    return {
      classification: "partial_judgment_summary",
      positive,
      negative,
      reason: SUMMARY_RE.test(text)
        ? "official_abridged_summary"
        : "short_body_with_judgment_identity",
    };
  }

  return {
    classification: "metadata_only",
    positive,
    negative,
    reason: "insufficient_body_for_judgment_support",
  };
}

// ── Local caption-window structure (V2 addition) ───────────────────────────
//
// A judgment body carries its own caption: court identity, docket, parties,
// panel and the decision header all sit inside one short window at the head of
// the document. An article about the judgment uses the same vocabulary, but
// scattered across the page — never co-located with the docket it cites.
//
// Markers below are matched against the SAME normalization the caller uses for
// the docket key (punctuation/gershayim stripped, lowercased), so they must be
// punctuation-free.

/** How far into the document a docket hit may sit and still count as caption. */
export const EARLY_HIT_LIMIT = 4_000;
/** Bounded window around an early docket hit. */
export const CAPTION_WINDOW_BEFORE = 600;
export const CAPTION_WINDOW_AFTER = 1_200;

const STRUCTURE_SIGNALS: Array<{ name: string; markers: string[] }> = [
  { name: "court_identity", markers: ["בית המשפט", "בית הדין", "בבית המשפט", "בבית הדין"] },
  { name: "party_block_vs", markers: [" נגד ", " נ ", " נ׳ ", " נ' "] },
  {
    name: "litigant_roles",
    markers: [
      "המערער",
      "המערערת",
      "המשיב",
      "המשיבה",
      "המשיבים",
      "העותר",
      "העותרת",
      "המבקש",
      "המבקשת",
      "הנאשם",
      "התובע",
      "הנתבע",
      "מאשימה",
      "בכ",
    ],
  },
  { name: "panel_opener", markers: ["לפני", "בפני", "הרכב", "כבוד השופט", "כבוד הנשיא"] },
  {
    name: "decision_header",
    markers: ["פסק דין", "פסק-דין", "גזר דין", "הכרעת דין", "החלטה"],
  },
];

/** Supporting-only signals: they enrich diagnostics, they never gate. */
const DISPOSITION_MARKERS = [
  "ניתן היום",
  "אשר על כן",
  "לפיכך",
  "הערעור נדחה",
  "הערעור מתקבל",
  "העתירה נדחתה",
  "העתירה התקבלה",
  "התביעה נדחתה",
  "התביעה מתקבלת",
];

export interface CaptionStructureVerdict {
  /** An early docket hit exists with ≥2 distinct structural signals nearby. */
  self_identifying: boolean;
  /** Offset of the qualifying (or best) early hit, -1 when none. */
  hit_offset: number;
  /** Distinct structural signal names found inside the window. */
  signals: string[];
  /** Supporting-only disposition/voice markers seen anywhere in the body. */
  supporting: string[];
}

/**
 * Decide whether the body identifies ITSELF as the cited judgment, using only
 * text local to an early docket occurrence. Repeated mentions elsewhere on the
 * page never substitute for this.
 */
export function assessCaptionStructure(
  normalizedBody: string,
  docketHits: number[],
): CaptionStructureVerdict {
  const supporting = DISPOSITION_MARKERS.filter((m) => normalizedBody.includes(m));
  const numbered = (normalizedBody.match(/\n\s*\d{1,3}\s*[.)]/g) || []).length;
  if (numbered >= 8) supporting.push(`numbered_paragraphs_x${numbered}`);

  let best: CaptionStructureVerdict = {
    self_identifying: false,
    hit_offset: -1,
    signals: [],
    supporting,
  };

  for (const hit of docketHits) {
    if (hit > EARLY_HIT_LIMIT) continue;
    const window = normalizedBody.slice(
      Math.max(0, hit - CAPTION_WINDOW_BEFORE),
      hit + CAPTION_WINDOW_AFTER,
    );
    const signals = STRUCTURE_SIGNALS
      .filter((g) => g.markers.some((m) => window.includes(m)))
      .map((g) => g.name);
    if (signals.length > best.signals.length) {
      best = { self_identifying: signals.length >= 2, hit_offset: hit, signals, supporting };
    }
    if (best.self_identifying) break;
  }

  return best;
}
