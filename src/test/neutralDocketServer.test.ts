import * as neutral from "../../supabase/functions/citation-chat/neutralDocket";
import * as bookEvidenceRoute from "../../supabase/functions/citation-chat/bookEvidenceRoute";
/** Actual deployed-handler source executed offline with dummy runtime and closed transports. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as pasted from "../../supabase/functions/_shared/pastedCitation";
import * as recovery from "../../supabase/functions/_shared/citationRecovery";
import * as bookFinal from "../../supabase/functions/_shared/citationPure/bookFinal";
import * as prefixes from "../../supabase/functions/_shared/caseTypePrefixes";
import * as statute from "../../supabase/functions/citation-chat/statuteRoute";
import * as country from "../../supabase/functions/citation-chat/countryRoute";
import * as freeformInterpret from "../../supabase/functions/_shared/citationPure/freeformInterpret";
const compiled = ts.transpileModule(readFileSync("supabase/functions/citation-chat/index.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function fixture(rows: unknown[] = []) {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const query: any = {select: vi.fn(()=>query), eq: vi.fn(()=>query), ilike: vi.fn(()=>query), limit: vi.fn(()=>query), abortSignal: vi.fn(async()=>({data:rows,error:null}))};
  const cache = vi.fn((table:string) => { if(table!=="verified_sources")throw Error("Wrong table");return query; });
  const provider = vi.fn(() => { throw new Error("Unexpected provider access"); });
  const claim = vi.fn(() => { throw new Error("Unexpected usage claim"); });
  const construct = vi.fn();
  const client = { auth: { getClaims: async () => ({ data: { claims: { sub: "synthetic-account" } }, error: null }) }, from: cache, rpc: claim };
  const require = (path: string) => {
    if(path.includes("neutralDocket")) return neutral;
      if (path.includes("bookEvidenceRoute")) return bookEvidenceRoute;
    if (path.includes("http/server")) return { serve: (fn: typeof handler) => { handler = fn; } };
    if (path.includes("supabase-js")) return { createClient: () => client };
    if (path.includes("pastedCitation")) return pasted;
    if (path.includes("citationRecovery")) return recovery;
    if (path.includes("citationPure/bookFinal")) return bookFinal;
    if (path.includes("caseTypePrefixes")) return prefixes;
    if (path.includes("statuteRoute")) return statute;
    if (path.includes("countryRoute")) return country;
    if (path.includes("freeformInterpret")) return freeformInterpret;
    if (path.includes("citationDiagnosticGate")) return { isCitationDiagnosticPreflight: () => false };
    if (path.includes("costTelemetry")) return { withCostTelemetry: (_: unknown, fn: () => unknown) => fn(), setTelemetryFromBody: () => {}, trackedFetch: provider };
    if (path.includes("citationUsageGuard")) return { citationProviderOutcomeUnknown: () => false, withCitationProviderOutcome: (fn: () => unknown) => fn(), CitationUsageGuard: class { constructor() { construct(); } begin = claim; finish = async () => {}; }, citationFingerprint: async () => "offline-fingerprint" };
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
describe("actual neutral docket handler",()=>{
 it.each(["6821/93","4628/93","5121/98","140/00","389/80"])("reads catalog once before any usage/provider for %s",async raw=>{
  const h=fixture();const r=await h.invoke({rawInput:raw,messages:[{role:"user",content:raw}]});
  expect(r.status).toBe(200);expect(r.body.content).toContain(raw);expect(r.body.content).toContain("נא להוסיף");
  expect(r.body.pastedCitation.jurisdiction).toBe("UNKNOWN");expect(h.cache).toHaveBeenCalledTimes(1);expect(h.provider).not.toHaveBeenCalled();expect(h.claim).not.toHaveBeenCalled();
 });
 it.each([1,2])("%s exact catalog candidates never become a selected judgment",async count=>{
  const rows=Array.from({length:count},(_,i)=>({full_citation:`ע״א 140/00 צד${i} נ׳ אחר (2004)`,source_type:"case_law_database",verification_status:"verified"}));
  const h=fixture(rows);const r=await h.invoke({rawInput:"140/00",messages:[{role:"user",content:"140/00"}]});
  expect(r.body.content.startsWith("140/00\n⚠️")).toBe(true);
  expect(r.body.content.includes("התאמה אפשרית בלבד")).toBe(count===1);
  expect(r.body.content.includes("כמה התאמות אפשריות בלבד")).toBe(count===2);
  expect(h.provider).not.toHaveBeenCalled();expect(h.claim).not.toHaveBeenCalled();
 });
 it("rejects mismatched raw before reading catalog",async()=>{
  const h=fixture();await h.invoke({rawInput:"140/00",messages:[{role:"user",content:"389/80"}]});expect(h.cache).not.toHaveBeenCalled();expect(h.provider).not.toHaveBeenCalled();
 });
});
