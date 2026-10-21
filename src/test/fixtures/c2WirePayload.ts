import { CHAT_HOST, planCitationEvidence, planLocalCitation, planTypedRequest } from "@/lib/citationPlanner";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";
import { c1ServerPayload } from "./c1ServerPayload";
export const C2_WIRE = [
  { id: "A", raw: "Author: Jane Doe; Book: Synthetic Collection; Original year: 1901", type: "foreign_book", local: { originalYear: "1901" }, output: "1901" },
  { id: "B", raw: "Author: Jane Doe; Book: Synthetic Collection; Publisher: Synthetic Press; Publisher status: non-original", type: "foreign_book", local: { publisher: "Synthetic Press", publisherStatus: "non-original" }, output: "Synthetic Press" },
  { id: "C", raw: "Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection; First page: 12; Pinpoint: 214-216", type: "foreign_book_chapter", local: { firstPage: "12", pinpoint: "214-216" }, output: "214–216" },
  { id: "D", raw: "Author: Jane Doe; Book: Synthetic Collection; Section: 4.2", type: "foreign_book", local: { section: "4.2" }, output: "§ 4.2" },
] as const;
type WireFixture = { id: string; raw: string; type: "foreign_book" | "foreign_book_chapter" };
export function c2WirePlan(f: WireFixture) {
  const evidence = planCitationEvidence(f.raw, citationManualChoice(f.type));
  const input = { evidence, sourceType: f.type, input: f.raw, isPinpoint: false, manual: false };
  const local = planLocalCitation(input, CHAT_HOST);
  if ("resolution" in local) throw new Error("Expected bounded completion for wire fixture " + f.id);
  return planTypedRequest({ ...input, canonicalRaw: f.raw, statutePrep: local.statutePrep }, CHAT_HOST);
}
export async function c2WirePayload(f: WireFixture) {
  const plan = c2WirePlan(f);
  const chapter = f.type === "foreign_book_chapter";
  const donor = { title: `${chapter ? "Quiet Rules — " : ""}Jane Doe, Synthetic Collection (2nd ed. 2020)`, snippet: `Jane Doe, ${chapter ? "Quiet Rules, in " : ""}Synthetic Collection (2nd ed. 2020).`, url: "https://press.example.edu/collection/quiet-rules" };
  const request = plan.foreignLookup;
  if (!request) throw new Error("Missing book lookup");
  const { response, calls } = await c1ServerPayload({ kind: chapter ? "book_chapter" : "book", jurisdiction: "OTHER", rawInput: f.raw,
    parsedFields: request.parsedFields as Record<string, string> }, [donor]);
  return { plan, response, calls };
}