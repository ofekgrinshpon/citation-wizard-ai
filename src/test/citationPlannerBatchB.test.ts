/**
 * Batch B — shared pure planner/resolver. Offline only.
 * Before/after differential: the frozen baseline runner (04d6363) vs the
 * refactored runner, on the same mocked IO, comparing results AND request bodies.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ invoke: vi.fn(), retry: vi.fn(), classifier: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke, retryCitationFunction: m.retry }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: m.cache, classifyVerifiedSource: vi.fn(() => "x"), getVerifiedCategoryLabel: vi.fn(() => "x") }));
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: m.classifier }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { runCitation } from "@/lib/runCitation";
import { runCitation as legacyRunCitation } from "./fixtures/legacyRunCitation.baseline";
import { CHAT_HOST, RUNNER_HOST, planCitationEvidence, planLocalCitation, planTypedRequest, resolveCitationResponse } from "@/lib/citationPlanner";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";
import type { SourceType } from "@/data/abbreviations";

type Fx = { name: string; raw: string; type?: SourceType };
const FIXTURES: Fx[] = [
  // ten existing partially supported foreign source types
  { name: "US case complete", raw: "Brown v. Board of Education, 347 U.S. 483 (1954)", type: "foreign_case_us" },
  { name: "US case incomplete", raw: "Brown v. Board of Education", type: "foreign_case_us" },
  { name: "US unreported", raw: "Alpha v. Beta, No. 24-CV-017-A, 2024 WL 123456, at *3, *7–9 (D. Mass. Mar. 2, 2024)", type: "foreign_case_us" },
  { name: "UK case", raw: "R v Smith [2001] UKHL 12", type: "foreign_case_other" },
  { name: "US statute complete", raw: "17 U.S.C. § 512 (2018)", type: "foreign_statute_us" },
  { name: "US statute incomplete", raw: "17 U.S.C. § 512", type: "foreign_statute_us" },
  { name: "UK statute", raw: "Human Rights Act 1998", type: "foreign_statute_uk" },
  { name: "article", raw: "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)", type: "foreign_journal_article" },
  { name: "article DOI", raw: "Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960), doi:10.1086/466560", type: "foreign_journal_article" },
  { name: "book", raw: "Jane Doe, Synthetic Book 12 (2d ed. 2020)", type: "foreign_book" },
  { name: "chapter ambiguous", raw: "Hidden Costs, Courts and Memory, in Synthetic Collection 12 (Jane Doe ed., 2020)", type: "foreign_book_chapter" },
  { name: "chapter labelled", raw: "Author: Ana Roe; Chapter: Quiet Rules; Collection: The Synthetic Collection; First page: 210; Pinpoint: 214; Editor: Ben Poe; Year: 2015", type: "foreign_book_chapter" },
  { name: "manuscript", raw: "Maya Cohen, Courts and Memory 12, 15 (2024) (unpublished manuscript)", type: "foreign_unpublished_manuscript" },
  { name: "thesis", raw: "Maya Cohen, A Thesis on Memory (2024) (Ph.D. dissertation, Synthetic University)", type: "foreign_thesis" },
  { name: "newspaper", raw: "Local Vote Delayed, Daily Synthetic, June 25, 1990, at A1, A4", type: "foreign_newspaper" },
  { name: "periodical unsigned ambiguous", raw: "Hidden Costs, New Horizons, Synthetic Monthly, June 1990, at 12", type: "foreign_journal_article" },
  { name: "generic foreign", raw: "Some Foreign Source 12 (2020)", type: "foreign" },
  { name: "unsupported manual Canada", raw: "R v Jordan, 2016 SCC 27", type: "foreign_case_other" },
  // Israeli / unknown / German / markers / Hebrew precedence
  { name: "Israeli full", raw: 'ע"א 1234/20 כהן נ׳ לוי (נבו 2.3.2021)' },
  { name: "Israeli bare", raw: 'ע"א 1234/20' },
  { name: "Israeli manual", raw: 'ע"א 1234/20 כהן נ׳ לוי', type: "case_law_database" },
  { name: "German", raw: "BVerfG 1 BvR 400/51" },
  { name: "German full", raw: "BVerfG, Urteil vom 15. Januar 1958, 1 BvR 400/51, BVerfGE 7, 198" },
  { name: "bare numeric", raw: "400/51" },
  { name: "unknown suffix", raw: "Brown v. Board of Education, 347 U.S. 483 (1954) xyz-unknown-tail" },
  { name: "markers/HTML", raw: "Jane Doe, C## Guide: x^^2 & A**B <b>x</b>, 12 Yale L.J. 1 (2000)" },
  { name: "manual book on case", raw: "Brown v. Board of Education", type: "foreign_book" },
  { name: "Hebrew article", raw: 'ישראל ישראלי "מאמר בדיני חוזים" עיוני משפט מב 100 (2020)', type: "article" },
];

const RESPONSES: Record<string, unknown> = {
  generic: { content: 'ע"א 400/51 כהן נ׳ לוי, פ"ד ה 1 (1951)' },
  case_ok: { content: "UNSAFE", foreignLookup: { kind: "case", identity: { matched: true, jurisdiction: "US" }, fields: { caseName: "Brown v. Board of Education", reporter: "U.S.", volume: "347", firstPage: "483", year: "1954" } } },
  case_partial: { content: "UNSAFE", foreignLookup: { kind: "case", identity: { matched: true, jurisdiction: "US" }, fields: { caseName: "Brown v. Board of Education", year: "1954" } } },
  case_conflict: { content: "UNSAFE", foreignLookup: { kind: "case", identity: { matched: true, jurisdiction: "UK", conflicts: ["x"] }, fields: { caseName: "Other" } } },
  unmatched: { content: "UNSAFE", foreignLookup: { identity: { matched: false } } },
  disambiguation: { content: "UNSAFE", foreignLookup: { disambiguation: [{ jurisdiction: "US", label: "A", url: "https://a" }, { jurisdiction: "UK", label: "B", url: "https://b" }] } },
  article_ok: { content: "UNSAFE", foreignLookup: { articleResolution: "resolved", fields: { authors: "Ronald H. Coase", articleTitle: "The Problem of Social Cost", volume: "3", journal: "J.L. & Econ.", firstPage: "1", year: "1960" } } },
  article_conflict: { content: "UNSAFE", foreignLookup: { articleResolution: "conflict", fields: {} } },
  safety_mismatch: { content: "UNSAFE", pastedCitation: { version: 1, fingerprint: "forged", rawInput: "forged" } },
  empty: { content: "" },
};

async function settle(fn: () => Promise<unknown>) {
  try { return { ok: await fn() }; } catch (e) { const x = e as { code?: string; userMessage?: string }; return { err: { code: x.code, userMessage: x.userMessage } }; }
}
const strip = (calls: unknown[][]) => calls.map(c => { const b = { ...(c[1] as Record<string, unknown>) }; delete b.requestId; return b; });
const strip2 = (r: { ok?: unknown; err?: unknown }) => {
  if (!r.ok) return r;
  const o = { ...(r.ok as Record<string, unknown>) }; delete o.telemetry; return { ok: o };
};

beforeEach(() => {
  vi.clearAllMocks();
  m.cache.mockResolvedValue(null);
  m.classifier.mockResolvedValue({ sourceType: "case_law_database", confidence: 1 });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

describe("batch B before/after differential — runner (Batch/Bibliography share this path)", () => {
  for (const fx of FIXTURES) for (const [rname, data] of Object.entries(RESPONSES)) {
    it(`${fx.name} × ${rname}`, async () => {
      m.invoke.mockResolvedValue({ data, errorInfo: null });
      const opts = { rawInput: fx.raw, overrideType: fx.type, useVerifiedStore: false };
      const before = await settle(() => legacyRunCitation(opts));
      const beforeCalls = strip(m.invoke.mock.calls); const beforeClassifier = m.classifier.mock.calls.length;
      m.invoke.mockClear(); m.classifier.mockClear();
      const after = await settle(() => runCitation(opts));
      // text, status, labels, provenance (pastedCitation), warnings, source type
      expect(strip2(after)).toEqual(strip2(before));
      expect(strip(m.invoke.mock.calls)).toEqual(beforeCalls);
      expect(m.classifier.mock.calls.length).toBe(beforeClassifier);
    });
  }
  it("transport error yields identical typed error and no extra IO", async () => {
    m.invoke.mockResolvedValue({ data: null, errorInfo: { code: "UPSTREAM", status: 502, message: "x", requestId: "r1" } });
    const opts = { rawInput: "Brown v. Board of Education", useVerifiedStore: false };
    const before = await settle(() => legacyRunCitation(opts)); m.invoke.mockClear();
    const after = await settle(() => runCitation(opts));
    expect(after).toEqual(before); expect(m.invoke).toHaveBeenCalledTimes(1);
  });
});

describe("batch B required runner behaviours", () => {
  it("German 400/51 preserved with zero classifier/cache/provider and no Israeli fallback", async () => {
    const r = await runCitation({ rawInput: "BVerfG 1 BvR 400/51" });
    expect(r.status).toBe("warning"); expect(r.reply).not.toContain("ע\"א");
    expect(m.invoke).not.toHaveBeenCalled(); expect(m.cache).not.toHaveBeenCalled(); expect(m.classifier).not.toHaveBeenCalled();
  });
  it("bare numeric unknown preserved without request", async () => {
    const r = await runCitation({ rawInput: "400/51" });
    expect(r.citation).toBe("400/51"); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("manual book on case is terminal conflict with zero requests", async () => {
    const r = await runCitation({ rawInput: "Brown v. Board of Education", overrideType: "foreign_book" });
    expect(r.pastedCitation?.conflicts).toContain("manual_source_kind_conflict"); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("incomplete US case sends one bound typed request; generic content never shown", async () => {
    m.invoke.mockResolvedValue({ data: RESPONSES.case_ok, errorInfo: null });
    const r = await runCitation({ rawInput: "Brown v. Board of Education", useVerifiedStore: false });
    expect(r.citation).toBe("Brown v. Board of Education, 347 U.S. 483 (1954).");
    const body = m.invoke.mock.calls[0][1];
    expect(body.rawInput).toBe("Brown v. Board of Education"); expect(body.foreignLookup.rawInput).toBe("Brown v. Board of Education");
    expect(m.invoke).toHaveBeenCalledTimes(1);
  });
  it("stale after response: no result applied, no second request", async () => {
    let cur = true; m.invoke.mockImplementation(async () => { cur = false; return { data: RESPONSES.case_ok, errorInfo: null }; });
    const r = await settle(() => runCitation({ rawInput: "Brown v. Board of Education", useVerifiedStore: false, isResultCurrent: () => cur }));
    expect(r.err?.code).toBe("CITATION_INPUT_CHANGED"); expect(m.invoke).toHaveBeenCalledTimes(1);
  });
  it("server retry reuses the prepared request via descriptor without re-planning or new invoke", async () => {
    const descriptor = { requestId: "r1", attempt: 1 };
    m.invoke.mockResolvedValue({ data: null, errorInfo: { code: "UPSTREAM", status: 502, message: "x", requestId: "r1", citationRetry: descriptor } });
    m.retry.mockResolvedValue({ data: RESPONSES.case_ok, errorInfo: null });
    const r = await settle(() => runCitation({ rawInput: "Brown v. Board of Education", useVerifiedStore: false }));
    const err = (await runCitation({ rawInput: "Brown v. Board of Education", useVerifiedStore: false }).catch(e => e)) as { citationRetry: { retry: () => Promise<{ citation: string }> } };
    expect(r.err?.code).toBe("UPSTREAM");
    m.invoke.mockClear(); m.classifier.mockClear();
    const ok = await err.citationRetry.retry();
    expect(ok.citation).toContain("347 U.S. 483"); expect(m.invoke).not.toHaveBeenCalled(); expect(m.classifier).not.toHaveBeenCalled();
    expect(m.retry).toHaveBeenCalledTimes(1); expect(m.retry.mock.calls[0][0]).toBe(descriptor);
  });
});

describe("batch B pure planner contract", () => {
  const plan = (raw: string, type: SourceType | null, caps = CHAT_HOST, manual = false) => {
    const ev = planCitationEvidence(raw, manual && type ? citationManualChoice(type) : null);
    const input = { evidence: ev, sourceType: type, input: raw, isPinpoint: false, manual };
    const local = ev.preserve ? { origin: "preserve", resolution: ev.preserve } : planLocalCitation(input, caps);
    return "resolution" in local ? { local } : { local, typed: planTypedRequest({ ...input, statutePrep: local.statutePrep, canonicalRaw: raw }, caps) };
  };
  it("performs no IO and is deterministic for equivalent input/capabilities", () => {
    for (const fx of FIXTURES) for (const caps of [CHAT_HOST, RUNNER_HOST]) {
      expect(plan(fx.raw, fx.type ?? null, caps)).toEqual(plan(fx.raw, fx.type ?? null, caps));
    }
    expect(fetch).not.toHaveBeenCalled(); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("complete Brown is local in both chat and runner capabilities", () => {
    for (const caps of [CHAT_HOST, RUNNER_HOST]) {
      const p = plan("Brown v. Board of Education, 347 U.S. 483 (1954)", "foreign_case_us", caps);
      expect("resolution" in p.local && p.local.resolution.citation).toContain("347 U.S. 483 (1954)");
    }
  });
  it.each(["safety_mismatch", "case_ok", "case_partial", "case_conflict", "unmatched"])("case typed outcome %s is terminal for both capabilities (no generic fallback)", rname => {
    for (const caps of [CHAT_HOST, RUNNER_HOST]) {
      const p = plan("Brown v. Board of Education", null, caps);
      const r = resolveCitationResponse(p.typed!, RESPONSES[rname] as Record<string, unknown>, caps);
      expect(r.kind).not.toBe("legacy");
      if (r.kind === "terminal") expect(r.resolution.reply).not.toContain("UNSAFE");
    }
  });
  it.each(["generic", "unmatched", "safety_mismatch"])("statute typed outcome %s is terminal", rname => {
    for (const caps of [CHAT_HOST, RUNNER_HOST]) {
      const p = plan("17 U.S.C. § 512", "foreign_statute_us", caps);
      const r = resolveCitationResponse(p.typed!, RESPONSES[rname] as Record<string, unknown>, caps);
      expect(r.kind).toBe("terminal"); if (r.kind === "terminal") expect(r.resolution.reply).not.toContain("UNSAFE");
    }
  });
  it("article: chat declares incomplete fallback; runner hands off only when no typed article render", () => {
    const raw = "Coase, The Problem of Social Cost, 3 J.L. & Econ. (1960)";
    const chat = plan(raw, "foreign_journal_article", CHAT_HOST);
    if (chat.typed) expect(resolveCitationResponse(chat.typed, { content: "UNSAFE" }, CHAT_HOST).kind).toBe("terminal");
    for (const rn of ["article_ok", "article_conflict", "safety_mismatch"]) for (const caps of [CHAT_HOST, RUNNER_HOST]) {
      const p = plan(raw, "foreign_journal_article", caps);
      if (!p.typed) continue;
      const r = resolveCitationResponse(p.typed, RESPONSES[rn] as Record<string, unknown>, caps);
      expect(r.kind).toBe("terminal"); if (r.kind === "terminal") expect(r.resolution.reply).not.toContain("UNSAFE");
    }
  });
  it("recovery presentation wrappers do not alter the bound raw input", () => {
    const p = plan("Brown v. Board of Education", null, CHAT_HOST);
    expect(p.typed!.foreignLookup).toMatchObject({ rawInput: "Brown v. Board of Education", kind: "case" });
    expect(p.typed!.evidence.pasted.contract.rawInput).toBe("Brown v. Board of Education");
  });
  it("Israeli input is a legacy handoff with no foreign lookup", () => {
    for (const caps of [CHAT_HOST, RUNNER_HOST]) {
      const p = plan('ע"א 1234/20 כהן נ׳ לוי (נבו 2.3.2021)', "case_law_database", caps);
      expect(p.typed?.kind).toBe("legacy"); expect(p.typed?.foreignLookup).toBeNull();
    }
  });
  it("declared capability differences are explicit", () => {
    expect(CHAT_HOST).not.toEqual(RUNNER_HOST);
    expect(RUNNER_HOST.groundedMerge && !CHAT_HOST.groundedMerge).toBe(true);
    expect(RUNNER_HOST.typedRequestBuilder).toBe("runner_foreign_lookup");
  });
});
