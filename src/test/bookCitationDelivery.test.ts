import { describe, expect, it, vi } from "vitest";
import { prepareBookAwareCitationDelivery, readBookFinal, selectBookEditionChoice } from "../../supabase/functions/_shared/citationPure/bookFinal";
import type { CitationRecoveryInput } from "../../supabase/functions/_shared/citationRecovery";
import { CitationRecoveryApi, type CitationRecoveryRecord } from "@/lib/citationRecoveryApi";
import { CitationRequestIdentity } from "@/lib/citationRequestIdentity";
import { planCitationEvidence, planTypedRequest, resolveCitationResponse, RUNNER_HOST } from "@/lib/citationPlanner";
import { renderCitationRecovery } from "@/lib/renderCitationRecovery";
import { MemoryCitationJournal } from "./fixtures/memoryCitationJournal";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: {}, functions: {} } }));
const id = "public-book-fixture";
const examples = [
  ["National Identity", "Anthony D. Smith"],
  ["Brownlie's Principles of Public International Law", "James Crawford"],
] as const;

function fixture(title: string, author: string, count: number) {
  const raw = `${title} by ${author}`;
  const fields = { bookTitle: title, authors: author };
  const plan = planTypedRequest({
    evidence: planCitationEvidence(raw, null), sourceType: "foreign_book",
    input: raw, canonicalRaw: raw, isPinpoint: false, manual: false, statutePrep: null,
  }, RUNNER_HOST);
  const input: CitationRecoveryInput = {
    rawInput: raw, batchId: null, messages: [{ role: "user", content: raw }],
    foreignLookup: { enabled: true, kind: "book", jurisdiction: "OTHER", rawInput: raw, parsedFields: fields },
  };
  const years = ["1993", "1994"].slice(0, count);
  const records = years.map((year, i) => {
    const isbn = ["9780874172041", "9780198761228"][i];
    return { title, author, year, isbn, kind: "publication", sourceId: String(i), quote: `${raw} Paperback ${isbn} Published ${year}` };
  });
  const foreignLookup = {
    kind: "book", jurisdiction: "OTHER", fields: {}, grounded: {}, provenance: {}, diagnostics: { tier1Queried: true, tier2Fired: false },
    sources: records.map(r => ({ url: `https://example.org/${r.sourceId}`, tier: "tier1", snippet: r.quote, strong: true })),
    identity: { matched: count > 0, anchors: count > 0 ? [`title:${title}`] : [], conflicts: count === 2 ? ["year:editions:1993,1994"] : [] },
    bookModelEvidence: { version: 1, records, sources: records.map(r => ({ id: r.sourceId, url: `https://example.org/${r.sourceId}`, text: r.quote })) },
  };
  return { raw, plan, input, body: { content: "", foreignLookup } };
}

async function authenticatedRecord(input: CitationRecoveryInput, result: CitationRecoveryRecord["result"]) {
  const now = Date.now();
  const record: CitationRecoveryRecord = {
    requestId: id, retryOfRequestId: null, status: "succeeded", availability: "available", input, result,
    createdAt: new Date(now - 500).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
    refundReceipt: { status: "retained", refunded: false, units_refunded: 0, request_id: id },
  };
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "fixture-admin" }, access_token: "fixture", expires_at: now / 1000 + 3600 } }, error: null }) },
    functions: { invoke: vi.fn(async () => ({ data: { requests: [record], nextCursor: null }, error: null })) },
  };
  const api = new CitationRecoveryApi(client as never, new CitationRequestIdentity(256, new MemoryCitationJournal()));
  const found = await api.read("fixture-admin", id);
  expect(found).not.toBeNull();
  expect(client.functions.invoke).toHaveBeenCalledTimes(1);
  expect(client.functions.invoke.mock.calls[0]).toEqual(["citation-recovery", { body: { requestId: id }, headers: { Authorization: "Bearer fixture" } }]);
  return found!;
}

