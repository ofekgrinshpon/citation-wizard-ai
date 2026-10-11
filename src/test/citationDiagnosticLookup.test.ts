import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runForeignLookup, type ForeignLookupInput } from "../../supabase/functions/citation-chat/foreignLookup";
import {
  CITATION_DIAGNOSTIC_COUNT_LIMIT, CITATION_DIAGNOSTIC_FIELDS, createCitationDiagnosticCollector,
  sanitizeCitationDiagnostic, safeObserveCitationDiagnostic, type CitationDiagnosticObserver,
} from "../../supabase/functions/_shared/citationDiagnostic";

const rawInput = "Warren & Brandeis, The Right to Privacy, pp. 213–214.";
const input: ForeignLookupInput = { kind: "journal_article", jurisdiction: "OTHER", rawInput };
const donor = {
  title: "The Right to Privacy — Warren and Brandeis", url: "https://law.harvard.edu/privacy",
  snippet: "Samuel D. Warren and Louis D. Brandeis, The Right to Privacy, 4 Harvard Law Review 193 (1890).",
};
const partialHtml = '<meta name="citation_title" content="The Right to Privacy"><meta name="citation_author" content="Warren"><meta name="citation_author" content="Brandeis">';
const completeHtml = partialHtml + '<meta name="citation_journal_title" content="Harvard Law Review"><meta name="citation_volume" content="4"><meta name="citation_firstpage" content="193"><meta name="citation_date" content="1890">';
type SearchFixture = { status?: number; payload?: unknown; jsonError?: boolean; fetchError?: boolean };
type PageFixture = { status?: number; text?: string; fetchError?: boolean; readError?: boolean };

function replay(searches: SearchFixture[], page: PageFixture = {}) {
  let nextSearch = 0;
  const calls: unknown[] = [];
  const reads = { json: 0, page: 0 };
  const fetchImpl = (async (url: string, init?: RequestInit, options?: unknown) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body, options });
    if (url === "https://api.perplexity.ai/search") {
      const fixture = searches[nextSearch++] ?? { payload: { results: [] } };
      if (fixture.fetchError) throw new Error("PRIVATE_PROVIDER_FAILURE https://secret.example/secret API_KEY_SENTINEL");
      const status = fixture.status ?? 200;
      return {
        ok: status >= 200 && status < 300, status,
        json: async () => {
          reads.json++;
          if (fixture.jsonError) throw new Error("PRIVATE_JSON_BODY");
          return fixture.payload ?? { results: [] };
        },
      } as Response;
    }
    if (page.fetchError) throw new Error("PRIVATE_PAGE_FETCH_FAILURE");
    const status = page.status ?? 200;
    return {
      ok: status >= 200 && status < 300, status, body: null,
      text: async () => {
        reads.page++;
        if (page.readError) throw new Error("PRIVATE_PAGE_READ_FAILURE");
        return page.text ?? "";
      },
    } as Response;
  }) as typeof fetch;
  return {
    calls, reads,
    run: (observer?: CitationDiagnosticObserver, lookupInput = input, apiKey: string | null = "API_KEY_SENTINEL") =>
      runForeignLookup(lookupInput, { fetchImpl, apiKey, diagnosticObserver: observer }),
  };
}

