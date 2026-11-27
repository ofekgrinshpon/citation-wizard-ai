import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { parseNzscCover, nzscJudgmentUrl } from "../../supabase/functions/_shared/citationPure/nzscDecision";
import { acquireNzscDecision } from "../../supabase/functions/citation-chat/nzscRecordRoute";

const load = (name: string) => readFileSync(`src/test/fixtures/nzsc/${name}.txt`, "utf8");
const smith = "[2024] NZSC 5";
const url = nzscJudgmentUrl(smith)!;
describe("NZSC original judgment evidence", () => {
  it("binds exact neutral identifier to an original and rejects the same parties' leave decision", () => {
    expect(parseNzscCover(smith, url, load("2024-NZSC-5"))).toMatchObject({ docket: "SC 149/2021", firstParty: "MICHAEL JOHN SMITH" });
    expect(parseNzscCover(smith, url, load("2022-NZSC-35"))).toBeNull();
  });
  it("rejects an official press summary and another host or path", () => {
    expect(parseNzscCover(smith, url, load("MR-2024-NZSC-5"))).toBeNull();
    expect(parseNzscCover(smith, url + "?download=1", load("2024-NZSC-5"))).toBeNull();
  });
  it("normalizes exact unbracketed input without permitting locator or year mismatch", () => {
    expect(nzscJudgmentUrl("2024 NZSC 5")).toBe(url);
    expect(nzscJudgmentUrl("2024 NZSC 5 [12]")).toBeNull();
    expect(nzscJudgmentUrl("[2024 NZSC 5")).toBeNull();
    expect(nzscJudgmentUrl("2003 NZSC 5")).toBeNull();
    const other = "[2024] NZSC 124";
    expect(parseNzscCover(other, nzscJudgmentUrl(other)!, load("2024-NZSC-124"))?.secondParty).toBe("ROCHE PRODUCTS (NEW ZEALAND) LIMITED");
  });
  it("calls only the exact official URL and refuses an incomplete worker result", async () => {
    const fetch = vi.fn(async () => new Response("%PDF-1.7\n% fake transport fixture", { headers:{ "content-type":"application/pdf" } }));
    const text = load("2024-NZSC-5");
    const extract = vi.fn(async () => ({ text, total_pages: 1, stopped_reason: "document_end",
      pages: [{ page: 1, status: "read", truncated: false, start: 0, end: text.length }] })) as unknown as NonNullable<NonNullable<Parameters<typeof acquireNzscDecision>[1]>["extract"]>;
    expect((await acquireNzscDecision("2024 NZSC 5", { fetch, extract }))?.neutral).toBe(smith);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({ redirect:"error" }));
    const partial = async (...args: Parameters<typeof extract>) => {
      const document = await extract(...args);
      return { ...document, pages: document.pages.map(page => ({ ...page, truncated:true })) };
    };
    expect(await acquireNzscDecision(smith,{ fetch, extract:partial })).toBeNull();
  });
});

describe("actual worker extraction preserves NZSC identity", () => {
  const read = (f: string) => readFileSync(`src/test/fixtures/nzsc/${f}.worker.txt`, "utf8");
  it("verifies Smith and Austin despite the emitted running title and split NEW", () => {
    expect(parseNzscCover("[2024] NZSC 5", nzscJudgmentUrl("[2024] NZSC 5")!, read("case"))?.secondParty).toBe("FONTERRA CO-OPERATIVE GROUP LIMITED");
    expect(parseNzscCover("[2024] NZSC 124", nzscJudgmentUrl("[2024] NZSC 124")!, read("2024-NZSC-124"))?.secondParty).toBe("ROCHE PRODUCTS (NEW ZEALAND) LIMITED");
  });
  it("rejects the media release, same-parties leave decision and a swapped running-title ID", () => {
    const url = nzscJudgmentUrl("[2024] NZSC 5")!;
    expect(parseNzscCover("[2024] NZSC 5",url,read("MR-2024-NZSC-5"))).toBeNull();
    expect(parseNzscCover("[2024] NZSC 5",url,read("2022-NZSC-35"))).toBeNull();
    expect(parseNzscCover("[2024] NZSC 5",url,read("case").replace("[2024] NZSC 5","[2024] NZSC 50"))).toBeNull();
  });
});
