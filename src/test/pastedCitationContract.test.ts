import { describe, expect, it } from "vitest";
import { buildPastedCitation, guardPastedCitationRequest, rawCitationFingerprint } from "../../supabase/functions/_shared/pastedCitation";
import { preparePastedCitation, citationManualChoice } from "@/lib/pastedCitationAdapter";
const DE = "BVerfG, Urteil vom 15. Januar 1958, 1 BvR 400/51, BVerfGE 7, 198";
const US = "Brown v. Board of Education, 347 U.S. 483 (1954)";
describe("batch A pure supplied-evidence contract", () => {
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