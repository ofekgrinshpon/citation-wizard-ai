/** Offline vertical retention gate: only auth, provider fetch and persistence are mocked. */
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as recovery from "../../supabase/functions/_shared/citationRecovery";
import * as usage from "../../supabase/functions/_shared/citationUsageGuard";
import * as pasted from "../../supabase/functions/_shared/pastedCitation";
import * as prefixes from "../../supabase/functions/_shared/caseTypePrefixes";
import * as statute from "../../supabase/functions/citation-chat/statuteRoute";
import { runForeignLookup, articleLookupFallback } from "../../supabase/functions/citation-chat/foreignLookup";
import { CHAT_HOST, resolveCitationResponse } from "@/lib/citationPlanner";
import { renderCitationRecovery } from "@/lib/renderCitationRecovery";
import { readCitationRecovery } from "@/lib/citationRecoveryApi";
import { saveRecoveredCitationHistory } from "@/lib/citationHistorySave";
import { C2_WIRE, c2WirePlan } from "./fixtures/c2WirePayload";

const client = vi.hoisted(() => ({ session: vi.fn(), invoke: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getSession: client.session }, functions: { invoke: client.invoke }, from: client.from,
} }));
const owner = "retention-owner", requestId = "retention-request-0001";
const compile = (path: string) => ts.transpileModule(readFileSync(path, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const chatCode = compile("supabase/functions/citation-chat/index.ts");
const readCode = compile("supabase/functions/citation-recovery/index.ts");
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("TextEncoder", TextEncoder);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live IO forbidden"); }));
  client.session.mockResolvedValue({ data: { session: { user: { id: owner }, access_token: "offline" } }, error: null });
});
afterEach(() => vi.unstubAllGlobals());

async function vertical(f: typeof C2_WIRE[number], mode = "complete") {
  const plan = c2WirePlan(f);
  const request = plan.foreignLookup;
  if (!request) throw new Error("Missing request");
  const chapter = f.type === "foreign_book_chapter";
  const name = chapter ? "Quiet Rules — Jane Doe, Synthetic Collection" : "Jane Doe, Synthetic Collection";
  const donor = { title: `${name} (2nd ed. 2020)`, snippet: `Jane Doe, ${chapter ? "Quiet Rules, in " : ""}Synthetic Collection (2nd ed. 2020).`, url: "https://press.example.edu/collection/quiet-rules" };
  if (mode === "snippet-only") donor.title = "Jane Doe, Synthetic Collection (2nd ed. 2020)";
  const search = vi.fn(async () => new Response(JSON.stringify({ results: [donor] })));
  const lookup = vi.fn(async (input: Parameters<typeof runForeignLookup>[0]) => {
    const result = await runForeignLookup(input, { apiKey: "offline", fetchImpl: search });
    if (mode === "partial") { delete result.fields.edition; delete result.grounded.edition; delete result.provenance.edition; }
    if (mode === "conflict") result.identity.conflicts.push("year:2020/2019");
    if (mode === "forged-field") Object.assign(result.fields, { secret: "invalid" });
    if (mode === "forged-source") Object.assign(result.sources[0], { document: "invalid" });
    if (mode === "invalid-snippet") Object.assign(result.sources[0], { snippet: { text: "invalid" } });
    if (mode === "invalid-provenance") Object.assign(result.provenance.year, { document: "invalid" });
    if (mode === "invalid-identity") Object.assign(result.identity, { matched: "true" });
    if (mode === "invalid-tier") Object.assign(result.sources[0], { tier: "forged" });
    return result;
  });
  let retainedInput: unknown = null;
  let retainedResult: unknown = null;
  let status = "unknown";
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "begin_citation_request") {
      retainedInput = args._recovery_input;
      return { data: { ok: true, execute: true, status: "in_progress", request_id: args._request_id, retry_of_request_id: null, attempt_token: "offline-attempt" }, error: null };
    }
    if (name === "finish_citation_request") {
      status = String(args._outcome); retainedResult = args._result;
      return { data: { ok: true, status, result_stored: status === "succeeded" }, error: null };
    }
    if (name !== "read_citation_recovery") throw new Error("Unexpected mutation");
    const created = Date.now() - 1000;
    return { data: { requests: [{ requestId, retryOfRequestId: null, status, availability: "available",
      createdAt: new Date(created).toISOString(), expiresAt: new Date(created + recovery.CITATION_RECOVERY_TTL_MS).toISOString(),
      input: retainedInput, result: retainedResult,
      refundReceipt: { status: "retained", refunded: false, units_refunded: 0, request_id: requestId },
    }], nextCursor: null }, error: null };
  });
  const authClient = { auth: { getClaims: async () => ({ data: { claims: { sub: owner } }, error: null }) }, rpc,
    from: () => {
      const chain = { select: () => chain, eq: () => chain, or: () => chain, limit: async () => ({ data: [], error: null }) };
      return chain;
    } };
  const makeHandler = (code: string) => {
    let handler: ((req: Request) => Promise<Response>) | undefined;
    const require = (path: string) => {
      if (path.includes("http/server")) return { serve: (fn: typeof handler) => { handler = fn; } };
      if (path.includes("supabase-js")) return { createClient: () => authClient };
      if (path.includes("citationUsageGuard")) return usage;
      if (path.includes("citationRecovery")) return recovery;
      if (path.includes("pastedCitation")) return pasted;
      if (path.includes("caseTypePrefixes")) return prefixes;
      if (path.includes("statuteRoute")) return statute;
      if (path.includes("foreignLookup")) return { runForeignLookup: lookup, articleLookupFallback };
      if (path.includes("costTelemetry")) return { withCostTelemetry: (_: unknown, fn: () => unknown) => fn(), setTelemetryFromBody: () => {}, trackedFetch: search };
      if (path.includes("citationDiagnosticGate")) return { isCitationDiagnosticPreflight: () => false };
      return {};
    };
    new Function("require", "exports", "Deno", "fetch", code)(require, {}, { env: { get: () => "offline-only" } }, () => { throw new Error("Generic fetch forbidden"); });
    return async (body: unknown) => {
      if (!handler) throw new Error("Missing handler");
      return handler(new Request("https://fixture.invalid", { method: "POST", headers: { Authorization: "Bearer offline" }, body: JSON.stringify(body) }));
    };
  };
  const response = await makeHandler(chatCode)({ citationRequestVersion: 3, requestId, rawInput: f.raw,
    messages: [{ role: "user", content: f.raw }], foreignLookup: request });
  const body = await response.json();
  const endpoint = makeHandler(readCode);
  client.invoke.mockImplementation(async (_: string, options: { body: unknown }) => {
    const response = await endpoint(options.body);
    return { data: await response.json(), error: response.ok ? null : new Error("Offline recovery failed") };
  });
  const writes: Record<string, unknown>[] = [];
  let existing: Record<string, unknown> | null = null;
  client.from.mockImplementation(() => {
    let pending: Record<string, unknown> | null = null;
    const chain = { upsert: (entry: Record<string, unknown>) => { pending = entry; return chain; }, select: () => chain, eq: () => chain,
      maybeSingle: async () => {
        if (pending && !existing) { writes.push(pending); existing = { ...pending, id: "saved-history" }; return { data: existing, error: null }; }
        return { data: pending ? null : existing, error: null };
      } };
    return chain;
  });
  return { plan, body, response, rpc, search, lookup, writes, retainedResult, donor,
    mutateInput: (mutate: (input: recovery.CitationRecoveryInput) => void) => {
      const input = recovery.citationRecoveryInput(retainedInput);
      if (!input) throw new Error("Invalid fixture input");
      mutate(input); retainedInput = input;
    } };
}

