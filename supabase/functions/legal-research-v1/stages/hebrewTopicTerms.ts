/**
 * fix_topicality_and_role_labelling_v1 — Hebrew topic-term normalization.
 *
 * The previous stemmer stripped a single leading letter and truncated to five
 * characters, which produced false mismatches on ordinary legal morphology:
 *
 *     מנהלית → נהלי        המנהלי → מנהלי        (no match)
 *
 * so "הגנת ההסתמכות במשפט המנהלי" was scored `off_topic` against a question
 * about מנהלית. The fix is deliberately morphological, not a dictionary:
 *
 *   1. A word contributes a small **set of equivalent forms** (surface form +
 *      conservative prefix-stripped forms), never one guessed stem. Matching is
 *      form-set intersection, so it is symmetric and no single wrong stripping
 *      decision can lose a term.
 *   2. Each form is normalized for the definite article / construct state /
 *      gender / number endings and for plene-vs-defective yod spelling.
 *   3. A prefix is only stripped when the remainder is still a real-length
 *      Hebrew core (≥3 letters), so lexical מ- words (מנהלי, מידתיות, משפט)
 *      keep their surface form in the set as well as the stripped one.
 *
 * No whitelist of legal terms is used anywhere in this file.
 */

/** Clitic prefixes that legitimately attach to Hebrew nouns/adjectives. */
const PREFIXES_2 = ["מה", "בה", "לה", "וה", "כה", "שה", "כש", "וב", "ול", "ומ", "וכ", "ושה"];
// Note: a bare leading מ is NOT stripped — in Hebrew legal vocabulary it is
// almost always lexical (מנהלי, מידתיות, משפט), and stripping it collapses
// unrelated words (מנהלי/נהלים).
const PREFIXES_1 = ["ה", "ו", "ב", "ל", "כ", "ש"];

const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };

const HEB = /^[\u0590-\u05FF]+$/;

function unfinal(w: string): string {
  return w.split("").map((ch) => FINALS[ch] ?? ch).join("");
}

/** Endings tried longest-first; only applied when a ≥3-letter core remains.
 *  Written with non-final letters because words are un-finalized first. */
const SUFFIXES = ["ויות", "יימ", "ימ", "ות", "יה", "ית", "ה", "ת", "י"].map(unfinal);

function stripSuffixOnce(w: string): string {
  // Plural of ־ות nouns: רשויות → רשות (keeps singular/plural equivalent).
  if (w.endsWith("ויות") && w.length >= 6) return w.slice(0, -4) + "ות";
  for (const suf of SUFFIXES) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

/** Applied to a fixed point (רשויות → רשות → רשו) so plural and singular converge. */
function stripSuffix(w: string): string {
  let cur = w;
  for (let i = 0; i < 3; i++) {
    const next = stripSuffixOnce(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur;
}

/** Canonical shape of one surface form: endings + plene/defective spelling. */
function canonicalize(w: string): string[] {
  let base = stripSuffix(unfinal(w));
  // Collapse a trailing doubled yod (ציפייה → ציפי, not ציפיי).
  base = base.replace(/יי$/, "י");
  const out = new Set<string>([base]);
  // Plene (מלא) vs defective (חסר) spelling: מינהל ≡ מנהל.
  const noYod = base.replace(/י/g, "");
  // Guarded: short defective forms (סביר → סבר) collide with unrelated words.
  if (noYod.length >= 4 && noYod !== base) out.add(noYod);
  return [...out];
}

/**
 * All equivalent normalized forms of one word. Includes the surface form, so a
 * lexical leading מ/ה is never lost by an over-eager prefix strip.
 */
export function termForms(raw: string): string[] {
  const w = unfinal(String(raw ?? "").trim());
  if (!w) return [];
  if (!HEB.test(w)) return w.length >= 4 ? [w.toLowerCase()] : [];
  const surfaces = new Set<string>([w]);
  for (const p of PREFIXES_2) {
    if (w.startsWith(p) && w.length - p.length >= 3) surfaces.add(w.slice(p.length));
  }
  for (const p of PREFIXES_1) {
    if (w.startsWith(p) && w.length - p.length >= 3) surfaces.add(w.slice(1));
  }
  const forms = new Set<string>();
  for (const s of surfaces) for (const c of canonicalize(s)) if (c.length >= 3) forms.add(c);
  return [...forms];
}

/** Two words denote the same legal topic term. */
export function termsMatch(a: string, b: string): boolean {
  const fa = new Set(termForms(a));
  for (const f of termForms(b)) if (fa.has(f)) return true;
  return false;
}

/**
 * Stable, human-readable label for a term (telemetry + dedupe only).
 * Equality of keys is NOT the matching rule — use `termsMatch` / form-set
 * intersection for that, since two equivalent words can canonicalize to
 * different shortest forms.
 */
export function termKey(raw: string): string {
  const w = unfinal(String(raw ?? "").trim());
  if (!w) return "";
  if (!HEB.test(w)) return w.toLowerCase();
  return canonicalize(w)[0] ?? w;
}

/** True when two words share at least one normalized form. */
export function formsIntersect(a: Iterable<string>, b: Iterable<string>): boolean {
  const sa = new Set(a);
  for (const f of b) if (sa.has(f)) return true;
  return false;
}

export function tokenize(text: string): string[] {
  return String(text ?? "")
    .split(/[^\u0590-\u05FFA-Za-z]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
}
