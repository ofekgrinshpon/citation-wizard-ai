/**
 * Bluebook 22 foreign-source facade (Israeli Rule 35.1 → current Bluebook).
 * classify → extract → normalize → deterministic render → validate.
 */

import { detectForeignSource, type ForeignDetection } from "./extract";
import { escapeCitationLiteral, unescapeCitationLiteral } from "@/lib/citationSegments";
import {
  renderBook,
  renderBookChapter,
  renderConstitution,
  renderInternet,
  renderJournalArticle,
  renderUkCase,
  renderUkStatute,
  renderUsCase,
  renderUsStatute,
  stripMarkers,
  type RenderResult,
} from "./render";

export * from "./types";
export * from "./tables";
export { detectForeignSource, type ForeignDetection } from "./extract";
export {
  renderUsCase,
  renderUkCase,
  renderConstitution,
  renderUsStatute,
  renderUkStatute,
  renderJournalArticle,
  renderBook,
  renderBookChapter,
  renderInternet,
  stripMarkers,
  type RenderResult,
} from "./render";

/** Source-supplied field text is literal: escape marker-like characters. */
function literalFields(fields: unknown): unknown {
  if (typeof fields === "string") return escapeCitationLiteral(fields);
  if (Array.isArray(fields)) return fields.map(literalFields);
  if (fields && typeof fields === "object") {
    return Object.fromEntries(Object.entries(fields as Record<string, unknown>).map(([k, v]) => [k, literalFields(v)]));
  }
  return fields;
}

/** Warnings / unrepresented details are plain text for their consumers. */
function plainResult(r: RenderResult | null): RenderResult | null {
  if (!r) return r;
  const out: RenderResult = { ...r, warnings: r.warnings.map(unescapeCitationLiteral) };
  if (r.unrepresented) out.unrepresented = r.unrepresented.map(unescapeCitationLiteral);
  return out;
}

/**
 * Render a detection. Field values are treated as literal source text (a
 * title such as "C## Guide" is never read as markup); callers holding
 * stored, already-marked citations must pass plain text to detection.
 */
export function renderForeignDetection(d: ForeignDetection): RenderResult | null {
  return plainResult(renderDetectionFields(d.kind, d.jurisdiction, literalFields(d.fields)));
}

function renderDetectionFields(kind: ForeignDetection["kind"], jurisdiction: ForeignDetection["jurisdiction"], fields: unknown): RenderResult | null {
  const d = { kind, jurisdiction };
  const f = fields as never;
  switch (d.kind) {
    case "case":
      return d.jurisdiction === "UK" ? renderUkCase(f) : renderUsCase(f);
    case "constitution":
      return renderConstitution(f);
    case "statute":
      return d.jurisdiction === "UK" ? renderUkStatute(f) : renderUsStatute(f);
    case "journal_article":
      return renderJournalArticle(f);
    case "book":
      return renderBook(f);
    case "book_chapter":
      return renderBookChapter(f);
    case "internet":
      return renderInternet(f);
    default:
      return null;
  }
}

/**
 * Best-effort deterministic Bluebook rendering of a raw foreign citation.
 * Returns null when nothing can be rendered safely (no fabrication).
 */
export function renderForeignCitation(raw: string): (RenderResult & { detection: ForeignDetection }) | null {
  const detection = detectForeignSource(raw);
  if (!detection || detection.confidence !== "deterministic") return null;
  const rendered = renderForeignDetection(detection);
  if (!rendered) return null;
  return { ...rendered, detection };
}

export { stripMarkers as stripCitationMarkers };
