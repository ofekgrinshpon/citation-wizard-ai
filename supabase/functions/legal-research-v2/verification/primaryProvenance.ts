/**
 * legal-research-v2 — SAFEGUARD B: unreadable primary authority fallback.
 *
 * When the user names a specific docketed authority and its own text cannot be
 * read well enough to verify a verbatim span, V2 may fall back to ONE bounded
 * research attempt for an AUTHORITATIVE DERIVATIVE source (typically a later
 * Supreme Court judgment that quotes or describes the requested judgment).
 *
 * The fallback source passes exactly the same body / identity / span / support
 * checks. Nothing here loosens verification: it only records where the support
 * came from, so the answer can disclose it and cite the document that was
 * actually verified — never the unreadable original.
 */

import type { EvidenceSource, SupportProvenance, VerifiedEvidencePack } from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import { hostOf, normalizeDocketText } from "../shared/primitives.ts";

const AUTHORITATIVE_HOSTS = [
  "court.gov.il",
  "supremedecisions.court.gov.il",
  "gov.il",
  "knesset.gov.il",
  "justice.gov.il",
  "nevo.co.il",
];

/** Is this document itself the requested authority (its own official text)? */
export function isPrimaryRepresentation(source: EvidenceSource, docketDisplay: string): boolean {
  const d = normalizeDocketText(docketDisplay);
  if (!d) return false;
  return normalizeDocketText(source.title).includes(d);
}

/**
 * An authoritative derivative is another *authoritative* document (judgment or
 * official material) that discusses the requested authority. Blogs, SEO pages,
 * anonymous summaries and search snippets never qualify.
 */
export function isAuthoritativeDerivative(
  source: EvidenceSource,
  docketDisplay: string,
): boolean {
  if (source.fetch_status !== "ok" || !source.is_actual_document) return false;
  const host = source.url ? hostOf(source.url) : "";
  if (!AUTHORITATIVE_HOSTS.some((h) => host.endsWith(h))) return false;
  const d = normalizeDocketText(docketDisplay);
  const body = normalizeDocketText(`${source.title}\n${source.extracted_text}`);
  if (!d || !body.includes(d)) return false;
  // It must be a document in its own right, not the requested one.
  return !isPrimaryRepresentation(source, docketDisplay);
}

export function classifyProvenance(
  source: EvidenceSource,
  docketDisplay: string,
): SupportProvenance {
  return isPrimaryRepresentation(source, docketDisplay)
    ? "primary_direct"
    : "authoritative_derivative";
}

export interface PrimaryGapReport {
  /** Named authorities the run must speak about. */
  obligations: string[];
  /** Obligations with no verified span from the authority's own text. */
  unreadable: string[];
  /** Obligations already answered from an authoritative derivative. */
  derivative: string[];
}

export function assessPrimaryGap(
  pack: VerifiedEvidencePack,
  store: EvidenceStore,
  obligations: string[],
): PrimaryGapReport {
  const unreadable: string[] = [];
  const derivative: string[] = [];
  for (const docket of obligations) {
    let direct = false;
    let deriv = false;
    for (const c of pack.claims) {
      for (const ref of c.sources) {
        const src = store.get(ref.source_id);
        if (!src) continue;
        if (isPrimaryRepresentation(src, docket)) direct = true;
        else if (isAuthoritativeDerivative(src, docket)) deriv = true;
      }
    }
    if (direct) continue;
    unreadable.push(docket);
    if (deriv) derivative.push(docket);
  }
  return { obligations, unreadable, derivative };
}

/** True when one bounded derivative-fallback research attempt is warranted. */
export function shouldAttemptDerivativeFallback(report: PrimaryGapReport): boolean {
  return report.unreadable.some((d) => !report.derivative.includes(d));
}

export function buildDerivativeFallbackMessage(dockets: string[]): string {
  return `לא הושג טקסט קריא של פסק הדין המקורי: ${dockets.join(", ")}.

סבב מחקר ממוקד אחד בלבד — מקור נגזר סמכותי:
- אתר פסק דין מאוחר של בית המשפט העליון (או מקור רשמי מקביל) המצטט, מתאר או מיישם במפורש את ההלכה שנקבעה ב${
    dockets.join(", ")
  }, והבא את גופו ב-fetch.
- אל תשתמש בבלוגים, בתקצירים אנונימיים, בדפי SEO או בתקצירי חיפוש.
- הציטוט חייב להיות מילה במילה מגוף פסק הדין המאוחר שנקרא, ולא מפסק הדין המקורי.
- נסח את הטענה כך שברור שהיא נשענת על אופן הצגת ההלכה בפסיקה המאוחרת.
אם גם זה לא מתאפשר — אל תמציא. רשום זאת ב-unresolved_questions והגש תזכיר.`;
}

export function buildDerivativeDisclosure(dockets: string[]): string {
  return `לא הצלחתי לאמת ישירות טקסט קריא של פסק הדין המקורי (${
    dockets.join(", ")
  }); הקביעות להלן מבוססות על האופן שבו ההלכה מוצגת בפסיקה מאוחרת של בית המשפט העליון.`;
}

/** Annotate verified refs with their provenance relative to a named authority. */
export function annotateProvenance(
  pack: VerifiedEvidencePack,
  store: EvidenceStore,
  obligations: string[],
): VerifiedEvidencePack {
  if (!obligations.length) return pack;
  return {
    ...pack,
    claims: pack.claims.map((c) => ({
      ...c,
      sources: c.sources.map((ref) => {
        const src = store.get(ref.source_id);
        if (!src) return ref;
        const docket = obligations.find((d) =>
          isPrimaryRepresentation(src, d) || isAuthoritativeDerivative(src, d)
        );
        if (!docket) return ref;
        return { ...ref, support_provenance: classifyProvenance(src, docket) };
      }),
    })),
  };
}
