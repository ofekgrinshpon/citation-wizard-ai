/** Offline vertical retention gate: only auth, provider fetch and persistence are mocked. */
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as recovery from "../../supabase/functions/_shared/citationRecovery";
import * as usage from "../../supabase/functions/_shared/citationUsageGuard";
import * as pasted from "../../supabase/functions/_shared/pastedCitation";
import * as bookFinal from "../../supabase/functions/_shared/citationPure/bookFinal";
import { splitCitationWarnings } from "@/lib/citationSegments";
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

// Emulates JSONB object-order loss without changing array order or JSON values.
function reorderObjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorderObjects);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().reverse()
    .map(key => [key, reorderObjects((value as Record<string, unknown>)[key])]));
  return value;
}
async function vertical(f: { id: string; raw: string; type: "foreign_book" | "foreign_book_chapter" }, mode = "complete", jsonb = false) {
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
    if (mode === "unmatched") { result.identity.matched = false; result.identity.conflicts.push("unmatched"); }
    if (mode === "error") result.error = "lookup_failed";
    if (mode === "missing-key") result.error = "missing_perplexity_credentials";
    if (mode === "thrown") throw new Error("offline lookup failure");
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
      retainedInput = jsonb ? reorderObjects(args._recovery_input) : args._recovery_input;
      return { data: { ok: true, execute: true, status: "in_progress", request_id: args._request_id, retry_of_request_id: null, attempt_token: "offline-attempt" }, error: null };
    }
    if (name === "finish_citation_request") {
      status = String(args._outcome); retainedResult = jsonb ? reorderObjects(args._result) : args._result;
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
      if (path.includes("citationPure/bookFinal")) return bookFinal;
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
    messages: [{ role: "user", content: f.raw }], foreignLookup: request,
    content: "CLIENT INJECTED CONTENT", bookFinal: "CLIENT INJECTED FLAG" });
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
    mutateResult: (mutate: (result: recovery.CitationRecoveryResult) => void) => {
      const result = recovery.citationRecoveryResult(retainedResult);
      if (!result) throw new Error("Invalid result");
      mutate(result); retainedResult = result;
    },
    mutateInput: (mutate: (input: recovery.CitationRecoveryInput) => void) => {
      const input = recovery.citationRecoveryInput(retainedInput);
      if (!input) throw new Error("Invalid fixture input");
      mutate(input); retainedInput = input;
    } };
}

