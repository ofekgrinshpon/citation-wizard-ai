import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeCitationDiagnostic, citationDiagnosticRequestTag, citationDiagnosticTag,
  CITATION_DIAGNOSTIC_FIXTURE, CITATION_DIAGNOSTIC_BUILD, CITATION_DIAGNOSTIC_PARSER,
  CITATION_DIAGNOSTIC_EXPIRES } from "../../supabase/functions/_shared/citationDiagnosticGate";
import { buildForeignArticleRequest } from "@/lib/foreignArticleAdapter";

const boundary = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: boundary.invoke } } }));
const tag = "relex-en-20261011-0123456789abcdef";
const now = Date.parse("2026-10-11T10:00:00Z");
const fixture = buildForeignArticleRequest(CITATION_DIAGNOSTIC_FIXTURE);
const envelope = () => ({ version: 1, tag, build: CITATION_DIAGNOSTIC_BUILD, parser: CITATION_DIAGNOSTIC_PARSER, phase: "ready" });
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(now); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("temporary citation diagnostic authorization", () => {
  it("defaults off and accepts only the exact expiring fixture contract", async () => {
    const admin = vi.fn(async () => true);
    for (const [request, lookup] of [[undefined, fixture], [{ tag: "arbitrary" }, fixture], [{ tag }, { ...fixture, rawInput: "private other text" }],
      [{ tag }, { ...fixture, parsedFields: { ...fixture.parsedFields, year: "1890" } }], [{ tag }, { ...fixture, parsedFields: {} }]]) {
      expect(await authorizeCitationDiagnostic(request, lookup, admin, now)).toBeNull();
    }
    expect(admin).not.toHaveBeenCalled();
    expect(citationDiagnosticRequestTag({ tag }, fixture, now)).toBe(tag);
    expect(citationDiagnosticTag(tag, CITATION_DIAGNOSTIC_EXPIRES)).toBeNull();
    expect(citationDiagnosticTag(tag, Date.parse("2026-10-10T23:59:59Z"))).toBeNull();
  });
  it("requires a current positive admin result, fails closed on errors, and emits no content", async () => {
    expect(await authorizeCitationDiagnostic({ tag }, fixture, async () => true, now)).toBe(tag);
    expect(await authorizeCitationDiagnostic({ tag }, fixture, async () => false, now)).toBeNull();
    expect(await authorizeCitationDiagnostic({ tag }, fixture, async () => { throw new Error("secret fixture token"); }, now)).toBeNull();
  });
  it("bounds a stalled role read and aborts it", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = authorizeCitationDiagnostic({ tag }, fixture, async (s) => { signal = s; return new Promise(() => {}); }, now);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toBeNull();
    expect(signal?.aborted).toBe(true);
  });
});

describe("diagnostic client readiness and privacy", () => {
  it("makes one preflight only for a valid candidate and activates only after the matching build receipt", async () => {
    const m = await import("@/lib/citationDiagnostic");
    expect(m.citationDiagnosticCandidate(CITATION_DIAGNOSTIC_FIXTURE, false, `?relexCitationTrace=${tag}`)).toBeNull();
    expect(m.citationDiagnosticCandidate("Other input", true, `?relexCitationTrace=${tag}`)).toBeNull();
    expect(m.citationDiagnosticCandidate(CITATION_DIAGNOSTIC_FIXTURE, true, "")).toBeNull();
    expect(m.activeCitationDiagnostic(CITATION_DIAGNOSTIC_FIXTURE, true, `?relexCitationTrace=${tag}`)).toBeUndefined();
    boundary.invoke.mockResolvedValue({ data: { citationDiagnostic: envelope() }, error: null });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await Promise.all([m.prepareCitationDiagnostic(tag), m.prepareCitationDiagnostic(tag)])).toEqual([true, true]);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(boundary.invoke.mock.calls[0]).toEqual(["citation-chat", { body: { foreignLookup: fixture, citationDiagnostic: { tag, preflight: true } } }]);
    expect(m.activeCitationDiagnostic(CITATION_DIAGNOSTIC_FIXTURE, true, `?relexCitationTrace=${tag}`)).toEqual({ tag });
    expect(log.mock.calls).toHaveLength(1);
    expect(String(log.mock.calls[0][0])).not.toContain(CITATION_DIAGNOSTIC_FIXTURE);
  });
  it("does not retry an unsuccessful readiness check or accept a mismatched build", async () => {
    const m = await import("@/lib/citationDiagnostic");
    boundary.invoke.mockResolvedValue({ data: { citationDiagnostic: { ...envelope(), build: "old" } }, error: null });
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await m.prepareCitationDiagnostic(tag)).toBe(false);
    expect(await m.prepareCitationDiagnostic(tag)).toBe(false);
    expect(boundary.invoke).toHaveBeenCalledTimes(1);
    expect(m.activeCitationDiagnostic(CITATION_DIAGNOSTIC_FIXTURE, true, `?relexCitationTrace=${tag}`)).toBeUndefined();
  });
  it("projects console output and rejects arbitrary tag, response and HTTP fields", async () => {
    const m = await import("@/lib/citationDiagnostic");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    m.observeCitationDiagnostic({ tag }, CITATION_DIAGNOSTIC_FIXTURE, "response", {
      server: { ...envelope(), authorization: "secret", answer: "private", url: "https://private.invalid" }, httpStatus: 200,
    });
    const text = String(log.mock.calls[0][0]);
    expect(text).toContain('"phase":"response"');
    expect(text).not.toMatch(/secret|private|authorization|answer|url/);
    m.observeCitationDiagnostic({ tag }, "Other user input", "response", { server: envelope() });
    m.observeCitationDiagnostic({ tag: "unbounded" }, CITATION_DIAGNOSTIC_FIXTURE, "response", { server: envelope() });
    expect(log).toHaveBeenCalledTimes(1);
    expect(m.sanitizeCitationDiagnosticEnvelope({ ...envelope(), tag: "other" }, tag)).toBeNull();
    expect(m.citationDiagnosticBody({ tag }, "Other input")).toEqual({});
  });
  it("never lets console failure interrupt response handling", async () => {
    const m = await import("@/lib/citationDiagnostic");
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("unavailable console"); });
    expect(() => m.observeCitationDiagnostic({ tag }, CITATION_DIAGNOSTIC_FIXTURE, "response", { server: envelope() })).not.toThrow();
  });
});
