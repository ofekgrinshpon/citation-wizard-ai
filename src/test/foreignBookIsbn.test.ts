import { describe, expect, it, vi } from "vitest";
import { CHAT_HOST, RUNNER_HOST, WORD_HOST, foreignFreeformSourceType, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse, selectBookEditionChoice } from "@/lib/citationPlanner";
import { validateCitationInput } from "@/lib/citationInputValidation";
import { citationTextOnly } from "@/lib/citationSegments";
import { boundBookCompletion } from "../../supabase/functions/_shared/citationPure/bookFinal";
import type { CitationRecoveryInput } from "../../supabase/functions/_shared/citationRecovery";
import { extractBookIsbn, normalizeBookIsbn } from "../../supabase/functions/_shared/citationPure/bookIsbn";
import { runForeignLookup } from "../../supabase/functions/citation-chat/foreignLookup";

const isbn = "9780874172041";
const fixture = { title: "National Identity", authors: [{ name: "Anthony D. Smith" }], publish_date: "1993", identifiers: { isbn_10: ["0874172047"], isbn_13: [isbn] } };
const fetchRecord = (patch: Record<string, unknown> = {}) => vi.fn<typeof fetch>().mockImplementation(async () =>
  new Response(JSON.stringify({ ["ISBN:" + isbn]: { ...fixture, ...patch } })));
function planFor(raw: string, caps = CHAT_HOST) {
  const p = { evidence: planCitationEvidence(raw, null), sourceType: foreignFreeformSourceType(raw), input: raw, isPinpoint: false, manual: false };
  expect(p.sourceType).toBe("foreign_book");
  expect(planLocalCitation(p, caps).origin).toBeNull();
  const plan = planTypedRequest({ ...p, statutePrep: null, canonicalRaw: raw }, caps);
  expect(plan.foreignLookup).toMatchObject({ kind: "book", jurisdiction: "OTHER" });
  return plan;
}
describe("exact book ISBN lookup", () => {
  it("checks both ISBN formats and accepts a bare valid identifier", () => {
    expect(normalizeBookIsbn("0-87417-204-7")).toBe(isbn);
    expect(normalizeBookIsbn("978-0-87417-204-1")).toBe(isbn);
    expect(extractBookIsbn("ISBN 9780874172042")?.isbn).toBeNull();
    expect(extractBookIsbn("A review of ISBN systems")).toBeNull();
    expect(validateCitationInput(isbn).valid).toBe(true);
  });
  it.each([CHAT_HOST, WORD_HOST, RUNNER_HOST])("completes $host with exactly one fixed catalogue request", async caps => {
    const raw = "ISBN: 0-87417-204-7";
    const plan = planFor(raw, caps);
    expect(boundBookCompletion({ messages: [{ role: "user", content: raw }], batchId: null, rawInput: raw, foreignLookup: plan.foreignLookup } as CitationRecoveryInput)).not.toBeNull();
    const fetchImpl = fetchRecord();
    const result = await runForeignLookup({ kind: "book", jurisdiction: "OTHER", rawInput: raw }, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin).toBe("https://openlibrary.org");
    expect(url.searchParams.get("bibkeys")).toBe("ISBN:" + isbn);
    const resolved = resolveCitationResponse(plan, { foreignLookup: result }, caps);
    if (resolved.kind !== "terminal") throw new Error("Expected terminal response");
    expect(citationTextOnly(resolved.resolution.citation)).toBe("Anthony D. Smith, National Identity (1993).");
  });
  it("preserves supplied wording and discards a record that conflicts", async () => {
    const raw = "National Identity by Smith, Anthony D; ISBN 9780874172041";
    const plan = planFor(raw);
    const request = { kind: "book" as const, jurisdiction: "OTHER" as const, rawInput: raw };
    const matching = await runForeignLookup(request, { fetchImpl: fetchRecord() });
    expect(matching.fields).toEqual({ year: "1993" });
    const resolved = resolveCitationResponse(plan, { foreignLookup: matching }, CHAT_HOST);
    if (resolved.kind !== "terminal") throw new Error("Expected terminal response");
    expect(citationTextOnly(resolved.resolution.citation)).toContain("(1993)");
    for (const patch of [{ title: "Different title" }, { authors: [{ name: "Jane Smith" }] },
      { identifiers: { isbn_13: ["9780980200447"] } }, { publish_date: "1993 or 1999" }]) {
      expect((await runForeignLookup(request, { fetchImpl: fetchRecord(patch) })).identity.matched).toBe(false);
    }
  });
  it("avoids searching an invalid ISBN and preserves partial content when catalogue unavailable", async () => {
    const raw = "ISBN 9780874172042", fetchImpl = fetchRecord();
    const r = await runForeignLookup({ kind: "book", jurisdiction: "OTHER", rawInput: raw }, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.identity.matched).toBe(false);
    const p = { evidence: planCitationEvidence(raw, null), sourceType: foreignFreeformSourceType(raw), input: raw, isPinpoint: false, manual: false };
    const local = planLocalCitation(p, CHAT_HOST);
    expect("resolution" in local && local.resolution.status).toBe("warning");
    const failure = await runForeignLookup({ kind: "book", jurisdiction: "OTHER", rawInput: isbn },
      { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 429 })) });
    expect(failure.error).toBe("isbn_lookup_unavailable");
    expect(failure.fields).toEqual({});
  });
  it.each([CHAT_HOST, WORD_HOST, RUNNER_HOST])("applies edition choice locally in $host", async caps => {
    const raw = "National Identity by Smith, Anthony D";
    const plan = planFor(raw, caps);
    const results = ["1991", "1993"].map(year => ({ url: "https://press.example.edu/" + year, title: "National Identity — Anthony D. Smith", snippet: `Anthony D. Smith, National Identity (${year}).` }));
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ results })));
    const found = await runForeignLookup({ kind: "book", jurisdiction: "OTHER", rawInput: raw, parsedFields: { bookTitle: "National Identity", authors: "Smith, Anthony D" } }, { apiKey: "mock", fetchImpl });
    const resolved = resolveCitationResponse(plan, { foreignLookup: found }, caps);
    if (resolved.kind !== "terminal") throw new Error("Expected terminal response");
    const choice = resolved.resolution.bookEditionChoice!;
    expect(choice.options.map(o => o.year).sort()).toEqual(["1991", "1993"]);
    const before = fetchImpl.mock.calls.length, id = choice.options.find(o => o.year === "1993")!.id;
    const chosen = selectBookEditionChoice(choice, id, raw, caps);
    if (chosen.kind !== "resolved") throw new Error("Expected edition choice");
    expect(citationTextOnly(chosen.resolution.citation)).toContain("(1993)");
    const keep = selectBookEditionChoice(choice, "keep-missing", raw, caps);
    if (keep.kind !== "resolved") throw new Error("Expected keep missing");
    expect(citationTextOnly(keep.resolution.citation)).not.toMatch(/1991|1993/);
    expect(selectBookEditionChoice(choice, id, raw + " (2003)", caps).kind).toBe("stale");
    expect(fetchImpl).toHaveBeenCalledTimes(before);
  });
});