async function parity(searches: SearchFixture[], page: PageFixture = {}, lookupInput = input) {
  const plain = replay(searches, page), traced = replay(searches, page);
  const collector = createCitationDiagnosticCollector();
  const before = await plain.run(undefined, lookupInput);
  const after = await traced.run(collector.observe, lookupInput);
  expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  expect(traced.calls).toEqual(plain.calls);
  expect(traced.reads).toEqual(plain.reads);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  return { result: after, trace: collector.snapshot(), calls: traced.calls, reads: traced.reads };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked network forbidden in citation diagnostics"); })));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("temporary citation lookup observation", () => {
  it("records missing credentials without requests or changing fallback bytes", async () => {
    const plain = replay([]), traced = replay([]), collector = createCitationDiagnosticCollector();
    expect(JSON.stringify(await traced.run(collector.observe, input, null))).toBe(JSON.stringify(await plain.run(undefined, input, null)));
    expect(traced.calls).toEqual([]);
    expect(collector.snapshot()).toMatchObject({
      suppliedFields: ["authors", "articleTitle", "pinpoint"], stopReason: "missing_credentials",
      searches: { tier1: { status: "not_started" }, tier2: { status: "not_started" } },
      final: { resolution: "incomplete", missingFields: ["journal", "volume", "firstPage", "year"] },
    });
  });

  it("observes a missing title without adding requests or a resolution to the result", async () => {
    const test = await parity([], {}, { ...input, rawInput: "" });
    expect(test.calls).toEqual([]);
    expect(test.result.articleResolution).toBeUndefined();
    expect(test.trace.stopReason).toBe("missing_title");
    expect(test.trace.final.resolution).toBe("unavailable");
  });

  it.each([
    ["http_error", { status: 429 }, 429, 0],
    ["json_error", { jsonError: true }, 200, 2],
    ["invalid_shape", { payload: { unexpected: "PRIVATE_JSON_BODY" } }, 200, 2],
    ["fetch_error", { fetchError: true }, null, 0],
  ] as const)("records %s per tier and preserves existing rescue", async (status, fixture, httpStatus, reads) => {
    const test = await parity([fixture, fixture]);
    expect(test.calls).toHaveLength(2);
    expect(test.reads).toEqual({ json: reads, page: 0 });
    for (const tier of ["tier1", "tier2"] as const) expect(test.trace.searches[tier]).toMatchObject({ status, httpStatus, resultCount: 0 });
    expect(test.trace.stopReason).toBe("tier2_exhausted");
    expect(test.trace.final.resolution).toBe("incomplete");
    expect(JSON.stringify(test.trace)).not.toMatch(/PRIVATE|SENTINEL|secret|https:/);
  });

  it("records Search timeout without altering the two-attempt bound", async () => {
    vi.useFakeTimers();
    const collector = createCitationDiagnosticCollector();
    let calls = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls++;
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_TIMEOUT"))));
    }) as typeof fetch;
    const result = runForeignLookup(input, { fetchImpl, apiKey: "mock", diagnosticObserver: collector.observe });
    await vi.advanceTimersByTimeAsync(40_000);
    expect((await result).articleResolution).toBe("incomplete");
    expect(calls).toBe(2);
    expect(collector.snapshot().searches.tier1.status).toBe("timeout");
    expect(collector.snapshot().searches.tier2.status).toBe("timeout");
  });

  it("retains the HTTP status when Search times out during its existing JSON read", async () => {
    vi.useFakeTimers();
    const collector = createCitationDiagnosticCollector();
    let reads = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => ({
      ok: true, status: 200, json: () => {
        reads++;
        return new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_JSON_TIMEOUT"))));
      },
    })) as typeof fetch;
    const result = runForeignLookup(input, { fetchImpl, apiKey: "mock", diagnosticObserver: collector.observe });
    await vi.advanceTimersByTimeAsync(40_000);
    expect((await result).articleResolution).toBe("incomplete");
    expect(reads).toBe(2);
    expect(collector.snapshot().searches.tier1).toMatchObject({ status: "timeout", httpStatus: 200 });
    expect(collector.snapshot().searches.tier2).toMatchObject({ status: "timeout", httpStatus: 200 });
  });

  it("counts weak, strong-unparsed and missing-URL results without accepting them", async () => {
    const fixture = { payload: { results: [
      { ...donor, url: "https://weak.example/privacy" },
      { ...donor, title: "Unrelated Work", snippet: "PRIVATE_UNRELATED_SNIPPET" },
      { title: "PRIVATE_TITLE_WITHOUT_URL" },
    ] } };
    const test = await parity([fixture, fixture]);
    expect(test.calls).toHaveLength(2);
    expect(test.trace.searches.tier1).toMatchObject({ resultCount: 3, strongHostCount: 1, weakHostCount: 1, missingUrlCount: 1, noRecordCount: 1, parsedCount: 0 });
    expect(test.trace.page.status).toBe("no_candidate");
    expect(test.trace.final.identityMatched).toBe(false);
    expect(JSON.stringify(test.trace)).not.toContain("PRIVATE");
  });

  it("exposes the existing partial HTML early stop without fixing it", async () => {
    const test = await parity([{ payload: { results: [{ ...donor, snippet: "PRIVATE_NO_PUBLICATION" }] } }], { text: partialHtml });
    expect(test.calls).toHaveLength(2); // one Search, one existing page request
    expect(test.reads).toEqual({ json: 1, page: 1 });
    expect(test.result.diagnostics).toEqual({ tier1Queried: true, tier2Fired: false });
    expect(test.result.articleResolution).toBe("incomplete");
    expect(test.trace.page).toMatchObject({ status: "record_accepted", tier: "tier1", httpStatus: 200, parsedCount: 1, acceptedCount: 1, acceptedFields: ["authors", "articleTitle"] });
    expect(test.trace.searches.tier2.status).toBe("not_started");
    expect(test.trace.stopReason).toBe("tier1_records_present");
    expect(test.trace.final.missingFields).toEqual(["journal", "volume", "firstPage", "year"]);
  });

  it.each([
    ["http_error", { status: 403 }, 403, 0],
    ["empty", { text: "" }, 200, 1],
    ["no_record", { text: "PRIVATE_HTML_NO_METADATA" }, 200, 1],
    ["fetch_error", { fetchError: true }, null, 0],
    ["read_error", { readError: true }, 200, 1],
  ] as const)("observes page %s without another inspection or extra body reads", async (status, page, httpStatus, pageReads) => {
    const test = await parity([{ payload: { results: [{ ...donor, snippet: "" }] } }, { payload: { results: [] } }], page);
    expect(test.calls).toHaveLength(3);
    expect(test.reads).toEqual({ json: 2, page: pageReads });
    expect(test.trace.page).toMatchObject({ status, httpStatus, parsedCount: 0 });
    expect(test.trace.searches.tier2.status).toBe("ok");
  });

  it("accepts complete snippets, records field presence and skips the page", async () => {
    const test = await parity([{ payload: { results: [donor] } }]);
    expect(test.calls).toHaveLength(1);
    expect(test.trace.searches.tier1).toMatchObject({ resultCount: 1, parsedCount: 1, acceptedCount: 1, rejectedCount: 0 });
    expect(test.trace.page.status).toBe("skipped_records_present");
    expect(test.trace.final).toMatchObject({ resolution: "resolved", identityMatched: true, presentFields: [...CITATION_DIAGNOSTIC_FIELDS], missingFields: [], conflictFields: [] });
  });

  it("records complete HTML fields with a single body read", async () => {
    const test = await parity([{ payload: { results: [{ ...donor, snippet: "" }] } }], { text: completeHtml });
    expect(test.trace.final.resolution).toBe("resolved");
    expect(test.trace.page.acceptedFields).toEqual(CITATION_DIAGNOSTIC_FIELDS.filter((field) => field !== "pinpoint"));
    expect(test.reads.page).toBe(1);
  });

  it("does not reread, clone or change cancellation of a streamed page", async () => {
    const streamReplay = (observer?: CitationDiagnosticObserver) => {
      const reads = { search: 0, reader: 0, chunks: 0, cancel: 0, requests: 0 };
      const fetchImpl = (async (url: string) => {
        reads.requests++;
        if (url === "https://api.perplexity.ai/search") return {
          ok: true, status: 200, json: async () => { reads.search++; return { results: [{ ...donor, snippet: "" }] }; },
        } as Response;
        // The original bound cancels after the chunk crosses its byte limit.
        const bytes = new TextEncoder().encode(completeHtml + " ".repeat(1_500_000));
        return {
          ok: true, status: 200,
          body: { getReader: () => {
            reads.reader++;
            return {
              read: async () => { reads.chunks++; return { done: false, value: bytes }; },
              cancel: async () => { reads.cancel++; },
            };
          } },
          text: () => { throw new Error("Unexpected second body path"); },
          clone: () => { throw new Error("Unexpected response clone"); },
        } as unknown as Response;
      }) as typeof fetch;
      return { reads, result: runForeignLookup(input, { fetchImpl, apiKey: "mock", diagnosticObserver: observer }) };
    };
    const collector = createCitationDiagnosticCollector();
    const ordinary = streamReplay(), observed = streamReplay(collector.observe);
    expect(JSON.stringify(await observed.result)).toBe(JSON.stringify(await ordinary.result));
    expect(observed.reads).toEqual(ordinary.reads);
    expect(observed.reads).toEqual({ search: 1, reader: 1, chunks: 1, cancel: 1, requests: 2 });
    expect(collector.snapshot().final.resolution).toBe("resolved");
  });

  it("records the existing page timeout and still makes the bounded rescue Search", async () => {
    vi.useFakeTimers();
    const collector = createCitationDiagnosticCollector();
    let searches = 0, pages = 0;
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (url === "https://api.perplexity.ai/search") {
        searches++;
        return new Response(JSON.stringify({ results: [{ ...donor, snippet: "" }] }), { status: 200 });
      }
      pages++;
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("PRIVATE_PAGE_TIMEOUT"))));
    }) as typeof fetch;
    const result = runForeignLookup(input, { fetchImpl, apiKey: "mock", diagnosticObserver: collector.observe });
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await result).articleResolution).toBe("incomplete");
    expect({ searches, pages }).toEqual({ searches: 2, pages: 1 });
    expect(collector.snapshot().page.status).toBe("timeout");
  });

  it("observes a blocked page URL without fetching it", async () => {
    const fixture = { payload: { results: [{ ...donor, snippet: "", url: "ftp://law.harvard.edu/privacy" }] } };
    const test = await parity([fixture, fixture]);
    expect(test.calls).toHaveLength(2);
    expect(test.reads.page).toBe(0);
    expect(test.trace.page.status).toBe("blocked_url");
  });

  it("records a parsed page rejected for a supplied-field conflict", async () => {
    const test = await parity([{ payload: { results: [{ ...donor, snippet: "" }] } }, { payload: { results: [] } }], { text: completeHtml }, { ...input, parsedFields: { year: "1990" } });
    expect(test.trace.page).toMatchObject({ status: "record_rejected", parsedCount: 1, acceptedCount: 0, rejectedCount: 1 });
    expect(test.trace.final.conflictFields).toEqual(["year"]);
    expect(test.trace.final.resolution).toBe("conflict");
  });

  it("distinguishes parsed records rejected against supplied anchors", async () => {
    const fixture = { payload: { results: [donor] } };
    const test = await parity([fixture, fixture], {}, { ...input, parsedFields: { year: "1990" } });
    expect(test.trace.searches.tier1).toMatchObject({ parsedCount: 1, acceptedCount: 0, rejectedCount: 1, acceptedFields: [] });
    expect(test.trace.searches.tier2.rejectedCount).toBe(1);
    expect(test.trace.final).toMatchObject({ resolution: "conflict", conflictFields: ["year"] });
    expect(JSON.stringify(test.trace)).not.toMatch(/1890|1990|Warren|Brandeis|Harvard|Privacy|SENTINEL/);
  });

  it("records cross-record conflicts without exposing the incompatible values", async () => {
    const other = { ...donor, url: "https://lawreview.example.edu/private", snippet: donor.snippet.replace("(1890)", "(1990)") };
    const test = await parity([{ payload: { results: [donor, other] } }]);
    expect(test.trace.searches.tier1).toMatchObject({ parsedCount: 2, acceptedCount: 2, rejectedCount: 0 });
    expect(test.trace.final).toMatchObject({ resolution: "conflict", conflictFields: ["year"], missingFields: ["journal", "volume", "firstPage", "year"] });
    expect(test.result.fields).toEqual({});
  });

  it("fails open when every observer callback throws", async () => {
    const plain = replay([{ payload: { results: [{ ...donor, snippet: "" }] } }], { text: partialHtml });
    const broken = replay([{ payload: { results: [{ ...donor, snippet: "" }] } }], { text: partialHtml });
    const callback = vi.fn(() => { throw new Error("observer failure"); });
    expect(JSON.stringify(await broken.run(callback))).toBe(JSON.stringify(await plain.run()));
    expect(broken.calls).toEqual(plain.calls);
    expect(broken.reads).toEqual(plain.reads);
    expect(callback).toHaveBeenCalled();
  });

  it("fails open for an accidentally async rejecting observer", async () => {
    const fixture = { payload: { results: [donor] } };
    const plain = replay([fixture]), broken = replay([fixture]);
    expect(await broken.run(async () => { throw new Error("PRIVATE_ASYNC_OBSERVER_FAILURE"); })).toEqual(await plain.run());
    expect(broken.calls).toEqual(plain.calls);
    expect(broken.reads).toEqual(plain.reads);
  });

  it("keeps simultaneous invocations and returned snapshots independent", async () => {
    const complete = createCitationDiagnosticCollector(), missing = createCitationDiagnosticCollector();
    await Promise.all([replay([{ payload: { results: [donor] } }]).run(complete.observe), replay([{ fetchError: true }, { fetchError: true }]).run(missing.observe)]);
    expect(complete.snapshot().final.resolution).toBe("resolved");
    expect(missing.snapshot().final.resolution).toBe("incomplete");
    const copy = complete.snapshot(); copy.final.presentFields.length = 0; copy.searches.tier1.status = "fetch_error";
    expect(complete.snapshot().final.presentFields).toHaveLength(7);
    expect(complete.snapshot().searches.tier1.status).toBe("ok");
  });

  it("does not trace non-article lookups or change their requests/results", async () => {
    const callback = vi.fn();
    const plain = replay([]), observed = replay([]), caseInput: ForeignLookupInput = { kind: "case", jurisdiction: "US", rawInput: "Smith v. Jones" };
    expect(await observed.run(callback, caseInput)).toEqual(await plain.run(undefined, caseInput));
    expect(observed.calls).toEqual(plain.calls);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe("citation diagnostic privacy boundary", () => {
  it("drops all unknown server fields and free text, clamps counts and projects enums", () => {
    const safe = sanitizeCitationDiagnostic({
      version: 1, rawInput: "PRIVATE_INPUT", apiKey: "PRIVATE_KEY", userId: "PRIVATE_USER", headers: { secret: "PRIVATE_HEADER" },
      suppliedFields: ["authors", "PRIVATE_FIELD", "authors"],
      searches: { tier1: { status: "PRIVATE_ERROR", httpStatus: 999, resultCount: 999999, parsedCount: -1, acceptedCount: Infinity, parsedFields: ["year", "PRIVATE_VALUE"], url: "https://private.example" } },
      page: { status: "record_accepted", httpStatus: 200, parsedFields: ["journal"], snippet: "PRIVATE_SNIPPET" },
      stopReason: "PRIVATE_REASON", final: { resolution: "resolved", identityMatched: "PRIVATE_TRUE", presentFields: ["articleTitle"], conflictFields: ["year", "PRIVATE_CONFLICT"], error: "PRIVATE_FINAL_ERROR" },
    });
    expect(JSON.stringify(safe)).not.toMatch(/PRIVATE|https:|rawInput|apiKey|userId|headers|snippet/);
    expect(safe).toMatchObject({ suppliedFields: ["authors"], searches: { tier1: { status: "not_started", httpStatus: null, resultCount: CITATION_DIAGNOSTIC_COUNT_LIMIT, parsedCount: 0, acceptedCount: 0, parsedFields: ["year"] } }, final: { identityMatched: false, conflictFields: ["year"] } });
    expect(sanitizeCitationDiagnostic(safe)).toEqual(safe);
  });

  it("never throws for malformed, unsupported or getter-backed response objects", () => {
    for (const value of [null, "private", { version: 2 }, new Proxy({}, { get: () => { throw new Error("private"); } })]) expect(sanitizeCitationDiagnostic(value)).toBeNull();
    const collector = createCitationDiagnosticCollector();
    expect(() => collector.observe(null as never)).not.toThrow();
    expect(() => safeObserveCitationDiagnostic(() => { throw new Error("private"); }, { type: "stop", reason: "missing_title" })).not.toThrow();
  });

  it("bounds repeated observations without retaining a history or untrusted fields", () => {
    const collector = createCitationDiagnosticCollector();
    for (let i = 0; i < 1100; i++) collector.observe({ type: "record", tier: "tier1", origin: "snippet", accepted: true, fields: ["year"], conflicts: [] });
    expect(collector.snapshot().searches.tier1.parsedCount).toBe(CITATION_DIAGNOSTIC_COUNT_LIMIT);
    expect(collector.snapshot().searches.tier1.acceptedFields).toEqual(["year"]);
    expect(JSON.stringify(collector.snapshot()).length).toBeLessThan(2200);
  });
});
