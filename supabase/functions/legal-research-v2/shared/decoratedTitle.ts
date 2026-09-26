/**
 * legal-research-v2 — conservative normalization of DECORATED scholarly
 * discovery titles (decorated_title_normalization_v1).
 *
 * Discovery providers frequently return a repository page title rather than a
 * work title:
 *
 *   "זכויות יוצרים ותחרות – משוק עותקים למשטר רישוי | ניבה אלקין-קורן (כרך ב)"
 *
 * The author is visibly present, but it is glued to the title, so the trusted
 * work identity stays title-only and `isSameWork()` can never rise above
 * `title_only_insufficient`.
 *
 * This module does ONE thing: split an obvious bibliographic decoration off a
 * discovery title, deterministically and conservatively.
 *
 * What this module is NOT:
 *   • not a citation parser — it never splits on hyphens, en-dashes, colons or
 *     commas, which are ordinary parts of real article titles;
 *   • not a guesser — when the suffix is not unmistakably a personal name it
 *     keeps the original title untouched and extracts nothing;
 *   • not evidence — everything produced here is IDENTITY metadata only.
 */

import { isGarbageAuthorValue } from "./bibliographic.ts";

/** Only unmistakable separators. Never "-", "–", ":" or ",". */
const SEPARATOR_RE = /\s*[|｜]\s*/;

/** Volume / issue decoration allowed to sit after the author in the suffix. */
const VOLUME_SUFFIX_RE =
  /\s*(?:[([](?:כרך|חלק|מהדורה)\s*[^)\]]{1,14}[)\]]|[([]?\s*(?:vol\.?|volume|no\.?|issue|part)\s*[\dIVXLivxl]+\s*[)\]]?|[([]\s*(?:1[6-9]|20)\d{2}\s*[)\]])\s*$/i;

/** Suffix words that mean the suffix is a venue / repository, not a person. */
const VENUE_WORD_RE =
  /(journal|review|press|university|faculty|repository|library|archive|papers?|studies|law|quarterly|bulletin|series|edition|pdf|download|home|site|blog|כתב\s*עת|אוניברסיט|הפקולטה|ספריי?ה|מאגר|הוצאה|מהדורה|כתבי|רבעון|עיוני|משפטים|הורדה)/i;

/** Conjunctions / function words: a person's name does not contain them. */
const FUNCTION_WORD_RE =
  /^(and|the|of|in|on|for|to|a|an|with|from|או|של|על|עם|ואת|את)$/i;

/** A single name token: letters plus the punctuation real names carry. */
const NAME_TOKEN_RE = /^[\p{L}][\p{L}'’.\-־]*$/u;

export interface DecoratedTitleSplit {
  /** Core work title. Equals the input when nothing was safely separable. */
  title: string;
  /** Personal author extracted from the decoration, when unmistakable. */
  authors?: string[];
  /** True when the returned title differs from the raw input. */
  normalized: boolean;
  /** Raw input, for telemetry. */
  raw: string;
}

/** Does this suffix read as one personal name and nothing else? */
function personalNameFromSuffix(suffix: string): string | undefined {
  const s = suffix.replace(VOLUME_SUFFIX_RE, "").replace(/[,;.\s]+$/, "").trim();
  if (!s) return undefined;
  if (/\d/.test(s) || /[@/]|https?:/i.test(s)) return undefined;
  if (VENUE_WORD_RE.test(s)) return undefined;
  const tokens = s.split(/\s+/).filter(Boolean);
  // A personal name is short. Three tokens covers "ניבה אלקין-קורן" and
  // "Robert P. Merges"; anything longer is prose, not a byline.
  if (tokens.length < 2 || tokens.length > 3) return undefined;
  if (!tokens.every((t) => NAME_TOKEN_RE.test(t))) return undefined;
  if (tokens.some((t) => FUNCTION_WORD_RE.test(t))) return undefined;
  // Latin names must be capitalized; Hebrew has no case, so it is exempt.
  const latin = tokens.filter((t) => /^[A-Za-z]/.test(t));
  if (latin.length && !latin.every((t) => /^[A-Z]/.test(t))) return undefined;
  if (isGarbageAuthorValue(s)) return undefined;
  return s;
}

/** A core title must still be able to name a work on its own. */
function usableCore(title: string): boolean {
  const words = title.split(/\s+/).filter((w) => w.length > 1);
  return title.length >= 8 && words.length >= 3;
}

/**
 * Split an obvious bibliographic decoration off a discovery title.
 * Returns the input unchanged whenever confidence is not high.
 */
export function splitDecoratedScholarlyTitle(
  raw: string | undefined,
): DecoratedTitleSplit | undefined {
  const input = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!input) return undefined;
  const keep: DecoratedTitleSplit = { title: input, normalized: false, raw: input };

  const parts = input.split(SEPARATOR_RE).map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return keep;

  const [left, right] = parts;
  if (!usableCore(left)) return keep;

  const author = personalNameFromSuffix(right);
  if (author) {
    return { title: left, authors: [author], normalized: true, raw: input };
  }
  // A suffix that is pure volume/issue decoration is still safely removable.
  if (right.replace(VOLUME_SUFFIX_RE, "").trim() === "") {
    return { title: left, normalized: true, raw: input };
  }
  return keep;
}
