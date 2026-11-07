/**
 * Stage 4 mocked end-to-end: the real runCitation planner, the real lookup,
 * and the real renderer. Search responses are fixtures. No live provider.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { createCitationBudget } from "../../supabase/functions/_shared/citationPure/freeformInterpret";
import { citationTextOnly } from "@/lib/citationSegments";
import { CHAT_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse, selectForeignCaseChoice } from "@/lib/citationPlanner";
import { runCitation } from "@/lib/runCitation";

const m = vi.hoisted(() => ({ invoke: vi.fn(), searches: 0 }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke, retryCitationFunction: vi.fn(), citationRetryDisclosure: vi.fn() }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: vi.fn().mockResolvedValue(null), findSimilarVerifiedSource: vi.fn().mockResolvedValue(null) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: async () => { throw new Error("classifier offline"); } }, from: () => { throw new Error("no database"); } } }));

const BOOK = "National identity by Smith, Anthony D";
const MIXED = "הספר National identity מאת Smith, Anthony D";
const ARTICLE = "The Path of the Law by Holmes, Oliver Wendell, Harvard Law Review";

function hit(title: string, snippet: string, url = "https://press.example.edu/work") {
  return { title, url, snippet };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.searches = 0;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

async function cite(rawInput: string, results: Array<{ title: string; url: string; snippet: string }>, failFirst = false) {
  const budget = createCitationBudget();
  let looked: unknown;
  m.invoke.mockImplementation(async (_name: string, body: { foreignLookup?: ForeignLookupInput }) => {
    if (!body.foreignLookup) return { data: { content: 'ע"א 240/95 כהן נ׳ לוי, פ"ד י 1 (1954).' }, errorInfo: null };
    const response = await runForeignLookup(body.foreignLookup, {
      apiKey: "offline-only", budget,
      fetchImpl: (async () => {
        m.searches += 1;
        if (failFirst && m.searches === 1) throw new Error("timeout");
        return new Response(JSON.stringify({ results }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    looked = response;
    return { data: { foreignLookup: response, content: "" }, errorInfo: null };
  });
  const result = await runCitation({ rawInput, useVerifiedStore: false });
  return { result, budget, looked, request: m.invoke.mock.calls.at(-1)?.[1] as { foreignLookup?: ForeignLookupInput } | undefined };
}

describe("mocked citation flow", () => {
  it("turns the inverted Smith byline into a citation only from the matching edition", async () => {
    const { result, budget } = await cite(BOOK, [
      hit("National Identity", "Joan Other, National Identity (2001)."),
      hit("National Identity — Anthony D. Smith", "Anthony D. Smith, National Identity (1991).", "https://press.example.edu/smith-1991"),
    ]);
    const text = citationTextOnly(result.citation);
    expect(text).toContain("Smith, Anthony D");
    expect(text).toContain("National identity");
    expect(text).toContain("1991");
    expect(text).not.toContain("2001");
    expect(text).not.toContain("Joan");
    expect(text).not.toContain("Polity");
    expect(result.reply).not.toContain("מאומת");
    expect(budget.searches).toBeLessThanOrEqual(2);
    expect(budget.modelCalls).toBe(0);
    expect(m.searches).toBeLessThanOrEqual(2);
  });

  it("keeps the same citation when the name is wrapped in Hebrew cues", async () => {
    const { result, request } = await cite(MIXED, [
      hit("National Identity — Anthony D. Smith", "Anthony D. Smith, National Identity (1991)."),
    ]);
    expect(request?.foreignLookup?.parsedFields).toEqual({ bookTitle: "National identity", authors: "Smith, Anthony D" });
    expect(request?.foreignLookup?.rawInput).toBe(MIXED);
    expect(citationTextOnly(result.citation)).toContain("1991");
    expect(citationTextOnly(result.citation)).toContain("Smith, Anthony D");
  });

  it("does not treat a similar surname, a bare title, or two editions as one verified book", async () => {
    const wrong = await cite(BOOK, [hit("National Identity", "John Smith, National Identity (1988).")]);
    expect(citationTextOnly(wrong.result.citation)).not.toContain("1988");
    expect(wrong.result.completion?.identityConfirmed).not.toBe(true);

    const bare = await cite(BOOK, [hit("National Identity", "National Identity (1991).")]);
    expect(citationTextOnly(bare.result.citation)).not.toContain("1991");

    const editions = await cite(BOOK, [
      hit("National Identity", "Anthony D. Smith, National Identity (1991).", "https://press.example.edu/a"),
      hit("National Identity", "Anthony D. Smith, National Identity (2nd ed. 2001).", "https://press.example.edu/b"),
    ]);
    const editionText = citationTextOnly(editions.result.citation);
    expect(editionText).not.toContain("1991");
    expect(editionText).not.toContain("2001");
    expect(editionText).not.toMatch(/2nd ed/);
    expect(editions.result.completion?.identityConfirmed).toBe(true);
    expect(editions.result.completion?.fields.year).toBeUndefined();

    const sameYear = await cite(BOOK, [
      hit("National Identity", "Anthony D. Smith, National Identity (1991).", "https://press.example.edu/c"),
      hit("National Identity", "Anthony D. Smith, National Identity (2nd ed. 1991).", "https://press.example.edu/d"),
    ]);
    const sameYearText = citationTextOnly(sameYear.result.citation);
    expect(sameYearText).toContain("1991");
    expect(sameYearText).not.toMatch(/2nd ed/);
    expect(sameYear.result.completion?.fields.edition).toBeUndefined();
  });

  it("does not confirm Anthony Smith from Anthony J. Smith, and does confirm Smith, Anthony and Hart, H.L.A.", async () => {
    const ambiguous = await cite("National Identity by Anthony Smith", [
      hit("National Identity — Anthony J. Smith", "Anthony J. Smith, National Identity (1980)."),
    ]);
    expect(citationTextOnly(ambiguous.result.citation)).not.toContain("1980");
    expect(ambiguous.result.completion?.fields.year).toBeUndefined();

    const callsBefore = m.invoke.mock.calls.length;
    const beforeInverted = m.searches;
    const inverted = await cite("National identity by Smith, Anthony", [
      hit("National Identity — Anthony Smith", "Anthony Smith, National Identity (1991)."),
    ]);
    expect(citationTextOnly(inverted.result.citation)).not.toContain("1991");
    expect(m.invoke.mock.calls.length).toBe(callsBefore);
    expect(m.searches).toBe(beforeInverted);

    const beforeWarren = m.invoke.mock.calls.length;
    const warren = await cite("Privacy by Warren, Louis", [
      hit("Privacy — Louis Warren", "Louis Warren, Privacy (1990)."),
    ]);
    expect(citationTextOnly(warren.result.citation)).not.toContain("1990");
    expect(m.invoke.mock.calls.length).toBe(beforeWarren);

    const hart = await cite("The Concept of Law by Hart, H.L.A.", [
      hit("The Concept of Law — H.L.A. Hart", "H.L.A. Hart, The Concept of Law (1961)."),
    ]);
    expect(citationTextOnly(hart.result.citation)).toContain("1961");
    expect(hart.budget.modelCalls).toBe(0);
  });

  it("does not route a bare Review title as an article and keeps a Hebrew note with a Latin book", async () => {
    const review = await cite("National identity by Smith, Anthony, A Review of Politics", []);
    expect(review.request?.foreignLookup).toBeUndefined();
    expect(review.result.sourceType).not.toBe("foreign_journal_article");
    expect(m.searches).toBe(0);

    const noted = await cite("הערה 12/34 National identity by Smith, Anthony D", [
      hit("National Identity — Anthony D. Smith", "Anthony D. Smith, National Identity (1991)."),
    ]);
    expect(noted.request?.foreignLookup?.kind).toBe("book");
    expect(citationTextOnly(noted.result.citation)).toContain("1991");
  });

  it("completes the article from the full name and ignores a different Holmes", async () => {
    const good = await cite(ARTICLE, [hit(
      "The Path of the Law — Oliver Wendell Holmes",
      "Oliver Wendell Holmes, The Path of the Law, 10 Harvard Law Review 457 (1897).",
      "https://lawreview.example.edu/path",
    )]);
    const goodText = citationTextOnly(good.result.citation);
    expect(goodText).toContain("1897");
    expect(goodText).toContain("Harv. L. Rev.");
    expect(goodText).not.toContain("1901");
    expect(good.budget.modelCalls).toBe(0);

    const wrong = await cite(ARTICLE, [hit(
      "The Path of the Law — Joan Holmes",
      "Joan Holmes, The Path of the Law, 10 Yale Law Journal 1 (1901).",
      "https://lawreview.example.edu/other",
    )]);
    expect(citationTextOnly(wrong.result.citation)).not.toContain("1901");
    expect(wrong.result.completion?.fields.year).toBeUndefined();
  });

  it("formats a chosen case record without another search or model call", async () => {
    const input = "Donoghue v Stevenson";
    const { result, budget, looked } = await cite(input, [hit(
      "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)",
      "Donoghue v Stevenson [1932] UKHL 100, [1932] AC 562, 1932 SC (HL) 31.",
      "https://www.bailii.org/uk/cases/UKHL/1932/100.html",
    )]);
    expect(citationTextOnly(result.reply)).toContain("AC 562");
    expect(citationTextOnly(result.reply)).toContain("SC (HL)");
    expect(result.citation).toBe("");
    const evidence = planCitationEvidence(input, null);
    const base = { evidence, sourceType: "foreign" as const, input, isPinpoint: false, manual: false };
    const local = planLocalCitation(base, CHAT_HOST);
    const plan = planTypedRequest({ ...base, statutePrep: "statutePrep" in local ? local.statutePrep : null, canonicalRaw: input }, CHAT_HOST);
    const chat = resolveCitationResponse(plan, { foreignLookup: looked }, CHAT_HOST);
    if (chat.kind !== "terminal") throw new Error(chat.kind);
    expect(chat.resolution.foreignChoice?.options.length).toBeGreaterThan(1);
    const searches = m.searches;
    const before = { ...budget };
    const picked = chat.resolution.foreignChoice!.options.find((option) => option.label.includes("SC (HL)"))!;
    const chosen = selectForeignCaseChoice(chat.resolution.foreignChoice!, picked.id, [input], CHAT_HOST);
    expect(chosen.kind).toBe("resolved");
    if (chosen.kind !== "resolved") return;
    expect(citationTextOnly(chosen.resolution.citation)).toContain("1932 SC (HL) 31");
    expect(citationTextOnly(chosen.resolution.citation)).not.toContain("AC 562");
    expect(m.searches).toBe(searches);
    expect(budget).toEqual(before);
  });

  it("leaves an Israeli docket on the Israeli path", async () => {
    const { request, result } = await cite("ע\"א 240/95", []);
    expect(request?.foreignLookup?.freeformHandoff).toBeUndefined();
    expect(request?.foreignLookup?.kind).not.toBe("book");
    expect(result.sourceType).not.toBe("foreign_book");
    expect(m.searches).toBe(0);
  });

  it("does not send a second search when the first outcome is unknown", async () => {
    const { budget } = await cite(BOOK, [hit("National Identity", "Anthony D. Smith, National Identity (1991).")], true);
    expect(m.searches).toBe(1);
    expect(budget.unknown).toBe(true);
    expect(budget.searches).toBe(1);
  });
});
