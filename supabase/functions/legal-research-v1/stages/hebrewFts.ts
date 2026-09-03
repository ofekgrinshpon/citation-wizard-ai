// local_retrieval_precision_tuning_v1 — deterministic Hebrew lexical-query
// construction for the local FTS lane.
//
// Two problems this module fixes, both string/regex only (no LLM, no network):
//
//  1. The `simple` tsvector config has no Hebrew morphology, so `מידתיות`
//     never matches `המידתיות` / `למידתיות` / `במידתיות`. We therefore emit
//     an explicit OR-group of prefix variants per term.
//  2. `search_legal_chunks_text` forced the *two longest words* as required
//     AND terms, which anchors on incidental tokens. We select required terms
//     by legal salience instead, and prefer fewer mandatory terms over bad
//     ones.
//
// Nothing here changes listing suppression, source integrity, candidate
// breadth or any safety gate — it only decides which lexical query is sent.

/** Single-letter Hebrew clitic prefixes. */
const PREFIXES = ["ה", "ו", "ב", "ל", "כ", "מ", "ש"] as const;
/** Frequent two-letter combinations (preposition + definite article). */
const PREFIX_PAIRS = ["וה", "בה", "לה", "מה", "שה", "כש"] as const;

/**
 * Terms whose *first letter* looks like a clitic prefix but is part of the
 * lemma. Stripping them would destroy the legal meaning (מידתיות → ידתיות).
 */
const PROTECTED_LEMMAS = new Set([
  "מידתיות", "מבחן", "מבחני", "משפט", "משפטי", "משפטית", "משפטים", "מדינה",
  "ממשלה", "מנהלי", "מנהלית", "מנהל", "מקרקעין", "מעמד", "מעצר", "מזונות",
  "מסמך", "מקור", "מקורות", "מוסד", "מועצה", "מכרז", "מחוזי", "מהות",
  "ביקורת", "בית", "בטחון", "ביטחון", "בחירות", "בעלות", "בקשה", "בורר",
  "הליך", "הליכים", "הלכה", "הגבלה", "הסתמכות", "הבטחה", "הפליה", "הפקעה",
  "הסכם", "הצדקה", "הרשעה", "השתק", "התיישנות", "הוראה", "הגנה", "הפרה",
  "לשון", "לקוח", "כנסת", "כשרות", "כשירות", "כללי", "כבוד",
  "שופט", "שוויון", "שיקול", "שימוש", "שכירות", "שירות", "שלטון",
  "ועדה", "וועדה",
]);

/** Words that must never become a required AND term. */
const GENERIC_TERMS = new Set([
  "בית", "משפט", "בתי", "המשפט", "דין", "פסק", "פסקי", "פסיקה", "עליון",
  "העליון", "מחוזי", "שלום", "ישראל", "ישראלי", "ישראלית", "כללי", "כללית",
  "לפי", "בעניין", "לעניין", "נגד", "בנושא", "שאלה", "מהו", "מהי", "מהם",
  "כיצד", "האם", "מתי", "תוכן", "מסמך", "עמוד", "אתר", "רשימה", "כללים",
  "case", "law", "israel", "israeli", "court", "legal", "the", "and", "of",
]);

/**
 * Single tokens that are strong legal-domain signals on their own. The
 * `…ות` abstract-noun heuristic covers most doctrine names; this list carries
 * the rest.
 */
const SALIENT_TERMS = new Set([
  "חוק", "חוק-יסוד", "תקנות", "צו", "פקודה", "תקנה", "חוקה", "חוקתית",
  "מידתיות", "סבירות", "הסתמכות", "השתק", "חוקיות", "פרופורציונליות",
  "הבטחה", "התיישנות", "הפקעה", "אכיפה", "תרופות", "פיצויים", "רשלנות",
  "proportionality", "reliance", "estoppel", "constitutional",
]);

const TOKEN_SPLIT_RE = /[^\u0590-\u05FFA-Za-z0-9]+/;
/** tsquery-safe token: Hebrew or latin letters / digits only. */
const SAFE_TOKEN_RE = /^[\u0590-\u05FFA-Za-z0-9]{2,}$/;

export interface FtsNormalizationTelemetry {
  raw_query: string;
  normalized_terms: string[];
  added_variants: string[];
  preserved_phrases: string[];
  rejected_terms: string[];
  reason: string;
}

export interface FtsTermSelectionTelemetry {
  raw_query: string;
  required_terms_old: string[];
  required_terms_new: string[];
  booster_terms: string[];
  dropped_generic_terms: string[];
  selection_reason: string;
}

export interface HebrewFtsQuery {
  /** Precise tsquery: required salient groups AND-ed together. */
  tsq_primary: string;
  /** Recall fallback used only when the primary yields no hit. */
  tsq_fallback: string;
  normalization: FtsNormalizationTelemetry;
  term_selection: FtsTermSelectionTelemetry;
}

/** Strip a definite-article/conjunction prefix when it is clearly clitic. */
export function stripHebrewPrefix(token: string): string {
  const t = token.trim();
  if (PROTECTED_LEMMAS.has(t)) return t;
  if (!/^[\u0590-\u05FF]/.test(t)) return t;
  // Only ה / ו / וה are safe to strip blindly — the rest (ב/ל/כ/מ/ש) are
  // ambiguous with lemma-initial letters and are handled by variant expansion.
  for (const p of ["וה", "ה", "ו"]) {
    if (t.startsWith(p) && t.length - p.length >= 3) {
      const base = t.slice(p.length);
      if (PROTECTED_LEMMAS.has(base) || !GENERIC_TERMS.has(base)) return base;
    }
  }
  return t;
}

