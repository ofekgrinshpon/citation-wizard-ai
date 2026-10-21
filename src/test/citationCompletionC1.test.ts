import { beforeEach, describe, expect, it, vi } from "vitest";
import { acceptCitationCompletion } from "@/lib/citationCompletion";
import { CHAT_HOST, RUNNER_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";
import { c1ServerPayload, C1_BROWN, C1_REDIGI } from "./fixtures/c1ServerPayload";
import { buildForeignArticleRequest } from "@/lib/foreignArticleAdapter";
import type { SourceType } from "@/data/abbreviations";
import capture from "./fixtures/foreignArticleSearchCapture.json";
import { renderCitationRecovery } from "@/lib/renderCitationRecovery";
beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); })));
const raw = "Brown v. Board of Education";
function plan(input = raw, sourceType: SourceType | null = null, caps = CHAT_HOST) {
  const evidence = planCitationEvidence(input, null);
  const p = { evidence, sourceType, input, isPinpoint: false, manual: false };
  const local = planLocalCitation(p, caps);
  return planTypedRequest({ ...p, statutePrep: "statutePrep" in local ? local.statutePrep : null, canonicalRaw: input }, caps);
}
describe("C1 existing extraction envelope acceptance", () => {
  it("retains ReDigi volume and reporter when only firstPage lacks provenance", async () => {
    const input = "Capitol Records, LLC v. ReDigi Inc.";
    const p = plan(input);
    const { response } = await c1ServerPayload({ kind: "case", jurisdiction: "UNKNOWN", rawInput: input, parsedFields: { caseName: input } }, [C1_REDIGI]);
    expect(response.fields).toMatchObject({ volume: "910", reporter: "F.3d", firstPage: "649", court: "2d Cir.", year: "2018" });
    delete response.provenance.firstPage;
    const result = resolveCitationResponse(p, { foreignLookup: response }, CHAT_HOST);
    expect(result.kind).toBe("terminal");
    if (result.kind !== "terminal") return;
    expect(result.resolution.completion?.fields).toMatchObject({ volume: "910", reporter: "F.3d" });
    expect(result.resolution.citation).toContain("910 F.3d [חסר: עמוד]");
    expect(result.resolution.reply).not.toContain("לא אותר מקור פרסום");
    expect(result.resolution.completion?.fields.firstPage).toBeUndefined();
  });
  it.each([false, true])("rejects crossed UK declaration with grounded US evidence, supplied anchor=%s", async anchored => {
    const input = "Capitol Records, LLC v. ReDigi Inc." + (anchored ? " (2d Cir. 2018)" : "");
    const p = plan(input);
    const { response } = await c1ServerPayload({ kind: "case", jurisdiction: "UNKNOWN", rawInput: input, parsedFields: { caseName: "Capitol Records, LLC v. ReDigi Inc." } }, [C1_REDIGI]);
    const crossed = { ...response, jurisdiction: "UK", identity: { ...response.identity, jurisdiction: "UK" } };
    const result = resolveCitationResponse(p, { foreignLookup: crossed }, CHAT_HOST);
    expect(result.kind).toBe("terminal");
    if (result.kind !== "terminal") return;
    expect(result.resolution.completion?.identityConfirmed).toBe(false);
    expect(result.resolution.citation).toBe(input);
    expect(result.resolution.warningMsg).toContain("שיפוט");
    expect(result.resolution.completion?.fields).toEqual({});
  });
  it("accepts real case server output identically, without requiring a new envelope or raw echo", async () => {
    const { response, calls } = await c1ServerPayload({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } });
    const a = resolveCitationResponse(plan(), { foreignLookup: response }, CHAT_HOST);
    const b = resolveCitationResponse(plan(raw, null, RUNNER_HOST), { foreignLookup: response }, RUNNER_HOST);
    expect(a).toEqual(b);
    expect(a.kind === "terminal" && a.resolution.citation).toBe(`${raw}, 347 U.S. 483 (1954).`);
    expect(calls).toEqual(["https://api.perplexity.ai/search"]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["missing_provenance", "value_mismatch", "weak_source", "conflicting_supplied", "field_conflict"])('quarantines %s without losing independently grounded fields', async mode => {
    const { response } = await c1ServerPayload({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } });
    const changed = structuredClone(response);
    if (mode === "missing_provenance") delete changed.provenance.year;
    if (mode === "value_mismatch") changed.provenance.year.value = "1999";
    if (mode === "weak_source") { changed.provenance.year.sourceTitle = "Home"; changed.provenance.year.sourceUrl = "https://example.test/weak"; changed.sources.push({ url: "https://example.test/weak", title: "Home", tier: "tier1" }); }
    if (mode === "field_conflict") changed.identity.conflicts = ["year:1954 vs 1999"];
    const req = { ...plan().foreignLookup, parsedFields: { caseName: raw, ...(mode === "conflicting_supplied" ? { year: "1999" } : {}) } };
    if (mode === "field_conflict") { changed.fields.year = "1999"; changed.provenance.year.value = "1999"; }
    const accepted = acceptCitationCompletion(req, raw, changed);
    expect(accepted.identityConfirmed).toBe(true);
    expect(accepted.fields.reporter).toBe("U.S.");
    expect(accepted.fields.year).toBeUndefined();
    expect(accepted.quarantined).toContain("year");
    const result = resolveCitationResponse({ ...plan(), foreignLookup: req }, { foreignLookup: changed, content: "UNSAFE" }, CHAT_HOST);
    expect(result.kind).toBe("terminal");
    if (result.kind === "terminal") { expect(result.resolution.status).toBe("warning"); expect(result.resolution.reply).toContain("347 U.S. 483"); expect(result.resolution.reply).not.toContain("UNSAFE"); }
  });
  it.each(["kind", "jurisdiction", "raw", "anchor", "identity_value", "unmatched", "empty", "error"])('terminally rejects %s', async mode => {
    const { response } = await c1ServerPayload({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } });
    const changed: Record<string, unknown> = structuredClone(response) as unknown as Record<string, unknown>;
    if (mode === "kind") changed.kind = "book";
    if (mode === "jurisdiction") { changed.jurisdiction = "UK"; }
    if (mode === "raw") changed.rawInput = "Other v Source";
    if (mode === "anchor") changed.identity = { ...response.identity, anchors: ["parties:other v source"] };
    if (mode === "identity_value") changed.fields = { ...response.fields, caseName: "Other v Source" };
    if (mode === "unmatched") changed.identity = { ...response.identity, matched: false };
    if (mode === "error") changed.error = "unavailable";
    const result = resolveCitationResponse(plan(), { foreignLookup: mode === "empty" ? null : changed, content: "UNSAFE" }, CHAT_HOST);
    expect(result.kind).toBe("terminal");
    if (result.kind === "terminal") { expect(result.resolution.citation).toBe(raw); expect(result.resolution.status).toBe("warning"); expect(result.resolution.reply).not.toContain("UNSAFE"); }
  });
  it("accepts the captured article extraction while preserving supplied abbreviated authors exactly", async () => {
    const request = buildForeignArticleRequest(capture.input.rawInput);
    const { response, calls } = await c1ServerPayload(request, [capture.searches[1].results[4]]);
    const accepted = acceptCitationCompletion({ ...request }, request.rawInput, response);
    expect(accepted.identityConfirmed).toBe(true);
    expect(accepted.fields.journal).toBe("Harvard Law Review");
    expect(accepted.fields.authors).toBeUndefined();
    expect(accepted.quarantined).toEqual([]);
    expect(calls).toHaveLength(1);
  });
  it.each(["statute", "book", "book_chapter"] as const)("existing %s server construction stays bounded and only adds supported fields", async kind => {
    const statute = kind === "statute";
    const input = statute ? "Civil Rights Act § 1983" : "Author: Jane Doe; " + (kind === "book" ? "Book: Synthetic Collection" : "Chapter: Quiet Rules; Collection: Synthetic Collection");
    const parsedFields = statute ? { statuteName: "Civil Rights Act", section: "1983" } : { bookTitle: "Synthetic Collection", authors: "Jane Doe" };
    const donor = statute ? { title: "Civil Rights Act — 42 U.S.C. § 1983 (2018)", snippet: "Civil Rights Act — 42 U.S.C. § 1983 (2018).", url: "https://www.law.cornell.edu/uscode/text/42/1983" } : { title: "Synthetic Collection — Jane Doe (2020)", snippet: "Jane Doe, Synthetic Collection (2020).", url: "https://press.example.edu/collection" };
    const request = { kind, jurisdiction: statute ? "US" as const : "OTHER" as const, rawInput: input, parsedFields };
    const { response, calls } = await c1ServerPayload(request, [donor]);
    const accepted = acceptCitationCompletion({ ...request, ...(statute ? { statuteResponseVersion: 1 } : {}) }, input, response);
    expect(accepted.identityConfirmed).toBe(true);
    expect(accepted.fields.year).toBe(statute ? "2018" : "2020");
    expect(calls.filter(c => c === "https://api.perplexity.ai/search")).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
  it("C2 anchorless book/chapter direct typed planning cannot manufacture identity", () => {
    for (const type of ["foreign_book", "foreign_book_chapter"] as const) {
      expect(plan("Synthetic work needing details", type, CHAT_HOST).foreignLookup).toBeNull();
      expect(plan("Synthetic work needing details", type, RUNNER_HOST).foreignLookup).toBeNull();
    }
    expect(CHAT_HOST.host).toBe("chat");
  });
  it("bound retained partial response renders exactly like the shared resolver without IO", async () => {
    const { response } = await c1ServerPayload({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } });
    delete response.provenance.year;
    const p = plan();
    const live = resolveCitationResponse(p, { foreignLookup: response }, CHAT_HOST);
    const now = Date.UTC(2026, 9, 20);
    const retained = renderCitationRecovery({ requestId: "offline-c1", status: "succeeded", availability: "available",
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(), retryOfRequestId: null,
      input: { messages: [{ role: "user", content: "Prepared presentation wrapper" }], rawInput: raw, foreignLookup: p.foreignLookup, batchId: null },
      result: { foreignLookup: response }, refundReceipt: null } as never, now);
    expect(live.kind).toBe("terminal");
    if (live.kind === "terminal") expect(retained?.formattedOutput).toBe(live.resolution.reply);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("URL and source id alone cannot ground any added fields", async () => {
    const { response } = await c1ServerPayload({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } });
    response.sources = response.sources.map(({ url, tier }) => ({ url, tier }));
    const accepted = acceptCitationCompletion(plan().foreignLookup ?? {}, raw, response);
    expect(accepted.fields).toEqual({});
    expect(accepted.quarantined).toContain("year");
  });
  it("matching title anchor cannot hide a different DOI anchor", async () => {
    const req = buildForeignArticleRequest(capture.input.rawInput + " DOI 10.2307/1321160");
    const { response } = await c1ServerPayload(req, [capture.searches[1].results[4]]);
    response.identity.anchors.push("doi:10.9999/wrong");
    const accepted = acceptCitationCompletion({ ...req }, req.rawInput, response);
    expect(accepted.identityConfirmed).toBe(false);
    expect(accepted.fields).toEqual({});
  });
});