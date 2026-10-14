import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as refunds from "../../supabase/functions/_shared/legacyUsageRefund";
import * as locks from "../../supabase/functions/_shared/operationLock";
import * as weights from "../../supabase/functions/_shared/usageWeights";
import * as articleValidator from "../../supabase/functions/_shared/articleCitationValidator";

// Execute the actual Deno handler offline, with only transport/runtime imports
// substituted. No rewritten copy of its billing or failure logic is tested.
const compiled = new Map<string, string>();
function handler(name: string, options: {
  consume?: Record<string, unknown>;
  refund?: Record<string, unknown>;
  refundError?: unknown;
  consumeError?: unknown;
  fetch?: ReturnType<typeof vi.fn>;
  env?: Record<string, string>;
} = {}) {
  if (!compiled.has(name)) compiled.set(name, ts.transpileModule(
    readFileSync(`supabase/functions/${name}/index.ts`, "utf8"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText);
  const calls: Array<{ role: string; name: string; args: Record<string, unknown> }> = [];
  const client = (role: string) => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "verified-user" } }, error: null }),
      getClaims: async () => ({ data: { claims: { sub: "verified-user" } }, error: null }),
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ role, name, args });
      if (name === "acquire_operation_lock") return { data: { ok: true }, error: null };
      if (name === "consume_credits" || name === "consume_usage_batch") {
        return { data: options.consume ?? { ok: true }, error: options.consumeError ?? null };
      }
      if (name === "attest_usage_failure") return { data: options.refund ?? { ok: true, refunded: true }, error: options.refundError ?? null };
      return { data: { ok: true }, error: null };
    },
    from: () => {
      const q = {
        select: () => q, eq: () => q, in: () => q, or: () => q, order: () => q,
        limit: async () => ({ data: [], error: null }),
      };
      return q;
    },
  });
  const fetch = options.fetch ?? vi.fn(async () => { throw new Error("Unexpected offline provider call"); });
  const runtime = { env: { get: (key: string) => options.env?.[key] ?? ({
    SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service", LOVABLE_API_KEY: "fixture-model", PERPLEXITY_API_KEY: "fixture-model",
  } as Record<string, string>)[key] } };
  let serveHandler: (req: Request) => Promise<Response>;
  const require = (path: string) => {
    if (path.includes("/http/server")) return { serve: (fn: typeof serveHandler) => { serveHandler = fn; } };
    if (path.includes("@supabase/supabase-js")) return { createClient: (_url: string, key: string) => client(key === "fixture-service" ? "service" : "user") };
    if (path.includes("legacyUsageRefund")) return refunds;
    if (path.includes("operationLock")) return locks;
    if (path.includes("usageWeights")) return weights;
    if (path.includes("articleCitationValidator")) return articleValidator;
    if (path.includes("fflate")) return { unzipSync: () => ({}), strFromU8: () => "" };
    throw new Error(`Unexpected handler dependency: ${path}`);
  };
  new Function("require", "exports", "Deno", "fetch", compiled.get(name)!)(require, {}, runtime, fetch);
  const invoke = async (body: Record<string, unknown>) => {
    const response = await serveHandler!(new Request("https://fixture.invalid/handler", {
      method: "POST", headers: { Authorization: "Bearer fixture-token", "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    return { status: response.status, body: await response.json() };
  };
  return { invoke, calls, fetch };
}
const summaryBody = { question: "סיכום פסק דין לדוגמה", taskMode: "case_summary", requestId: "request-1234" };
const bibliographyBody = { rawSource: "Example legal book", requestId: "request-1234", sourceTypeHint: "literature" };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe("case summary actual handler refunds", () => {
  it("keeps valid full-text summary success intact", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ source: "user", fullText: "טקסט משפטי ".repeat(200) }))
      .mockResolvedValueOnce(response({ choices: [{ message: { content: "סיכום משפטי" } }] }));
    const h = handler("legal-qa", { fetch });
    expect((await h.invoke(summaryBody)).body.answer).toBe("סיכום משפטי");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(h.calls.filter((c) => c.name === "attest_usage_failure")).toHaveLength(0);
  });
  it("attests a known no-fulltext refusal with verified identity and service role", async () => {
    const h = handler("legal-qa", { fetch: vi.fn(async () => response({ source: "none", execution_outcome_unknown: false })) });
    expect((await h.invoke(summaryBody)).body.refunded).toBe(true);
    expect(h.calls.find((c) => c.name === "attest_usage_failure")).toMatchObject({
      role: "service", args: { _user_id: "verified-user", _request_id: "request-1234" },
    });
  });
  it.each([{}, { execution_outcome_unknown: true }])("does not refund unknown/missing verification evidence %j", async (marker) => {
    const h = handler("legal-qa", { fetch: vi.fn(async () => response({ source: "none", ...marker })) });
    expect(await h.invoke(summaryBody)).toMatchObject({ status: 503, body: { refunded: false, error: "VERIFICATION_OUTCOME_UNKNOWN" } });
    expect(h.calls.filter((c) => c.name === "attest_usage_failure")).toHaveLength(0);
  });
  it("does not refund a verification timeout", async () => {
    const h = handler("legal-qa", { fetch: vi.fn(async () => { throw new DOMException("timeout", "AbortError"); }) });
    expect((await h.invoke(summaryBody)).body.refunded).toBe(false);
    expect(h.calls.filter((c) => c.name === "attest_usage_failure")).toHaveLength(0);
  });
  it("does not execute or refund a replayed debit", async () => {
    const h = handler("legal-qa", { consume: { ok: true, replayed: true } });
    expect(await h.invoke(summaryBody)).toMatchObject({ status: 409, body: { error: "REQUEST_ALREADY_CONSUMED" } });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.calls.filter((c) => c.name === "attest_usage_failure")).toHaveLength(0);
  });
  it("does not claim success when refund RPC rejects", async () => {
    const h = handler("legal-qa", { refund: { ok: false }, fetch: vi.fn(async () => response({ source: "none", execution_outcome_unknown: false })) });
    expect((await h.invoke(summaryBody)).body.refunded).toBe(false);
  });
});