describe("C2 real retention → recovery → history", () => {
  it.each([...C2_WIRE.map(f => ({ ...f, mode: "complete" })), { ...C2_WIRE[2], id: "snippet-only", mode: "snippet-only" }])
    ("JSONB nested key reordering keeps $id authoritative citation and history", async f => {
      const h = await vertical(f, f.mode, true);
      expect(h.body.recoveryAvailability).toBe("available");
      const record = await readCitationRecovery(owner, requestId);
      if (!record) throw new Error("Missing recovery");
      const rendered = renderCitationRecovery(record);
      expect(rendered?.formattedOutput).toBe(h.body.content);
      expect(splitCitationWarnings(rendered?.formattedOutput ?? "").warnings).toEqual(splitCitationWarnings(h.body.content).warnings);
      if (!rendered) throw new Error("Missing rendered result");
      await saveRecoveredCitationHistory({ requestId, projectId: "project-one", expectedAccountId: owner, formattedOutput: rendered.formattedOutput });
      expect(h.writes[0]).toMatchObject({ formatted_output: h.body.content, raw_input: f.raw, citation_request_id: requestId, project_id: "project-one" });
      expect(JSON.stringify(h.retainedResult)).not.toContain('"snippet"');
      expect(h.rpc.mock.calls[1][1]).toMatchObject({ _outcome: "succeeded", _reason: "citation_delivered" });
      expect(h.lookup).toHaveBeenCalledTimes(1); expect(h.search).toHaveBeenCalledTimes(1);
      expect(h.rpc.mock.calls.map(([name]) => name)).toEqual(["begin_citation_request", "finish_citation_request", "read_citation_recovery", "read_citation_recovery"]);
      expect(fetch).not.toHaveBeenCalled();
    });
  it.each(C2_WIRE)("$id keeps fresh semantic fields through actual retention and save", async f => {
    const h = await vertical(f);
    expect(h.body.recoveryAvailability).toBe("available");
    expect(h.response.headers.get("X-Usage-Status")).toBeNull();
    expect(h.body.requestId).toBe(requestId);
    const finish = h.rpc.mock.calls.find(([name]) => name === "finish_citation_request")?.[1];
    expect(finish).toMatchObject({ _outcome: "succeeded", _reason: "citation_delivered", _request_id: requestId });
    expect(h.body.foreignLookup.sources[0].snippet).toBe(h.donor.snippet);
    expect(h.retainedResult).toEqual({ content: expect.any(String), foreignLookup: { ...h.body.foreignLookup,
      sources: [{ url: h.donor.url, title: h.donor.title, tier: "tier1" }],
    } });
    expect(recovery.citationRecoveryResult(h.retainedResult)).toEqual(h.retainedResult);
    const fresh = resolveCitationResponse(h.plan, { foreignLookup: h.body.foreignLookup }, CHAT_HOST);
    if (fresh.kind !== "terminal") throw new Error("Not terminal");
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    const rendered = renderCitationRecovery(record);
    expect(rendered?.formattedOutput).toBe(fresh.resolution.reply);
    expect(h.body.content).toBe(fresh.resolution.reply);
    expect(rendered?.completion).toBeUndefined();
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
  it.each(["partial", "conflict", "snippet-only", "unmatched", "error", "missing-key", "thrown"])("%s stays honestly partial/unconfirmed after projection", async mode => {
    const h = await vertical(C2_WIRE[2], mode);
    expect(h.body.recoveryAvailability).toBe("available");
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    const rendered = renderCitationRecovery(record);
    const fresh = resolveCitationResponse(h.plan, { foreignLookup: h.body.foreignLookup }, CHAT_HOST);
    if (fresh.kind !== "terminal") throw new Error("Not terminal");
    expect(rendered?.formattedOutput).toBe(fresh.resolution.reply);
    expect(h.body.content).toBe(fresh.resolution.reply);
    expect(splitCitationWarnings(rendered?.formattedOutput ?? "").warnings).toEqual(splitCitationWarnings(fresh.resolution.reply).warnings);
    expect(rendered?.completion).toBeUndefined();
    if (mode === "snippet-only") expect(fresh.resolution.completion?.identityConfirmed).toBe(true);
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
  it("snippet-only chapter without firstPage keeps final missing warning and grounded year", async () => {
    const h = await vertical({ id: "chapter-partial", raw: "Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection", type: "foreign_book_chapter" }, "snippet-only");
    const fresh = resolveCitationResponse(h.plan, h.body, CHAT_HOST);
    if (fresh.kind !== "terminal") throw new Error("Not terminal");
    expect(fresh.resolution.completion?.missing).toContain("firstPage");
    expect(fresh.resolution.completion?.fields).toMatchObject({ year: "2020", edition: "2nd ed." });
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    const rendered = renderCitationRecovery(record);
    expect(rendered?.formattedOutput).toBe(fresh.resolution.reply);
    expect(rendered?.formattedOutput).toContain("חסרים פרטים");
    expect(rendered?.formattedOutput).toContain("(2nd ed. 2020)");
    if (!rendered) throw new Error("Missing render");
    await saveRecoveredCitationHistory({ requestId, projectId: null, expectedAccountId: owner, formattedOutput: rendered.formattedOutput });
    expect(JSON.stringify(h.retainedResult)).not.toContain('"snippet"');
    expect(h.rpc.mock.calls.filter(([name]) => name === "begin_citation_request")).toHaveLength(1);
    expect(h.lookup).toHaveBeenCalledTimes(1);
  });
  it.each(["unversioned", "bad-version", "bad-binding", "wrong-structured-kind", "invalid-structured", "legacy"])("%s content never bypasses legacy validation", async mode => {
    const h = await vertical(C2_WIRE[2], "snippet-only");
    h.mutateResult(result => {
      if (mode === "unversioned") result.content = "FORGED FINAL CONTENT";
      if (mode === "bad-version") result.content = result.content?.replace(/book-final:\d+/, "book-final:999");
      if (mode === "bad-binding") result.content = result.content?.replace(/pc1:/, "bad:");
      if (mode === "legacy") delete result.content;
      if (mode === "wrong-structured-kind" && result.foreignLookup) result.foreignLookup.kind = "book";
      if (mode === "invalid-structured" && result.foreignLookup) result.foreignLookup.identity = { matched: "forged" };
    });
    if (mode === "invalid-structured") {
      const record = await readCitationRecovery(owner, requestId);
      expect(record?.availability).toBe("unavailable");
      expect(record?.result).toBeNull();
      await expect(saveRecoveredCitationHistory({ requestId, projectId: null, expectedAccountId: owner, formattedOutput: "forged" })).rejects.toThrow("CITATION_RECOVERY_UNAVAILABLE");
      expect(h.writes).toHaveLength(0); return;
    }
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    const rendered = renderCitationRecovery(record);
    expect(rendered?.formattedOutput).not.toContain("FORGED FINAL CONTENT");
    expect(rendered?.formattedOutput).not.toContain("(2nd ed. 2020)");
    expect(rendered?.warning).toBeTruthy();
    expect(h.lookup).toHaveBeenCalledTimes(1);
  });
  it("expired final output cannot replay or save", async () => {
    const h = await vertical(C2_WIRE[2], "snippet-only");
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    expect(renderCitationRecovery(record, Date.parse(record.expiresAt))).toBeNull();
    expect(h.writes).toHaveLength(0);
  });
  it("client constructed or parsed copies cannot gain authoritative replay origin", async () => {
    const h = await vertical(C2_WIRE[2], "snippet-only");
    const record = await readCitationRecovery(owner, requestId);
    if (!record) throw new Error("Missing recovery");
    expect(renderCitationRecovery(record)?.formattedOutput).toBe(h.body.content);
    const forged = structuredClone(record);
    expect(renderCitationRecovery(forged)?.formattedOutput).not.toContain("(2nd ed. 2020)");
    expect(renderCitationRecovery(forged)?.warning).toBeTruthy();
    expect(h.body.content).not.toContain("CLIENT INJECTED");
    const conflict = resolveCitationResponse(h.plan, { ...h.body, foreignLookup: { ...h.body.foreignLookup,
      identity: { ...h.body.foreignLookup.identity, matched: false } }, content: h.body.content }, CHAT_HOST);
    if (conflict.kind !== "terminal") throw new Error("Not terminal");
    expect(conflict.resolution.completion?.identityConfirmed).toBe(false);
    expect(conflict.resolution.reply).not.toContain("(2nd ed. 2020)");
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