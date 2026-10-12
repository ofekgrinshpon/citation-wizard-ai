import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectForeignSource, renderForeignCitation, renderUsStatute } from "@/data/bluebook";
import { extractUkStatute, extractUsStatute } from "@/data/bluebook/extract";
import { runCitation } from "@/lib/runCitation";

const boundaries = vi.hoisted(() => ({ invoke: vi.fn(), classify: vi.fn(), verified: vi.fn(), zero: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: boundaries.invoke }));
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: boundaries.classify }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: boundaries.verified, classifyVerifiedSource: vi.fn(), getVerifiedCategoryLabel: vi.fn() }));
vi.mock("@/lib/refundResponse", () => ({ handleRefundResponse: vi.fn() }));
vi.mock("@/lib/costTelemetry", () => ({ telemetryBody: () => ({}), reportZeroWork: boundaries.zero }));
vi.mock("@/lib/citationDiagnostic", () => ({ citationDiagnosticBody: () => ({}), observeCitationDiagnostic: vi.fn() }));

const supported = [
  ["42 U.S.C. § 1983 (2018)", "42 U.S.C. § 1983 (2018)."],
  ["Sherman Act, 15 U.S.C. §§ 1–7", "Sherman Act, 15 U.S.C. §§ 1–7."],
  ["42 U.S.C. §§ 1981, 1983 (2020)", "42 U.S.C. §§ 1981, 1983 (2020)."],
  ["42 U.S.C. §§ 1981, 1983", "42 U.S.C. §§ 1981, 1983."],
  ["42 U.S.C. § 1981, 1983 (2020).", "42 U.S.C. §§ 1981, 1983 (2020)."],
  ["42 U.S.C. §§ 1981–1983, 1985 (2020)", "42 U.S.C. §§ 1981–1983, 1985 (2020)."],
  ["42 U.S.C. §§ 1981 to 1983, 1985-1986 (2020)", "42 U.S.C. §§ 1981–1983, 1985–1986 (2020)."],
  ["42 U.S.C. §§ 1981(a)(1), 1983(b)(2) (2020)", "42 U.S.C. §§ 1981(a)(1), 1983(b)(2) (2020)."],
  ["42 U.S.C. §§ 1981(a)(1)–1981(a)(3), 1983(b) (2020)", "42 U.S.C. §§ 1981(a)(1)–1981(a)(3), 1983(b) (2020)."],
  ["42 U.S.C. §§ 1981(a)-(b), 1983, 1985(2)–(3) (2018)", "42 U.S.C. §§ 1981(a)–(b), 1983, 1985(2)–(3) (2018)."],
  ["42 U.S.C. § 1983(a)(1) (2020)", "42 U.S.C. § 1983(a)(1) (2020)."],
  ["42 U.S.C.A. §§ 1981, 1983 (2020)", "42 U.S.C.A. §§ 1981, 1983 (2020)."],
  ["42 U.S.C. § 2000e-2(a)(1) (2020)", "42 U.S.C. § 2000e-2(a)(1) (2020)."],
] as const;

const unsupported = [
  "42 U.S.C. §§ 1981,",
  "42 U.S.C. §§ 1981, (2020)",
  "42 U.S.C. §§ 1981,, 1983 (2020)",
  "42 U.S.C. §§ 1981, 1983– (2020)",
  "42 U.S.C. §§ 1981, 1983 to (2020)",
  "42 U.S.C. §§ 1981, 1983(a)( (2020)",
  "42 U.S.C. §§ 1981, 1983) (2020)",
  "42 U.S.C. §§ 1981, 1983 (2020",
  "42 U.S.C. §§ 1981, 1983 (20XX)",
  "42 U.S.C. §§ 1981 and 1983 (2020)",
  "42 U.S.C. §§ 1983, bananas (2018)",
  "42 U.S.C. § 1983 et seq. (2020)",
  "42 U.S.C. §§ 1981, 1983 (2020) unrelated suffix",
  "42 U.S.C. § 1983 (2020) (historical note)",
  "42 U.S.C. § 1983 (2020), https://example.org/source",
  "42 U.S.C. § 1983; 18 U.S.C. § 1001 (2020)",
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unmocked network is forbidden in statute regressions"); }));
});
afterEach(() => vi.unstubAllGlobals());

