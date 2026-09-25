/**
 * Milestone 2B — grounded foreign source lookup.
 *
 * The lookup discovers facts (Perplexity Search API, mocked here) but never
 * formats a citation and never guesses. Tier-1 domains are discovery hints;
 * identity matching + field-level grounding decide acceptance.
 */
import { describe, expect, it } from "vitest";
import {
  runForeignLookup,
  normalizePartyName,
  type ForeignLookupInput,
} from "../../supabase/functions/citation-chat/foreignLookup";
import { renderForeignDetection } from "@/data/bluebook";
import { detectForeignSource } from "@/data/bluebook/extract";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/** Mocked fetch: serves canned Perplexity Search responses per call order. */
function mockFetch(tiers: SearchResultItem[][]): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; body: Record<string, unknown> }>;
} {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  let i = 0;
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("perplexity.ai")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url: u, body });
      const results = tiers[Math.min(i++, tiers.length - 1)];
      return new Response(JSON.stringify({ results }), { status: 200 });
    }
    // Direct page inspection is disabled in these fixtures.
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const lookup = (
  input: ForeignLookupInput,
  tiers: SearchResultItem[][],
) => {
  const { fetchImpl, calls } = mockFetch(tiers);
  return { result: runForeignLookup(input, { fetchImpl, apiKey: "test-key" }), calls };
};

const REDI_INPUT: ForeignLookupInput = {
  kind: "case",
  jurisdiction: "US",
  rawInput: "Capitol Records, LLC v. ReDigi Inc. (2d Cir. 2018)",
  parsedFields: { caseName: "Capitol Records, LLC v. ReDigi Inc.", court: "2d Cir.", year: "2018" },
};

