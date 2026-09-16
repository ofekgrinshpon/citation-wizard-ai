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
// V1 set, widened ONLY for court forms the V1 corpus never covered: the labour
// courts write "בבית הדין הארצי לעבודה" instead of "בבית המשפט", and their
// dockets (ע"ע, עב"ל, ס"ק, סע"ש, עס"ק) were not in the V1 prefix alternation.
// No signal was removed and no signal became optional.
const OPENER_RE =
  /(ל\s?פני\s+(כבוד|הרכב)|בפני\s+(כבוד|הרכב)|בבית\s+המשפט|בבית\s+הדין|בית\s+הדין\s+(הארצי|האזורי)\s+לעבודה)/;
const DECISION_HEADER_RE = /(פסק[\s-]*דין|גזר[\s-]*דין|הכרעת[\s-]*דין|החלטה)/;
const PARTY_RE =
  /(המערער|המשיב|העותר|המבקש|הנאשם|התובע|הנתבע|מאשימה|המערערת|המשיבה|התובעת|הנתבעת|העובד|המעסיק)/;
const VS_RE = /\sנגד\s|\sנ'\s|\sנ׳\s/;
const DOCKET_RE =
  /(בג"?ץ|בג״ץ|ע"?א|רע"?א|ע"?פ|רע"?פ|בש"?א|עה"?ס|עע"?ם|ד"?נ|תמ"?ש|ת"?א|ע"?ע|עב"?ל|עס"?ק|ס"?ק|סע"?ש|ע"?ב|עמ"?נ|עמ"?ש|בר"?ע)\s*\d{1,6}\/\d{2,4}(?!\d)/;

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
// The probe works on a LINE-PRESERVING normalization (same punctuation /
// gershayim stripping as the docket key, but newlines survive) because caption
// structure is a line phenomenon: court, docket, litigants, panel and the
// decision header each sit on their own short line. Reported speech in an
// article puts the same words inside running prose lines.

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

/**
 * Signals that only a party-bearing court document carries. Court identity and
 * a decision header alone are also the standard vocabulary of an article ABOUT
 * a judgment, so at least one of these must be present in caption shape.
 */
const STRONG_SIGNALS = new Set(["party_block_vs", "litigant_roles", "panel_opener"]);

/** A caption line is short; running journalistic prose is not. */
export const CAPTION_LINE_MAX = 80;

