/**
 * Stage 5 batch 2 — unpublished manuscripts and dissertations/theses only
 * (general Bluebook 21 R17.2.1–17.2.2). Synthetic fixtures; offline only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectForeignSource, renderForeignCitation } from "@/data/bluebook";
import { detectSourceType } from "@/data/abbreviations";
import { citationToHtml, citationToPlain } from "@/lib/citationRichText";
import { parseCitationSegments } from "@/lib/citationSegments";
import { runCitation } from "@/lib/runCitation";
import { shouldUseLLMClassifier } from "@/lib/sourceTypeClassifier";
import { renderUnpublishedLocal } from "@/lib/unpublishedWorkLocal";
import {
  applyOverride, computeEffective, createRecord, detectClassification, engineRouteFor, isOutputStale, markGenerated,
  planGeneration, reconcileRecord, supportFor,
} from "@/lib/foreignClassification";

const b = vi.hoisted(() => ({ invoke: vi.fn(), classifier: vi.fn(), verified: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: b.invoke }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: b.verified }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: b.classifier } } }));

const MS = "Maya Cohen, Courts and Memory 12–15 (Mar. 2, 2024) (unpublished manuscript) (on file with author)";
const TH = "Maya Cohen, Courts and Memory 12, 15 (2024) (Ph.D. dissertation, Example University) (on file with Example Library)";
const plain = (s: string | undefined) => citationToPlain(s ?? "");

beforeEach(() => {
  vi.clearAllMocks();
  b.verified.mockResolvedValue(null);
  b.classifier.mockResolvedValue({ data: { sourceType: "foreign_book", confidence: 1 }, error: null });
  b.invoke.mockResolvedValue({ data: { content: "GENERIC MODEL OUTPUT" }, errorInfo: null });
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No live network"); }));
});

describe("R17.2.1 manuscript / R17.2.2 thesis — parsing and rendering", () => {
  it.each([[MS, "unpublished_manuscript"], [TH, "thesis"]])("formats %s locally, verbatim and complete", (input, kind) => {
    const r = renderForeignCitation(input);
    expect(r?.detection.kind).toBe(kind);
    expect(r?.missing).toEqual([]);
    expect(plain(r?.citation)).toBe(`${input}.`);
  });
  it("keeps pinpoint ranges and lists distinct", () => {
    expect(detectForeignSource(MS)?.fields).toMatchObject({ pinpoint: "12–15", date: "Mar. 2, 2024", location: "on file with author" });
    expect(detectForeignSource(TH)?.fields).toMatchObject({ pinpoint: "12, 15", date: "2024", workType: "Ph.D. dissertation", institution: "Example University" });
  });
  it("ordinary roman typography: no small caps or italics segments", () => {
    for (const input of [MS, TH]) {
      const segs = parseCitationSegments(renderForeignCitation(input)!.citation);
      expect(segs.every((s) => !s.italic && !s.smallCaps)).toBe(true);
    }
  });
  it("year-only thesis date is not expanded; missing institution reported, not invented", () => {
    const r = renderForeignCitation("Maya Cohen, Courts and Memory (2024) (Ph.D. dissertation)");
    expect(r?.missing).toEqual(["institution"]);
    expect(plain(r?.citation)).toContain("(2024) (Ph.D. dissertation, [חסר: המוסד המעניק])");
    expect(r?.warnings.length).toBeGreaterThan(0);
  });
  it("missing author and date are reported", () => {
    expect(renderForeignCitation("Courts and Memory (unpublished manuscript)")?.missing).toEqual(["authors", "date"]);
  });
  it("preserves author order, diacritics and non-English titles without case changes", () => {
    const input = "Zoë Ångström & Ana Peña, la mémoire des Cours (2023) (unpublished manuscript)";
    const r = renderForeignCitation(input);
    expect(detectForeignSource(input)?.fields).toMatchObject({ authors: "Zoë Ångström & Ana Peña", title: "la mémoire des Cours" });
    expect(plain(r?.citation)).toBe(`${input}.`);
  });
  it("literal ## / ^^ and HTML-looking strings survive plain and rich copy safely", () => {
    const input = "Maya Cohen, C## Guide x^^2 <b>bold</b> (2024) (unpublished manuscript)";
    const c = renderForeignCitation(input)!.citation;
    expect(plain(c)).toBe(`${input}.`);
    const html = citationToHtml(c);
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).not.toMatch(/<i>|small-caps/);
  });
  it("rich and plain output carry equivalent text", () => {
    const c = renderForeignCitation(TH)!.citation;
    const div = document.createElement("div");
    div.innerHTML = citationToHtml(c);
    expect(div.textContent).toBe(plain(c));
  });
  it("a URL stays verbatim and is flagged as unverified", () => {
    const input = `${MS}, https://repo.example.org/x`;
    const r = renderForeignCitation(input);
    expect(plain(r?.citation)).toBe(`${input}.`);
    expect(r?.warnings.join(" ")).toContain("לא אומתו");
  });
  it("trailing year-like number stays in the title with an ambiguity warning", () => {
    const r = renderForeignCitation("Maya Cohen, Courts in 2020 (2024) (unpublished manuscript)");
    expect(detectForeignSource("Maya Cohen, Courts in 2020 (2024) (unpublished manuscript)")?.fields).toMatchObject({ title: "Courts in 2020" });
    expect(r?.warnings.length).toBeGreaterThan(0);
  });
  it("never infers manuscript from a title word or from a repository host", () => {
    expect(detectForeignSource("Maya Cohen, The Unpublished Manuscript of Memory (2024)")?.kind).not.toBe("unpublished_manuscript");
    expect(detectForeignSource("Maya Cohen, A Thesis on Memory (2024), https://repository.example.edu/x")?.kind).not.toBe("thesis");
    expect(detectSourceType("Maya Cohen, Dissertation Notes (2024)")).not.toBe("foreign_thesis");
  });
  it("other Rule 17 types are not recognised", () => {
    for (const t of ["letter", "memorandum", "interview", "working paper", "forthcoming"]) {
      expect(detectForeignSource(`Maya Cohen, Courts and Memory (2024) (${t})`)?.kind ?? "").not.toMatch(/unpublished_manuscript|thesis/);
    }
  });
  it("Hebrew-dominant input is untouched", () => {
    expect(detectForeignSource("מאיה כהן, בתי משפט וזיכרון (2024) (unpublished manuscript)")).toBeNull();
  });
});

describe("R17.2 classification, manual choice and staleness", () => {
  it("detects the exact existing taxonomy subtypes; route supports only these two", () => {
    expect(detectClassification(MS).scalars.subtype?.value).toBe("unpublished_communication.manuscript");
    expect(detectClassification(MS).scalars.publication_status?.value).toBe("unpublished");
    expect(detectClassification(TH).scalars.subtype?.value).toBe("unpublished_communication.thesis");
    expect(detectClassification(TH).scalars.jurisdiction).toBeUndefined();
    const route = (sub: string) => engineRouteFor(computeEffective(detectClassification(""), { scalars: { family: "unpublished_communication", subtype: sub } }));
    expect(route("unpublished_communication.manuscript")).toEqual({ sourceType: "foreign_unpublished_manuscript", supported: true });
    expect(route("unpublished_communication.thesis")).toEqual({ sourceType: "foreign_thesis", supported: true });
    for (const sib of ["unpublished_communication.letter", "unpublished_communication.memo", "unpublished_communication.press_release"]) {
      expect(route(sib)).toEqual({ sourceType: "foreign", supported: false });
    }
  });
  it("manual subtype selects behaviour, marks stale until explicit generation, and input edits re-stale", () => {
    const input = "Maya Cohen, Courts and Memory 12 (2024)";
    let rec = applyOverride(createRecord("chat:p:0", input), { scalars: { family: "unpublished_communication", subtype: "unpublished_communication.manuscript" } });
    expect(isOutputStale(rec)).toBe(true);
    const plan = planGeneration(rec, input)!;
    expect(plan.sourceType).toBe("foreign_unpublished_manuscript");
    expect(supportFor(computeEffective(detectClassification(input), rec.overrides)).status).toBe("renderer_partial");
    rec = markGenerated(rec, plan);
    expect(isOutputStale(rec)).toBe(false);
    const switched = applyOverride(rec, { scalars: { subtype: "unpublished_communication.thesis" } });
    expect(isOutputStale(switched)).toBe(true);
    const edited = reconcileRecord(rec, "chat:p:0", `${input} (on file with author)`);
    expect(edited.overrides.scalars?.subtype).toBe("unpublished_communication.manuscript");
    expect(isOutputStale(edited)).toBe(true);
  });
  it("a plan computed for an older input never certifies a newer one", () => {
    const rec = applyOverride(createRecord("k", MS), { scalars: { family: "unpublished_communication", subtype: "unpublished_communication.manuscript" } });
    const old = planGeneration(rec, MS)!;
    const edited = reconcileRecord(rec, "k", `${MS} (x)`);
    expect(isOutputStale(markGenerated(edited, old))).toBe(true);
  });
  it("manual thesis with no degree label reports it missing instead of inventing", () => {
    const r = renderUnpublishedLocal("foreign_thesis", "Maya Cohen, Courts and Memory (2024)");
    expect(r?.missing).toEqual(["workType", "institution"]);
  });
  it("crossed manual choice preserves input with a mismatch warning", () => {
    const r = renderUnpublishedLocal("foreign_thesis", MS);
    expect(plain(r?.citation)).toBe(MS);
    expect(r?.warningMsg).toContain("אינו תואם");
  });
  it("non-target types are never routed to this renderer", () => {
    for (const t of ["foreign", "foreign_book", "academic_work"] as const) expect(renderUnpublishedLocal(t, MS)).toBeNull();
  });
});

describe("R17.2 shared single/batch pipeline (runCitation) — zero paid work", () => {
  it("complete explicit input skips the classifier", () => {
    expect(shouldUseLLMClassifier(MS, detectSourceType(MS))).toBe(false);
    expect(shouldUseLLMClassifier(TH, detectSourceType(TH))).toBe(false);
  });
  it.each([MS, TH])("renders locally with no classifier/model/network: %s", async (rawInput) => {
    const result = await runCitation({ rawInput, useVerifiedStore: false });
    expect(plain(result.citation)).toBe(`${rawInput}.`);
    expect(result.status).toBe("warning");
    expect(result.reply).toContain("לא אומתו");
    expect(b.invoke).not.toHaveBeenCalled();
    expect(b.classifier).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("manual manuscript override formats unlabeled input locally", async () => {
    const result = await runCitation({ rawInput: "Maya Cohen, Courts and Memory 12 (2024)", overrideType: "foreign_unpublished_manuscript", useVerifiedStore: false });
    expect(plain(result.citation)).toBe("Maya Cohen, Courts and Memory 12 (2024) (unpublished manuscript).");
    expect(b.invoke).not.toHaveBeenCalled();
  });
  it("unsupported sibling override (generic foreign) does not bypass into this renderer", async () => {
    const result = await runCitation({ rawInput: MS, overrideType: "foreign", useVerifiedStore: false });
    expect(b.invoke).toHaveBeenCalled();
    expect(result.status).not.toBe("verified");
  });
});