describe("Bluebook M2B — grounded foreign lookup", () => {
  it("B1: partial US case grounds volume/reporter/firstPage → deterministic render", async () => {
    const { result } = lookup(REDI_INPUT, [
      [
        {
          title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
          url: "https://law.justia.com/cases/federal/appellate-courts/ca2/16-2321/16-2321-2018-12-12.html",
          snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018) — Second Circuit.",
        },
      ],
    ]);
    const r = await result;
    expect(r.identity.matched).toBe(true);
    expect(r.diagnostics.tier2Fired).toBe(false);
    expect(r.fields.volume).toBe("910");
    expect(r.fields.reporter).toBe("F.3d");
    expect(r.fields.firstPage).toBe("649");
    expect(r.grounded.volume).toBe(true);
    expect(r.provenance.volume.sourceUrl).toContain("justia.com");

    // Merge like runCitation.ts (user fields win) and render deterministically.
    const rendered = renderForeignDetection({
      sourceType: "foreign_case_us",
      kind: "case",
      jurisdiction: "US",
      confidence: "deterministic",
      fields: { ...r.fields, caseName: "Capitol Records, LLC v. ReDigi Inc.", court: "2d Cir.", year: "2018" },
    });
    expect(rendered).not.toBeNull();
    expect(rendered!.citation).toBe("##Capitol Records, LLC v. ReDigi Inc.##, 910 F.3d 649 (2d Cir. 2018).");
    expect(rendered!.missing).toEqual([]);
  });

  it("B2: ungrounded field stays missing — no invented value", async () => {
    const { result } = lookup(REDI_INPUT, [
      [
        {
          title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d (2d Cir. 2018)",
          url: "https://law.justia.com/x",
          snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d (2d Cir. 2018)",
        },
      ],
    ]);
    const r = await result;
    expect(r.fields.volume).toBeUndefined();
    expect(r.fields.firstPage).toBeUndefined();
    expect(r.fields.reporter).toBeUndefined();
    const rendered = renderForeignDetection({
      sourceType: "foreign_case_us",
      kind: "case",
      jurisdiction: "US",
      confidence: "deterministic",
      fields: { ...r.fields, caseName: "Capitol Records, LLC v. ReDigi Inc.", court: "2d Cir.", year: "2018" },
    });
    expect(rendered!.citation).toContain("[חסר:");
  });

  it("B3: party mismatch → candidate rejected", async () => {
    const { result } = lookup(REDI_INPUT, [
      [
        {
          title: "Capitol Records, LLC v. Vimeo, LLC, 826 F.3d 78 (2d Cir. 2016)",
          url: "https://law.justia.com/y",
          snippet: "Capitol Records, LLC v. Vimeo, LLC, 826 F.3d 78 (2d Cir. 2016)",
        },
      ],
    ]);
    const r = await result;
    expect(r.identity.matched).toBe(false);
    expect(Object.keys(r.fields)).toHaveLength(0);
  });

  it("B4: user-supplied court conflict → lookup rejected", async () => {
    const { result } = lookup(
      { ...REDI_INPUT, parsedFields: { ...REDI_INPUT.parsedFields, court: "9th Cir." } },
      [
        [
          {
            title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
            url: "https://www.courtlistener.com/z",
            snippet: "Capitol Records v. ReDigi, 910 F.3d 649 (2d Cir. 2018)",
          },
        ],
      ],
    );
    const r = await result;
    expect(r.identity.matched).toBe(false);
    expect(r.identity.conflicts.join(" ")).toContain("court:");
  });

  it("B5: user-supplied year conflict → lookup rejected", async () => {
    const { result } = lookup(
      { ...REDI_INPUT, rawInput: "Capitol Records, LLC v. ReDigi Inc. (2d Cir. 2019)", parsedFields: { court: "2d Cir.", year: "2019" } },
      [
        [
          {
            title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
            url: "https://www.courtlistener.com/z",
            snippet: "Capitol Records v. ReDigi, 910 F.3d 649 (2d Cir. 2018)",
          },
        ],
      ],
    );
    const r = await result;
    expect(r.identity.matched).toBe(false);
    expect(r.identity.conflicts.join(" ")).toContain("year:");
  });

  it("B6: traditional UK report completion renders through the existing renderer", async () => {
    const { result } = lookup(
      {
        kind: "case",
        jurisdiction: "UK",
        rawInput: "Donoghue v Stevenson [1932]",
        parsedFields: { caseName: "Donoghue v Stevenson", year: "1932" },
      },
      [
        [
          {
            title: "Donoghue v Stevenson [1932] AC 562 (HL)",
            url: "https://www.bailii.org/uk/cases/UKHL/1932/100.html",
            snippet: "Donoghue v Stevenson [1932] AC 562 (HL) — House of Lords.",
          },
        ],
      ],
    );
    const r = await result;
    expect(r.identity.matched).toBe(true);
    expect(r.fields.reporter).toBe("AC");
    expect(r.fields.firstPage).toBe("562");
    const rendered = renderForeignDetection({
      sourceType: "foreign_case_other",
      kind: "case",
      jurisdiction: "UK",
      confidence: "deterministic",
      fields: { ...r.fields, caseName: "Donoghue v Stevenson", year: "1932" },
    });
    expect(rendered!.citation).toBe("##Donoghue v Stevenson## [1932] AC 562 (HL).");
  });

  it("B7: article journal passes through; abbreviation stays renderer-owned", async () => {
    const { result } = lookup(
      {
        kind: "journal_article",
        jurisdiction: "US",
        rawInput: "Ronald H. Coase, The Problem of Social Cost",
        parsedFields: { articleTitle: "The Problem of Social Cost", authors: "Ronald H. Coase" },
      },
      [
        [
          {
            title: "The Problem of Social Cost — Ronald H. Coase",
            url: "https://www.jstor.org/stable/724810",
            snippet: "Ronald H. Coase, The Problem of Social Cost, 3 Journal of Law and Economics 1 (1960)",
          },
        ],
      ],
    );
    const r = await result;
    expect(r.identity.matched).toBe(true);
    expect(r.fields.volume).toBe("3");
    expect(r.fields.journal).toBe("Journal of Law and Economics");
    expect(r.fields.firstPage).toBe("1");
    // The deterministic table owns the abbreviation, not the lookup.
    const rendered = renderForeignDetection({
      sourceType: "foreign_journal_article",
      kind: "journal_article",
      jurisdiction: "US",
      confidence: "deterministic",
      fields: { ...r.fields, authors: "Ronald H. Coase", articleTitle: "The Problem of Social Cost" },
    });
    expect(rendered!.citation).toContain("J.L. & Econ.");
  });

  it("B8: book year resolved from grounded metadata", async () => {
    const { result } = lookup(
      {
        kind: "book",
        jurisdiction: "US",
        rawInput: "Guido Calabresi, The Costs of Accidents",
        parsedFields: { bookTitle: "The Costs of Accidents", authors: "Guido Calabresi" },
      },
      [
        [
          {
            title: "The Costs of Accidents — Guido Calabresi",
            url: "https://books.google.com/books?id=abc",
            snippet: "Guido Calabresi, The Costs of Accidents: A Legal and Economic Analysis (1970)",
          },
        ],
      ],
    );
    const r = await result;
    expect(r.identity.matched).toBe(true);
    expect(r.fields.year).toBe("1970");
    expect(r.grounded.year).toBe(true);
  });

  it("B9: book chapter metadata resolved; ungrounded page stays missing", async () => {
    const { result } = lookup(
      {
        kind: "book_chapter",
        jurisdiction: "US",
        rawInput: "Richard Posner, Some Economics of Labor Law, in The Economics of Law",
        parsedFields: { chapterTitle: "Some Economics of Labor Law", authors: "Richard Posner" },
      },
      [
        [
          {
            title: "The Economics of Law — Posner chapter",
            url: "https://press.university.edu/catalog/law-econ",
            snippet: "Richard Posner, Some Economics of Labor Law, in The Economics of Law (1975)",
          },
        ],
      ],
    );
    const r = await result;
    expect(r.identity.matched).toBe(true);
    expect(r.fields.year).toBe("1975");
    expect(r.fields.firstPage).toBeUndefined();
  });

  it("B10: complete local input never needs lookup (local fast path intact)", () => {
    const det = detectForeignSource("Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)");
    expect(det).not.toBeNull();
    const rendered = renderForeignDetection(det!);
    expect(rendered!.missing).toEqual([]);
    // runCitation.ts only builds the lookup request after the local render
    // declines; a complete render with zero missing fields returns early.
  });

  it("B11/B12: Tier-2 rescue — legitimate off-list repository is accepted", async () => {
    const { result, calls } = lookup(REDI_INPUT, [
      [], // Tier 1 finds nothing.
      [
        {
          title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
          url: "https://lawreview.law.example-univ.edu/articles/redigi",
          snippet: "Discussing Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018).",
        },
      ],
    ]);
    const r = await result;
    expect(r.diagnostics.tier2Fired).toBe(true);
    // Off-list hostname is NOT a reason for rejection (quality = repository).
    expect(calls[1].body.search_domain_filter).toBeUndefined();
    expect(r.identity.matched).toBe(true);
    expect(r.fields.volume).toBe("910");
    expect(r.provenance.volume.basis).toBe("repository_metadata");
  });

  it("B13: weak off-list source may aid discovery but cannot ground fields", async () => {
    const { result } = lookup(REDI_INPUT, [
      [],
      [
        {
          title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
          url: "https://random-law-blog.example.com/post/123",
          snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
        },
      ],
    ]);
    const r = await result;
    expect(r.identity.matched).toBe(true);
    expect(Object.keys(r.fields)).toHaveLength(0);
  });

  it("B14: conflicting non-identity field stays missing; other fields survive", async () => {
    const { result } = lookup(REDI_INPUT, [
      [
        {
          title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
          url: "https://law.justia.com/a",
          snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
        },
        {
          title: "Capitol Records, LLC v. ReDigi Inc., 911 F.3d 649 (2d Cir. 2018)",
          url: "https://www.courtlistener.com/b",
          snippet: "Capitol Records, LLC v. ReDigi Inc., 911 F.3d 649 (2d Cir. 2018)",
        },
      ],
    ]);
    const r = await result;
    expect(r.identity.matched).toBe(true);
    expect(r.fields.volume).toBeUndefined(); // disagreement → missing
    expect(r.fields.reporter).toBe("F.3d"); // agreement → grounded
    expect(r.fields.firstPage).toBe("649");
  });

  it("B15: Rule 37 preserved — lookup/renderers never emit Id./supra/infra", async () => {
    const { result } = lookup(REDI_INPUT, [
      [
        {
          title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
          url: "https://law.justia.com/x",
          snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
        },
      ],
    ]);
    const r = await result;
    const rendered = renderForeignDetection({
      sourceType: "foreign_case_us",
      kind: "case",
      jurisdiction: "US",
      confidence: "deterministic",
      fields: { ...r.fields, caseName: "Capitol Records, LLC v. ReDigi Inc.", court: "2d Cir.", year: "2018" },
    });
    expect(rendered!.citation).not.toMatch(/\b(Id\.|supra|infra)\b/);
  });

  it("B16: Israeli input is never detected as foreign", () => {
    expect(detectForeignSource('ע"א 2934/93 פלוני נגד אלמוני')).toBeNull();
    expect(detectForeignSource("חוק החוזים (תרופות בשל הפרת חוזה), תשל\"א-1970")).toBeNull();
  });

  it("B17: rich formatting markers preserved in renderer output", async () => {
    const { result } = lookup(REDI_INPUT, [
      [
        {
          title: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
          url: "https://law.justia.com/x",
          snippet: "Capitol Records, LLC v. ReDigi Inc., 910 F.3d 649 (2d Cir. 2018)",
        },
      ],
    ]);
    const r = await result;
    const rendered = renderForeignDetection({
      sourceType: "foreign_case_us",
      kind: "case",
      jurisdiction: "US",
      confidence: "deterministic",
      fields: { ...r.fields, caseName: "Capitol Records, LLC v. ReDigi Inc.", court: "2d Cir.", year: "2018" },
    });
    expect(rendered!.citation).toContain("##");
  });

  it("B18: single formatter — no foreign renderer exists in edge functions", () => {
    const root = join(__dirname, "..", "..", "supabase", "functions");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) {
          const src = readFileSync(p, "utf8");
          if (/renderUsCase|renderUkCase|renderForeignCitation|renderForeignDetection/.test(src)) {
            offenders.push(p);
          }
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });

  it("helper: party normalization handles Inc./LLC/punctuation", () => {
    expect(normalizePartyName("Capitol Records, LLC")).toBe(normalizePartyName("Capitol Records LLC"));
    expect(normalizePartyName("ReDigi Inc.")).toBe(normalizePartyName("redigi"));
  });
});
