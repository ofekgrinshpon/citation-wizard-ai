/**
 * same_work_identity_enrichment_v1 — E1–E10.
 *
 * Enrichment gathers IDENTITY, never evidence, and never relaxes
 * `isSameWork()`: a title-only candidate stays rejected unless real
 * bibliographic identity confirms it is the same work.
 */

import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types.ts";
import {
  doiFromUrl,
  enrichAndCompare,
  type EnrichmentDeps,
  normalizeAuthorName,
  normalizeDoi,
  shouldEnrich,
} from "../../supabase/functions/legal-research-v2/tools/identityEnrichment.ts";
import {
  emptySameWorkRecoveryStats,
  identityFromSearchResult,
  noteSameWorkRecovery,
  recoverSameWork,
} from "../../supabase/functions/legal-research-v2/tools/sameWorkRecovery.ts";
import { isSameWork } from "../../supabase/functions/legal-research-v2/tools/alternativeCopy.ts";

const WANTED = {
  title: "The End of History for Corporate Law",
  authors: ["Henry Hansmann", "Reinier Kraakman"],
  year: "2001",
};

let n = 0;
function result(partial: Partial<SearchResult>): SearchResult {
  return { result_id: `E${++n}`, title: "", origin: "perplexity:raw_web", ...partial } as SearchResult;
}

const landing = (meta: string): EnrichmentDeps => ({
  fetchHtml: async () => `<html><head>${meta}</head><body></body></html>`,
});

