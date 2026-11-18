/** The regular authenticated citation route may request structured book
 * evidence, but only for strict deterministic no-year book inputs. */
import { boundBookCompletion } from "../_shared/citationPure/bookFinal.ts";
import { prepareFreeformHandoff } from "../_shared/citationPure/freeformInterpret.ts";
import type { CitationRecoveryInput } from "../_shared/citationRecovery.ts";

export interface BookCrossrefTarget { title: string; author: string }
const FIELD = /^[\p{L}\p{M}\d][\p{L}\p{M}\d .'’&,:()\-–]{1,160}$/u;
const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Transmit only title/byline, never the raw input, notes, or user account. */
export function bookCrossrefTarget(
  setting: string | undefined,
  input: CitationRecoveryInput | null,
): BookCrossrefTarget | null {
  if (setting !== undefined && setting !== "on") return null;
  if (!input || input.foreignLookup?.kind !== "book") return null;
  const bound = boundBookCompletion(input);
  if (!bound || bound.type !== "foreign_book") return null;
  const classified = prepareFreeformHandoff(bound.raw);
  if (classified?.mode !== "search" || classified.request.kind !== "book" ||
      classified.request.jurisdiction !== "OTHER") return null;
  const fields = classified.request.parsedFields;
  const title = fields.bookTitle, author = fields.authors;
  if (!title || !author || !FIELD.test(title) || !FIELD.test(author) ||
      ![norm(`${title} by ${author}`), norm(`${title} מאת ${author}`)].includes(norm(bound.raw)) ||
      Object.keys(fields).length !== 2 || bound.local.wire.bookTitle !== title ||
      bound.local.wire.authors !== author || Object.keys(bound.local.wire).length !== 2) return null;
  return { title, author };
}
