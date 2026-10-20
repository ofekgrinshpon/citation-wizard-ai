import { TextEncoder } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderForeignCitation, renderUkCase, stripMarkers } from "@/data/bluebook";
import { runCitation } from "@/lib/runCitation";
import { buildForeignArticleRequest, compatibleArticleCache, mergeForeignArticleCache } from "@/lib/foreignArticleAdapter";
import { renderCitationRecovery } from "@/lib/renderCitationRecovery";
import { citationRecoveryInput, citationRecoveryResult, CITATION_RECOVERY_INPUT_BYTES } from "../../supabase/functions/_shared/citationRecovery";

const boundary = vi.hoisted(() => ({ invoke: vi.fn(), verified: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundary.invoke }));
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: vi.fn(() => { throw new Error("Use explicit synthetic type"); }) }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundary.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", () => ({ telemetryBody: () => ({}), reportZeroWork: vi.fn() }));
vi.mock("@/lib/citationDiagnostic", () => ({ citationDiagnosticBody: () => ({}), observeCitationDiagnostic: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  boundary.verified.mockResolvedValue(null);
  vi.stubGlobal("TextEncoder", TextEncoder);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live calls forbidden"); }));
});
afterEach(() => vi.unstubAllGlobals());

const inputs = [
  "Example v. Sample, 100 F.3d 200, 205 n.5 (2d Cir. 1996)",
  "Example v. Sample, 100 F.3d 200 ¶¶ 23, 25 (2d Cir. 1996)",
  "Example v. Sample, 100 A.2d 200, 205, 50 N.Y.2d 1, 5",
  "Example v. Sample, 100 F.3d 200",
];
const foreignResult = (fields: Record<string, string>) => ({ kind: "case", jurisdiction: "US", fields, grounded: {}, provenance: {}, sources: [],
  identity: { matched: true, anchors: [], conflicts: [], jurisdiction: "US" }, diagnostics: { tier1Queried: false, tier2Fired: false } });

describe("real caller → real recovery contracts → retained renderer", () => {
  it.each(inputs)("accepts the captured request without dropping supplied fields: %s", async (rawInput) => {
    let accepted: ReturnType<typeof citationRecoveryInput> = null;
    boundary.invoke.mockImplementation(async (_name, body) => {
      // The real handler's exact pre-claim projection; only transport is mocked.
      accepted = citationRecoveryInput({ messages: body.messages, rawInput: body.rawInput ?? null,
        foreignLookup: body.foreignLookup ?? null, batchId: null });
      expect(accepted).not.toBeNull();
      expect(accepted?.foreignLookup).toEqual(body.foreignLookup);
      const foreignLookup = foreignResult({ court: "2d Cir.", year: "1996" });
      expect(citationRecoveryResult({ foreignLookup })).not.toBeNull();
      return { data: { foreignLookup }, errorInfo: null };
    });
    const result = await runCitation({ rawInput, overrideType: "foreign_case_us", useVerifiedStore: false });
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    const captured = boundary.invoke.mock.calls[0][1].foreignLookup;
    const parsed = captured.parsedFields;
    for (const key of ["unparsedRemainder", "parallel"]) {
      if (parsed[key]) expect(stripMarkers(result.reply)).toContain(parsed[key].replace(/^[,;]\s*/, ""));
    }
    const now = Date.UTC(2026, 9, 20);
    const recovered = renderCitationRecovery({ requestId: "synthetic-request", retryOfRequestId: null, status: "succeeded",
      createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(), availability: "available",
      input: accepted, result: { foreignLookup: foreignResult({ court: "2d Cir.", year: "1996" }) }, refundReceipt: null }, now);
    expect(recovered?.structured).toBe(true);
    expect(recovered?.plainText).toBe(stripMarkers(result.reply));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("retains named result fields but rejects arbitrary keys, nested values and byte overflow", () => {
    const base = { messages: [{ role: "user", content: "Synthetic citation" }], rawInput: null, batchId: null,
      foreignLookup: { enabled: true, kind: "case", jurisdiction: "US", parsedFields: { parallel: "50 N.Y.2d 1, 5", unparsedRemainder: "n.5" } } };
    expect(citationRecoveryInput(base)).toEqual(base);
    expect(citationRecoveryResult({ foreignLookup: foreignResult(base.foreignLookup.parsedFields) })).not.toBeNull();
    for (const parsedFields of [{ apiKey: "not-allowed" }, { unparsedRemainder: { text: "nested" } }, { parallel: ["nested"] },
      { unparsedRemainder: "x".repeat(CITATION_RECOVERY_INPUT_BYTES) }]) {
      expect(citationRecoveryInput({ ...base, foreignLookup: { ...base.foreignLookup, parsedFields } })).toBeNull();
    }
    expect(citationRecoveryResult({ foreignLookup: foreignResult({ arbitrary: "not-allowed" }) })).toBeNull();
  });
});

describe("bounded metadata gaps", () => {
  it("full date is not misclassified as court or silently lost", () => {
    const r = renderForeignCitation("Example v. Sample, 100 U.S. 200 (Mar. 22, 1996)");
    expect(r?.detection.fields).toMatchObject({ year: "1996", decisionDate: "Mar. 22, 1996" });
    expect((r?.detection.fields as { court?: string }).court).toBeUndefined();
    expect(r?.warnings.join(" ")).toContain("Mar. 22, 1996");
    expect(r?.missing).not.toContain("year");
  });
  it("UK page pinpoint without a reporter is warned, never converted to paragraphs", () => {
    const r = renderUkCase({ caseName: "Example v Sample", neutral: "UKSC 12", year: "2020", pinpoint: "23, 25" });
    expect(r.unrepresented?.join(" ")).toContain("23, 25");
    expect(r.warnings.join(" ")).toContain("23, 25");
    expect(r.citation).not.toContain("[23, 25]");
  });
  it.each(inputs.slice(0, 2))("suffix year is present-but-unrepresented, not absent: %s", (raw) => {
    const r = renderForeignCitation(raw);
    expect(r?.missing).not.toContain("year");
    expect(r?.warnings.join(" ")).not.toContain("חסרה שנת");
    expect(r?.warnings.join(" ")).toContain("1996");
    expect(r?.unrepresented?.length).toBeGreaterThan(0);
  });
  it("regional reporter without court remains honestly warned", () => {
    const r = renderForeignCitation("Example v. Sample, 100 A.2d 200 (1996)");
    expect(r?.warnings.length).toBeGreaterThan(0);
    expect(r?.missing).toContain("court");
  });
  it("constitution section list preserves §§ identity", () => {
    const r = renderForeignCitation("U.S. CONST. art. III, §§ 1, 3");
    expect(stripMarkers(r?.citation ?? "")).toBe("U.S. Const. art. III, §§ 1, 3.");
  });
});

describe("verified and article-cache warning propagation", () => {
  const article = "Ronald H. Coase, The Problem of Social Cost, 3 J.L. & Econ. 1 (1960)";
  it("verified-case hit keeps cached text/identity and unsupported warning state", async () => {
    const rawInput = "Example v. Sample, 100 F.3d 200 (2d Cir. 1996) (Taylor, J., dissenting)";
    boundary.verified.mockResolvedValue({ source_name: rawInput, full_citation: rawInput, source_type: "foreign_case_us" });
    const r = await runCitation({ rawInput, overrideType: "foreign_case_us" });
    expect(r.fromVerifiedStore).toBe(true);
    expect(r.citation).toBe(rawInput);
    expect(r.status).toBe("warning");
    expect(r.reply).toContain("⚠️");
    expect(r.warningMsg).toContain("dissenting");
    expect(boundary.invoke).not.toHaveBeenCalled();
  });
  it("article cache keeps stored suffix and exposes its warning on actual caller", async () => {
    const cached = `${article} (additional supplied metadata)`;
    boundary.verified.mockResolvedValue({ source_name: article, full_citation: cached, source_type: "foreign_journal_article" });
    const r = await runCitation({ rawInput: article, overrideType: "foreign_journal_article" });
    expect(r.fromVerifiedStore).toBe(true);
    expect(r.status).toBe("warning");
    expect(r.reply).toContain("additional supplied metadata");
    expect(r.reply).toContain("⚠️");
    expect(boundary.invoke).not.toHaveBeenCalled();
  });
  it("article cache preserves supplied unsupported suffix without treating it as identity", () => {
    const raw = `${article} (additional supplied metadata)`;
    expect(buildForeignArticleRequest(raw).parsedFields.unparsedRemainder).toContain("additional supplied metadata");
    expect(mergeForeignArticleCache(raw, article)).toContain("additional supplied metadata");
    const candidate = { id: "cached-identity", source_name: article, full_citation: article };
    const compatible = compatibleArticleCache("foreign_journal_article", raw, candidate);
    expect(compatible?.id).toBe("cached-identity");
    expect(compatible?.full_citation).toContain("⚠️");
    expect(compatible?.full_citation).toContain("additional supplied metadata");
    expect(candidate.full_citation).toBe(article);
    expect(mergeForeignArticleCache("Other Author, Other Article", article)).toBeNull();
  });
});