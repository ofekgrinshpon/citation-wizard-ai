/**
 * same_work_live_recovery_v1 — deterministic same-work recovery (R1–R8).
 *
 * Equivalence is decided by code, never by a model. These tests lock the
 * acceptance criteria: cross-host recovery works, title-only matches and
 * pirate mirrors are rejected, dead URLs are never retried, and a recovered
 * body still has to pass the ordinary document / evidence gates.
 */

import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types.ts";
import {
  emptySameWorkRecoveryStats,
  identityFromSearchResult,
  noteSameWorkRecovery,
  normalizeUrlKey,
  recoverSameWork,
  SAME_WORK_RECOVERY_LIMITS,
  workKey,
} from "../../supabase/functions/legal-research-v2/tools/sameWorkRecovery.ts";
import { isSameWork } from "../../supabase/functions/legal-research-v2/tools/alternativeCopy.ts";

let n = 0;
function result(partial: Partial<SearchResult>): SearchResult {
  return {
    result_id: `R${++n}`,
    title: "",
    origin: "perplexity:raw_web",
    ...partial,
  } as SearchResult;
}

const WANTED = {
  title: "Bodily Autonomy and Tattoo Copyright in the Digital Age",
  authors: ["Yael Bregman"],
  year: "2022",
};

describe("same-work live recovery", () => {
  it("R1 accepts a university PDF with the same title and author", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "http_403_forbidden",
      already_attempted_urls: ["https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123"],
      search: async () => [
        result({
          title: "Bodily Autonomy and Tattoo Copyright in the Digital Age",
          url: "https://law.huji.ac.il/sites/default/files/bregman-tattoo.pdf",
          snippet: "Yael Bregman, 2022",
          published_date: "2022-05-01",
        }),
      ],
    });
    expect(rec.recovered).toBe(true);
    if (rec.recovered) {
      expect(rec.candidate.url).toContain("huji.ac.il");
      expect(rec.telemetry.basis === "title_and_year" || rec.telemetry.basis === "title_and_author").toBe(true);
      expect(rec.telemetry.recovered_host).toBe("law.huji.ac.il");
    }
  });

  it("R2 rejects the same title with a different author and year", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [
        result({
          title: "Bodily Autonomy and Tattoo Copyright in the Digital Age",
          url: "https://example.edu/other-author.pdf",
          snippet: "Dana Cohen, 2017",
          published_date: "2017-01-01",
        }),
      ],
    });
    expect(rec.recovered).toBe(false);
    if (!rec.recovered) expect(rec.reason).toBe("no_equivalent_public_copy");
  });

  it("R2b title-only similarity is never sufficient", () => {
    const v = isSameWork({ title: WANTED.title }, { title: WANTED.title });
    expect(v.same_work).toBe(false);
    expect(v.basis).toBe("title_only_insufficient");
  });

  it("R3 accepts an exact DOI match on another host", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: { title: "Corporate Purpose", doi: "10.1111/jols.12345" },
      failure_class: "connection_reset",
      already_attempted_urls: ["https://ecgi.global/paper.pdf"],
      search: async () => [
        result({
          title: "Corporate Purpose (author manuscript)",
          url: "https://repository.law.umn.edu/cgi/viewcontent.cgi?doi=10.1111/jols.12345",
        }),
      ],
    });
    expect(rec.recovered).toBe(true);
    if (rec.recovered) expect(rec.telemetry.basis).toBe("doi_exact");
  });

  it("R4 rejects a pirate mirror even with an exact title", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async () => [
        result({
          title: WANTED.title,
          url: "https://sci-hub.se/10.1111/abc",
          published_date: "2022-01-01",
        }),
      ],
    });
    expect(rec.recovered).toBe(false);
    if (!rec.recovered) expect(rec.telemetry.rejected_host).toBe(1);
  });

  it("R5 never retries the original dead URL", async () => {
    const dead = "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=123";
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "http_403_forbidden",
      already_attempted_urls: [dead],
      search: async () => [
        result({ title: WANTED.title, url: dead.replace("https://", "https://www."), published_date: "2022" }),
      ],
    });
    expect(rec.recovered).toBe(false);
    expect(rec.telemetry.rejected_already_attempted).toBe(1);
    expect(normalizeUrlKey(dead)).toBe(normalizeUrlKey(dead.replace("https://", "https://www.")));
  });

  it("R6 rejects a candidate without enough metadata to establish equivalence", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "timeout",
      already_attempted_urls: [],
      search: async () => [result({ title: "Download PDF", url: "https://example.edu/files/a.pdf" })],
    });
    expect(rec.recovered).toBe(false);
    if (!rec.recovered) expect(rec.telemetry.rejected_identity).toBe(1);
  });

  it("R6b refuses to build a query when the failed work has no usable identity", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: { title: "PDF" },
      already_attempted_urls: [],
      search: async () => {
        throw new Error("must not search");
      },
    });
    expect(rec.recovered).toBe(false);
    if (!rec.recovered) expect(rec.reason).toBe("insufficient_identity_for_query");
  });

  it("R7 a non-recoverable failure class never triggers recovery", async () => {
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "discovery_endpoint_not_a_document",
      already_attempted_urls: [],
      search: async () => {
        throw new Error("must not search");
      },
    });
    expect(rec.recovered).toBe(false);
    expect(rec.telemetry.triggered).toBe(false);
  });

  it("R8 recovery is bounded: one query, bounded results, telemetry recorded", async () => {
    let calls = 0;
    const rec = await recoverSameWork({
      failed_source_identity: WANTED,
      failure_class: "http_403_forbidden",
      already_attempted_urls: [],
      search: async (_q, limit) => {
        calls += 1;
        expect(limit).toBe(SAME_WORK_RECOVERY_LIMITS.MAX_RESULTS);
        return Array.from({ length: 20 }, () =>
          result({ title: WANTED.title, url: "https://example.edu/x.pdf", published_date: "2022" }));
      },
    });
    expect(calls).toBe(1);
    expect(SAME_WORK_RECOVERY_LIMITS.MAX_QUERIES_PER_WORK).toBe(1);
    const stats = emptySameWorkRecoveryStats();
    noteSameWorkRecovery(stats, rec.telemetry);
    expect(stats.same_work_recovery_triggered).toBe(1);
    expect(stats.same_work_recovery_query_count).toBe(1);
    expect(stats.same_work_recovery_success).toBe(1);
    expect(stats.same_work_recovered_host).toEqual(["example.edu"]);
  });

  it("work keys are stable and dedupe a repeated work", () => {
    expect(workKey({ doi: "10.1/AB" })).toBe("doi:10.1/ab");
    expect(workKey({ title: WANTED.title })).toBe(workKey({ title: WANTED.title.toUpperCase() }));
    expect(workKey({ title: "short" })).toBeNull();
  });

  it("discovery identity is read, never guessed", () => {
    const id = identityFromSearchResult({
      title: "A Paper",
      snippet: "see doi 10.1000/xyz123 (2019)",
      url: "https://example.edu/a.pdf",
    });
    expect(id.doi).toBe("10.1000/xyz123");
    expect(id.year).toBe("2019");
    expect(id.authors).toBeUndefined();
  });
});