/** Line-preserving twin of the caller's docket-key normalization. */
export function normalizeKeepLines(input: string): string {
  return (input ?? "")
    .replace(/["'\u05f3\u05f4\u2018\u2019\u201c\u201d]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[.,;:()\[\]{}]/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .toLowerCase();
}

export interface CaptionStructureVerdict {
  /** An early docket hit sits inside a caption-shaped judgment header. */
  self_identifying: boolean;
  /** Offset of the qualifying (or best) early hit, -1 when none. */
  hit_offset: number;
  /** Distinct caption-shaped structural signals found inside the window. */
  signals: string[];
  /** Supporting-only disposition/voice markers seen anywhere in the body. */
  supporting: string[];
}

function captionLines(window: string): string[] {
  return window.split("\n").map((l) => l.trim()).filter((l) => l && l.length <= CAPTION_LINE_MAX);
}

/**
 * Decide whether the body identifies ITSELF as the cited judgment, using only
 * text local to an early docket occurrence. Repeated mentions elsewhere on the
 * page never substitute for this, and signals embedded in running prose lines
 * do not count as caption structure.
 */
export function assessCaptionStructure(
  title: string,
  text: string,
  docketKey: string,
): CaptionStructureVerdict {
  const body = normalizeKeepLines(`${title ?? ""}\n${text ?? ""}`);
  const supporting = DISPOSITION_MARKERS.filter((m) => body.includes(m));
  const numbered = (body.match(/\n\s*\d{1,3}\s*[.)]/g) || []).length;
  if (numbered >= 8) supporting.push(`numbered_paragraphs_x${numbered}`);

  let best: CaptionStructureVerdict = {
    self_identifying: false,
    hit_offset: -1,
    signals: [],
    supporting,
  };
  if (!docketKey) return best;

  let hit = body.indexOf(docketKey);
  while (hit !== -1 && hit <= EARLY_HIT_LIMIT) {
    // The docket's own line is excluded: a page title or breadcrumb of the form
    // "עא 3807/12 פלוני נ' אלמוני — <site>" reproduces caption vocabulary on a
    // single line without reproducing the judgment. Caption structure must be
    // present in the lines AROUND the docket, as it is in a real judgment head.
    const lineStart = body.lastIndexOf("\n", hit) + 1;
    let lineEnd = body.indexOf("\n", hit);
    if (lineEnd === -1) lineEnd = body.length;
    const before = body.slice(Math.max(0, hit - CAPTION_WINDOW_BEFORE), lineStart);
    const after = body.slice(lineEnd, hit + CAPTION_WINDOW_AFTER);
    const window = `${before}\n${after}`;
    const lines = captionLines(window);
    const signals = signalsIn((g) => lines.some((l) => g.markers.some((m) => l.includes(m))));
    let ok = signals.length >= 2 && signals.some((s) => STRONG_SIGNALS.has(s));
    let used = signals;

    // Flattened-extraction caption. A PDF-to-text conversion can join the
    // court line, the docket, the litigants and the panel into one long line,
    // which the line-shaped probe above cannot see. The same window is then
    // read without line structure — but the bar is RAISED, not lowered: three
    // distinct signals instead of two, strong signal still mandatory. An
    // article that merely cites the docket carries at most court identity plus
    // one incidental term in the same window, so it still fails.
    if (!ok) {
      // The docket's OWN line is excluded above, which is correct for a
      // line-structured caption but fatal for a flattened one, where the whole
      // caption IS that line. Read a bounded raw window around the hit instead.
      const raw = body.slice(
        Math.max(0, hit - CAPTION_WINDOW_BEFORE),
        hit + CAPTION_WINDOW_AFTER,
      );
      const flat = signalsIn((g) => g.markers.some((m) => raw.includes(m)));
      if (flat.length >= FLATTENED_MIN_SIGNALS && flat.some((s) => STRONG_SIGNALS.has(s))) {
        ok = true;
        used = [...flat, "flattened_caption"];
      }
    }

    if (ok || used.length > best.signals.length) {
      best = { self_identifying: ok, hit_offset: hit, signals: used, supporting };
    }
    if (ok) break;
    hit = body.indexOf(docketKey, hit + docketKey.length);
  }

  return best;
}

/** Distinct structural signal names selected by `pick`. */
function signalsIn(pick: (g: { name: string; markers: string[] }) => boolean): string[] {
  return STRUCTURE_SIGNALS.filter(pick).map((g) => g.name);
}

/** Signals required when the caption survived extraction only as flat text. */
export const FLATTENED_MIN_SIGNALS = 3;

/** How much of the document head counts as its caption area. */
export const HEAD_CHARS = 4_000;

export interface HeadStructureVerdict {
  /** Distinct caption-shaped structural signals in the document head. */
  signals: string[];
  /** At least two signals including a party-bearing (strong) one. */
  judicial_head: boolean;
  /** Docket numbers appearing in the head, normalized `n/yy`. */
  dockets: string[];
}

/**
 * Structure of the document HEAD, independent of any docket occurrence.
 *
 * Used only by the controlled structured-metadata path: when a PDF extraction
 * dropped the docket line entirely, the head must still look like a judgment
 * caption before stored metadata may supply the missing identity. It never
 * establishes WHICH judgment the body is — only that it is one.
 */
export function assessHeadStructure(title: string, text: string): HeadStructureVerdict {
  const head = normalizeKeepLines(`${title ?? ""}\n${text ?? ""}`).slice(0, HEAD_CHARS);
  const lines = captionLines(head);
  const signals = signalsIn((g) =>
    lines.some((l) => g.markers.some((m) => l.includes(m))) ||
    g.markers.some((m) => head.includes(m))
  );
  const dockets = [...new Set((head.match(/\d{1,6}\/\d{2,4}/g) ?? []))];
  return {
    signals,
    judicial_head: signals.length >= 2 && signals.some((s) => STRONG_SIGNALS.has(s)),
    dockets,
  };
}
