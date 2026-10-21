import { describe, expect, it, vi } from "vitest";
import { CHAT_HOST, RUNNER_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";
import type { SourceType } from "@/data/abbreviations";
import { c1ServerPayload } from "./fixtures/c1ServerPayload";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";

export const book = "Author: Jane Doe; Book: Synthetic Collection";
export const chapter = "Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection";
const donor = { title: "Synthetic Collection — Jane Doe (2020)", snippet: "Jane Doe, Synthetic Collection (2020).", url: "https://press.example.edu/collection" };
const plan = (raw: string, type: SourceType, caps = CHAT_HOST) => {
  const evidence = planCitationEvidence(raw, citationManualChoice(type));
  const input = { evidence, sourceType: type, input: raw, isPinpoint: false, manual: false };
  const local = evidence.preserve ? { origin: "preserve", resolution: evidence.preserve } : planLocalCitation(input, caps);
  return "resolution" in local ? { local } : { typed: planTypedRequest({ ...input, canonicalRaw: raw, statutePrep: local.statutePrep }, caps) };
};

describe("C2 bounded existing book/chapter completion planning", () => {
  it.each([[book, "foreign_book", "book"], [chapter, "foreign_book_chapter", "book_chapter"]] as const)("eligible %s uses one shared bound request", (raw, type, kind) => {
    const chat = plan(raw, type), runner = plan(raw, type, RUNNER_HOST);
    expect(chat.typed?.kind).toBe("typed");
    expect(chat.typed?.foreignLookup).toMatchObject({ enabled: true, rawInput: raw, kind, jurisdiction: "OTHER", parsedFields: { authors: "Jane Doe", bookTitle: "Synthetic Collection" } });
    expect(chat.typed?.foreignLookup).toEqual(runner.typed?.foreignLookup);
  });
  it.each([
    ["Author: Jane Doe; Book: Synthetic Collection; Year: 2020", "foreign_book"],
    ["Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection; First page: 12; Year: 2020", "foreign_book_chapter"],
    ["Hidden Costs, Courts and Memory, in Synthetic Collection 12 (Jane Doe ed., 2020)", "foreign_book_chapter"],
    ["Catch 22 (Jane Doe ed., 2020)", "foreign_book"],
    ["Title 2020 (Jane Doe ed., 2020)", "foreign_book"],
    ["Courts and Memory, in Synthetic Collection 2020 (Jane Doe ed., 2020)", "foreign_book_chapter"],
    ["Synthetic work needing details", "foreign_book"],
    ["Book: Synthetic Collection; Year: unknown", "foreign_book"],
    ["Author: Jane Doe; Book: Synthetic Collection; Mystery: retained", "foreign_book"],
    ["Brown v. Board of Education", "foreign_book"],
  ] as const)("local/preserve never requests: %s", (raw, type) => {
    for (const caps of [CHAT_HOST, RUNNER_HOST]) expect(plan(raw, type, caps).local).toBeDefined();
  });
  it.each(["matching", "partial", "supplied-conflict", "wrong-kind", "wrong-jurisdiction", "wrong-raw", "unmatched", "error", "missing-key", "multiple", "no-provenance", "mismatched-provenance"])("server-produced envelope %s has semantic parity", async mode => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live calls"); }));
    const raw = mode === "supplied-conflict" ? book + "; Edition: 2d" : book;
    const chat = plan(raw, "foreign_book"), runner = plan(raw, "foreign_book", RUNNER_HOST);
    expect(chat.typed).toBeDefined(); expect(runner.typed).toBeDefined();
    if (!chat.typed || !runner.typed) return;
    const { response, calls } = await c1ServerPayload({ kind: "book", jurisdiction: "OTHER", rawInput: raw, parsedFields: { authors: "Jane Doe", bookTitle: "Synthetic Collection" } }, [donor]);
    const changed = structuredClone(response) as unknown as Record<string, any>;
    if (mode === "partial" || mode === "no-provenance") delete changed.provenance.year;
    if (mode === "supplied-conflict") { changed.fields.edition = "3d"; changed.grounded.edition = true; changed.provenance.edition = { ...changed.provenance.year, value: "3d" }; }
    if (mode === "wrong-kind") changed.kind = "case";
    if (mode === "wrong-jurisdiction") changed.jurisdiction = "US";
    if (mode === "wrong-raw") changed.rawInput = "Other source";
    if (mode === "unmatched") changed.identity.matched = false;
    if (mode === "error" || mode === "missing-key") changed.error = mode;
    if (mode === "multiple") changed.disambiguation = [{ label: "A" }, { label: "B" }];
    if (mode === "mismatched-provenance") changed.provenance.year.value = "2019";
    const a = resolveCitationResponse(chat.typed, { foreignLookup: changed, content: "UNSAFE" }, CHAT_HOST);
    const b = resolveCitationResponse(runner.typed, { foreignLookup: changed, content: "UNSAFE" }, RUNNER_HOST);
    expect(a.kind).toBe("terminal"); expect(b.kind).toBe("terminal");
    if (a.kind !== "terminal" || b.kind !== "terminal") return;
    expect(a.resolution.completion).toEqual(b.resolution.completion);
    expect(a.resolution.warningMsg).toEqual(b.resolution.warningMsg);
    expect(a.resolution.reply).not.toContain("UNSAFE");
    expect(a.resolution.pastedCitation?.rawInput).toBe(raw);
    if (mode === "matching") expect(a.resolution.completion?.fields.year).toBe("2020");
    if (mode === "supplied-conflict") { expect(a.resolution.citation).toContain("2d"); expect(a.resolution.completion?.fields.edition).toBeUndefined(); }
    expect(calls).toEqual(["https://api.perplexity.ai/search"]);
    expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
});