describe("bibliography actual handler refunds", () => {
  it("keeps a valid provider citation intact", async () => {
    const h = handler("bibliography-lookup", { fetch: vi.fn(async () => response({ choices: [{ message: { content: JSON.stringify({ citation: "Author, Book (2026)", isDisambiguation: false, options: [] }) } }] })) });
    expect((await h.invoke(bibliographyBody)).body.citation).toBe("Author, Book (2026)");
    expect(h.calls.filter((c) => c.name === "attest_usage_failure")).toHaveLength(0);
  });
  it("attests an explicit provider rejection only through service identity", async () => {
    const h = handler("bibliography-lookup", { fetch: vi.fn(async () => response({ error: "rejected" }, 429)) });
    expect((await h.invoke(bibliographyBody)).body.refunded).toBe(true);
    expect(h.calls.find((c) => c.name === "attest_usage_failure")).toMatchObject({ role: "service", args: { _user_id: "verified-user" } });
  });
  it("does not auto-refund after a lost provider response", async () => {
    const h = handler("bibliography-lookup", { fetch: vi.fn(async () => { throw new TypeError("fetch failed"); }) });
    expect((await h.invoke(bibliographyBody)).body).toMatchObject({ refunded: false, execution_outcome_unknown: true });
    expect(h.calls.filter((c) => c.name === "attest_usage_failure")).toHaveLength(0);
  });
  it("does not execute or refund a replayed batched consume", async () => {
    const h = handler("bibliography-lookup", { consume: { ok: true, replayed: true } });
    expect((await h.invoke({ ...bibliographyBody, batchId: "batch-1234" })).status).toBe(409);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.calls.map((c) => c.name)).toEqual(["consume_usage_batch"]);
  });
  it("does not attempt a refund for failed debit recording", async () => {
    const h = handler("bibliography-lookup", { consumeError: { message: "lost response" } });
    expect((await h.invoke(bibliographyBody)).status).toBe(503);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.calls.map((c) => c.name)).toEqual(["consume_credits"]);
  });
});

describe("fulltext verification evidence", () => {
  it("marks a caught paid search transport failure as unknown", async () => {
    const h = handler("verify-case-fulltext", { fetch: vi.fn(async () => { throw new TypeError("fetch failed"); }) });
    expect((await h.invoke({ question: "תיק לדוגמה" })).body).toMatchObject({ source: "none", execution_outcome_unknown: true });
  });
  it.each([{}, { choices: [{ message: { content: "{}" } }] }, { choices: [{ message: { content: "{bad-json}" } }] }])("does not turn malformed search output into a definitive no-match %j", async (payload) => {
    const h = handler("verify-case-fulltext", { fetch: vi.fn(async () => response(payload)) });
    expect((await h.invoke({ question: "תיק לדוגמה" })).body).toMatchObject({ source: "none", execution_outcome_unknown: true });
  });
  it("does not turn an invalid conversion response into a definitive no-match", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ choices: [{ message: { content: JSON.stringify({ source_url: "https://fixture.invalid/source.pdf" }) } }] }))
      .mockResolvedValueOnce(new Response("%PDF-1.7\nfixture", { headers: { "Content-Type": "application/pdf" } }))
      .mockResolvedValueOnce(response({}));
    const h = handler("verify-case-fulltext", { fetch, env: { CONVERTAPI_SECRET: "fixture-convert" } });
    expect((await h.invoke({ question: "תיק לדוגמה" })).body).toMatchObject({ source: "none", execution_outcome_unknown: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("marks a completed no-source search as definitive", async () => {
    const h = handler("verify-case-fulltext", { fetch: vi.fn(async () => response({ choices: [{ message: { content: JSON.stringify({ source_url: null }) } }], citations: [] })) });
    expect((await h.invoke({ question: "תיק לדוגמה" })).body).toMatchObject({ source: "none", execution_outcome_unknown: false });
  });
});
