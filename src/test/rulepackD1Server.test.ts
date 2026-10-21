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
import { RULEPACK_MANIFEST } from "../../supabase/functions/_shared/citationPure/rulepack";
import { CHAT_HOST, planCitationEvidence, planLocalCitation, planTypedRequest } from "@/lib/citationPlanner";
import type { SourceType } from "@/data/abbreviations";

const RAW = "Brown v. Board of Education";
const noSideEffects = (h: ReturnType<typeof fixture>) => {
  expect(h.construct).not.toHaveBeenCalled(); expect(h.claim).not.toHaveBeenCalled();
  expect(h.cache).not.toHaveBeenCalled(); expect(h.provider).not.toHaveBeenCalled();
};
const lookup = { enabled: true, kind: "case", jurisdiction: "UNKNOWN", rawInput: RAW, parsedFields: { caseName: RAW } };

describe("D1 actual handler: manual jurisdiction id/code validation", () => {
  const ids = { AU: "t2:australia", CA: "t2:canada", FR: "t2:france-republic-of" } as const;
  it.each(Object.entries(ids).flatMap(([j, id]) => [
    { j, id, mode: "omitted", choice: { sourceType: "foreign_case_other", jurisdictionId: id } },
    { j, id, mode: "contradictory US", choice: { sourceType: "foreign_case_other", jurisdictionId: id, jurisdiction: "US" } },
    { j, id, mode: "malformed", choice: { sourceType: "foreign_case_other", jurisdictionId: id, jurisdiction: "NOT_A_COUNTRY" } },
  ]))("$j $mode code preserves raw with zero usage/cache/provider", async ({ j, mode, choice }) => {
    const h = fixture();
    const r = await h.invoke({ rawInput: RAW, messages: [{ role: "user", content: RAW }],
      pastedCitation: { ...pasted.buildPastedCitation(RAW), manualChoice: choice }, foreignLookup: lookup });
    expect(r.body.pastedCitation.route).toBe("preserve");
    expect(r.body.pastedCitation.rawInput).toBe(RAW);
    if (mode === "omitted") expect(r.body.pastedCitation.unsupported).toContain(j === "FR" ? `rulepack_planned_disabled:${j}` : "country_local_only_completion_disabled");
    if (mode === "contradictory US") expect(r.body.pastedCitation.conflicts).toContain("manual_jurisdiction_id_mismatch");
    if (mode === "malformed") expect(r.body.pastedCitation.conflicts).toContain("manual_jurisdiction_malformed");
    noSideEffects(h);
  });
  it("supported legacy US choice still reaches the existing usage boundary", () => {
    const c = pasted.guardPastedCitationRequest({ messages: [{ role: "user", content: RAW }], rawInput: RAW,
      pastedCitation: { ...pasted.buildPastedCitation(RAW), manualChoice: { sourceType: "foreign_case_us", jurisdictionId: "us", jurisdiction: "US" } }, foreignLookup: lookup });
    expect(c.route).toBe("foreign"); expect(c.conflicts).toEqual([]);
  });
});