describe("C2 real retention → recovery → history", () => {
  it.each(C2_WIRE)("$id keeps fresh semantic fields through actual retention and save", async f => {
    const h = await vertical(f);
    expect(h.body.recoveryAvailability).toBe("available");
    expect(h.response.headers.get("X-Usage-Status")).toBeNull();
    expect(h.body.requestId).toBe(requestId);
    const finish = h.rpc.mock.calls.find(([name]) => name === "finish_citation_request")?.[1];
    expect(finish).toMatchObject({ _outcome: "succeeded", _reason: "citation_delivered", _request_id: requestId });
    expect(h.body.foreignLookup.sources[0].snippet).toBe(h.donor.snippet);
    expect(h.retainedResult).toEqual({ content: "", foreignLookup: { ...h.body.foreignLookup,
      sources: [{ url: h.donor.url, title: h.donor.title, tier: "tier1" }],
    } });
    expect(recovery.citationRecoveryResult(h.retainedResult)).toEqual(h.retainedResult);
    const fresh = resolveCitationResponse(h.plan, { foreignLookup: h.body.foreignLookup }, CHAT_HOST);
    if (fresh.kind !== "terminal") throw new Error("Not terminal");
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    const rendered = renderCitationRecovery(record);
    expect(rendered?.completion).toEqual(fresh.resolution.completion);
    expect(rendered?.plainText).toContain(f.output);
    if (!rendered) throw new Error("Missing render");
    await expect(saveRecoveredCitationHistory({ requestId, projectId: "project-one", expectedAccountId: owner,
      formattedOutput: rendered.formattedOutput })).resolves.toEqual({ historyId: "saved-history", alreadySaved: false });
    expect(h.writes[0]).toMatchObject({ raw_input: f.raw, user_id: owner, project_id: "project-one", citation_request_id: requestId });
    expect(h.writes[0]).not.toHaveProperty("is_verified");
    expect(JSON.stringify(h.retainedResult)).not.toContain('"snippet"');
    expect(h.lookup).toHaveBeenCalledTimes(1); expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(["begin_citation_request", "finish_citation_request", "read_citation_recovery", "read_citation_recovery"]);
    expect(fetch).not.toHaveBeenCalled();
    await expect(saveRecoveredCitationHistory({ requestId, projectId: "other-project", expectedAccountId: owner,
      formattedOutput: rendered.formattedOutput })).rejects.toThrow("CITATION_HISTORY_DESTINATION_MISMATCH");
  });
  it.each(["partial", "conflict", "snippet-only"])("%s stays honestly partial/unconfirmed after projection", async mode => {
    const h = await vertical(C2_WIRE[2], mode);
    expect(h.body.recoveryAvailability).toBe("available");
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    const rendered = renderCitationRecovery(record);
    const fresh = resolveCitationResponse(h.plan, { foreignLookup: h.body.foreignLookup }, CHAT_HOST);
    if (fresh.kind !== "terminal") throw new Error("Not terminal");
    if (mode !== "snippet-only") expect(rendered?.completion).toEqual(fresh.resolution.completion);
    else { expect(fresh.resolution.completion?.identityConfirmed).toBe(true); expect(rendered?.completion?.identityConfirmed).toBe(false); expect(rendered?.warning).toBeTruthy(); }
    if (!rendered) throw new Error("Missing render");
    await saveRecoveredCitationHistory({ requestId, projectId: null, expectedAccountId: owner, formattedOutput: rendered.formattedOutput });
    expect(h.writes[0]).not.toHaveProperty("is_verified");
    expect(h.search).toHaveBeenCalledTimes(1);
  });
  it.each(["forged-field", "forged-source", "invalid-snippet", "invalid-provenance", "invalid-identity", "invalid-tier"])("%s retains invalid-result failure settlement", async mode => {
    const h = await vertical(C2_WIRE[0], mode);
    expect(h.body.recoveryAvailability).toBe("unconfirmed");
    expect(h.response.headers.get("X-Usage-Status")).toBe("unconfirmed");
    expect(h.retainedResult).toBeNull();
    expect(h.rpc.mock.calls[1][1]).toMatchObject({ _outcome: "unknown", _reason: "recovery_result_invalid", _result: null });
    await expect(saveRecoveredCitationHistory({ requestId, projectId: null, expectedAccountId: owner, formattedOutput: "forged" })).rejects.toThrow("CITATION_RECOVERY_UNAVAILABLE");
    expect(h.writes).toHaveLength(0); expect(h.lookup).toHaveBeenCalledTimes(1);
  });
  it.each(["raw", "kind", "manual"])("retained %s mismatch cannot promote completion", async mode => {
    const h = await vertical(C2_WIRE[0]);
    h.mutateInput(input => {
      if (!input.foreignLookup) throw new Error("Missing input");
      if (mode === "raw") input.foreignLookup.rawInput = "Author: Jane Doe; Book: Other Collection; Original year: 1901";
      if (mode === "kind") input.foreignLookup.kind = "book_chapter";
      if (mode === "manual") input.messages[0].content = `[סיווג שיפוט ידני: {"sourceType":"foreign_case_us","jurisdiction":"US"}]\n${C2_WIRE[0].raw}`;
    });
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    const rendered = renderCitationRecovery(record);
    expect(rendered?.completion).toBeUndefined();
    expect(rendered?.warning).toBeTruthy();
    expect(rendered?.plainText).toContain("1901");
    expect(h.lookup).toHaveBeenCalledTimes(1); expect(h.search).toHaveBeenCalledTimes(1);
    expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(["begin_citation_request", "finish_citation_request", "read_citation_recovery"]);
  });
  it("unchanged account and stale-scope guards prevent recovery writes", async () => {
    const h = await vertical(C2_WIRE[0]);
    client.session.mockResolvedValue({ data: { session: { user: { id: "other-account" } } }, error: null });
    await expect(saveRecoveredCitationHistory({ requestId, projectId: null, expectedAccountId: owner, formattedOutput: "not current" })).rejects.toThrow("CITATION_HISTORY_STALE");
    expect(client.invoke).not.toHaveBeenCalled(); expect(h.writes).toHaveLength(0);
    await expect(saveRecoveredCitationHistory({ requestId, projectId: null, expectedAccountId: owner, formattedOutput: "not current", isResultCurrent: () => false })).rejects.toThrow("CITATION_HISTORY_STALE");
    expect(h.rpc).toHaveBeenCalledTimes(2);
  });
});