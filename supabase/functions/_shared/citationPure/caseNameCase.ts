/**
 * Capitalization of English party names in foreign case citations. Pure, no IO.
 *
 * Only letter case changes here; words, order and punctuation stay exactly as
 * the user typed them. Two steps:
 *  1. `adoptVerifiedCasing`: when a verified source title (from the accepted
 *     record) spells the same words, its casing is used ("reDigi" -> "ReDigi").
 *  2. `capitalizeCaseName`: a word typed entirely in lowercase gets an initial
 *     capital (Bluebook capitalizes party names). Words that already contain a
 *     capital ("eBay", "McDonald") are left alone.
 */

/** Small words kept lowercase inside a party name (not at its start). */
const LOWERCASE_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "de", "del", "der", "di", "du", "en", "et", "ex", "for", "from", "in", "into",
  "la", "le", "of", "on", "or", "over", "re", "the", "to", "upon", "van", "von", "with", "al", "rel", "parte",
]);
/** Business/state designators written in capitals. */
const UPPERCASE_WORDS: Record<string, string> = {
  llc: "LLC", llp: "LLP", lllp: "LLLP", lp: "LP", plc: "PLC", pllc: "PLLC", usa: "USA", uk: "UK", nhs: "NHS",
};
const SEPARATOR = /^(?:v|vs)\.?$/;
/** Company designators a shortened source title may omit. */
const DESIGNATORS = new Set(["inc", "co", "corp", "ltd", "company", "corporation", "incorporated", "limited"]);

function capitalizeWord(word: string, partyStart: boolean): string {
  // Keep any word the user (or a source) already capitalized, and anything with digits.
  if (/[A-Z]/.test(word) || /\d/.test(word) || !/[a-z]/.test(word)) return word;
  const m = word.match(/^([^a-z]*)([a-z][a-z'’.-]*?)([^a-z]*)$/);
  if (!m) return word;
  const [, lead, core, tail] = m;
  const bare = core.replace(/\.$/, "");
  if (SEPARATOR.test(core)) return word;
  if (UPPERCASE_WORDS[bare]) return `${lead}${UPPERCASE_WORDS[bare]}${core.slice(bare.length)}${tail}`;
  if (!partyStart && LOWERCASE_WORDS.has(bare)) return word;
  const cased = core.split("-").map((part) => {
    const up = part.charAt(0).toUpperCase() + part.slice(1);
    return /^O['’][a-z]/.test(up) ? up.slice(0, 2) + up.charAt(2).toUpperCase() + up.slice(3) : up;
  }).join("-");
  return `${lead}${cased}${tail}`;
}

/** Capitalize lowercase English words of a case name. Non-Latin text is untouched. */
export function capitalizeCaseName(name: string): string {
  if (!/[a-z]/.test(name)) return name;
  const parts = name.split(/(\s+)/);
  let partyStart = true;
  return parts.map((p) => {
    if (/^\s*$/.test(p)) return p;
    const out = capitalizeWord(p, partyStart);
    partyStart = SEPARATOR.test(p.toLowerCase());
    return out;
  }).join("");
}

const letters = (s: string) => s.match(/[A-Za-z]+/g) ?? [];

/**
 * Adopt the letter casing of a verified source title for the words of `name`.
 * Returns null when no title qualifies. A title qualifies only if it is not
 * written mostly in capitals and contains every word of `name` (ignoring
 * case). Only capitalized source forms are adopted; a word spelled two
 * different ways across titles is left as typed.
 */
export function adoptVerifiedCasing(name: string, titles: readonly string[]): string | null {
  // Every identifying word of the name must appear in the title; small words and
  // company designators ("llc", "inc") may be missing from a shortened title.
  const significant = letters(name).map((w) => w.toLowerCase())
    .filter((w) => w.length > 1 && !LOWERCASE_WORDS.has(w) && !UPPERCASE_WORDS[w] && !DESIGNATORS.has(w) && w !== "v" && w !== "vs");
  if (!significant.length) return null;
  const forms = new Map<string, Set<string>>();
  let usable = false;
  for (const title of titles) {
    if (typeof title !== "string") continue;
    const words = letters(title);
    const all = words.join("");
    const upper = all.replace(/[^A-Z]/g, "").length;
    if (!all.length || upper / all.length > 0.6) continue;
    const folded = new Set(words.map((w) => w.toLowerCase()));
    if (!significant.every((w) => folded.has(w))) continue;
    usable = true;
    for (const w of words) {
      // Only a capital in the source is adopted; a typed capital is never lowered.
      if (!/[A-Z]/.test(w)) continue;
      const key = w.toLowerCase();
      if (!forms.has(key)) forms.set(key, new Set());
      forms.get(key)!.add(w);
    }
  }
  if (!usable) return null;
  const out = name.replace(/[A-Za-z]+/g, (w) => {
    const f = forms.get(w.toLowerCase());
    return f && f.size === 1 ? [...f][0] : w;
  });
  return out === name ? null : out;
}