describe("U.S.C. section preservation", () => {
  it.each(supported)("retains the complete citation: %s", (input, expected) => {
    const rendered = renderForeignCitation(input);
    expect(rendered?.citation).toBe(expected);
    expect(rendered?.missing).toEqual([]);
    expect(rendered?.warnings).toEqual([]);
  });

  it("separates a section list and publication year in structured fields", () => {
    expect(extractUsStatute("42 U.S.C. §§ 1981(a)(1), 1983(b)(2) (2020)")).toMatchObject({
      titleNumber: "42", code: "U.S.C.", sections: ["1981(a)(1)", "1983(b)(2)"], year: "2020",
    });
  });

  it("accepts sections-only structured input without a false missing section", () => {
    expect(renderUsStatute({ titleNumber: "42", code: "U.S.C.", sections: ["1981", "1983"], year: "2020" })).toEqual({
      citation: "42 U.S.C. §§ 1981, 1983 (2020).", missing: [], warnings: [],
    });
    expect(renderUsStatute({ titleNumber: "42", code: "U.S.C.", sections: ["1983"], year: "2020" }).citation).toBe("42 U.S.C. § 1983 (2020).");
    expect(renderUsStatute({ titleNumber: "42", code: "U.S.C.", sections: [] }).missing).toContain("section");
  });

  it.each(unsupported)("declines the complete unsupported or malformed input: %s", (input) => {
    expect(extractUsStatute(input)).toBeNull();
    expect(detectForeignSource(input)).toBeNull();
    expect(renderForeignCitation(input)).toBeNull();
  });
});

describe("U.S.C. citation pipeline boundaries", () => {
  it.each(supported)("uses the local formatter without any provider call: %s", async (rawInput, citation) => {
    const result = await runCitation({ rawInput, overrideType: "foreign_statute_us", useVerifiedStore: false });
    expect(result).toMatchObject({ citation, status: "valid", fromVerifiedStore: false, sourceType: "foreign_statute_us" });
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(boundaries.classify).not.toHaveBeenCalled();
    expect(boundaries.verified).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(unsupported)("passes the whole declined input to the existing fallback: %s", async (rawInput) => {
    const boundary = new Error("Stopped at the mocked citation engine boundary");
    boundaries.invoke.mockRejectedValueOnce(boundary);
    await expect(runCitation({ rawInput, overrideType: "foreign_statute_us", useVerifiedStore: false })).rejects.toBe(boundary);
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
    expect(boundaries.invoke.mock.calls[0][1].messages[0].content.endsWith(rawInput)).toBe(true);
    expect(boundaries.zero).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("existing UK statute grammar consumes the complete input", () => {
  it.each([
    ["Human Rights Act 1998, c. 42", "Human Rights Act 1998, c. 42."],
    ["Human Rights Act 1998, c. 42.", "Human Rights Act 1998, c. 42."],
    ["Human Rights Act 1998, c. 42, s. 1", "Human Rights Act 1998, c. 42, § 1."],
    ["Human Rights Act 1998, c. 42, § 1(2).", "Human Rights Act 1998, c. 42, § 1(2)."],
  ])("preserves the supported UK fast path: %s", async (rawInput, citation) => {
    expect(renderForeignCitation(rawInput)).toMatchObject({ citation, missing: [], warnings: [] });
    expect(await runCitation({ rawInput, overrideType: "foreign_statute_uk", useVerifiedStore: false })).toMatchObject({ citation, status: "valid" });
    expect(boundaries.invoke).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    "Equality Act 2010, c. 15, ss. 13, 19(1)–(2)",
    "Human Rights Act 1998, c. 42, s. 1, 2",
    "Human Rights Act 1998, c. 42, s. 1–3",
    "Human Rights Act 1998, c. 42, s. 1, Another Work",
    "Human Rights Act 1998, c. 42, unrelated suffix",
    "Human Rights Act 1998, c. 42, s. 1, https://example.org/source",
    "Human Rights Act 1998, c. 42, s. 1,",
  ])("declines unsupported UK tails and sends the entire input to fallback: %s", async (rawInput) => {
    expect(extractUkStatute(rawInput)).toBeNull();
    expect(renderForeignCitation(rawInput)).toBeNull();
    const boundary = new Error("Stopped at the mocked citation engine boundary");
    boundaries.invoke.mockRejectedValueOnce(boundary);
    await expect(runCitation({ rawInput, overrideType: "foreign_statute_uk", useVerifiedStore: false })).rejects.toBe(boundary);
    expect(boundaries.invoke).toHaveBeenCalledTimes(1);
    expect(boundaries.invoke.mock.calls[0][1].messages[0].content.endsWith(rawInput)).toBe(true);
    expect(boundaries.zero).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
