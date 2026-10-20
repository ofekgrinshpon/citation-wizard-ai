import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectForeignSource, renderForeignCitation, renderUsCase } from "@/data/bluebook";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";
import { runCitation } from "@/lib/runCitation";
import { detectClassification, applyOverride, createRecord, computeEffective, effectiveKey } from "@/lib/foreignClassification";

const b = vi.hoisted(() => ({ invoke: vi.fn(), classifier: vi.fn(), verified: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: b.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: b.verified }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: b.classifier } } }));

// All names/locators here are synthetic, not assertions about real decisions.
const SLIP = "Alpha v. Beta, No. 24-CV-017-A, slip op. at 6, 9–11 (D. Mass. Mar. 2, 2024)";
const PENDING = "Alpha v. Beta, No. 24-CV-017-A (D. Mass. filed Mar. 2, 2024)";
const DB = "Alpha v. Beta, No. 24-CV-017-A, 2024 WL 123456, at *3, *7–9 (D. Mass. Mar. 2, 2024)";

beforeEach(() => {
  vi.clearAllMocks();
  b.verified.mockResolvedValue(null);
  b.classifier.mockResolvedValue({ data: { sourceType: "foreign_case_us", confidence: 1 }, error: null });
  b.invoke.mockResolvedValue({ data: { content: "GENERIC MODEL OUTPUT" }, errorInfo: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live network"); }));
});

describe("D1a — bounded synthetic general R10.8.1(a,b) fixtures", () => {
  it.each([SLIP, PENDING, DB])("preserves and locally formats %s", (input) => {
    const r = renderForeignCitation(input);
    expect(r).not.toBeNull();
    expect(citationToPlain(r?.citation ?? "")).toBe(`${input}.`);
    expect(r?.missing).toEqual([]);
    expect(r?.detection.fields).toMatchObject({ docket: "24-CV-017-A", court: "D. Mass.", decisionDate: "Mar. 2, 2024" });
  });
  it("keeps non-separate starting/cited pages distinct, including equal pinpoints", () => {
    const input = "Alpha v. Beta, No. 1:24-CV-017-A, slip op. 6, 6, 9–11 (D. Mass. Mar. 2, 2024)";
    const r = renderForeignCitation(input);
    expect(r?.detection.fields).toMatchObject({ docket: "1:24-CV-017-A", firstPage: "6", pinpoint: "6, 9–11" });
    expect(citationToPlain(r?.citation ?? "")).toBe(`${input}.`);
  });
  it("does not invent a slip pinpoint", () => {
    const input = "Alpha v. Beta, No. 24-CV-017-A, slip op. (D. Mass. Mar. 2, 2024)";
    expect(citationToPlain(renderForeignCitation(input)?.citation ?? "")).toBe(`${input}.`);
  });
  it("locally retains incomplete docket/date with honest warnings", async () => {
    for (const rawInput of [
      "Alpha v. Beta, 2024 WL 123456 (D. Mass. Mar. 2, 2024)",
      "Alpha v. Beta, No. 24-CV-017-A, slip op. at 6 (D. Mass.)",
    ]) {
      const result = await runCitation({ rawInput, useVerifiedStore: false });
      expect(result.status).toBe("warning");
      expect(result.reply).toContain("[חסר:");
      expect(b.invoke).not.toHaveBeenCalled();
    }
  });
  it("does not cross a manual non-US case choice into local US formatting", async () => {
    const result = await runCitation({ rawInput: SLIP, overrideType: "foreign_case_other", useVerifiedStore: false });
    expect(result.citation).not.toBe(`${SLIP}.`);
    expect(b.invoke).toHaveBeenCalledTimes(1);
  });
  it("does not turn a filing date into decision year", () => {
    const f = detectForeignSource(PENDING)?.fields;
    expect(f).toMatchObject({ dateMeaning: "filed", decisionDate: "Mar. 2, 2024" });
    expect((f as { year?: string } | undefined)?.year).toBeUndefined();
    expect(detectClassification(PENDING).scalars.proceeding_status?.value).toBe("pending");
  });
  it("distinguishes paragraph lists from star lists and keeps note suffixes", () => {
    const input = "Alpha v. Beta, No. 24-CV-017-A, 2024 WL 123456, ¶¶ 3, 7–9 n.4 (D. Mass. Mar. 2, 2024)";
    const r = renderForeignCitation(input);
    expect(r?.detection.fields).toMatchObject({ paragraph: "3, 7–9 n.4" });
    expect((r?.detection.fields as { starPinpoint?: string } | undefined)?.starPinpoint).toBeUndefined();
    expect(citationToPlain(r?.citation ?? "")).toBe(`${input}.`);
  });
  it("keeps star lists, ranges and notes without conflating them", () => {
    const input = DB.replace("*7–9", "*7–9 n.4");
    expect(citationToPlain(renderForeignCitation(input)?.citation ?? "")).toBe(`${input}.`);
  });
  it("retains per-curiam/history with an explicit unsupported warning and safe copies", () => {
    const input = `${SLIP} (per curiam), aff'd on other grounds; <script>x</script> C## Guide`;
    const r = renderForeignCitation(input);
    expect(r?.unrepresented?.length).toBeGreaterThan(0);
    expect(r?.warnings.length).toBeGreaterThan(0);
    expect(citationToPlain(r?.citation ?? "")).toContain("(per curiam), aff'd on other grounds; <script>x</script> C## Guide");
    expect(citationToHtml(r?.citation ?? "")).toContain("&lt;script&gt;");
    expect(citationToHtml(r?.citation ?? "")).not.toContain("<script>");
  });
  it.each(["court", "decisionDate", "docket"])("reports missing %s without reporter placeholders", (field) => {
    const f: Record<string, string> = { caseName: "Alpha v. Beta", docket: "24-CV-017-A", databaseIdentifier: "2024 WL 123456", court: "D. Mass.", decisionDate: "Mar. 2, 2024" };
    delete f[field];
    const r = renderUsCase(f);
    expect(r.missing).toEqual([field]);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.missing).not.toContain("reporter");
  });
  it("ambiguous foreign slip form never defaults to US", () => {
    const d = detectForeignSource(SLIP.replace("D. Mass.", "Unknown Tribunal"));
    expect(d?.jurisdiction).not.toBe("US");
    expect(renderForeignCitation(SLIP.replace("D. Mass.", "Unknown Tribunal"))).toBeNull();
    expect(renderForeignCitation(SLIP.replace("D. Mass.", "D. France."))).toBeNull();
  });
  it("uses existing axes while preserving manual choices", () => {
    const detected = detectClassification(DB);
    expect(detected.scalars.subtype?.value).toBe("decision.judgment");
    expect(detected.multi.access_medium?.value).toContain("commercial_database");
    expect(detected.multi.citation_scheme?.value).toContain("document_number");
    const rec = applyOverride(createRecord("synthetic", DB), { scalars: { publication_status: "published", proceeding_status: "unknown" } });
    const e = computeEffective(detected, rec.overrides);
    expect(e.scalars.publication_status).toBe("published");
    expect(e.scalars.proceeding_status).toBe("unknown");
    expect(effectiveKey(e)).not.toBe(effectiveKey(computeEffective(detected, {})));
  });
  it.each([SLIP, PENDING, DB])("real shared single/batch pipeline needs no classifier/provider for %s", async (rawInput) => {
    const result = await runCitation({ rawInput, useVerifiedStore: false });
    expect(citationToPlain(result.citation)).toBe(`${rawInput}.`);
    expect(result.status).not.toBe("verified");
    expect(b.invoke).not.toHaveBeenCalled();
    expect(b.classifier).not.toHaveBeenCalled();
  });
  it("real local pipeline surfaces preserved unsupported tails instead of claiming verification", async () => {
    const result = await runCitation({ rawInput: `${DB} (per curiam)`, useVerifiedStore: false });
    expect(result.status).toBe("warning");
    expect(result.reply).toContain("⚠️");
    expect(result.citation).toContain("(per curiam)");
    expect(b.invoke).not.toHaveBeenCalled();
  });
});