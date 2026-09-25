/**
 * same_work_trust_boundary_v1 — agent-supplied identity may help FIND another
 * copy of a work; it may never PROVE that a candidate is the same work.
 *
 * T1–T7 lock the boundary: model-asserted author / year / DOI never upgrade a
 * title-only candidate, deterministic metadata still does, and the hint still
 * reaches the rediscovery query.
 */

import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types.ts";
import {
  emptySameWorkRecoveryStats,
  noteSameWorkRecovery,
  queryIdentity,
  recoverSameWork,
} from "../../supabase/functions/legal-research-v2/tools/sameWorkRecovery.ts";
import type { EnrichmentDeps } from "../../supabase/functions/legal-research-v2/tools/identityEnrichment.ts";

let n = 0;
function result(partial: Partial<SearchResult>): SearchResult {
  return { result_id: `T${++n}`, title: "", origin: "perplexity:raw_web", ...partial } as SearchResult;
}

const TITLE = "Understanding the Agency Costs of Controlling Shareholders";

/** Enrichment that returns exactly the candidate-side fields given to it. */
function depsReturning(fields: {
  author?: string;
  year?: string;
  doi?: string;
  title?: string;
}): EnrichmentDeps {
  return {
    fetchHtml: async () =>
      `<html><head>
        <meta name="citation_title" content="${fields.title ?? TITLE}">
        ${fields.author ? `<meta name="citation_author" content="${fields.author}">` : ""}
        ${fields.year ? `<meta name="citation_publication_date" content="${fields.year}/01/01">` : ""}
        ${fields.doi ? `<meta name="citation_doi" content="${fields.doi}">` : ""}
      </head><body></body></html>`,
  };
}

describe("same-work trust boundary", () => {
  it("T1 an agent-supplied author cannot prove equivalence", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE }, // trusted: title only
      search_hint: { authors: ["Ronald J. Gilson"] },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [result({ title: TITLE, url: "https://law.example.edu/gilson.pdf" })],
      enrichment: depsReturning({ author: "Ronald J. Gilson" }),
    });
    expect(rec.recovered).toBe(false);
    expect(rec.telemetry.hint_used_for_equivalence).toBe(false);
  });

  it("T2 an agent-supplied year cannot prove equivalence", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE },
      search_hint: { year: "2005" },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [result({ title: TITLE, url: "https://law.example.edu/a.pdf" })],
      enrichment: depsReturning({ year: "2005" }),
    });
    expect(rec.recovered).toBe(false);
  });

  it("T3 an agent-supplied DOI cannot produce doi_exact", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE },
      search_hint: { doi: "10.1111/abc.12345" },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [result({ title: TITLE, url: "https://law.example.edu/b.pdf" })],
      enrichment: depsReturning({ doi: "10.1111/abc.12345" }),
    });
    expect(rec.recovered).toBe(false);
    expect(rec.equivalence_basis).toBeUndefined();
  });

  it("T4 a deterministic DOI still proves equivalence", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE, doi: "10.1111/abc.12345" },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [
        result({ title: TITLE, url: "https://repo.example.edu/x?doi=10.1111/abc.12345" }),
      ],
    });
    expect(rec.recovered).toBe(true);
    expect(rec.equivalence_basis).toBe("doi_exact");
  });

  it("T5 a deterministic author still proves equivalence", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE, authors: ["Ronald J. Gilson"] },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [result({ title: TITLE, url: "https://law.example.edu/c.pdf" })],
      enrichment: depsReturning({ author: "Ronald J. Gilson" }),
    });
    expect(rec.recovered).toBe(true);
    expect(rec.equivalence_basis).toBe("title_and_author");
  });

  it("T6 the hint still shapes the rediscovery query", async () => {
    let seen = "";
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE },
      search_hint: { authors: ["Ronald J. Gilson"], year: "2005" },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async (q) => {
        // Queries form an ordered ladder; the hint shapes the richest one.
        seen += ` ${q}`;
        return [];
      },
    });
    expect(seen).toContain("Gilson");
    expect(seen).toContain("2005");
    expect(rec.telemetry.hint_used_for_query).toBe(true);
    expect(rec.telemetry.trusted_fields).toEqual(["title"]);
    expect(rec.telemetry.hint_fields).toEqual(["authors", "year"]);
    expect(queryIdentity({ title: TITLE }, { year: "2005" }).year).toBe("2005");
  });

  it("T7 enrichment telemetry and the hint invariant survive into run stats", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: { title: TITLE },
      search_hint: { authors: ["Ronald J. Gilson"] },
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [result({ title: TITLE, url: "https://law.example.edu/d.pdf" })],
      enrichment: depsReturning({ author: "Ronald J. Gilson" }),
    });
    expect(rec.telemetry.enrichment.length).toBe(1);
    const stats = emptySameWorkRecoveryStats();
    noteSameWorkRecovery(stats, rec.telemetry);
    expect(stats.same_work_enrichment_triggered).toBe(1);
    expect(stats.same_work_agent_hint_used_for_query).toBe(1);
    expect(stats.same_work_agent_hint_used_for_equivalence).toBe(0);
    expect(stats.same_work_original_identity_trusted_fields).toEqual(["title"]);
  });
});
