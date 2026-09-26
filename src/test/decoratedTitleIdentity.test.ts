/**
 * decorated_title_normalization_v1 + original_work_enrichment_v1 — T1–T7.
 *
 * The live failure: discovery returned "Title | Author (כרך ב)" as one string,
 * so the original work stayed title-only and every alternative copy was
 * rejected as `title_only_insufficient`. These tests pin the fix AND the trust
 * boundary it must not cross.
 */

import { describe, expect, it } from "vitest";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types.ts";
import { splitDecoratedScholarlyTitle } from "../../supabase/functions/legal-research-v2/shared/decoratedTitle.ts";
import {
  buildTrustedWorkIdentity,
  identityFromSearchResult,
  recoverSameWork,
} from "../../supabase/functions/legal-research-v2/tools/sameWorkRecovery.ts";
import { isSameWork } from "../../supabase/functions/legal-research-v2/tools/alternativeCopy.ts";
import {
  ENRICHMENT_LIMITS,
  shouldEnrich,
  type EnrichmentDeps,
} from "../../supabase/functions/legal-research-v2/tools/identityEnrichment.ts";

const RAW =
  'זכויות יוצרים ותחרות – משוק עותקים למשטר רישוי | ניבה אלקין-קורן (כרך ב)';
const CORE = "זכויות יוצרים ותחרות – משוק עותקים למשטר רישוי";
const AUTHOR = "ניבה אלקין-קורן";

let n = 0;
function result(partial: Partial<SearchResult>): SearchResult {
  return { result_id: `T${++n}`, title: "", origin: "perplexity:raw_web", ...partial } as SearchResult;
}