/** All prefix variants of a base term, base first. */
export function hebrewVariants(base: string): string[] {
  const out = [base];
  if (!/^[\u0590-\u05FF]/.test(base)) return out;
  if (base.length < 3) return out;
  for (const p of PREFIXES) out.push(p + base);
  for (const p of PREFIX_PAIRS) out.push(p + base);
  return Array.from(new Set(out));
}

function safe(tok: string): boolean {
  return SAFE_TOKEN_RE.test(tok);
}

/** `(a | b | c)` OR-group with optional suffix wildcards. */
function orGroup(base: string): string {
  const variants = hebrewVariants(base).filter(safe);
  if (!variants.length) return "";
  // No suffix wildcards: prefix expansion already covers the clitics, and
  // `:*` over a large OR-group is an order of magnitude more expensive on the
  // GIN index (measured: 0.3s → 10s on one probe query).
  return `(${variants.join(" | ")})`;
}

/** Phrase group: adjacency between per-word variant groups. */
function phraseGroup(words: string[]): string {
  const groups = words.map((w) => orGroup(stripHebrewPrefix(w))).filter(Boolean);
  if (groups.length < 2) return groups[0] ?? "";
  return groups.join(" <-> ");
}

function salience(term: string, isPhrase: boolean): number {
  let s = 0;
  if (isPhrase) s += 3;
  const t = term.toLowerCase();
  if (SALIENT_TERMS.has(term) || SALIENT_TERMS.has(t)) s += 3;
  // Hebrew abstract-noun doctrine names: מידתיות, סבירות, חוקתיות, הסתמכות…
  if (!isPhrase && /[\u0590-\u05FF]{4,}(ות|יות)$/.test(term)) s += 2;
  if (!isPhrase && term.length >= 6) s += 1;
  if (GENERIC_TERMS.has(term)) s -= 6;
  return s;
}

/** The legacy heuristic, reproduced for before/after telemetry only. */
export function legacyRequiredTerms(query: string): string[] {
  const words = String(query || "").split(/\s+/).filter((w) => w.length >= 2);
  return [...words].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, 2);
}

/**
 * Build the lexical query for the local FTS lane.
 *
 * @param compactQuery the compact Hebrew query already produced by
 *        `buildCompactQuery` (phrases first, then residual tokens).
 * @param phrases multi-word legal phrases that must stay phrase-sensitive.
 */
export function buildHebrewFtsQuery(
  compactQuery: string,
  phrases: string[] = [],
): HebrewFtsQuery {
  const raw = String(compactQuery || "").trim();
  const tokens = raw.split(TOKEN_SPLIT_RE).filter((t) => t.length >= 2 && safe(t));

  const preservedPhrases = phrases
    .map((p) => p.trim())
    .filter((p) => p.split(/\s+/).length >= 2 && raw.includes(p))
    .slice(0, 3);
  const phraseWords = new Set(preservedPhrases.flatMap((p) => p.split(/\s+/)));

  const rejected: string[] = [];
  const singles: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokens) {
    if (phraseWords.has(tok)) continue;
    const base = stripHebrewPrefix(tok);
    if (base.length < 2) { rejected.push(tok); continue; }
    if (seen.has(base)) continue;
    seen.add(base);
    singles.push(base);
  }

  // ── term selection by salience ────────────────────────────────────────
  const scored = [
    ...preservedPhrases.map((p) => ({ term: p, isPhrase: true, score: salience(p, true) })),
    ...singles.map((t) => ({ term: t, isPhrase: false, score: salience(t, false) })),
  ].sort((a, b) => b.score - a.score);

  const dropped_generic = scored.filter((s) => s.score < 0).map((s) => s.term);
  const usable = scored.filter((s) => s.score >= 0);

  let required = usable.filter((s) => s.score >= 3).slice(0, 2);
  let reason = "salient_required_terms";
  if (!required.length) {
    required = usable.filter((s) => s.score >= 2).slice(0, 1);
    reason = required.length ? "single_moderate_salience_term" : "no_required_terms_all_boosters";
  }
  const requiredSet = new Set(required.map((r) => r.term));
  const boosters = usable.filter((s) => !requiredSet.has(s.term));

  const groupFor = (s: { term: string; isPhrase: boolean }) =>
    s.isPhrase ? phraseGroup(s.term.split(/\s+/)) : orGroup(s.term);

  const requiredGroups = required.map(groupFor).filter(Boolean);
  const boosterGroups = boosters.map(groupFor).filter(Boolean);

  const andPart = requiredGroups.join(" & ");
  const orPart = boosterGroups.join(" | ");
  const tsq_primary = andPart || orPart;
  const tsq_fallback = andPart && orPart
    ? `(${andPart}) | (${orPart})`
    : (orPart || andPart);

  const added_variants: string[] = [];
  for (const s of [...required, ...boosters]) {
    if (s.isPhrase) continue;
    for (const v of hebrewVariants(s.term)) if (v !== s.term) added_variants.push(v);
  }

  return {
    tsq_primary,
    tsq_fallback,
    normalization: {
      raw_query: raw.slice(0, 300),
      normalized_terms: [...required, ...boosters].map((s) => s.term),
      added_variants: added_variants.slice(0, 40),
      preserved_phrases: preservedPhrases,
      rejected_terms: rejected,
      reason: "hebrew_prefix_variant_expansion_v1",
    },
    term_selection: {
      raw_query: raw.slice(0, 300),
      required_terms_old: legacyRequiredTerms(raw),
      required_terms_new: required.map((s) => s.term),
      booster_terms: boosters.map((s) => s.term),
      dropped_generic_terms: dropped_generic,
      selection_reason: reason,
    },
  };
}
