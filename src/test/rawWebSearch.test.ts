/**
 * v2_raw_web_search_v1 — deterministic contract tests.
 *
 * These pin the tool contract only: discovery shape, safety, dedupe key and
 * budget accounting. No research policy, no ranking, no admission.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  RAW_WEB_SEARCH_LIMITS,
  rawQueryKey,
  runRawWebSearch,
} from "../../supabase/functions/legal-research-v2/tools/rawWebSearch.ts";
import { resetResultIds } from "../../supabase/functions/legal-research-v2/tools/resultIds.ts";
import { checkUrlSafety, isSafeFetchUrl } from "../../supabase/functions/legal-research-v2/shared/urlSafety.ts";
import { StopPolicy } from "../../supabase/functions/legal-research-v2/agent/stopPolicy.ts";
import { DEFAULT_BUDGETS } from "../../supabase/functions/legal-research-v2/types.ts";
import { corroborateAuthority } from "../../supabase/functions/legal-research-v2/tools/authorityCorroboration.ts";

function apiResponse(results: unknown[]): Response {
  return new Response(JSON.stringify({ results }), { status: 200 });
}

const fakeFetch = (results: unknown[]) => () => Promise.resolve(apiResponse(results));

const emptyIdentity = { dockets: [], statutes: [], sections: [], years: [], courts: [] } as never;

describe("raw_web_search contract", () => {
  beforeEach(() => resetResultIds());

  it("returns ranked discovery results with no generated answer", async () => {
    const out = await runRawWebSearch({ query: 'ע"א 423/75' }, {
      apiKey: "k",
      fetchImpl: fakeFetch([
        { title: "פסק דין", url: "https://judgments.org.il/x", snippet: "טקסט", date: "1977-01-01" },
      ]) as unknown as typeof fetch,
    });
    expect(out.error).toBeUndefined();
    expect(out.results).toHaveLength(1);
    expect(out.results[0].origin).toBe("perplexity:raw_web");
    expect(out.results[0].domain).toBe("judgments.org.il");
    expect(out.results[0]).not.toHaveProperty("text");
    expect(out.results[0]).not.toHaveProperty("answer");
  });

  it("clamps the result limit to the documented bounds", async () => {
    let body: Record<string, unknown> = {};
    const impl = ((_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Promise.resolve(apiResponse([]));
    }) as unknown as typeof fetch;
    await runRawWebSearch({ query: "a", limit: 99 }, { apiKey: "k", fetchImpl: impl });
    expect(body.max_results).toBe(RAW_WEB_SEARCH_LIMITS.MAX_RESULTS);
    await runRawWebSearch({ query: "a", limit: -5 }, { apiKey: "k", fetchImpl: impl });
    expect(body.max_results).toBe(RAW_WEB_SEARCH_LIMITS.MIN_RESULTS);
  });

  it("sends a domain filter only when one is supplied", async () => {
    let body: Record<string, unknown> = {};
    const impl = ((_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Promise.resolve(apiResponse([]));
    }) as unknown as typeof fetch;
    await runRawWebSearch({ query: "a" }, { apiKey: "k", fetchImpl: impl });
    expect(body.search_domain_filter).toBeUndefined();
    await runRawWebSearch({ query: "a", domain_filter: ["judgments.org.il"] }, { apiKey: "k", fetchImpl: impl });
    expect(body.search_domain_filter).toEqual(["judgments.org.il"]);
  });

  it("drops unsafe URLs at discovery time", async () => {
    const out = await runRawWebSearch({ query: "a" }, {
      apiKey: "k",
      fetchImpl: fakeFetch([
        { title: "meta", url: "http://169.254.169.254/latest/meta-data" },
        { title: "local", url: "http://127.0.0.1:8080/x" },
        { title: "lan", url: "http://192.168.1.10/x" },
        { title: "ok", url: "https://www.gov.il/x" },
      ]) as unknown as typeof fetch,
    });
    expect(out.results.map((r) => r.url)).toEqual(["https://www.gov.il/x"]);
  });

  it("reports missing credentials and empty queries without throwing", async () => {
    expect((await runRawWebSearch({ query: "" }, { apiKey: "k" })).error).toBe("empty_query");
    expect((await runRawWebSearch({ query: "a" }, { apiKey: null })).error).toBe(
      "missing_perplexity_credentials",
    );
  });

  it("surfaces exhausted credits and http errors", async () => {
    const quota = (() =>
      Promise.resolve(new Response("insufficient_quota", { status: 401 }))) as unknown as typeof fetch;
    expect((await runRawWebSearch({ query: "a" }, { apiKey: "k", fetchImpl: quota })).error).toBe(
      "perplexity_credits_exhausted",
    );
    const http = (() => Promise.resolve(new Response("", { status: 500 }))) as unknown as typeof fetch;
    expect((await runRawWebSearch({ query: "a" }, { apiKey: "k", fetchImpl: http })).error).toBe(
      "perplexity_http_500",
    );
  });

  it("mints ids from the shared sequence so fetch({result_id}) works", async () => {
    const out = await runRawWebSearch({ query: "a" }, {
      apiKey: "k",
      fetchImpl: fakeFetch([{ title: "1", url: "https://a.com" }, { title: "2", url: "https://b.com" }]) as
        unknown as typeof fetch,
    });
    expect(out.results.map((r) => r.result_id)).toEqual(["R1", "R2"]);
  });
});

describe("raw query dedupe key", () => {
  it("is stable under case, spacing and filter order", () => {
    expect(rawQueryKey({ query: "  Foo   Bar " })).toBe(rawQueryKey({ query: "foo bar" }));
    expect(rawQueryKey({ query: "q", domain_filter: ["b.com", "a.com"] }))
      .toBe(rawQueryKey({ query: "q", domain_filter: ["a.com", "b.com"] }));
  });

  it("separates different queries and different filters", () => {
    expect(rawQueryKey({ query: "a" })).not.toBe(rawQueryKey({ query: "b" }));
    expect(rawQueryKey({ query: "a" })).not.toBe(rawQueryKey({ query: "a", domain_filter: ["x.com"] }));
  });
});

describe("raw web search budget", () => {
  it("is bounded and independent of the sonar search budget", () => {
    const p = new StopPolicy({ ...DEFAULT_BUDGETS, max_raw_search_calls: 2 });
    expect(p.checkTool("raw_web_search")).toBeNull();
    p.note("raw_web_search");
    p.note("raw_web_search");
    expect(p.checkTool("raw_web_search")).toContain("budget_exhausted:raw_web_search");
    expect(p.checkTool("search", "web")).toBeNull();
    expect(p.search_calls.web).toBe(0);
  });

  it("survives serialization across a worker restart", () => {
    const p = new StopPolicy({ ...DEFAULT_BUDGETS, max_raw_search_calls: 2 });
    p.note("raw_web_search");
    const revived = StopPolicy.fromJSON({ ...DEFAULT_BUDGETS, max_raw_search_calls: 2 }, p.toJSON());
    expect(revived.raw_search_calls).toBe(1);
    revived.note("raw_web_search");
    expect(revived.checkTool("raw_web_search")).toContain("budget_exhausted");
  });
});

describe("outbound url safety", () => {
  it("refuses loopback, private, link-local and metadata targets", () => {
    for (
      const u of [
        "http://localhost/x",
        "http://127.0.0.1/x",
        "http://[::1]/x",
        "http://10.0.0.5/x",
        "http://192.168.0.1/x",
        "http://172.16.5.5/x",
        "http://169.254.169.254/",
        "http://metadata.google.internal/x",
        "http://box.local/x",
        "file:///etc/passwd",
      ]
    ) {
      expect(isSafeFetchUrl(u), u).toBe(false);
      expect(checkUrlSafety(u).reason, u).toBeTruthy();
    }
  });

  it("allows ordinary public https targets", () => {
    for (const u of ["https://www.gov.il/he/x", "https://judgments.org.il/a", "https://supremedecisions.court.gov.il/Home/Download?x=1"]) {
      expect(isSafeFetchUrl(u), u).toBe(true);
    }
  });
});

describe("case identity guard for broad-web candidates", () => {
  const body = (t: string) => ({
    title: "",
    text: t,
    identity_fields: emptyIdentity,
    is_actual_document: true,
  });

  it("binds a supreme-court body carrying the requested proceeding type", () => {
    const r = corroborateAuthority({
      expected: { docket: 'ע"א 2553/01' },
      ...body('בבית המשפט העליון\nע"א 2553/01 פלוני נ׳ אלמוני\nפסק דין. השופט א׳ ברק.'),
    });
    expect(r.corroborated).toBe(true);
    expect(r.basis).toBe("docket_present_in_body");
  });

  it("refuses a same-digit district judgment", () => {
    const r = corroborateAuthority({
      expected: { docket: 'ע"א 2553/01' },
      ...body('בית המשפט המחוזי בחיפה\nע"א (חיפה) 2553/01'),
    });
    expect(r.corroborated).toBe(false);
    expect(["docket_court_level_mismatch", "docket_proceeding_type_mismatch"]).toContain(r.basis);
  });

  it("refuses a same-digit labour-court case", () => {
    const r = corroborateAuthority({
      expected: { docket: 'ע"פ 8704/09' },
      ...body('בית הדין האזורי לעבודה\nבל 8704/09 פלוני נ׳ המוסד לביטוח לאומי'),
    });
    expect(r.corroborated).toBe(false);
  });

  it("refuses a bare digits-only mention", () => {
    const r = corroborateAuthority({
      expected: { docket: 'ע"א 2553/01' },
      ...body("ראו דיון בעמוד 2553/01 של הקובץ"),
    });
    expect(r.corroborated).toBe(false);
    expect(r.basis).toBe("docket_proceeding_type_mismatch");
  });

  it("does not require party names", () => {
    const r = corroborateAuthority({
      expected: { docket: 'ע"א 423/75' },
      ...body('בבית המשפט העליון בשבתו כבית משפט לערעורים אזרחיים\nע"א 423/75\nפסק דין. ניתן היום.'),
    });
    expect(r.corroborated).toBe(true);
  });

  it("refuses a commentary page that merely cites the judgment", () => {
    const article = "מאמר משפטי. ".repeat(400) +
      'כפי שנקבע ב-ע"א 423/75 בבית המשפט העליון, ' + "המשך הדיון. ".repeat(200);
    const r = corroborateAuthority({ expected: { docket: 'ע"א 423/75' }, ...body(article) });
    expect(r.corroborated).toBe(false);
    expect(r.basis).toBe("docket_mention_not_self_identifying");
  });

  it("still reports an absent docket as absent", () => {
    const r = corroborateAuthority({
      expected: { docket: 'ע"א 423/75' },
      ...body("פסק דין אחר לגמרי"),
    });
    expect(r.basis).toBe("docket_absent_from_body");
  });
});
