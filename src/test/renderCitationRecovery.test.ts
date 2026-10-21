import { describe, expect, it, vi } from "vitest";
import type { CitationRecoveryRecord } from "@/lib/citationRecoveryApi";
import { citationRecoveryDeadline, renderCitationRecovery, recoveryInputText, recoveryInputTruncated, recoveryPlainText, RECOVERY_TEXT_LIMIT } from "@/lib/renderCitationRecovery";
import { C2_WIRE, c2WirePayload } from "./fixtures/c2WirePayload";

const now = Date.UTC(2026, 9, 13, 12);
function record(patch: Partial<CitationRecoveryRecord> = {}): CitationRecoveryRecord {
  return { requestId: "recovered-request", retryOfRequestId: null, status: "succeeded", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(), availability: "available",
    input: { rawInput: null, messages: [{ role: "user", content: "Prepared prompt" }], batchId: null, foreignLookup: null },
    result: { content: "Generic preserved response" }, refundReceipt: { status: "retained", refunded: false, units_refunded: 0, request_id: "recovered-request" }, ...patch };
}
function article(): CitationRecoveryRecord {
  return record({ input: { messages: [{ role: "user", content: "Prepared prompt must not become citation context" }], rawInput: null, batchId: null,
    foreignLookup: { kind: "journal_article", jurisdiction: "OTHER", rawInput: "Warren & Brandeis, The Right to Privacy, pp. 213–214.", parsedFields: { authors: "Warren & Brandeis", articleTitle: "The Right to Privacy", pinpoint: "213–214" } } },
    result: { foreignLookup: { fields: { authors: "Samuel D. Warren and Louis D. Brandeis", articleTitle: "Provider title must not replace the original", volume: "4", journal: "Harvard Law Review", firstPage: "193", year: "1890", pinpoint: "999" }, identity: { matched: true }, articleResolution: "resolved" } } });
}

