/**
 * D1 correction gate: AU/CA/FR × six enabled general-literature families must
 * match the pre-D1 baseline (b36df130) through the actual runCitation host.
 * Fixture captured ONLY by running this file inside an extracted baseline tree
 * with D1_LIT_CAPTURE=<path>; never regenerated from the candidate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { runCitation } from "@/lib/runCitation";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";
import type { SourceType } from "@/data/abbreviations";

const m = vi.hoisted(() => ({ invoke: vi.fn(), classifier: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: m.cache }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.classifier } } }));
beforeEach(() => {
  vi.clearAllMocks();
  m.cache.mockResolvedValue(null);
  m.classifier.mockResolvedValue({ data: { sourceType: "foreign", confidence: 1 }, error: null });
  m.invoke.mockResolvedValue({ data: { content: "UNSAFE MODEL OUTPUT" }, errorInfo: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

const FIXTURE = "src/test/fixtures/rulepackD1LiteratureBaseline.json";
const INPUTS: Array<[SourceType, string]> = [
  ["foreign_book", "Author: Jane Doe; Book: Synthetic Collection; Edition: 2nd; Year: 2020"],
  ["foreign_book_chapter", "Author: Jane Doe; Chapter: Hidden Costs; Book: Synthetic Collection; Editors: John Roe; Year: 2020"],
  ["foreign_journal_article", "Jane Doe, Hidden Costs, 12 Yale L.J. 34 (2020)"],
  ["foreign_newspaper", "Author: Jane Doe; Title: Hidden Costs; Newspaper: N.Y. Times; Date: Mar. 3, 2020; Page: A1"],
  ["foreign_unpublished_manuscript", "Jane Doe, Hidden Costs (2020) (unpublished manuscript) (on file with author)"],
  ["foreign_thesis", "Jane Doe, Hidden Costs (2019) (Ph.D. dissertation, Synthetic University)"],
];
const IDS = ["t2:australia", "t2:canada", "t2:france-republic-of"];

async function snapshot() {
  const out = [];
  for (const id of IDS) for (const [type, raw] of INPUTS) {
    vi.clearAllMocks();
    m.cache.mockResolvedValue(null);
    m.invoke.mockResolvedValue({ data: { content: "UNSAFE MODEL OUTPUT" }, errorInfo: null });
    const r = await runCitation({ rawInput: raw, overrideType: type, manualChoice: citationManualChoice(type, id), useVerifiedStore: true });
    out.push({ id, type, raw, citation: r.citation, reply: r.reply, status: r.status, warningMsg: r.warningMsg ?? null,
      invoke: m.invoke.mock.calls.length, cache: m.cache.mock.calls.length, classifier: m.classifier.mock.calls.length });
  }
  return out;
}

describe("D1 general literature with planned-country manual choice", () => {
  it("matches baseline output, style, warnings and IO counts (18 cases)", async () => {
    const now = await snapshot();
    if (process.env.D1_LIT_CAPTURE) { writeFileSync(process.env.D1_LIT_CAPTURE, JSON.stringify(now, null, 1)); return; }
    const frozen = JSON.parse(readFileSync(FIXTURE, "utf8"));
    expect(frozen).toHaveLength(18);
    expect(now).toEqual(frozen);
  });
});
