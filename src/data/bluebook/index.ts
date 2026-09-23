/**
 * Bluebook 22 foreign-source facade (Israeli Rule 35.1 → current Bluebook).
 * classify → extract → normalize → deterministic render → validate.
 */

import { detectForeignSource, type ForeignDetection } from "./extract";
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

export function renderForeignDetection(d: ForeignDetection): RenderResult | null {
  const f = d.fields as never;
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
