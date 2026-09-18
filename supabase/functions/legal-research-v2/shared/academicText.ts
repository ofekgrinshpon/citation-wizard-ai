/**
 * legal-research-v2 — canonical document text (academic_evidence_yield_v1).
 *
 * ONE canonical textual representation per fetched document.
 *
 * Why this exists: the agent may only quote text it was served, and the
 * verifier matches that quote literally against the STORED body. Previously
 * the stored body was raw extraction output while the served copy had been
 * run through `cleanQuotableText()`, so every presentation artefact the clean
 * step removed was a potential span mismatch. The fix is Option A from the
 * track spec: normalize deterministically ONCE, before storage, and let both
 * quote serving and verification work against that same canonical text.
 *
 * Every transformation here is deterministic, conservative and faithful:
 * invisible controls, exotic spaces, whitespace shape, Latin line-break
 * hyphenation and deterministically repeated page furniture. Nothing is
 * paraphrased, translated, reordered or invented.
 */

const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\u00ad\ufeff]/g;
const ODD_SPACE_RE = /[\u00a0\u2000-\u200a\u205f\u3000\t]/g;

export interface TextQuality {
  chars: number;
  line_count: number;
  avg_line_length: number;
  /** Share of non-empty lines shorter than 15 chars (column/gutter shredding). */
  suspicious_fragment_ratio: number;
  /** Share of non-empty lines that occur more than once (page furniture). */
  repeated_line_ratio: number;
  bidi_control_count: number;
  replacement_char_ratio: number;
}

export type ExtractionStatus = "not_attempted" | "failed" | "empty" | "low_quality" | "usable";

/** Count of invisible bidi/zero-width controls in the RAW extraction output. */
export function countBidiControls(raw: string): number {
  return (raw ?? "").match(INVISIBLE_RE)?.length ?? 0;
}

/**
 * Canonical, faithful text for storage. Idempotent.
 *
 * Invariant relied upon elsewhere: for any slice `s` of the returned text,
 * `cleanQuotableText(s) === s.trim()`, so a served quote is always a literal
 * substring of the stored body.
 */
export function canonicalizeDocumentText(raw: string): string {
  let text = (raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE_RE, "")
    .replace(ODD_SPACE_RE, " ");

  // Latin line-break hyphenation: "consti-\ntutional" → "constitutional".
  // Hebrew does not hyphenate across lines, so this is Latin-only on purpose.
  text = text.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");

  text = text
    .split("\n")
    .map((l) => l.replace(/[ ]{2,}/g, " ").trim())
    .join("\n");

  text = removeRepeatedFurniture(text);

  return text.replace(/\n{3,}/g, "\n\n").replace(/[ ]{2,}/g, " ").trim();
}

/**
 * Drop lines that are deterministically page furniture: short lines repeating
 * across the document (running headers, journal name, bare page numbers).
 * Conservative: only short lines, only when they repeat at least four times,
 * and never a line that reads like running prose.
 */
function removeRepeatedFurniture(text: string): string {
  const lines = text.split("\n");
  if (lines.length < 20) return text;
  const counts = new Map<string, number>();
  for (const l of lines) {
    const k = l.trim();
    if (!k) continue;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const furniture = new Set<string>();
  for (const [line, n] of counts) {
    if (n < 4) continue;
    if (line.length > 80) continue;
    // Running prose repeats too rarely to reach four; but never strip a line
    // that ends like a sentence.
    if (/[.!?׃]$/.test(line) && line.length > 40) continue;
    furniture.add(line);
  }
  if (!furniture.size) return text;
  return lines.filter((l) => !furniture.has(l.trim())).join("\n");
}

export function assessTextQuality(text: string, rawForControls?: string): TextQuality {
  const t = text ?? "";
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const total = lines.length;
  const chars = t.length;
  const short = lines.filter((l) => l.length < 15).length;
  const seen = new Map<string, number>();
  for (const l of lines) seen.set(l, (seen.get(l) ?? 0) + 1);
  let repeated = 0;
  for (const [, n] of seen) if (n > 1) repeated += n;
  const replacements = (t.match(/\ufffd/g) ?? []).length;
  return {
    chars,
    line_count: total,
    avg_line_length: total ? Math.round((lines.join("").length / total) * 10) / 10 : 0,
    suspicious_fragment_ratio: total ? Math.round((short / total) * 1000) / 1000 : 0,
    repeated_line_ratio: total ? Math.round((repeated / total) * 1000) / 1000 : 0,
    bidi_control_count: countBidiControls(rawForControls ?? t),
    replacement_char_ratio: chars ? Math.round((replacements / chars) * 1000) / 1000 : 0,
  };
}

/**
 * Deterministic extraction verdict used for yield telemetry only. It never
 * gates evidence: a "low_quality" body is still stored and still verifiable.
 */
export function classifyExtraction(text: string, quality: TextQuality): ExtractionStatus {
  const t = (text ?? "").trim();
  if (!t) return "empty";
  if (quality.replacement_char_ratio > 0.05) return "low_quality";
  if (quality.chars < 400) return "low_quality";
  // A body that is almost entirely short fragments carries no quotable prose.
  if (quality.line_count >= 20 && quality.suspicious_fragment_ratio > 0.85) return "low_quality";
  return "usable";
}

/** Longest run of contiguous prose — what a 40–900 char quote needs. */
export function longestProseRun(text: string): number {
  let best = 0;
  for (const para of (text ?? "").split(/\n{2,}/)) {
    const t = para.replace(/\n/g, " ").trim();
    if (t.length > best) best = t.length;
  }
  return best;
}