describe("pure recovery renderer", () => {
  it.each(["raw", "kind", "manual", "wire", "forged_local", "provider_local"])("C2 retained %s cannot manufacture supplied fields", async mode => {
    const f = C2_WIRE[0];
    const { plan, response } = await c2WirePayload(f);
    const request = structuredClone(plan.foreignLookup);
    if (!request) throw new Error("Missing request");
    const r = record({ input: { rawInput: f.raw, messages: [{ role: "user", content: f.raw }], foreignLookup: request, batchId: null },
      result: { foreignLookup: structuredClone(response) as unknown as Record<string, unknown> } });
    if (mode === "raw") request.rawInput = "Author: Jane Doe; Book: Other Collection; Original year: 1901";
    if (mode === "kind") request.kind = "book_chapter";
    if (mode === "manual" && r.input) r.input.messages[0].content = `[סיווג שיפוט ידני: {"sourceType":"foreign_case_us","jurisdiction":"US"}]\n${f.raw}`;
    if (mode === "wire") request.parsedFields = { ...(request.parsedFields as object), year: "2099" };
    if (mode === "forged_local") Object.assign(request, { localFields: { originalYear: "2099", publisher: "Forged Press" }, localSourceFields: { originalYear: { value: "2099", spans: [] } } });
    if (mode === "provider_local" && r.result?.foreignLookup) r.result.foreignLookup.fields = { ...response.fields, originalYear: "2099", publisher: "Forged Press" };
    const fetch = vi.fn(() => { throw new Error("No recovery IO"); });
    vi.stubGlobal("fetch", fetch);
    try {
      const rendered = renderCitationRecovery(r, now);
      expect(rendered?.plainText).toContain("1901");
      expect(rendered?.plainText).not.toContain("2099");
      expect(rendered?.plainText).not.toContain("Forged Press");
      if (["raw", "kind", "manual", "wire"].includes(mode)) {
        expect(rendered?.warning).toContain("אינם תואמים");
        expect(rendered?.completion).toBeUndefined();
      } else expect(rendered?.completion?.suppliedFields?.originalYear?.value).toBe("1901");
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("renders structured-only articles from original parsed fields and existing deterministic formatters", () => {
    const fetch = vi.fn(() => { throw new Error("No network"); });
    vi.stubGlobal("fetch", fetch);
    const rendered = renderCitationRecovery(article(), now)!;
    expect(rendered.structured).toBe(true);
    // C1 older ungrounded payloads remain readable, but never complete fields.
    expect(rendered.formattedOutput).toContain("Warren & Brandeis");
    expect(rendered.formattedOutput).toContain("The Right to Privacy");
    expect(rendered.formattedOutput).toContain("[חסר: עמוד], 213–214");
    expect(rendered.warning).toBeTruthy();
    expect(rendered.formattedOutput).not.toContain("Provider title");
    expect(rendered.plainText).not.toContain("##");
    expect(recoveryInputText(article())).toBe("Warren & Brandeis, The Right to Privacy, pp. 213–214.");
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("retains missing-field/conflict warnings without fabricating complete output", () => {
    const incomplete = article();
    incomplete.result = { foreignLookup: { fields: {}, identity: { matched: false, conflicts: ["year"] }, articleResolution: "conflict" } };
    const rendered = renderCitationRecovery(incomplete, now)!;
    expect(rendered.formattedOutput).toContain("[חסר:");
    expect(rendered.formattedOutput).toContain("213–214");
    expect(rendered.warning).toBeTruthy();
    expect(rendered.formattedOutput).toContain("אינה בפורמט נתמך");
  });

  it("renders structured-only cases with original name/year/pinpoint taking precedence", () => {
    const r = record({ input: { messages: [{ role: "user", content: "Prepared case" }], rawInput: null, batchId: null,
      foreignLookup: { kind: "case", jurisdiction: "UNKNOWN", parsedFields: { caseName: "Capitol Records, LLC v. ReDigi Inc.", year: "2018", court: "2d Cir.", pinpoint: "655" } } },
      result: { foreignLookup: { identity: { matched: true, jurisdiction: "US" }, fields: { caseName: "Wrong replacement", volume: "910", reporter: "F.3d", firstPage: "649", year: "2020", pinpoint: "999" } } } });
    const rendered = renderCitationRecovery(r, now)!;
    expect(rendered.plainText).toContain("Capitol Records, LLC v. ReDigi Inc.");
    expect(rendered.plainText).toContain("910 F.3d 649, 655 (2d Cir. 2018)");
    expect(rendered.plainText).not.toContain("999");
  });

  it("roundtrips UK reporter aliases from original fields without losing the supplied volume/series", () => {
    const r = record({ input: { messages: [{ role: "user", content: "Prepared UK case" }], rawInput: null, batchId: null,
      foreignLookup: { kind: "case", jurisdiction: "UK", parsedFields: { caseName: "Caparo Industries plc v. Dickman", year: "1990", court: "HL", ukVolume: "2", ukSeries: "AC", firstPage: "605", pinpoint: "610" } } },
      result: { foreignLookup: { identity: { matched: true, jurisdiction: "UK" }, fields: { reporter: "WLR", reporterVolume: "5", firstPage: "999", year: "2020" } } } });
    const rendered = renderCitationRecovery(r, now)!;
    expect(rendered.plainText).toContain("[1990] 2 AC 605, 610 (HL)");
    expect(rendered.plainText).not.toContain("WLR");
    r.input!.foreignLookup!.parsedFields = { caseName: "Case v. Case", ukSeries: "AC", reporter: "WLR" };
    expect(renderCitationRecovery(r, now)).toBeNull();
  });

  it("does not invent a citation from unbound structured results or unusable shapes", () => {
    const missingContext = article(); missingContext.input = null;
    expect(renderCitationRecovery(missingContext, now)).toBeNull();
    const invalid = article(); invalid.input!.foreignLookup!.parsedFields = { articleTitle: "x".repeat(4001) };
    expect(renderCitationRecovery(invalid, now)).toBeNull();
    const unknownCase = record({ input: { messages: [], rawInput: null, batchId: null, foreignLookup: { kind: "case", jurisdiction: "UNKNOWN", parsedFields: {} } }, result: { foreignLookup: { identity: { matched: true }, fields: { caseName: "Case v. Case" } } } });
    expect(renderCitationRecovery(unknownCase, now)).toBeNull();
  });

  it("caps retention to 24 hours from claim creation and never renders expired/unknown/pending/failed content", () => {
    const r = record({ expiresAt: new Date(now + 172_800_000).toISOString() });
    expect(citationRecoveryDeadline(r)).toBe(now + 86_400_000);
    expect(renderCitationRecovery(r, now + 86_400_000)).toBeNull();
    for (const status of ["unknown", "in_progress", "failed"] as const) expect(renderCitationRecovery(record({ status }), now)).toBeNull();
    expect(renderCitationRecovery(record({ availability: "expired" }), now)).toBeNull();
    expect(renderCitationRecovery(record({ createdAt: "invalid" }), now)).toBeNull();
  });

  it("keeps generic content as inert plain text and removes direction/control characters", () => {
    const rendered = renderCitationRecovery(record({ result: { content: "<script>alert(1)</script>\u0000\u202eText\nNext" } }), now)!;
    expect(rendered.structured).toBe(false);
    expect(rendered.plainText).toBe("<script>alert(1)</script>Text\nNext");
    expect(recoveryPlainText({ unsafe: "object" })).toBe("");
  });

  it("bounds generic output and marks truncation so UI cannot save a partial result", () => {
    const rendered = renderCitationRecovery(record({ result: { content: "x".repeat(RECOVERY_TEXT_LIMIT + 10) } }), now)!;
    expect(rendered.plainText).toHaveLength(RECOVERY_TEXT_LIMIT);
    expect(rendered.truncated).toBe(true);
    expect(rendered.warning).toContain("חלק");
  });

  it("labels bounded input previews rather than silently claiming the whole input was displayed", () => {
    const r = record(); r.input!.rawInput = "x".repeat(RECOVERY_TEXT_LIMIT + 1);
    expect(recoveryInputText(r)).toHaveLength(RECOVERY_TEXT_LIMIT);
    expect(recoveryInputTruncated(r)).toBe(true);
  });

  it("preserves disambiguation as bounded text without activating supplied URLs", () => {
    const r = article();
    r.result = { foreignLookup: { disambiguation: [
      { label: "Case A", jurisdiction: "US", url: "javascript:alert(1)" },
      { label: "Case B", jurisdiction: "UK", url: "https://example.invalid/case" },
    ] } };
    const rendered = renderCitationRecovery(r, now)!;
    expect(rendered.structured).toBe(true);
    expect(rendered.plainText).toContain("The Right to Privacy");
    expect(rendered.warning).toContain("אינה בפורמט נתמך");
    expect(rendered.plainText).not.toContain("javascript:");
  });
});
