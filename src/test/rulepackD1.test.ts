import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCitation } from "@/lib/runCitation";
import { citationToPlain } from "@/lib/citationRichText";
import { citationManualChoice } from "@/lib/pastedCitationAdapter";
import { planCitationEvidence, planForeignLookup } from "@/lib/citationPlanner";
import { buildPastedCitation, guardPastedCitationRequest } from "../../supabase/functions/_shared/pastedCitation";
import { RULEPACK_MANIFEST, rulepackJurisdictionFromId, rulepackLookupEligible, readRulepackVersion, PLANNED_RULEPACK_WARNING } from "../../supabase/functions/_shared/citationPure/rulepack";

const m = vi.hoisted(() => ({ invoke: vi.fn(), classifier: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: m.cache }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.classifier } } }));
beforeEach(() => {
  vi.clearAllMocks();
  m.cache.mockResolvedValue(null);
  m.classifier.mockResolvedValue({ data: { sourceType: "foreign", confidence: 1 }, error: null });
  m.invoke.mockResolvedValue({ data: { content: "UNSAFE" }, errorInfo: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live network forbidden"); }));
});

const NEW = [
  { j: "AU", id: "t2:australia", sub: "t2:australia/x22-queensland", raw: "Competition and Consumer Act 2010 (Cth) s 18", type: "foreign_statute_us" as const },
  { j: "CA", id: "t2:canada", sub: undefined, raw: "Criminal Code, RSC 1985, c C-46, s 718", type: "foreign" as const },
  { j: "FR", id: "t2:france-republic-of", sub: undefined, raw: "Code civil art. 1240", type: "foreign" as const },
] as const;

describe("D1 manifest", () => {
  it("only existing routes are enabled; AU/CA/DE/FR are planned and disabled with v21 authority", () => {
    const enabledJ = new Set(RULEPACK_MANIFEST.filter(e => e.status === "enabled").map(e => e.jurisdiction));
    expect([...enabledJ].sort()).toEqual(["GENERAL", "UK", "UNANCHORED", "US"]);
    for (const j of ["AU", "CA", "DE", "FR"]) {
      const e = RULEPACK_MANIFEST.filter(x => x.jurisdiction === j);
      expect(e.length).toBeGreaterThan(0);
      for (const x of e) {
        expect(x.status).toBe("planned_disabled"); expect(x.completion).toBeNull(); expect(x.rendererId).toBeNull();
        expect(x.authority.edition).toBe("21"); expect(x.authority.url).toMatch(/\/bluebook\/v21\/tables\/t2-foreign-jurisdictions\//);
        expect(x.authority.observed).toBe("2026-10-21");
      }
    }
    expect(RULEPACK_MANIFEST.find(e => e.id === "fr.case.cass")?.exclusions.join()).toMatch(/oc\.\/soc\./);
  });
  it("lookup eligibility matches existing typed routes only", () => {
    for (const [k, j] of [["case", "US"], ["case", "UK"], ["case", "UNKNOWN"], ["statute", "US"], ["statute", "UK"], ["book", "OTHER"], ["book_chapter", "OTHER"], ["journal_article", "OTHER"]])
      expect(rulepackLookupEligible(k, j)).toBe(true);
    for (const [k, j] of [["case", "AU"], ["statute", "CA"], ["case", "DE"], ["statute", "FR"], ["statute", "OTHER"], ["statute", "UNKNOWN"], ["internet", "OTHER"]])
      expect(rulepackLookupEligible(k, j)).toBe(false);
  });
  it("version fallback: absent legacy, 1 current, anything else unsupported", () => {
    expect(readRulepackVersion(undefined)).toBe("legacy"); expect(readRulepackVersion(1)).toBe("current");
    for (const v of [2, "1", null, 0]) expect(readRulepackVersion(v)).toBe("unsupported");
  });
  it("jurisdiction ids map to own country, never US/IL; other countries stay UNKNOWN", () => {
    expect(rulepackJurisdictionFromId("t2:australia/x22-queensland")).toBe("AU");
    expect(rulepackJurisdictionFromId("t2:canada")).toBe("CA");
    expect(rulepackJurisdictionFromId("t2:france-republic-of")).toBe("FR");
    expect(rulepackJurisdictionFromId("t2:germany-federal-republic-of/german-lander")).toBe("DE");
    expect(rulepackJurisdictionFromId("t2:brazil")).toBe("UNKNOWN");
    expect(rulepackJurisdictionFromId("t2:australiax")).toBe("UNKNOWN");
  });
});

describe("D1 effective manual choice (fail-before: new countries were cast to UNKNOWN)", () => {
  it.each(NEW)("$j manual choice keeps its country and preserves non-case input", ({ j, id, raw, type }) => {
    const manual = citationManualChoice(type, id);
    expect(manual?.jurisdiction).toBe(j);
    const c = buildPastedCitation(raw, manual);
    expect(c.route).toBe("preserve");
    expect(c.unsupported).toContain(`rulepack_planned_disabled:${j}`);
    expect(c.jurisdiction).toBe(j);
  });
  it.each(NEW)("$j override through actual runCitation: raw preserved, zero provider/cache/classifier", async ({ j, id, sub, raw, type }) => {
    const r = await runCitation({ rawInput: raw, overrideType: type, manualChoice: citationManualChoice(type, id, sub) });
    expect(citationToPlain(r.citation)).toBe(raw);
    expect(r.status).toBe("warning"); expect(r.warningMsg).toBe(PLANNED_RULEPACK_WARNING);
    expect(r.pastedCitation?.jurisdiction).toBe(j);
    expect(m.invoke).not.toHaveBeenCalled(); expect(m.cache).not.toHaveBeenCalled(); expect(m.classifier).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("wrong manual country cannot erase conflicting US evidence", () => {
    const raw = "Brown v. Board of Education, 347 U.S. 483 (1954)";
    const c = buildPastedCitation(raw, citationManualChoice("foreign_case_other", "t2:australia"));
    expect(c.route).toBe("preserve"); expect(c.conflicts).toContain("manual_jurisdiction_conflict");
    expect(c.evidence.some(e => e.jurisdiction === "US")).toBe(true);
  });
  it("new-country choice never yields a typed lookup request", () => {
    const ev = planCitationEvidence("Mabo v Queensland (No 2) (1992) 175 CLR 1", citationManualChoice("foreign_case_other", "t2:australia"));
    expect(ev.preserve).not.toBeNull();
    expect(planForeignLookup("foreign_case_other", "Mabo v Queensland", null)).toEqual({ kind: "case", jurisdiction: "UNKNOWN" });
  });
});

describe("D1 actual server guard", () => {
  const msg = (raw: string, choice: object) => [{ role: "user", content: `[סיווג שיפוט ידני: ${JSON.stringify(choice)}]\n${raw}` }];
  it.each(NEW)("$j retained manual choice is recognized server-side and preserves", ({ j, raw }) => {
    const c = guardPastedCitationRequest({ messages: msg(raw, { jurisdiction: j, sourceType: "foreign", foreign: true }), rawInput: raw });
    expect(c.manualChoice?.jurisdiction).toBe(j);
    expect(c.route).toBe("preserve"); expect(c.unsupported).toContain(`rulepack_planned_disabled:${j}`);
  });
  it("unknown manual jurisdiction strings are dropped, not cast", () => {
    const c = guardPastedCitationRequest({ messages: msg("Smith v. Jones", { jurisdiction: "NZ" }), rawInput: "Smith v. Jones" });
    expect(c.manualChoice?.jurisdiction).toBeUndefined();
  });
  it("typed lookup jurisdiction outside the existing wire set is rejected", () => {
    const raw = "Mabo v. Queensland";
    const c = guardPastedCitationRequest({ messages: [{ role: "user", content: raw }], rawInput: raw,
      foreignLookup: { enabled: true, kind: "case", jurisdiction: "AU", rawInput: raw, parsedFields: { caseName: raw } } });
    expect(c.route).toBe("preserve"); expect(c.conflicts).toContain("lookup_jurisdiction_unsupported");
  });
  it("unsupported rulepack wire version fails closed; absent stays legacy-compatible", () => {
    const raw = "Brown v. Board of Education";
    const wire = buildPastedCitation(raw);
    expect(guardPastedCitationRequest({ messages: [{ role: "user", content: raw }], rawInput: raw, pastedCitation: wire }).route).toBe("foreign");
    const bad = guardPastedCitationRequest({ messages: [{ role: "user", content: raw }], rawInput: raw, pastedCitation: { ...wire, rulepackVersion: 9 } });
    expect(bad.route).toBe("preserve"); expect(bad.conflicts).toContain("rulepack_version_unsupported");
  });
  it("server recomputes evidence: forged wire jurisdiction cannot authorize", () => {
    const raw = "Code civil art. 1240";
    const forged = { ...buildPastedCitation(raw), jurisdiction: "US", route: "foreign", manualChoice: { jurisdiction: "FR" } };
    const c = guardPastedCitationRequest({ messages: [{ role: "user", content: raw }], rawInput: raw, pastedCitation: forged });
    expect(c.route).toBe("preserve"); expect(c.jurisdiction).toBe("FR");
  });
});

describe("D1 natural German docket safeguards", () => {
  it.each(["BGH, Urteil vom 12. März 2020 – VI ZR 123/19", "BGHZ 123, 45", "BGH VI ZR 400/51 — C## x^^2"])("%s routes DE preserve, never Israeli lookup", async raw => {
    const c = buildPastedCitation(raw);
    expect(c.jurisdiction).toBe("DE"); expect(c.route).toBe("preserve");
    const r = await runCitation({ rawInput: raw });
    expect(citationToPlain(r.citation)).toBe(raw);
    expect(m.invoke).not.toHaveBeenCalled(); expect(m.classifier).not.toHaveBeenCalled();
  });
});

describe("D1 spans and literal markers", () => {
  it("evidence spans index the original Unicode raw", () => {
    const raw = "🙂 הערה: Mabo v Queensland ##x^^ BVerfG";
    const c = buildPastedCitation(raw, citationManualChoice("foreign", "t2:australia"));
    const e = c.evidence.find(x => x.signal === "court")!;
    expect(raw.slice(e.span.start, e.span.end)).toBe("BVerfG");
    expect(c.rawInput).toBe(raw);
  });
  it("preserved output escapes literal ## and ^^", async () => {
    const raw = "Code civil ##art.^^ 1240";
    const r = await runCitation({ rawInput: raw, overrideType: "foreign", manualChoice: citationManualChoice("foreign", "t2:france-republic-of") });
    expect(citationToPlain(r.citation)).toBe(raw); expect(r.citation).not.toBe(raw);
    expect(m.invoke).not.toHaveBeenCalled();
  });
});

describe("D1 manifest metadata accuracy", () => {
  const byId = (id: string) => RULEPACK_MANIFEST.find(e => e.id === id);
  it("constitution is US-scoped, not general", () => {
    expect(byId("general.constitution")).toBeUndefined();
    expect(byId("us.constitution")).toMatchObject({ jurisdiction: "US", status: "enabled", completion: null });
  });
  it("US reported and unreported templates have distinct required fields", () => {
    expect(byId("us.case.reported")?.requiredFields).toEqual(expect.arrayContaining(["volume", "reporter", "firstPage"]));
    expect(byId("us.case.unreported")?.requiredFields).not.toEqual(expect.arrayContaining(["volume"]));
    expect(byId("us.case.unreported")?.requiredFields).toEqual(expect.arrayContaining(["docket", "decisionDate"]));
    expect(byId("us.case.unreported")?.completion).toBeNull();
  });
  it("CA neutral and standalone S.C.R. are distinct; FR Bulletin needs part/decision number", () => {
    expect(byId("ca.case.scc_neutral")?.requiredFields).toContain("neutral");
    expect(byId("ca.case.scr")?.requiredFields).not.toContain("neutral");
    const fr = byId("fr.case.cass")!;
    expect(fr.requiredFields).toEqual(expect.arrayContaining(["bulletinPart", "decisionNumber"]));
    expect(fr.requiredFields).not.toEqual(expect.arrayContaining(["volume"]));
    expect(fr.requiredFields).not.toEqual(expect.arrayContaining(["firstPage"]));
  });
});