describe("decorated scholarly title normalization", () => {
  it("T1 reproduces the live failure and now proves the same work", async () => {
    const trusted = buildTrustedWorkIdentity({
      discovery: {
        title: RAW,
        url: "https://law.haifa.ac.il/wp-content/uploads/2021/11/b2_6.pdf",
      },
    });
    expect(trusted.identity.title).toBe(CORE);
    expect(trusted.identity.authors).toEqual([AUTHOR]);
    expect(trusted.author_from_title).toBe(true);
    expect(trusted.provenance.authors).toBe("discovery_title");

    const candidate = result({
      title: CORE + " | " + AUTHOR,
      url: "https://repo.example.org/copy.pdf",
    });
    const verdict = isSameWork(trusted.identity, identityFromSearchResult(candidate));
    expect(verdict.same_work).toBe(true);
    expect(verdict.basis).toBe("title_and_author");

    const attempted: string[] = [];
    const rec = await recoverSameWork({
      failed_source_identity: trusted.identity,
      failure_class: "unsupported_response",
      already_attempted_urls: ["https://law.haifa.ac.il/wp-content/uploads/2021/11/b2_6.pdf"],
      search: async () => [candidate],
      acquire: async (c) => {
        attempted.push(c.url!);
        return { ok: true };
      },
    });
    expect(rec.recovered).toBe(true);
    expect(rec.equivalence_basis).toBe("title_and_author");
    expect(attempted).toEqual(["https://repo.example.org/copy.pdf"]);
  });

  it("T2 never splits legitimate punctuation inside a real title", () => {
    for (
      const t of [
        "Copyright, Competition and Digital Markets",
        "Licensing: From Copies to Access",
        "Copyright – Exhaustion and Reproduction",
        "זכויות יוצרים ותחרות – משוק עותקים למשטר רישוי",
      ]
    ) {
      const out = splitDecoratedScholarlyTitle(t);
      expect(out?.title).toBe(t);
      expect(out?.authors).toBeUndefined();
      expect(out?.normalized).toBe(false);
      expect(identityFromSearchResult({ title: t }).authors).toBeUndefined();
    }
  });

  it("T3 keeps a pipe suffix that is not a byline", () => {
    for (
      const t of [
        "Secondary Digital Markets and Exhaustion | Digital Markets and Competition",
        "Copyright Exhaustion in the Cloud | Harvard Law Review",
        "Copyright Exhaustion in the Cloud | Download PDF",
      ]
    ) {
      const out = splitDecoratedScholarlyTitle(t);
      expect(out?.title).toBe(t);
      expect(out?.authors).toBeUndefined();
    }
  });

  it("T1b strips a volume-only suffix without inventing an author", () => {
    const out = splitDecoratedScholarlyTitle("Copyright and Competition Revisited | (כרך ב)");
    expect(out?.title).toBe("Copyright and Competition Revisited");
    expect(out?.authors).toBeUndefined();
    expect(out?.normalized).toBe(true);
  });

  it("T4 one bounded metadata lookup enriches a title-only original", async () => {
    let calls = 0;
    const deps: EnrichmentDeps = {
      fetchTitleMetadata: async () => {
        calls += 1;
        return {
          service: "crossref",
          record: {
            title: ["Known Article Title"],
            author: [{ given: "Dana", family: "Levi" }],
            issued: { "date-parts": [[2014]] },
          },
        };
      },
    };
    const candidate = result({
      title: "Known Article Title",
      url: "https://repo.example.org/known.pdf",
      published_date: "2014-05-01",
    });
    const rec = await recoverSameWork({
      failed_source_identity: { title: "Known Article Title" },
      failure_class: "unsupported_response",
      already_attempted_urls: [],
      enrichment: deps,
      search: async () => [candidate],
      acquire: async () => ({ ok: true }),
    });
    expect(calls).toBe(1);
    expect(rec.telemetry.original_enrichment_attempted).toBe(true);
    expect(rec.telemetry.original_enrichment_success).toBe(true);
    expect(rec.telemetry.original_fields_after_enrichment).toEqual(
      expect.arrayContaining(["title", "authors", "year"]),
    );
    expect(rec.telemetry.original_enrichment_provenance).toEqual(
      expect.arrayContaining(["authors:crossref", "year:crossref"]),
    );
    expect(rec.recovered).toBe(true);
  });

  it("T5 ignores a metadata result about a different work", async () => {
    const deps: EnrichmentDeps = {
      fetchTitleMetadata: async () => ({
        service: "crossref",
        record: {
          title: ["An Entirely Unrelated Study Of Something Else"],
          author: [{ given: "Other", family: "Person" }],
          issued: { "date-parts": [[1999]] },
        },
      }),
    };
    const rec = await recoverSameWork({
      failed_source_identity: { title: "Known Article Title" },
      failure_class: "unsupported_response",
      already_attempted_urls: [],
      enrichment: deps,
      search: async () => [],
      acquire: async () => ({ ok: true }),
    });
    expect(rec.telemetry.original_enrichment_attempted).toBe(true);
    expect(rec.telemetry.original_enrichment_success).toBe(false);
    expect(rec.telemetry.trusted_fields).toEqual(["title"]);
    expect(rec.recovered).toBe(false);
  });

  it("T6 normalization fixes candidate-enrichment eligibility without lowering the threshold", () => {
    const decorated = { title: RAW };
    const clean = { title: CORE };
    const rejected = isSameWork(decorated, clean);
    expect(
      shouldEnrich(decorated, clean, rejected),
    ).toBe(false); // decorated title fails the gate — the live failure

    const normalized = identityFromSearchResult({ title: RAW });
    const candidateOnly = { title: CORE };
    const verdict = isSameWork({ title: normalized.title }, candidateOnly);
    expect(shouldEnrich({ title: normalized.title }, candidateOnly, verdict)).toBe(true);
    expect(ENRICHMENT_LIMITS.MIN_TITLE_SIMILARITY).toBe(0.7);
  });

  it("T7 metadata alone never produces an acquired source", async () => {
    let acquireCalls = 0;
    const deps: EnrichmentDeps = {
      fetchTitleMetadata: async () => ({
        service: "crossref",
        record: {
          title: [CORE],
          author: [{ name: AUTHOR }],
          issued: { "date-parts": [[2017]] },
        },
      }),
    };
    const rec = await recoverSameWork({
      failed_source_identity: { title: CORE },
      failure_class: "unsupported_response",
      already_attempted_urls: [],
      enrichment: deps,
      search: async () => [result({ title: CORE, url: "https://repo.example.org/x.pdf" })],
      acquire: async () => {
        acquireCalls += 1;
        return { ok: false, failure_class: "unsupported_response" };
      },
    });
    expect(rec.telemetry.original_enrichment_success).toBe(true);
    expect(acquireCalls).toBeGreaterThan(0);
    expect(rec.recovered).toBe(false);
    expect(rec.reason).toBe("equivalent_copies_failed_acquisition");
  });
});
