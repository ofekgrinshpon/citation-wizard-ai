/** Actual deployed-handler source executed offline with dummy runtime and closed transports. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as pasted from "../../supabase/functions/_shared/pastedCitation";
import * as recovery from "../../supabase/functions/_shared/citationRecovery";
import * as prefixes from "../../supabase/functions/_shared/caseTypePrefixes";
import * as statute from "../../supabase/functions/citation-chat/statuteRoute";
const compiled = ts.transpileModule(readFileSync("supabase/functions/citation-chat/index.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture() {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const cache = vi.fn(() => { throw new Error("Unexpected cache access"); });
  const provider = vi.fn(() => { throw new Error("Unexpected provider access"); });
  const claim = vi.fn(() => { throw new Error("Unexpected usage claim"); });
  const construct = vi.fn();
  const client = { auth: { getClaims: async () => ({ data: { claims: { sub: "synthetic-account" } }, error: null }) }, from: cache, rpc: claim };
  const require = (path: string) => {
    if (path.includes("http/server")) return { serve: (fn: typeof handler) => { handler = fn; } };
    if (path.includes("supabase-js")) return { createClient: () => client };
    if (path.includes("pastedCitation")) return pasted;
    if (path.includes("citationRecovery")) return recovery;
    if (path.includes("caseTypePrefixes")) return prefixes;
    if (path.includes("statuteRoute")) return statute;
    if (path.includes("citationDiagnosticGate")) return { isCitationDiagnosticPreflight: () => false };
    if (path.includes("costTelemetry")) return { withCostTelemetry: (_: unknown, fn: () => unknown) => fn(), setTelemetryFromBody: () => {}, trackedFetch: provider };
    if (path.includes("citationUsageGuard")) return { withCitationProviderOutcome: (fn: () => unknown) => fn(), CitationUsageGuard: class { constructor() { construct(); } begin = claim; finish = async () => {}; }, citationFingerprint: async () => "offline-fingerprint" };
    // Imports not exercised by this pre-cache safety branch remain inaccessible.
    return {};
  };
  new Function("require", "exports", "Deno", "fetch", compiled)(require, {}, { env: { get: () => "dummy-offline" } }, provider);
  return { cache, provider, claim, construct, invoke: async (body: Record<string, unknown>) => {
    if (!handler) throw new Error("Missing actual handler");
    const r = await handler(new Request("https://fixture.invalid", { method: "POST", headers: { Authorization: "Bearer synthetic", "Content-Type": "application/json" }, body: JSON.stringify({ citationRequestVersion: 3, requestId: "synthetic-request-1", ...body }) }));
    return { status: r.status, body: await r.json() };
  } };
}
describe("batch A actual server pre-cache route guard", () => {
  it.each([
    { rawInput: 'ע"א 400/51 כהן נ׳ לוי' }, { rawInput: "Other v. Source" }, { rawInput: null },
    { rawInput: "Brown v. Board of Education", kind: "book" },
    { rawInput: "Brown v. Board of Education", parsedFields: { caseName: "Other v. Source" } },
    { rawInput: "Brown v. Board of Education", parsedFields: { bookTitle: "Brown" } },
  ])("actual handler rejects mismatched/forged lookup before usage construction: %j", async overrides => {
    const raw = "Brown v. Board of Education"; const h = fixture();
    const r = await h.invoke({ rawInput: raw, messages: [{ role: "user", content: raw }], pastedCitation: pasted.buildPastedCitation(raw),
      foreignLookup: { enabled: true, kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: {}, ...overrides } });
    expect(r.status).toBe(200); expect(r.body.content).toContain(raw); expect(r.body.pastedCitation.route).toBe("preserve");
    expect(h.construct).not.toHaveBeenCalled(); expect(h.claim).not.toHaveBeenCalled(); expect(h.cache).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled();
  });
  it.each(["Brown v. Board of Education", '[סיווג אוטומטי: פסיקה]\n══ מנוע אזכור (test) ══\nOther v. Source\n══════════\nBrown v. Board of Education'])("equal UNKNOWN input with legitimate wrapper passes binding to closed usage boundary: %s", async content => {
    const raw = "Brown v. Board of Education"; const h = fixture();
    await h.invoke({ rawInput: raw, messages: [{ role: "user", content }], foreignLookup: { enabled: true, kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } } });
    expect(h.construct).toHaveBeenCalledTimes(1); expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.provider).not.toHaveBeenCalled(); expect(h.cache).not.toHaveBeenCalled();
  });
  it.each(["BVerfG 1 BvR 400/51", "BVerfG, Urteil vom 15. Januar 1958, 1 BvR 400/51, BVerfGE 7, 198", "400/51",
    "Brown v. Board of Education, 347 U.S. 483 (1954)"])("%s cannot reach Israeli cache/search/provider", async raw => {
    const h = fixture();
    const r = await h.invoke({ messages: [{ role: "user", content: raw }] });
    expect(r.status).toBe(200); expect(r.body.content).toContain(raw); expect(r.body.content).toContain("⚠️");
    expect(r.body.pastedCitation.version).toBe(1);
    expect(h.cache).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled(); expect(h.claim).not.toHaveBeenCalled();
  });
  it("German docket cannot be smuggled into an Israeli declaration or US lookup", async () => {
    const raw = "BVerfG 1 BvR 400/51"; const h = fixture();
    const r = await h.invoke({ rawInput: raw, messages: [{ role: "user", content: raw }],
      pastedCitation: { ...pasted.buildPastedCitation(raw), jurisdiction: "IL", route: "israeli", manualChoice: { jurisdiction: "IL" } },
      foreignLookup: { enabled: true, kind: "case", jurisdiction: "US", rawInput: raw, parsedFields: {} } });
    expect(r.body.pastedCitation.conflicts).toContain("manual_jurisdiction_conflict");
    expect(h.cache).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled(); expect(h.claim).not.toHaveBeenCalled();
  });
});