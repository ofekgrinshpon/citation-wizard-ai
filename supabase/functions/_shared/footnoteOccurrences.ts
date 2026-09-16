/**
 * Shared, runtime-agnostic footnote occurrence engine (Rule 37 repeat
 * citations + superscript marker typography).
 *
 * Pure functions only — no imports, no I/O — so both Supabase edge functions
 * (Deno) and the browser bundle can use exactly the same legal behaviour.
 *
 * Legal source of truth: `src/lib/footnoteRepeatRules.ts` (Israeli Uniform
 * Citation, rule 37 incl. 37.5 for legislation). This module reproduces the
 * same formatting semantics but identifies a repeated authority by a
 * deterministic source id instead of fuzzy title matching.
 *
 * Numbering model: a footnote number belongs to a CITATION OCCURRENCE, not to
 * a source. Nine occurrences produce nine chronological footnotes even when
 * they all point at the same authority.
 */

const SUP_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";

/** 12 → "¹²" (deterministic, multi-digit safe). */
export function toSuperscript(n: number): string {
  return String(Math.max(0, Math.floor(n)))
    .split("")
    .map((d) => SUP_DIGITS[Number(d)] ?? d)
    .join("");
}

const TRAILING_PUNCT_RE = /[.!?,;:״"')\]]$/u;

/**
 * Typography rule: punctuation belongs to the sentence, the marker comes
 * immediately AFTER it. Text with no terminal punctuation gets a period first,
 * so the output is "טענה.¹" and never "טענה¹.".
 */
export function placeMarkerAfterPunctuation(text: string, marker: string): string {
  const t = text.replace(/\s+$/u, "");
  if (!marker) return t;
  if (!t) return marker;
  return TRAILING_PUNCT_RE.test(t) ? t + marker : t + "." + marker;
}

const LEGISLATION_DETECT = /^(חוק|פקודת|פקודה|תקנות|צו|כללי|הוראות|חוק[\s-]יסוד|סעיף\s+[\dא-ת]+\s+ל)/;

export function isLegislationText(text: string): boolean {
  return LEGISLATION_DETECT.test((text ?? "").trim());
}

export function extractLawName(text: string): string {
  const cleaned = (text ?? "").trim().replace(/^סעיף\s+[\dא-ת()./\\–-]+\s+ל/, "").trim();
  return cleaned.split(",")[0]?.trim() || cleaned;
}

/** "עמ' 5" → "בעמ' 5", "סעיף 20" → "בס' 20", "פסקה 4" → "בפס' 4". */
export function withBetPrefix(suffix: string): string {
  const trimmed = (suffix ?? "").trim();
  if (!trimmed) return "";
  if (/^(בעמ['״]|בס['״]|בפס['״])/.test(trimmed)) return trimmed;
  if (/^עמ['״]/.test(trimmed)) return trimmed.replace(/^עמ/, "בעמ");
  if (/^ס['״]\s/.test(trimmed)) return trimmed.replace(/^ס/, "בס");
  // \b does not work next to Hebrew letters — match on whitespace/digit instead.
  if (/^סעיף(?=[\s\d]|$)/.test(trimmed)) return trimmed.replace(/^סעיף\s*/, "בס' ");
  if (/^פסקה(?=[\s\d]|$)/.test(trimmed)) return trimmed.replace(/^פסקה\s*/, "בפס' ");
  return trimmed;
}

const GENERIC_PARTIES =
  /^(מדינת ישראל|פלוני|פלונית|אלמוני|אלמונית|היועץ המשפטי לממשלה|היועמ"ש|היועמ״ש|state of israel|attorney general)\b/i;

/** Short repeat label: "עניין X" for judgments, the law name for legislation. */
export function extractShortSourceLabel(text: string): string {
  const cleaned = (text ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\*\*/g, "")
    .replace(/##/g, "")
    .trim();

  const caseMatch = cleaned.match(/([^,\n()]+?)\s+נ['׳]\s+([^,\n()]+?)(?=\s*,|\s*\(|$)/);
  if (caseMatch) {
    const a = caseMatch[1].trim().replace(/^.*?\d+\/\d+\s+/, "").trim();
    const b = caseMatch[2].trim();
    const pick = GENERIC_PARTIES.test(b) ? (GENERIC_PARTIES.test(a) ? b : a) : b;
    return `עניין ${pick}`;
  }

  const hebrewLaw = cleaned.match(
    /(חוק[\s-]יסוד[^,\n]*|חוק[^,\n]*|פקודת[^,\n]*|פקודה[^,\n]*|תקנות[^,\n]*|צו[^,\n]*)/,
  );
  if (hebrewLaw) return hebrewLaw[1].trim();

  const englishLead = cleaned.match(/^([^,(\n]{3,80})/);
  if (englishLead) return englishLead[1].trim();

  return cleaned.split(",")[0].trim();
}

/** Section identifier inside a legislation locator, for rule 37.5. */
export function extractSection(locator: string): string {
  const m = (locator ?? "").match(/(?:סעיף|ס['״])\s*([\dא-ת()./\-–]+)/);
  return m ? m[1] : "";
}

export interface CitationOccurrence {
  source_id: string;
  /** Fully formatted first-appearance citation (already deterministic). */
  full_citation: string;
  short_label?: string;
  locator?: string;
  is_legislation?: boolean;
  law_name?: string;
  url?: string;
}

export type RepeatKind = "full" | "ibid" | "supra";

/** One verified source inside a footnote occurrence. */
export interface FootnoteSourceEntry {
  source_id: string;
  /** Text actually shown for this source here (full / שם / לעיל ה"ש). */
  citation: string;
  /** First-appearance citation of the same authority. */
  full_citation: string;
  first_occurrence: number;
  repeat_kind: RepeatKind;
  locator?: string;
  url?: string;
}

export interface OccurrenceFootnote extends FootnoteSourceEntry {
  index: number;
  /** Every verified source cited at this single textual point. */
  sources: FootnoteSourceEntry[];
  source_ids: string[];
}

/**
 * A CITATION POINT in the body: one marker, one footnote number, one or more
 * verified sources. Source relationships come from verification — this module
 * only formats them.
 */
export type CitationOccurrenceGroup = CitationOccurrence[];

function joinCompound(entries: FootnoteSourceEntry[]): string {
  if (entries.length === 1) return entries[0].citation;
  return entries
    .map((e) => e.citation.trim().replace(/[.\s]+$/u, ""))
    .filter(Boolean)
    .join("; ") + ".";
}

/**
 * Turn a chronological list of citation POINTS into numbered footnotes
 * carrying rule 37 repeat text. Deterministic and side-effect free.
 *
 * Strict שם rule: `שם` is used only when the current point and the immediately
 * preceding point each cite exactly one source and it is the same source.
 * Anything involving a compound footnote uses explicit repeat citations, so a
 * reader can never be unsure which authority `שם` refers to.
 */
export function buildCompoundFootnotes(
  groups: CitationOccurrenceGroup[],
  opts: { offset?: number } = {},
): OccurrenceFootnote[] {
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const first = new Map<string, {
    index: number;
    full: string;
    label: string;
    isLegislation: boolean;
    lawName: string;
    locator: string;
  }>();
  /** Previous point's single source id, or null when it was compound/empty. */
  let prevSoloSourceId: string | null = null;

  return groups.map((group, i) => {
    const index = offset + i + 1;
    const solo = group.length === 1;

    const entries: FootnoteSourceEntry[] = group.map((occ) => {
      const locator = (occ.locator ?? "").trim();
      const prior = first.get(occ.source_id);

      if (!prior) {
        const isLegislation = occ.is_legislation ?? isLegislationText(occ.full_citation);
        const label = (occ.short_label ?? "").trim() || extractShortSourceLabel(occ.full_citation);
        const lawName = (occ.law_name ?? "").trim() ||
          (isLegislation ? extractLawName(occ.full_citation) : "");
        first.set(occ.source_id, { index, full: occ.full_citation, label, isLegislation, lawName, locator });
        return {
          source_id: occ.source_id,
          citation: occ.full_citation,
          full_citation: occ.full_citation,
          first_occurrence: index,
          repeat_kind: "full" as RepeatKind,
          locator: locator || undefined,
          url: occ.url,
        };
      }

      // `שם` requires both points to be single-source and the same authority.
      const adjacent = solo && prevSoloSourceId === occ.source_id;
      const newLocator = locator && locator !== prior.locator ? locator : "";
      let citation: string;
      let repeat_kind: RepeatKind;

      if (prior.isLegislation) {
        // Rule 37.5 — legislation never uses לעיל ה"ש with a case-law label.
        const section = extractSection(locator) || extractSection(prior.locator);
        if (adjacent) {
          repeat_kind = "ibid";
          citation = newLocator && section ? `שם, בס' ${section}.` : "שם.";
        } else {
          repeat_kind = "supra";
          citation = section && prior.lawName
            ? `ס' ${section} ל${prior.lawName}.`
            : prior.lawName
            ? `${prior.lawName}, לעיל ה"ש ${prior.index}.`
            : "שם.";
        }
      } else if (adjacent) {
        repeat_kind = "ibid";
        const suffix = newLocator ? withBetPrefix(newLocator) : "";
        citation = suffix ? `שם, ${suffix}.` : "שם.";
      } else {
        repeat_kind = "supra";
        const suffix = newLocator ? `, ${withBetPrefix(newLocator)}` : "";
        citation = `${prior.label}, לעיל ה"ש ${prior.index}${suffix}.`;
      }

      return {
        source_id: occ.source_id,
        citation,
        full_citation: prior.full,
        first_occurrence: prior.index,
        repeat_kind,
        locator: locator || undefined,
        url: occ.url,
      };
    });

    prevSoloSourceId = solo ? group[0].source_id : null;

    const head = entries[0];
    return {
      index,
      sources: entries,
      source_ids: entries.map((e) => e.source_id),
      source_id: head?.source_id ?? "",
      citation: entries.length ? joinCompound(entries) : "",
      full_citation: head?.full_citation ?? "",
      first_occurrence: head?.first_occurrence ?? index,
      repeat_kind: head?.repeat_kind ?? "full",
      locator: head?.locator,
      url: entries.length === 1 ? head?.url : undefined,
    };
  });
}

/**
 * Single-source convenience wrapper: each occurrence is its own citation point.
 */
export function buildOccurrenceFootnotes(
  occurrences: CitationOccurrence[],
  opts: { offset?: number } = {},
): OccurrenceFootnote[] {
  return buildCompoundFootnotes(occurrences.map((o) => [o]), opts);
}

/**
 * Backwards compatibility for answers rendered before occurrence footnotes:
 * strips a trailing markdown footnote-definition block and converts inline
 * `[^n]` markers into superscripts. Never mutates persisted records — call it
 * at display/copy time only.
 */
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

/** Convert any remaining legacy `[^n]` markers into superscript numerals. */
export function legacyMarkersToSuperscript(markdown: string): string {
  return (markdown ?? "").replace(/\[\^(\d+)\]/g, (_m, n: string) => toSuperscript(Number(n)));
}

/** Display/copy-safe normalisation of any answer, new or historical. */
export function normalizeAnswerForDisplay(markdown: string): string {
  return legacyMarkersToSuperscript(stripLegacyFootnoteDefinitions(markdown));
}
