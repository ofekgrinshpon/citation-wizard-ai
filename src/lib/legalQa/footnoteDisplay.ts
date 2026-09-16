/**
 * Presentation-only compatibility for answers produced before the
 * occurrence-footnote renderer. Historical records are never mutated — this
 * runs at display/copy time.
 *
 * Semantic twin of the display helpers in
 * `supabase/functions/_shared/footnoteOccurrences.ts` (kept separate to avoid
 * coupling the browser bundle to the Deno function tree).
 */

const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

export function toSuperscript(n: number): string {
  return String(Math.max(0, Math.floor(n)))
    .split("")
    .map((d) => SUP_DIGITS[Number(d)] ?? d)
    .join("");
}

/** Remove a trailing `[^n]: ...` markdown footnote-definition block. */
export function stripLegacyFootnoteDefinitions(markdown: string): string {
  const lines = (markdown ?? "").split("\n");
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1].trim();
    if (line === "" || /^\[\^\d+\]:/.test(line)) {
      end--;
      continue;
    }
    break;
  }
  const hadDefinitions = lines.slice(end).some((l) => /^\s*\[\^\d+\]:/.test(l));
  return (hadDefinitions ? lines.slice(0, end) : lines).join("\n").trimEnd();
}

export function legacyMarkersToSuperscript(markdown: string): string {
  return (markdown ?? "").replace(/\[\^(\d+)\]/g, (_m, n: string) => toSuperscript(Number(n)));
}

/** Body text safe to show or copy: markers only, no duplicated footnote list. */
export function normalizeAnswerForDisplay(markdown: string): string {
  return legacyMarkersToSuperscript(stripLegacyFootnoteDefinitions(markdown));
}
