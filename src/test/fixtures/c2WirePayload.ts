import { webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import * as statuteRoute from "../../../supabase/functions/citation-chat/statuteRoute";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as recovery from "../../../supabase/functions/_shared/citationRecovery";
import * as usage from "../../../supabase/functions/_shared/citationUsageGuard";
import * as pasted from "../../../supabase/functions/_shared/pastedCitation";
import * as prefixes from "../../../supabase/functions/_shared/caseTypePrefixes";
import * as bookFinal from "../../../supabase/functions/_shared/citationPure/bookFinal";
import { CHAT_HOST, planCitationEvidence, planLocalCitation, planTypedRequest } from "@/lib/citationPlanner";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";
import { c1ServerPayload } from "./c1ServerPayload";
export const C2_WIRE = [
  { id: "A", raw: "Author: Jane Doe; Book: Synthetic Collection; Original year: 1901", type: "foreign_book", local: { originalYear: "1901" }, output: "1901" },
  { id: "B", raw: "Author: Jane Doe; Book: Synthetic Collection; Publisher: Synthetic Press; Publisher status: non-original", type: "foreign_book", local: { publisher: "Synthetic Press", publisherStatus: "non-original" }, output: "Synthetic Press" },
  { id: "C", raw: "Author: Jane Doe; Chapter: Quiet Rules; Collection: Synthetic Collection; First page: 12; Pinpoint: 214-216", type: "foreign_book_chapter", local: { firstPage: "12", pinpoint: "214-216" }, output: "214–216" },
  { id: "D", raw: "Author: Jane Doe; Book: Synthetic Collection; Section: 4.2", type: "foreign_book", local: { section: "4.2" }, output: "§ 4.2" },
] as const;
type WireFixture = { id: string; raw: string; type: "foreign_book" | "foreign_book_chapter" };
export function c2WirePlan(f: WireFixture) {
  const evidence = planCitationEvidence(f.raw, citationManualChoice(f.type));
  const input = { evidence, sourceType: f.type, input: f.raw, isPinpoint: false, manual: false };
  const local = planLocalCitation(input, CHAT_HOST);
  if ("resolution" in local) throw new Error("Expected bounded completion for wire fixture " + f.id);
  return planTypedRequest({ ...input, canonicalRaw: f.raw, statutePrep: local.statutePrep }, CHAT_HOST);
}
export async function c2WirePayload(f: WireFixture) {
  const plan = c2WirePlan(f);
  const chapter = f.type === "foreign_book_chapter";
  const donor = { title: `${chapter ? "Quiet Rules — " : ""}Jane Doe, Synthetic Collection (2nd ed. 2020)`, snippet: `Jane Doe, ${chapter ? "Quiet Rules, in " : ""}Synthetic Collection (2nd ed. 2020).`, url: "https://press.example.edu/collection/quiet-rules" };
  const request = plan.foreignLookup;
  if (!request) throw new Error("Missing book lookup");
  const { response, calls } = await c1ServerPayload({ kind: chapter ? "book_chapter" : "book", jurisdiction: "OTHER", rawInput: f.raw,
    parsedFields: request.parsedFields as Record<string, string> }, [donor]);
  return { plan, response, calls };
}
/** Actual trusted handler + UsageGuard; only provider/auth/persistence mocked. */
export async function c2AuthoritativePayload(f: WireFixture) {
  const plan = c2WirePlan(f);
  const request = plan.foreignLookup;
  if (!request) throw new Error("Missing request");
  const donor = { title: "Jane Doe, Synthetic Collection (2nd ed. 2020)", snippet: `Jane Doe, ${f.type === "foreign_book_chapter" ? "Quiet Rules, in " : ""}Synthetic Collection (2nd ed. 2020).`, url: "https://press.example.edu/collection/quiet-rules" };
  const payload = await c1ServerPayload({ kind: f.type === "foreign_book_chapter" ? "book_chapter" : "book", jurisdiction: "OTHER", rawInput: f.raw,
    parsedFields: request.parsedFields as Record<string, string> }, [donor]);
  const counts = { lookup: 0, begin: 0, finish: 0 };
  let retained: unknown;
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const client = { auth: { getClaims: async () => ({ data: { claims: { sub: "offline-owner" } }, error: null }) },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "begin_citation_request") { counts.begin++; return { data: { ok: true, execute: true, status: "in_progress", request_id: args._request_id, retry_of_request_id: null, attempt_token: "offline-token" }, error: null }; }
      if (name === "finish_citation_request") { counts.finish++; retained = args._result; return { data: { ok: true, status: args._outcome, result_stored: true }, error: null }; }
      throw new Error("Unexpected IO");
    }, from: () => { const chain = { select: () => chain, eq: () => chain, or: () => chain, limit: async () => ({ data: [], error: null }) }; return chain; } };
  const code = ts.transpileModule(readFileSync("supabase/functions/citation-chat/index.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "exports", "Deno", "fetch", "crypto", "TextEncoder", code)((path: string) => {
    if (path.includes("http/server")) return { serve: (fn: typeof handler) => { handler = fn; } };
    if (path.includes("supabase-js")) return { createClient: () => client };
    if (path.includes("citationUsageGuard")) return usage;
    if (path.includes("citationRecovery")) return recovery;
    if (path.includes("pastedCitation")) return pasted;
    if (path.includes("caseTypePrefixes")) return prefixes;
    if (path.includes("citationPure/bookFinal")) return bookFinal;
    if (path.includes("statuteRoute")) return statuteRoute;
    if (path.includes("foreignLookup")) return { runForeignLookup: async () => { counts.lookup++; return payload.response; } };
    if (path.includes("costTelemetry")) return { withCostTelemetry: (_: unknown, fn: () => unknown) => fn(), setTelemetryFromBody: () => {} };
    if (path.includes("citationDiagnosticGate")) return { isCitationDiagnosticPreflight: () => false };
    return {};
  }, {}, { env: { get: () => "offline" } }, () => { throw new Error("Generic IO forbidden"); }, webcrypto, TextEncoder);
  if (!handler) throw new Error("No handler");
  const response = await handler(new Request("https://offline.invalid", { method: "POST", headers: { Authorization: "Bearer offline" }, body: JSON.stringify({
    citationRequestVersion: 3, requestId: "host-authoritative-0001", rawInput: f.raw, messages: [{ role: "user", content: f.raw }], foreignLookup: request,
    content: "INJECTED CLIENT CONTENT",
  }) }));
  const body = await response.json();
  if (body.recoveryAvailability !== "available") throw new Error("Unconfirmed fixture");
  return { ...payload, body, retained, counts };
}
