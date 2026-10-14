import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import ts from "typescript";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import * as recovery from "../../supabase/functions/_shared/citationRecovery";
import * as guard from "../../supabase/functions/_shared/citationUsageGuard";

beforeAll(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("TextEncoder", TextEncoder); });
afterAll(() => vi.unstubAllGlobals());
const input = { messages: [{ role: "user", content: "Fixture legal citation" }], rawInput: "Fixture source", foreignLookup: null, batchId: null };
const foreign = { kind: "journal_article", jurisdiction: "OTHER", fields: { articleTitle: "Fixture title" }, grounded: { articleTitle: true },
  provenance: { articleTitle: { value: "Fixture title", basis: "structured_metadata" } }, sources: [],
  identity: { matched: true, anchors: ["title:Fixture title"], conflicts: [] }, diagnostics: { tier1Queried: false, tier2Fired: false }, articleResolution: "incomplete" };
const receipt = { status: "not_applicable", refunded: false, units_refunded: 0, request_id: "request-0001" };
const date = Date.now();
const record = (overrides: Record<string, unknown> = {}) => ({ requestId: "request-0001", retryOfRequestId: null, status: "succeeded",
  createdAt: new Date(date - 1000).toISOString(), expiresAt: new Date(date - 1000 + recovery.CITATION_RECOVERY_TTL_MS).toISOString(),
  availability: "available", input, result: { content: "Synthetic recovered citation" }, refundReceipt: receipt, ...overrides });

