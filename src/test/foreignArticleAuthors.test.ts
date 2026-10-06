import { describe, expect, it } from "vitest";
import { buildForeignArticleRequest, mergeForeignArticleCache, renderForeignArticleLookup } from "@/lib/foreignArticleAdapter";
import { runForeignLookup } from "../../supabase/functions/citation-chat/foreignLookup";

const canonical = "Samuel D. Warren & Louis D. Brandeis";
const citation = `${canonical}, The Right to Privacy, 4 Harv. L. Rev. 193, 201–203 (1890)`;
const donor = { title: `The Right to Privacy — ${canonical}`, url: "https://law.harvard.edu/privacy", snippet: `${canonical}, The Right to Privacy, 4 Harvard Law Review 193 (1890).` };

async function live(authors: string, records = [donor]) {
  const request = buildForeignArticleRequest(`${authors}, The Right to Privacy, pp. 213–214.`);
  let calls = 0;
  const result = await runForeignLookup(request, { apiKey: "offline-only", fetchImpl: (async (url: string) => {
    if (url === "https://api.perplexity.ai/search") {
      calls++;
      return new Response(JSON.stringify({ results: records }), { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch });
  return { request, result, rendered: renderForeignArticleLookup(request, result)!, calls };
}

describe("compatible article author enrichment", () => {
  it.each(["Warren & Brandeis", "S. D. Warren & L. D. Brandeis"])("enriches %s from same-work evidence without mutating request anchors", async (authors) => {
    const found = await live(authors);
    expect(found.request.parsedFields.authors).toBe(authors);
    expect(found.result.fields.authors).toBe(canonical);
    expect(found.result.provenance.authors).toMatchObject({ value: canonical, sourceUrl: donor.url, basis: "search_result_explicit" });
    expect(found.rendered.citation).toContain(canonical);
    expect(found.rendered.citation).toContain("193, 213–214 (1890)");
    expect(found.rendered.status).toBe("valid");
    expect(found.calls).toBe(1);
  });

  it.each(["Warren & Brandeis", "S. D. Warren & L. D. Brandeis"])("preserves canonical cached names and replaces the pinpoint for %s", (authors) => {
    const merged = mergeForeignArticleCache(`${authors}, The Right to Privacy, pp. 213–214.`, citation);
    expect(merged).toContain(canonical);
    expect(merged).toContain("193, 213–214 (1890)");
    expect(merged).not.toContain("201–203");
  });

  it.each([
    "John Warren & Louis Brandeis",
    "S. A. Warren & L. D. Brandeis",
    "Samuel David Warren & Louis Daniel Brandeis",
    "Louis Brandeis & Samuel Warren",
    "Warren & Holmes",
    "Warren",
    "Warren & Brandeis & Holmes",
  ])("rejects explicit conflicting author details or membership/order: %s", async (authors) => {
    // Explicit middle names that differ from supplied initials are tested separately below.
    const evidence = authors.includes("David") ? { ...donor, snippet: donor.snippet.replace("Samuel D.", "Samuel Daniel").replace("Louis D.", "Louis David") } : donor;
    const found = await live(authors, [evidence]);
    expect(found.rendered.citation).toContain(authors);
    expect(found.rendered.status).toBe("warning");
    expect(found.result.fields.authors).toBeUndefined();
    expect(mergeForeignArticleCache(found.request.rawInput, evidence.snippet.replace("Harvard Law Review", "Harv. L. Rev."))).toBeNull();
  });

  it("retains supplied names with no evidence", async () => {
    const found = await live("Warren & Brandeis", []);
    expect(found.rendered.citation).toContain("Warren & Brandeis");
    expect(found.rendered.status).toBe("warning");
  });

  it("does not shrink already complete given names or change their separator", async () => {
    const supplied = "Samuel David Warren and Louis David Brandeis";
    const found = await live(supplied);
    expect(found.rendered.citation).toContain(supplied);
    expect(mergeForeignArticleCache(found.request.rawInput, citation)).toContain(supplied);
    expect(found.result.fields.authors).toBeUndefined();
  });

  it("does not enrich or erase supplied names when richer sources conflict", async () => {
    const abbreviated = { ...donor, snippet: donor.snippet.replace(canonical, "S. D. Warren & L. D. Brandeis") };
    const other = { ...donor, url: "https://lawreview.example.edu/other", snippet: donor.snippet.replace("Samuel D.", "Stephen D.") };
    const found = await live("Warren & Brandeis", [abbreviated, donor, other]);
    expect(found.rendered.citation).toContain("Warren & Brandeis");
    expect(found.result.articleResolution).toBe("conflict");
    expect(found.result.fields.authors).toBeUndefined();
  });

  it("selects richer compatible names when a shorter same-work record appeared first", async () => {
    const shorter = { ...donor, snippet: donor.snippet.replace(canonical, "Warren & Brandeis") };
    const found = await live("Warren & Brandeis", [shorter, { ...donor, url: "https://lawreview.example.edu/original" }]);
    expect(found.result.fields.authors).toBe(canonical);
    expect(found.result.provenance.authors.sourceUrl).toBe("https://lawreview.example.edu/original");
  });
});
