import { describe, expect, it } from "vitest";
import { buildPastedCitation, guardPastedCitationRequest, rawCitationFingerprint } from "../../supabase/functions/_shared/pastedCitation";
import { preparePastedCitation, citationManualChoice, pastedCaseRequest, renderPastedCaseResponse } from "@/lib/pastedCitationAdapter";
const DE = "BVerfG, Urteil vom 15. Januar 1958, 1 BvR 400/51, BVerfGE 7, 198";
const US = "Brown v. Board of Education, 347 U.S. 483 (1954)";
describe("batch A pure supplied-evidence contract", () => {
  it("effective book choice conflicts with case shape without manufacturing jurisdiction", () => {
    const raw = "Brown v. Board of Education";
    const p = preparePastedCitation(raw, citationManualChoice("foreign_book"));
    expect(p.contract.jurisdiction).toBe("UNKNOWN"); expect(p.contract.conflicts).toContain("manual_source_kind_conflict");
    expect(pastedCaseRequest(raw, p.contract)).toBeNull(); expect(p.local?.citation).toBe(raw);
  });
  it.each([
    { rawInput: 'ע"א 400/51 כהן נ׳ לוי' }, { rawInput: "Other v. Source" }, { rawInput: null },
    { rawInput: "Brown v. Board of Education", kind: "book" },
    { rawInput: "Brown v. Board of Education", parsedFields: { caseName: "Other v. Source" } },
    { rawInput: "Brown v. Board of Education", parsedFields: { bookTitle: "Brown" } },
  ])("server rejects replaced lookup input/kind/fields: %j", overrides => {
    const raw = "Brown v. Board of Education";
    const c = guardPastedCitationRequest({ rawInput: raw, messages: [{ role: "user", content: raw }],
      foreignLookup: { enabled: true, kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: {}, ...overrides } });
    expect(c.route).toBe("preserve"); expect(c.conflicts.length).toBeGreaterThan(0); expect(c.rawInput).toBe(raw);
  });
  it("canonical equal lookup and documented engine/manual/recovery wrappers remain bound", () => {
    const raw = "Brown v. Board of Education";
    const message = `[סיווג שיפוט ידני: {"sourceType":"foreign_case_us"}]\n[סיווג אוטומטי: פסיקה]\n[תיקון סיווג: המשתמש ציין שמדובר בפסיקה]\n══ מנוע אזכור (test) ══\nדוגמה: Other v. Source\n══════════\n[כלל רלוונטי: 36.4]\n[בחירת תוצאה]\n${raw}\n\n══ מקור מאומת (פסיקה) ══\nאזכור מלא: Other v. Source\n══════════`;
    const c = guardPastedCitationRequest({ rawInput: raw, messages: [{ role: "user", content: message }], foreignLookup: { enabled: true, kind: "case", jurisdiction: "UNKNOWN", rawInput: raw, parsedFields: { caseName: raw } } });
    expect(c.route).toBe("foreign"); expect(c.conflicts).toEqual([]);
  });
  it.each([{ kind: "book" }, { fields: { caseName: "Other v. Source", reporter: "U.S.", volume: "347", firstPage: "483", year: "1954" } }])("matched response cannot change source kind/identity: %j", overrides => {
    const raw = "Brown v. Board of Education"; const p = preparePastedCitation(raw);
    const r = renderPastedCaseResponse(p.contract, pastedCaseRequest(raw, p.contract), { kind: "case", identity: { matched: true, jurisdiction: "US" }, fields: { caseName: raw, reporter: "U.S.", volume: "347", firstPage: "483", year: "1954" }, ...overrides });
    expect(r?.citation).toBe(raw); expect(r?.warningMsg).toBeTruthy();
  });
  it("bounded repeated evidence cannot mask conflicting jurisdictions or discard raw spans", () => {
    const raw = "BVerfG ".repeat(200) + "347 U.S. 483 (1954)";
    const c = buildPastedCitation(raw);
    expect(c.route).toBe("preserve"); expect(c.conflicts).toContain("conflicting_text_jurisdictions");
    expect(c.evidence.length).toBeLessThanOrEqual(128); expect(c.rawInput).toBe(raw);
  });
  it("matched foreign response still cannot cross manual jurisdiction or supplied identity fields", () => {
    const raw = "Brown v. Board of Education";
    const { contract } = preparePastedCitation(raw, { jurisdiction: "US", foreign: true });
    const request = pastedCaseRequest(raw, contract);
    expect(renderPastedCaseResponse(contract, request, { identity: { matched: true, jurisdiction: "UK" }, fields: { caseName: "Wrong", neutral: "UKSC 1", year: "2020" } })?.citation).toBe(raw);
    expect(renderPastedCaseResponse(contract, request, { identity: { matched: true, jurisdiction: "US" }, fields: { caseName: "Wrong", reporter: "U.S.", volume: "347", firstPage: "483", year: "1954" } })?.citation).toContain(raw);
  });
  it("manual choice survives bounded recovery messages without trusting country declarations", () => {
    const manual = { jurisdiction: "IL", sourceType: "case_law_database" };
    const c = guardPastedCitationRequest({ rawInput: DE, messages: [{ role: "user", content: `[סיווג שיפוט ידני: ${JSON.stringify(manual)}]\n${DE}` }] });
    expect(c.route).toBe("preserve"); expect(c.conflicts).toContain("manual_jurisdiction_conflict");
  });
  it.each([
    [DE, "DE", "preserve"], ["BVerfG 1 BvR 400/51", "DE", "preserve"],
    ['ע"א 1234/20 כהן נ׳ לוי (נבו 2.3.2021)', "IL", "israeli"], ['ע"א 1234/20', "IL", "israeli"],
    ["1234/20 כהן נ׳ לוי", "IL", "israeli"], [US, "US", "foreign"],
    ["Brown v. Board of Education", "UNKNOWN", "foreign"], ["400/51", "UNKNOWN", "preserve"],
    ["Some Unknown Court 400/51", "UNKNOWN", "preserve"],
    ["BVerfG 1 BvR 400/51 — הערה", "DE", "preserve"],
  ])("%s routes using text evidence only", (raw, jurisdiction, route) => {
    const c = buildPastedCitation(raw);
    expect(c.jurisdiction).toBe(jurisdiction); expect(c.route).toBe(route); expect(c.identityVerified).toBe(false);
    expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
  it("adapts parser fields with exact original spans, keeps suffix and absent fields unknown", () => {
    const raw = `  ${US} C## Guide: x^^2 & A**B`;
    const c = preparePastedCitation(raw).contract;
    expect(c.fields.year.value).toBe("1954");
    expect(c.fields.decisionDate.value).toBeNull();
    for (const f of Object.values(c.fields)) for (const s of f.spans) {
      expect(s.end).toBeGreaterThan(s.start);
      expect(f.value).toContain(raw.slice(s.start, s.end));
    }
    expect(c.unknownSpans.map(s => raw.slice(s.start,s.end)).join("")).toContain("C## Guide: x^^2 & A**B");
    expect(c.fingerprint).toBe(rawCitationFingerprint(raw));
    expect(c.fingerprint).not.toBe(rawCitationFingerprint(raw.trim()));
  });
  it("contradictory manual and mixed known text produce specific conflict", () => {
    expect(buildPastedCitation(DE, { jurisdiction: "IL" }).conflicts).toContain("manual_jurisdiction_conflict");
    expect(buildPastedCitation('BVerfG 400/51 ע"א 1234/20').conflicts).toContain("conflicting_text_jurisdictions");
    expect(buildPastedCitation('ע"א 1234/20', { foreign: true }).route).toBe("preserve");
  });
  it("unknown numeral manual Israel does not become evidence", () => {
    expect(buildPastedCitation("400/51", { jurisdiction: "IL" }).route).toBe("preserve");
    expect(buildPastedCitation("400/51", { jurisdiction: "DE", foreign: true }).formatter).toBe("unsupported");
  });
  it("UK subunit manual choice is not proof of a complete formatter", () => {
    const c = preparePastedCitation("Alpha v. Beta [2020] UKSC 1", citationManualChoice("foreign_case_other", "t2:united-kingdom", "t2:united-kingdom/scotland"));
    expect(c.contract.route).toBe("preserve"); expect(c.contract.formatter).toBe("unsupported");
    const unknownCountry = preparePastedCitation("Alpha v. Beta", citationManualChoice("foreign_case_other", "t2:canada"));
    expect(unknownCountry.contract.manualChoice?.jurisdictionId).toBe("t2:canada");
    expect(unknownCountry.contract.route).toBe("preserve");
  });
  it("server derives foreign evidence from text despite forged client declaration/rawInput", () => {
    const c = guardPastedCitationRequest({ messages: [{ role: "user", content: DE }], rawInput: 'ע"א 1234/20',
      pastedCitation: { ...buildPastedCitation(DE), jurisdiction: "IL", route: "israeli" } });
    expect(c.route).toBe("preserve"); expect(c.conflicts).toContain("request_text_conflict");
  });
  it("server strips engine examples but retains actual foreign docket", () => {
    const c = guardPastedCitationRequest({ messages: [{ role: "user", content: `[סיווג אוטומטי: פסיקה]\n══ מנוע ══\nע"א 1234/20\n══════════\n${DE}` }] });
    expect(c.jurisdiction).toBe("DE"); expect(c.route).toBe("preserve");
  });
});