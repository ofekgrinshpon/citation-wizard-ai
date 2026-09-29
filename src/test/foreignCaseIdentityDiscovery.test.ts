/**
 * Foreign case identity discovery: case name → verified identity →
 * missing citation fields → deterministic citation. Never guess jurisdiction.
 */
import { describe, expect, it } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import { renderForeignDetection } from "@/data/bluebook";
import { planForeignLookup, extractForeignCaseName } from "@/lib/runCitation";
import { detectForeignSource } from "@/data/bluebook/extract";

interface Item { title: string; url: string; snippet: string }

function run(input: ForeignLookupInput, tiers: Item[][]) {
  const calls: Array<Record<string, unknown>> = [];
  let i = 0;
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    if (String(url).includes("perplexity.ai")) {
      calls.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ results: tiers[Math.min(i++, tiers.length - 1)] }), { status: 200 });
    }
    return new Response("nf", { status: 404 });
  }) as unknown as typeof fetch;
  return { p: runForeignLookup(input, { fetchImpl, apiKey: "k" }), calls };
}

const REDIGI: Item = {
  title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
  url: "https://www.courtlistener.com/opinion/4566107/capitol-records-llc-v-redigi-inc/",
  snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018).",
};

describe("foreign case identity discovery", () => {
  it("D1: bare 'Capitol Records, LLC v. ReDigi Inc.' → UNKNOWN → US resolved and completed", async () => {
    const raw = "Capitol Records, LLC v. ReDigi Inc.";
    const plan = planForeignLookup("foreign", raw, detectForeignSource(raw));
    expect(plan).toEqual({ kind: "case", jurisdiction: "UNKNOWN" });
    const { p, calls } = run(
      { kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: extractForeignCaseName(raw)! } },
      [[REDIGI]],
    );
    const r = await p;
    // Tier 1 searched both US and UK hint sets.
    expect(calls[0].search_domain_filter).toEqual(expect.arrayContaining(["courtlistener.com", "bailii.org"]));
    expect(r.identity.matched).toBe(true);
    expect(r.identity.jurisdiction).toBe("US");
    expect(r.identity.jurisdictionDiscovered).toBe(true);
    expect(r.fields).toMatchObject({ volume: "910", reporter: "F.3d", firstPage: "649", court: "2d Cir.", year: "2018" });
    expect(r.provenance.volume.sourceUrl).toContain("courtlistener.com");
    const out = renderForeignDetection({
      sourceType: "foreign_case_us", kind: "case", jurisdiction: "US", confidence: "deterministic",
      fields: { caseName: "Capitol Records, LLC v. ReDigi Inc.", ...r.fields },
    });
    expect(out?.missing).toEqual([]);
    expect(out?.citation).toContain("910 F.3d 649 (2d Cir. 2018)");
  });

  it("D2: same case with '(2d Cir. 2018)' uses the explicit anchors (US fast path)", async () => {
    const raw = "Capitol Records, LLC v. ReDigi Inc. (2d Cir. 2018)";
    const plan = planForeignLookup("foreign_case_us", raw, detectForeignSource(raw));
    expect(plan?.jurisdiction).toBe("US");
    const { p } = run(
      { kind: "case", jurisdiction: "US", rawInput: raw, parsedFields: { caseName: "Capitol Records, LLC v. ReDigi Inc.", court: "2d Cir.", year: "2018" } },
      [[REDIGI]],
    );
    const r = await p;
    expect(r.identity.matched).toBe(true);
    expect(r.identity.jurisdiction).toBe("US");
    expect(r.fields).toMatchObject({ volume: "910", reporter: "F.3d", firstPage: "649" });
  });

  it("D3: UK case identified by name only", async () => {
    const raw = "Donoghue v Stevenson";
    expect(planForeignLookup("foreign", raw, detectForeignSource(raw))).toEqual({ kind: "case", jurisdiction: "UNKNOWN" });
    const { p } = run({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } }, [[
      {
        title: "Donoghue v Stevenson [1932] UKHL 100 (26 May 1932)",
        url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html",
        snippet: "Donoghue v Stevenson [1932] UKHL 100.",
      },
    ]]);
    const r = await p;
    expect(r.identity.matched).toBe(true);
    expect(r.identity.jurisdiction).toBe("UK");
    expect(r.fields).toMatchObject({ neutral: "UKHL 100", year: "1932" });
  });

  it("D4: ambiguous case name → disambiguation, no fields", async () => {
    const raw = "Smith v. Jones";
    const { p } = run({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } }, [[
      { title: "Smith v. Jones, 123 F.3d 45 (5th Cir. 1997)", url: "https://www.courtlistener.com/opinion/1/smith-v-jones/", snippet: "Smith v. Jones, 123 F.3d 45 (5th Cir. 1997)." },
      { title: "Smith v Jones [2004] EWCA Civ 123", url: "https://www.bailii.org/ew/cases/EWCA/Civ/2004/123.html", snippet: "Smith v Jones [2004] EWCA Civ 123." },
    ]]);
    const r = await p;
    expect(r.identity.matched).toBe(false);
    expect(r.fields).toEqual({});
    expect(r.disambiguation?.length).toBe(2);
    expect(r.disambiguation?.map((d) => d.jurisdiction).sort()).toEqual(["UK", "US"]);
  });

  it("D4b: two different US records with the same name → disambiguation", async () => {
    const raw = "Smith v. Jones";
    const { p } = run({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } }, [[
      { title: "Smith v. Jones, 123 F.3d 45 (5th Cir. 1997)", url: "https://www.courtlistener.com/opinion/1/a/", snippet: "Smith v. Jones, 123 F.3d 45 (5th Cir. 1997)." },
      { title: "Smith v. Jones, 456 F.2d 78 (9th Cir. 1972)", url: "https://law.justia.com/cases/federal/b/", snippet: "Smith v. Jones, 456 F.2d 78 (9th Cir. 1972)." },
    ]]);
    const r = await p;
    expect(r.identity.matched).toBe(false);
    expect(r.disambiguation?.length).toBe(2);
  });

  it("D5: no verified source → nothing guessed", async () => {
    const raw = "Fictional Widgets Ltd v. Nobody Corp";
    const { p } = run({ kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } }, [[
      { title: "Blog: widgets news", url: "https://random-blog.example.com/post", snippet: "Fictional Widgets Ltd v. Nobody Corp was discussed." },
    ], []]);
    const r = await p;
    expect(r.identity.matched).toBe(false);
    expect(r.identity.jurisdiction).toBeUndefined();
    expect(r.fields).toEqual({});
    expect(r.disambiguation).toBeUndefined();
  });
});