describe("book pilot delivery", () => {
  it.each(examples)("returns visible live and reloaded results without publication proof: %s", async (title, author) => {
    const { raw, plan, input, body } = fixture(title, author, 0);
    expect(plan.foreignLookup?.parsedFields).toEqual(input.foreignLookup?.parsedFields);
    const delivered = prepareBookAwareCitationDelivery(body, input, id, raw);
    expect(delivered.body.content).toContain("[חסר: שנה]");
    expect(readBookFinal(delivered.result?.content, input, id)?.reply).toBe(delivered.body.content);
    const live = resolveCitationResponse(plan, delivered.body, RUNNER_HOST);
    if (live.kind !== "terminal") throw new Error("expected terminal");
    expect(live.resolution.reply).toBe(delivered.body.content);
    expect(live.resolution.bookEditionChoice).toBeUndefined();
    expect(live.resolution.completion?.identityConfirmed).toBe(false);
    const reloaded = await authenticatedRecord(input, delivered.result);
    expect(renderCitationRecovery(reloaded)?.formattedOutput).toBe(delivered.body.content);
    expect(renderCitationRecovery({...reloaded})?.plainText).not.toContain("relex:book-final:");
  });

  it.each([1, 2])("renders %s evidenced year options and never stores private proof", async count => {
    const { raw, plan, input, body } = fixture(...examples[0], count);
    const delivered = prepareBookAwareCitationDelivery(body, input, id, raw);
    const live = resolveCitationResponse(plan, delivered.body, RUNNER_HOST);
    if (live.kind !== "terminal") throw new Error("expected terminal");
    expect(live.resolution.reply).toBe(delivered.body.content);
    if (count === 2) {
      expect(live.resolution.reply).toContain("[חסר: שנה]");
      const choices = live.resolution.bookEditionChoice!;
      expect(choices.options).toHaveLength(2);
      expect(selectBookEditionChoice(choices, "book-year-1994", raw)?.citation).toContain("1994");
      expect(selectBookEditionChoice(choices, "book-year-1994", raw + " ")).toBeNull();
    } else {
      expect(live.resolution.reply).toContain("1993");
      expect(live.resolution.bookEditionChoice).toBeUndefined();
    }
    expect(readBookFinal(delivered.result?.content, input, id)?.reply).toBe(live.resolution.reply);
    const stored = JSON.stringify(delivered.result);
    expect(stored).not.toMatch(/bookModelEvidence|9780874172041|snippet|strong/);
    expect(renderCitationRecovery(await authenticatedRecord(input, delivered.result))?.formattedOutput).toBe(live.resolution.reply);
  });

  it.each(["request binding", "jurisdiction", "unknown source key", "unknown envelope version"])("fails closed on %s without a blank success", flaw => {
    const { raw, input, body } = fixture(...examples[0], 1);
    if (flaw === "request binding") input.foreignLookup!.parsedFields = { authors: "Wrong Author", bookTitle: "Wrong Title" };
    if (flaw === "jurisdiction") body.foreignLookup.jurisdiction = "UK";
    if (flaw === "unknown source key") Object.assign(body.foreignLookup.sources[0], { unexpected: "do not retain" });
    if (flaw === "unknown envelope version") body.foreignLookup.bookModelEvidence.version = 9;
    const delivered = prepareBookAwareCitationDelivery(body, input, id, raw);
    expect(delivered.body.content).toContain(raw);
    expect(delivered.body.content).not.toContain("1993");
    expect(delivered.body.foreignLookup).toBeUndefined();
    expect(delivered.result).toEqual({ content: delivered.body.content });
  });

  it("preserves unrelated structured-only results", () => {
    const body = { content: "", foreignLookup: { kind: "case", jurisdiction: "US", fields: { year: "2005" },
      sources: [], grounded: {}, provenance: {}, diagnostics: { tier1Queried: true, tier2Fired: false }, identity: { matched: true, anchors: [], conflicts: [] } } };
    expect(prepareBookAwareCitationDelivery(body, null, id)).toEqual({ body, result: body });
  });
});
