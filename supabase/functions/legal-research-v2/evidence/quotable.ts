/**
 * legal-research-v2 — quotable excerpt preparation.
 *
 * The research agent may only cite text it actually received. Everything it
 * receives must therefore be (a) a literal slice of a stored body and (b) in a
 * form that survives the verifier's verbatim span check.
 *
 * The transformations here are deterministic and presentation-only: invisible
 * bidi/zero-width controls, soft hyphens and exotic spaces are removed, runs of
 * whitespace collapse, and window edges snap to whitespace so the agent never
 * receives half a word it might "repair" from memory. The stored body is never
 * modified — only the copy handed to the model.
 */

const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u00ad\ufeff]/g;
const ODD_SPACE_RE = /[\u00a0\u2000-\u200a\u205f\u3000\t]/g;

/** Literal text, cleaned of presentation noise only. */
export function cleanQuotableText(raw: string): string {
  return (raw ?? "")
    .replace(INVISIBLE_RE, "")
    .replace(ODD_SPACE_RE, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Slice a body, snapping both edges to whitespace so no word is cut. */
export function snapWindow(text: string, start: number, length: number): string {
  const from = Math.max(0, start);
  let s = from;
  if (s > 0) {
    const ws = text.lastIndexOf(" ", s);
    const nl = text.lastIndexOf("\n", s);
    const back = Math.max(ws, nl);
    if (back >= 0 && s - back < 60) s = back + 1;
  }
  let e = Math.min(text.length, s + length);
  if (e < text.length) {
    const fwd = text.indexOf(" ", e);
    if (fwd >= 0 && fwd - e < 60) e = fwd;
  }
  return cleanQuotableText(text.slice(s, e));
}

export interface ServedQuote {
  quote_id: string;
  source_id: string;
  /** What the agent was looking for when this excerpt was served. */
  issue?: string;
  text: string;
}

export const QUOTE_LIMITS = {
  MAX_KEPT: 24,
  MAX_CHARS: 900,
  /** Quotes re-surfaced in the rolling research state each turn. */
  STATE_QUOTES: 6,
  STATE_CHARS: 520,
};
