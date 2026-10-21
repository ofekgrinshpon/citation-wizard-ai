import { c1ServerPayload } from "./c1ServerPayload";
export const C2_BOOK = "Author: Jane Doe; Book: Synthetic Collection";
export const C2_CHAPTER = "Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection";
export const C2_DONOR = { title: "Synthetic Collection — Jane Doe (2020)", snippet: "Jane Doe, Synthetic Collection (2020).", url: "https://press.example.edu/collection" };
export const C2_MODES = ["matching", "partial", "supplied-conflict", "wrong-kind", "wrong-jurisdiction", "wrong-raw", "unmatched", "error", "missing-key", "multiple", "no-provenance", "mismatched-provenance"] as const;
export type C2Mode = typeof C2_MODES[number];
export const C2_CORRECTION_MODES = ["edition-book", "edition-chapter", "wrong-chapter", "absent-chapter", "firstPage-only", "partial-chapter"] as const;
export type C2CorrectionMode = typeof C2_CORRECTION_MODES[number];
export function c2CorrectionFixture(mode: C2CorrectionMode) {
  const kind = mode === "edition-book" ? "book" : "book_chapter";
  const type = mode === "edition-book" ? "foreign_book" : "foreign_book_chapter";
  const rawInput = kind === "book" ? C2_BOOK : C2_CHAPTER + (mode === "partial-chapter" || mode === "firstPage-only" ? "" : "; First page: 12") + (mode === "firstPage-only" ? "; Year: 2020" : "");
  const title = mode === "wrong-chapter" ? "Different Chapter" : "Quiet Rules";
  const donor = mode === "absent-chapter" || kind === "book"
    ? { title: "Jane Doe, Synthetic Collection (2nd ed. 2020)", snippet: "Jane Doe, Synthetic Collection (2nd ed. 2020).", url: "https://press.example.edu/collection" }
    : { title: `${title} — Jane Doe, Synthetic Collection (2nd ed. 2020)`, snippet: `Jane Doe, ${title}, in Synthetic Collection 130 (2nd ed. 2020).`, url: `https://press.example.edu/collection/${mode === "wrong-chapter" ? "different-chapter" : "quiet-rules"}` };
  return { kind, type, rawInput, donor } as const;
}
export async function c2CorrectionPayload(mode: C2CorrectionMode) {
  const fixture = c2CorrectionFixture(mode);
  const { response, calls } = await c1ServerPayload({ kind: fixture.kind, jurisdiction: "OTHER", rawInput: fixture.rawInput,
    parsedFields: { authors: "Jane Doe", bookTitle: "Synthetic Collection", ...(fixture.kind === "book_chapter" ? { chapterTitle: "Quiet Rules" } : {}) } }, [fixture.donor]);
  return { ...fixture, response, calls };
}
export async function c2Payload(kind: "book" | "book_chapter", rawInput: string, mode: C2Mode) {
  const donor = kind === "book_chapter" ? { ...C2_DONOR, title: "Quiet Rules — Jane Doe, Synthetic Collection (2020)", snippet: "Jane Doe, Quiet Rules, in Synthetic Collection (2020)." } : C2_DONOR;
  const { response, calls } = await c1ServerPayload({ kind, jurisdiction: "OTHER", rawInput, parsedFields: { authors: "Jane Doe", bookTitle: "Synthetic Collection", ...(kind === "book_chapter" ? { chapterTitle: "Quiet Rules" } : {}) } }, [donor]);
  if (mode === "partial" || mode === "no-provenance") delete response.provenance.year;
  if (mode === "supplied-conflict") { response.fields.edition = "3d"; response.grounded.edition = true; response.provenance.edition = { ...response.provenance.year, value: "3d" }; }
  if (mode === "wrong-kind") response.kind = "case";
  if (mode === "wrong-jurisdiction") response.jurisdiction = "US";
  if (mode === "unmatched") response.identity.matched = false;
  if (mode === "error" || mode === "missing-key") response.error = mode;
  if (mode === "multiple") response.disambiguation = [{ jurisdiction: "US", label: "A", url: "https://a.example.test" }, { jurisdiction: "UK", label: "B", url: "https://b.example.test" }];
  if (mode === "mismatched-provenance") response.provenance.year.value = "2019";
  return { response: mode === "wrong-raw" ? { ...response, rawInput: "Other source" } : response, calls };
}