const code = ts.transpileModule(readFileSync("supabase/functions/citation-recovery/index.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function handler(options: { data?: unknown; error?: unknown; claims?: unknown; authError?: unknown; throws?: boolean } = {}) {
  let fn!: (req: Request) => Promise<Response>;
  const calls: Array<{ name: string; args: Record<string, unknown>; role: string; config?: unknown }> = [];
  const auth = vi.fn(async () => ({ data: { claims: "claims" in options ? options.claims : { sub: "owner-verified" } }, error: options.authError ?? null }));
  const createClient = (_url: string, key: string, config?: unknown) => ({
    auth: { getClaims: auth },
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args, role: key, config });
      if (options.throws) throw new Error("Offline response lost");
      return { data: "data" in options ? options.data : { requests: [record()], nextCursor: null }, error: options.error ?? null };
    },
    from: () => { throw new Error("Recovery may not access another table or cache"); },
  });
  const require = (path: string) => {
    if (path.includes("http/server")) return { serve: (f: typeof fn) => { fn = f; } };
    if (path.includes("supabase-js")) return { createClient };
    if (path.endsWith("citationRecovery.ts")) return recovery;
    if (path.endsWith("citationUsageGuard.ts")) return guard;
    throw new Error(`Unexpected recovery import ${path}`);
  };
  new Function("require", "exports", "Deno", "fetch", code)(require, {}, { env: { get: (key: string) => ({
    SUPABASE_URL: "https://fixture.invalid", SUPABASE_ANON_KEY: "anon-fixture", SUPABASE_SERVICE_ROLE_KEY: "service-fixture",
  } as Record<string, string>)[key] } }, () => { throw new Error("Network forbidden"); });
  return { calls, auth, invoke: async (body: unknown = {}, authorization: string | null = "Bearer fixture-token", method = "POST") => {
    const res = await fn(new Request("https://fixture.invalid/citation-recovery", { method,
      headers: authorization ? { Authorization: authorization } : {}, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
    return { status: res.status, headers: res.headers, body: res.status === 200 && method === "OPTIONS" ? null : await res.json() };
  } };
}

describe("pure allowlisted recovery payload validation", () => {
  it("preserves all execution fields without UI or observation metadata", () => {
    expect(recovery.citationRecoveryInput(input)).toEqual(input);
    expect(recovery.citationRecoveryInput({ ...input, foreignLookup: { enabled: true, kind: "journal_article", jurisdiction: "OTHER", rawInput: "Fixture", parsedFields: { articleTitle: "Fixture", doi: "10.0/fixture" }, articleResponseVersion: 1 } })).not.toBeNull();
  });
  it.each([
    { ...input, messages: [{ role: "user", content: "Fixture", token: "do-not-store" }] },
    { ...input, foreignLookup: { enabled: true, authorization: "do-not-store" } },
    { ...input, foreignLookup: { enabled: true, parsedFields: { apiKey: "do-not-store" } } },
    { ...input, citationDiagnostic: { trace: "do-not-store" } },
    { ...input, messages: Array.from({ length: 101 }, () => input.messages[0]) },
  ])("rejects extra or oversized execution shape %#", (value) => expect(recovery.citationRecoveryInput(value)).toBeNull());
  it("enforces UTF-8 byte limits before claim", () => {
    expect(recovery.citationRecoveryInput({ ...input, rawInput: "א".repeat(65536) })).toBeNull();
    expect(recovery.citationRecoveryInput({ ...input, rawInput: "x".repeat(100000) })).not.toBeNull();
    expect(recovery.citationRecoveryResult({ content: "x".repeat(262144) })).toBeNull();
  });
  it("preserves valid structured-only results, including incomplete article resolution", () => {
    expect(recovery.citationRecoveryResult({ foreignLookup: foreign })).toEqual({ foreignLookup: foreign });
    expect(recovery.citationRecoveryResult({ content: "", foreignLookup: foreign })).toEqual({ content: "", foreignLookup: foreign });
  });
  it("projects only content and typed foreign result, never diagnostic or auth envelopes", () => {
    expect(recovery.citationRecoveryResult({ content: "Fixture", citationDiagnostic: { trace: "never retained" }, authorization: "never retained", choices: ["raw provider"] })).toEqual({ content: "Fixture" });
    expect(recovery.citationRecoveryResult({ foreignLookup: { ...foreign, providerTrace: { token: "never retained" } } })).toBeNull();
    expect(recovery.citationRecoveryResult({ foreignLookup: { ...foreign, fields: { token: "never retained" } } })).toBeNull();
  });
  it.each([{}, { content: " " }, { content: 123 }, { foreignLookup: {} }, { content: "valid", foreignLookup: { ...foreign, identity: {} } }])("rejects unusable or malformed result %#", value => expect(recovery.citationRecoveryResult(value)).toBeNull());
});

describe("actual read-only recovery handler, mocked auth/RPC, no network", () => {
  it.each([null, "Basic fixture", "Bearer "])("rejects missing bearer token %#", async authorization => {
    const h = handler(); expect((await h.invoke({}, authorization)).status).toBe(401); expect(h.calls).toHaveLength(0);
  });
  it.each([null, {}, { sub: "" }, { sub: 123 }])("requires verified JWT owner %#", async claims => {
    const h = handler({ claims }); expect((await h.invoke()).status).toBe(401); expect(h.calls).toHaveLength(0);
  });
  it("rejects auth failure even when an owner claim is present", async () => {
    const h = handler({ authError: { message: "Invalid JWT" } }); expect((await h.invoke()).status).toBe(401); expect(h.calls).toHaveLength(0);
  });
  it("derives owner from verified JWT and sends exactly one service read RPC", async () => {
    const h = handler(); const r = await h.invoke({ requestId: "request-0001" });
    expect(r.status).toBe(200); expect(r.body.requests[0].result).toEqual({ content: "Synthetic recovered citation" });
    expect(h.auth).toHaveBeenCalledWith("fixture-token");
    expect(h.calls).toEqual([{ name: "read_citation_recovery", role: "service-fixture", config: undefined,
      args: { _user_id: "owner-verified", _request_id: "request-0001", _parent_request_id: null, _cursor: null, _limit: 20 } }]);
    expect(r.headers.get("cache-control")).toBe("no-store, private");
  });
  it.each([{ userId: "another-owner" }, { requestId: "short" }, { requestId: "request-0001", parentRequestId: "parent-0001" }, { parentRequestId: "parent-0001", cursor: "cursor-0001" }, { limit: 51 }, { limit: null }, { cursor: "x".repeat(4096) }])("rejects forged ownership and invalid query %#", async body => {
    const h = handler(); expect((await h.invoke(body)).status).toBe(400); expect(h.calls).toHaveLength(0);
  });
  it("keeps exact not-found indistinguishable from another owner's missing request", async () => {
    const h = handler({ data: { requests: [], nextCursor: null } });
    expect((await h.invoke({ requestId: "another-owner-request" })).body).toEqual({ requests: [], nextCursor: null });
  });
  it("recovers exactly the immediate canonical child and rejects a grandchild substitution", async () => {
    const h = handler({ data: { requests: [record({ retryOfRequestId: "parent-0001" })], nextCursor: null } });
    expect((await h.invoke({ parentRequestId: "parent-0001" })).status).toBe(200);
    const wrong = handler({ data: { requests: [record({ retryOfRequestId: "child-0001" })], nextCursor: null } });
    expect((await wrong.invoke({ parentRequestId: "parent-0001" })).status).toBe(503);
  });
  it("hides expired input and result even if a stale RPC response includes payload", async () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    const h = handler({ data: { requests: [record({ createdAt: new Date(Date.parse(expired) - recovery.CITATION_RECOVERY_TTL_MS).toISOString(), expiresAt: expired })], nextCursor: null } });
    expect((await h.invoke()).body.requests[0]).toMatchObject({ availability: "expired", input: null, result: null, status: "succeeded" });
  });
  it.each(["in_progress", "failed", "unknown"])("does not publish a result from %s", async status => {
    const h = handler({ data: { requests: [record({ status })], nextCursor: null } });
    expect((await h.invoke()).body.requests[0]).toMatchObject({ status, result: null, availability: status === "in_progress" ? "pending" : "available" });
  });
  it("reports absent payload without inventing delivery or retry authority", async () => {
    const h = handler({ data: { requests: [record({ input: null, result: null })], nextCursor: null } });
    expect((await h.invoke()).body.requests[0]).toMatchObject({ availability: "unavailable", input: null, result: null });
  });
  it("hides both payloads when a succeeded row lacks a valid stored result", async () => {
    const h = handler({ data: { requests: [record({ result: null, availability: "unavailable" })], nextCursor: null } });
    expect((await h.invoke()).body.requests[0]).toMatchObject({ availability: "unavailable", input: null, result: null });
  });
  it("strips internal tokens, fingerprints and account data from service response", async () => {
    const h = handler({ data: { requests: [record({ attempt_token: "secret", fingerprint: "private", user_id: "owner", balance: 99 })], nextCursor: null } });
    const result = (await h.invoke()).body.requests[0];
    expect(Object.keys(result).sort()).toEqual(["availability", "createdAt", "expiresAt", "input", "refundReceipt", "requestId", "result", "retryOfRequestId", "status"].sort());
  });
  it("shows current authoritative refund receipt, including a later anchor refund", async () => {
    const latestReceipt = { status: "refunded", refunded: true, units_refunded: 1, request_id: "anchor-0001" };
    const h = handler({ data: { requests: [record({ status: "failed", result: null, refundReceipt: latestReceipt })], nextCursor: null } });
    expect((await h.invoke()).body.requests[0].refundReceipt).toEqual(latestReceipt);
  });
  it("accepts a short bounded page cursor and never re-executes a read after lost acknowledgement", async () => {
    const h = handler({ data: { requests: [record()], nextCursor: "request-0001" } });
    expect((await h.invoke({ limit: 50, cursor: "prior-0001" })).body.nextCursor).toBe("request-0001");
    const lost = handler({ throws: true }); expect((await lost.invoke()).status).toBe(503); expect(lost.calls).toHaveLength(1);
  });
});

describe("guard recovery binding and ambiguous writes", () => {
  it("refuses a mismatched input fingerprint before any RPC/debit", async () => {
    const rpc = vi.fn(); const g = new guard.CitationUsageGuard({ rpc }, "owner", "request-0001");
    expect(await g.begin("f".repeat(64), null, null, input)).toMatchObject({ execute: false, error: "INVALID_RECOVERY_INPUT" });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("requires a durable result acknowledgement, not status success alone", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { ok: true, execute: true, status: "in_progress", request_id: "request-0001", retry_of_request_id: null, attempt_token: "token" }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, status: "succeeded" }, error: null });
    const g = new guard.CitationUsageGuard({ rpc }, "owner", "request-0001");
    await g.begin(await guard.citationFingerprint(input), null, null, input);
    expect(await g.finish("succeeded", "delivery", { content: "Fixture" })).toEqual({ confirmed: false, refunded: false });
    expect(await g.finish("failed", "do not refund")).toEqual({ confirmed: false, refunded: false });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[1][1]._result).toEqual({ content: "Fixture" });
  });
});


it("fixes the UTF-8 canonical fingerprint vector shared with the authored SQL fixture", async () => {
  const input = {"messages":[{"role":"user","content":"Fixture \n\"ציטוט\" Ω"}],"rawInput":null,"foreignLookup":{"enabled":false,"parsedFields":{"title":" A ","authors":"B"}},"batchId":null};
  expect(await guard.citationFingerprint(input)).toBe("31b4a0f82b34786efe1dda54143f0ccb066fc2735f097d82f9acd2f133d299b0");
});