/** Architecture proof: temporarily disable manifest entries and restore them. */
function withDisabled<T>(ids: string[], fn: () => T): T {
  const entries = RULEPACK_MANIFEST.filter(e => ids.includes(e.id));
  expect(entries).toHaveLength(ids.length);
  const prior = entries.map(e => e.status);
  for (const e of entries) (e as { status: string }).status = "planned_disabled";
  try { return fn(); } finally { entries.forEach((e, i) => { (e as { status: string }).status = prior[i]; }); }
}
async function withDisabledAsync<T>(ids: string[], fn: () => Promise<T>): Promise<T> {
  const entries = RULEPACK_MANIFEST.filter(e => ids.includes(e.id));
  expect(entries).toHaveLength(ids.length);
  const prior = entries.map(e => e.status);
  for (const e of entries) (e as { status: string }).status = "planned_disabled";
  try { return await fn(); } finally { entries.forEach((e, i) => { (e as { status: string }).status = prior[i]; }); }
}
function plan(raw: string, type: SourceType | null) {
  const ev = planCitationEvidence(raw, null);
  if (ev.preserve) return { preserve: true, foreignLookup: null };
  const input = { evidence: ev, sourceType: type ?? ev.pasted.detection?.sourceType ?? null, input: raw, isPinpoint: false, manual: !!type };
  const local = planLocalCitation(input, CHAT_HOST);
  if ("resolution" in local) return { preserve: local.origin === "preserve", warning: local.resolution.warningMsg, foreignLookup: null };
  return { preserve: false, foreignLookup: planTypedRequest({ ...input, statutePrep: local.statutePrep, canonicalRaw: raw }, CHAT_HOST).foreignLookup };
}
const DISABLED = "תבנית האזכור לסוג המקור ולתחום השיפוט אינה זמינה; הקלט נשמר ללא השלמה וללא חיפוש.";
describe("D1 manifest is the decision source (planner + server)", () => {
  const BOOK = "Author: Jane Doe; Book: Synthetic Collection; Original year: 1901";
  const CHAPTER = "Author: Jane Doe; Chapter: Hidden Costs; Book: Synthetic Collection; Editors: John Roe";
  it.each([
    { ids: ["general.book"], raw: BOOK, type: "foreign_book" as SourceType },
    { ids: ["general.book_chapter"], raw: CHAPTER, type: "foreign_book_chapter" as SourceType },
    { ids: ["us.statute"], raw: "Copyright Act", type: "foreign_statute_us" as SourceType },
    { ids: ["us.statute"], raw: "17 U.S.C. §512 (2018)", type: "foreign_statute_us" as SourceType },
    { ids: ["uk.statute"], raw: "Human Rights Act 1998, c. 42", type: "foreign_statute_uk" as SourceType },
    { ids: ["unanchored.case"], raw: RAW, type: null },
    { ids: ["us.case.reported", "us.case.unreported"], raw: "Brown v. Board of Education, 347 U.S. 483 (1954)", type: null },
    { ids: ["uk.case"], raw: "R (Miller) v. Secretary of State [2017] UKSC 5", type: null },
    { ids: ["general.journal_article"], raw: "Jane Doe, Hidden Costs, 12 Yale L.J. 34 (2020)", type: "foreign_journal_article" as SourceType },
  ])("disabling $ids preserves locally with no typed request", ({ ids, raw, type }) => {
    const enabled = plan(raw, type);
    const disabled = withDisabled(ids, () => plan(raw, type));
    expect(disabled).toMatchObject({ preserve: true, foreignLookup: null, warning: DISABLED });
    expect(plan(raw, type)).toEqual(enabled); // restored
  });
  it.each([
    { ids: ["unanchored.case"], foreignLookup: lookup, raw: RAW },
    { ids: ["general.book"], foreignLookup: { enabled: true, kind: "book", jurisdiction: "OTHER", rawInput: "Author: Jane Doe; Book: Synthetic Collection", parsedFields: { authors: "Jane Doe", bookTitle: "Synthetic Collection" } }, raw: "Author: Jane Doe; Book: Synthetic Collection" },
    { ids: ["us.statute"], foreignLookup: { enabled: true, kind: "statute", jurisdiction: "US", rawInput: "Copyright Act", parsedFields: { statuteName: "Copyright Act" } }, raw: "Copyright Act" },
  ])("actual handler rejects disabled $ids before usage/cache/provider", async ({ ids, foreignLookup, raw }) => {
    const h = fixture();
    const r = await withDisabledAsync(ids, () => h.invoke({ rawInput: raw, messages: [{ role: "user", content: raw }], foreignLookup }));
    expect(r.body.pastedCitation.conflicts).toContain("rulepack_lookup_disabled");
    noSideEffects(h);
  });
  it("missing manifest entry for a lookup kind/jurisdiction is rejected", () => {
    const c = pasted.guardPastedCitationRequest({ messages: [{ role: "user", content: "Copyright Act" }], rawInput: "Copyright Act",
      foreignLookup: { enabled: true, kind: "statute", jurisdiction: "OTHER", rawInput: "Copyright Act", parsedFields: {} } });
    expect(c.route).toBe("preserve"); expect(c.conflicts).toContain("rulepack_lookup_disabled");
  });
});

import { COUNTRY_LOCAL_FIXTURES } from "./fixtures/countryLocalFixtures";
describe("six local country templates actual handler never completes", () => {
  it.each(COUNTRY_LOCAL_FIXTURES)("$id rejects generic and forged unanchored lookups before usage", async f => {
    for (const foreignLookup of [undefined,{enabled:true,kind:f.id.includes("case")?"case":"statute",jurisdiction:"UNKNOWN",rawInput:f.raw,parsedFields:{}}]) {
      const h = fixture(); const r = await h.invoke({rawInput:f.raw,messages:[{role:"user",content:f.raw}],foreignLookup});
      expect(r.body.pastedCitation.route).toBe("preserve"); expect(r.body.pastedCitation.rawInput).toBe(f.raw); noSideEffects(h);
    }
  });
});