describe("same-work identity enrichment", () => {
  it("E1 landing-page author makes a title-only candidate provable", async () => {
    const out = await enrichAndCompare({
      wanted: WANTED,
      candidate: { title: WANTED.title },
      candidate_url: "https://law.yale.edu/faculty/hansmann-end-of-history",
      deps: landing(
        `<meta name="citation_title" content="The End of History for Corporate Law">
         <meta name="citation_author" content="Hansmann, Henry">
         <meta name="citation_author" content="Kraakman, Reinier">`,
      ),
    });
    expect(out.verdict.same_work).toBe(true);
    expect(out.verdict.basis).toBe("title_and_author");
    expect(out.telemetry.landing_meta).toBe(1);
    expect(out.telemetry.fields_gained).toContain("authors");
  });

  it("E2 a DOI lookup that returns the original DOI is decisive", async () => {
    const out = await enrichAndCompare({
      wanted: { title: "Corporate Purpose", doi: "https://doi.org/10.1111/JOLS.12345" },
      candidate: { title: "Corporate Purpose" },
      candidate_url: "https://repository.law.umn.edu/faculty/99",
      deps: {
        fetchHtml: async () =>
          `<meta name="citation_doi" content="doi: 10.1111/jols.12345">`,
      },
    });
    expect(out.verdict.same_work).toBe(true);
    expect(out.verdict.basis).toBe("doi_exact");
  });

  it("E3 a metadata lookup with a different author and year is rejected", async () => {
    const out = await enrichAndCompare({
      wanted: WANTED,
      candidate: { title: WANTED.title },
      candidate_url: "https://example.edu/paper",
      deps: landing(
        `<meta name="citation_title" content="The End of History for Corporate Law">
         <meta name="citation_author" content="Cohen, Dana">
         <meta name="citation_publication_date" content="2017/03/01">`,
      ),
    });
    expect(out.verdict.same_work).toBe(false);
    expect(out.telemetry.still_insufficient).toBe(true);
  });

  it("E4 an adjacent online-first year alone never identifies a work", async () => {
    const out = await enrichAndCompare({
      wanted: { title: WANTED.title, year: "2001" },
      candidate: { title: WANTED.title },
      candidate_url: "https://example.edu/online-first",
      deps: landing(
        `<meta name="citation_title" content="The End of History for Corporate Law">
         <meta name="citation_publication_date" content="2000">`,
      ),
    });
    expect(out.verdict.same_work).toBe(false);
    expect(out.verdict.basis).toBe("title_only_insufficient");
  });

  it("E4b the same adjacent year IS accepted once a DOI confirms the work", async () => {
    const out = await enrichAndCompare({
      wanted: { title: WANTED.title, year: "2001", doi: "10.2307/1229689" },
      candidate: { title: WANTED.title },
      candidate_url: "https://example.edu/online-first",
      deps: landing(
        `<meta name="citation_doi" content="10.2307/1229689">
         <meta name="citation_publication_date" content="2000">`,
      ),
    });
    expect(out.verdict.same_work).toBe(true);
    expect(out.verdict.basis).toBe("doi_exact");
  });

  it("E5 garbage metadata (pubdat, file paths) is ignored", async () => {
    const out = await enrichAndCompare({
      wanted: WANTED,
      candidate: { title: WANTED.title },
      candidate_url: "https://example.edu/x",
      deps: landing(
        `<meta name="citation_title" content="pubdat">
         <meta name="citation_author" content="C:\\Working Papers\\11883.wpd">`,
      ),
    });
    expect(out.identity.authors).toBeUndefined();
    expect(out.identity.title).toBe(WANTED.title);
    expect(out.verdict.same_work).toBe(false);
  });

  it("E6 a conflicting DOI is a hard reject that overrides title similarity", async () => {
    const out = await enrichAndCompare({
      wanted: { title: WANTED.title, doi: "10.1111/aaa.1" },
      candidate: { title: WANTED.title, authors: WANTED.authors },
      candidate_url: "https://example.edu/other",
      deps: landing(`<meta name="citation_doi" content="10.2222/bbb.2">`),
    });
    expect(out.hard_reject).toBe(true);
    expect(out.verdict.same_work).toBe(false);
    expect(out.telemetry.conflict).toBe(true);
  });

  it("E7 confirmed identity does not by itself admit the source as evidence", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "http_403_forbidden",
      already_attempted_urls: ["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1"],
      search: async () => [
        result({ title: WANTED.title, url: "https://law.yale.edu/faculty/eoh" }),
      ],
      enrichment: landing(
        `<meta name="citation_title" content="The End of History for Corporate Law">
         <meta name="citation_author" content="Hansmann, Henry">`,
      ),
    });
    expect(rec.recovered).toBe(true);
    expect(rec.equivalence_basis).toBe("title_and_author");
    // Recovery returns a CANDIDATE, never a body and never evidence.
    expect((rec.candidate as unknown as { body?: string }).body).toBeUndefined();
    expect(rec.candidate?.url).toContain("yale.edu");
  });

  it("E8 the metadata service is used for identity only, never as a source", async () => {
    let cited: string | undefined;
    const out = await enrichAndCompare({
      wanted: WANTED,
      candidate: { title: WANTED.title },
      candidate_url: "https://example.edu/paper",
      deps: {
        fetchTitleMetadata: async () => {
          cited = "https://api.crossref.org/works";
          return {
            service: "crossref",
            record: {
              title: [WANTED.title],
              author: [{ given: "Henry", family: "Hansmann" }],
              issued: { "date-parts": [[2001]] },
              DOI: "10.2307/1229689",
            },
          };
        },
      },
    });
    expect(out.verdict.same_work).toBe(true);
    expect(out.telemetry.crossref).toBe(1);
    // The endpoint never becomes the candidate: identity only.
    expect(cited).toBe("https://api.crossref.org/works");
    expect(out.identity.title).toBe(WANTED.title);
  });

  it("E9 no author, year or DOI even after enrichment stays rejected", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [result({ title: WANTED.title, url: "https://example.edu/a" })],
      enrichment: { fetchHtml: async () => undefined },
    });
    expect(rec.recovered).toBe(false);
    expect(rec.reason).toBe("identity_still_insufficient_after_enrichment");
    const stats = emptySameWorkRecoveryStats();
    noteSameWorkRecovery(stats, rec.telemetry);
    expect(stats.same_work_enrichment_triggered).toBe(1);
    expect(stats.same_work_enrichment_still_insufficient).toBe(1);
  });

  it("E10 a clear title mismatch never triggers enrichment", async () => {
    const candidate = identityFromSearchResult({ title: "A Completely Different Paper Title" });
    const verdict = isSameWork(WANTED, candidate);
    expect(verdict.basis).toBe("title_mismatch");
    expect(shouldEnrich(WANTED, candidate, verdict)).toBe(false);

    let touched = false;
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [
        result({ title: "A Completely Different Paper Title", url: "https://example.edu/b" }),
      ],
      enrichment: {
        fetchHtml: async () => {
          touched = true;
          return undefined;
        },
      },
    });
    expect(touched).toBe(false);
    expect(rec.reason).toBe("no_equivalent_public_copy");
  });

  it("DOI normalization is strictly syntactic", () => {
    expect(normalizeDoi("https://doi.org/10.1111/ABC.1")).toBe("10.1111/abc.1");
    expect(normalizeDoi("doi: 10.1111/abc.1 ")).toBe("10.1111/abc.1");
    expect(normalizeDoi("10.1111-abc")).toBeUndefined();
    expect(doiFromUrl("https://repo.edu/cgi/viewcontent.cgi?doi=10.1111/abc.1")).toBe("10.1111/abc.1");
  });

  it("author names normalize across harmless formatting differences", () => {
    expect(normalizeAuthorName("Gilson, Ronald J.")).toBe("Ronald J. Gilson");
    const v = isSameWork(
      { title: "Corporate Governance and Economic Efficiency", authors: ["Ronald J. Gilson"] },
      { title: "Corporate Governance and Economic Efficiency", authors: ["Gilson, Ronald"] },
    );
    expect(v.same_work).toBe(true);
  });
});
