import { c1ServerPayload } from "./c1ServerPayload";
export const C2_BOOK = "Author: Jane Doe; Book: Synthetic Collection";
export const C2_CHAPTER = "Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection";
export const C2_DONOR = { title: "Synthetic Collection — Jane Doe (2020)", snippet: "Jane Doe, Synthetic Collection (2020).", url: "https://press.example.edu/collection" };
export const C2_MODES = ["matching", "partial", "supplied-conflict", "wrong-kind", "wrong-jurisdiction", "wrong-raw", "unmatched", "error", "missing-key", "multiple", "no-provenance", "mismatched-provenance"] as const;
export type C2Mode = typeof C2_MODES[number];
export async function c2Payload(kind: "book" | "book_chapter", rawInput: string, mode: C2Mode) {
  const { response, calls } = await c1ServerPayload({ kind, jurisdiction: "OTHER", rawInput, parsedFields: { authors: "Jane Doe", bookTitle: "Synthetic Collection", ...(kind === "book_chapter" ? { chapterTitle: "Quiet Rules" } : {}) } }, [C2_DONOR]);
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