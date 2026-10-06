// Handler-contract tests: execute the real TSX component functions with a tiny
// hook/element harness. No DOM or provider is involved. runPool, telemetry ids,
// repeat rules and answer re-rendering use the production implementations.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import * as telemetry from "@/lib/costTelemetry";
import * as concurrency from "@/lib/concurrency";
import * as repeatRules from "@/lib/footnoteRepeatRules";
import * as footnoteRerender from "@/lib/legalQa/footnoteRerender";
import { CREDIT_COSTS } from "@/lib/creditCosts";

const root = process.env.CITATION_PANEL_BASELINE_ROOT || resolve(__dirname, "../..");
const describeAttribution = process.env.CITATION_PANEL_BASELINE_ROOT ? describe.skip : describe;
const refillPath = "src/components/legal-qa/CitationReviewPanel.tsx";
const uniformPath = "src/components/legal-research/UniformCitationPanel.tsx";

// jsdom replaces Uint8Array, which breaks esbuild's native TextEncoder invariant.
// Compile the real TSX with the exact installed compiler in a fresh Node realm,
// then execute the same handler harness below. No shell, browser-global patch,
// config change or test stub for the compiler; source travels only over stdin.
const compilerPath = createRequire(import.meta.url).resolve("esbuild");
const compileScript = `const fs = require("node:fs");
const { transformSync } = require(${JSON.stringify(compilerPath)});
process.stdout.write(transformSync(fs.readFileSync(0, "utf8"), {
  loader: "tsx", format: "cjs", target: "es2022", jsxFactory: "element",
}).code);`;
const compiledSources = new Map<string, string>();
function compileComponent(source: string): string {
  const existing = compiledSources.get(source);
  if (existing !== undefined) return existing;
  const code = execFileSync(process.execPath, ["-e", compileScript], {
    input: source, encoding: "utf8", cwd: root, timeout: 5000, maxBuffer: 2 * 1024 * 1024,
  });
  compiledSources.set(source, code);
  return code;
}


type Element = { type: unknown; props: Record<string, unknown>; children: unknown[] };
type Setter = (next: unknown | ((previous: unknown) => unknown)) => void;
const element = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element =>
  ({ type, props: props || {}, children: children.flat(Infinity) });

function mount(path: string, name: string, props: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const states: unknown[] = [];
  let cursor = 0;
  const modules: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const slot = cursor++;
        if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
        const set: Setter = (next) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; };
        return [states[slot], set];
      },
      useMemo: (factory: () => unknown) => factory(),
      useCallback: (callback: unknown) => callback,
    },
    sonner: { toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
    "@/lib/costTelemetry": telemetry,
    "@/lib/concurrency": concurrency,
    "@/lib/footnoteRepeatRules": repeatRules,
    "@/lib/legalQa/footnoteRerender": footnoteRerender,
    "@/lib/creditCosts": { CREDIT_COSTS },
    "@/components/FootnoteReviewCard": { FootnoteReviewCard: "FootnoteReviewCard" },
    "./CitationReviewCard": { CitationReviewCard: "CitationReviewCard" },
    "@/components/ui/button": { Button: "Button" },
    "@/hooks/useOffice": { useOffice: () => ({ isOfficeAddin: false, hasDocumentAccess: false }) },
    "@/hooks/useProjects": { useProjects: () => ({ currentProject: { id: "project-unchanged" } }) },
    "@/lib/citationRichText": { copyCitationRich: vi.fn(), copyCitationsRich: vi.fn() },
    "@/lib/wordInsertion": { insertCitationAsFootnote: vi.fn() },
    ...overrides,
  };
  const code = compileComponent(readFileSync(resolve(root, path), "utf8"));
  const module = { exports: {} as Record<string, (props: Record<string, unknown>) => Element> };
  // Only the known local component source is evaluated; imports must be mocked
  // explicitly so accidental provider, database or browser work fails closed.
  new Function("require", "module", "exports", "element", code)((id: string) => {
    if (!(id in modules)) throw new Error(`Unexpected component dependency: ${id}`);
    return modules[id];
  }, module, module.exports, element);
  return {
    render() { cursor = 0; return module.exports[name](props); },
    modules,
  };
}

function all(node: unknown): Element[] {
  if (!node || typeof node !== "object" || !("children" in node)) return [];
  const e = node as Element;
  return [e, ...e.children.flatMap(all)];
}
function card(tree: Element, type: string, index = 0): Record<string, unknown> {
  return all(tree).filter((e) => e.type === type)[index].props;
}
function button(tree: Element, text: string): () => Promise<void> {
  const e = all(tree).find((e) => (e.type === "button" || e.type === "Button") && e.children.includes(text));
  if (!e) throw new Error(`Button missing: ${text}`);
  return e.props.onClick as () => Promise<void>;
}
const call = (props: Record<string, unknown>, key: string, ...args: unknown[]) =>
  (props[key] as (...args: unknown[]) => Promise<void>)(...args);
const cell = (props: Record<string, unknown>) => props.cell as Record<string, unknown>;
const withoutTelemetry = (value: Record<string, unknown>) => Object.fromEntries(
  Object.entries(value).filter(([key]) => !["telemetry", "telemetryFeature", "telemetryBatchId", "telemetryRequestId"].includes(key)),
);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertMetadata(t: Record<string, unknown>, feature: string, wire = false) {
  expect(Object.keys(t).sort()).toEqual((wire
    ? ["telemetryFeature", "telemetryBatchId", "telemetryRequestId"]
    : ["feature", "telemetryBatchId", "telemetryRequestId"]).sort());
  expect(t[wire ? "telemetryFeature" : "feature"]).toBe(feature);
  expect(t.telemetryBatchId).toMatch(uuid);
  expect(t.telemetryRequestId).toMatch(uuid);
  expect(t.telemetryBatchId).not.toBe(t.telemetryRequestId);
}
function wireMetadata(body: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(body).filter(([key]) => key.startsWith("telemetry")));
}

const originalFootnotes = [{ number: 1, citation: 'בג"ץ 1000/92 מקור פרטי', source_type: "case_law_database", url: "https://example.invalid/private", source: "local" }];
function review(invoke = vi.fn(async () => ({ data: { ok: true, updated_citation: "אזכור מעודכן", filled_count: 2 }, error: null })), overrides: Record<string, unknown> = {}) {
  const onApply = vi.fn();
  const onCancel = vi.fn();
  const instance = mount(refillPath, "CitationReviewPanel", { answer: "תשובה פרטית¹", footnotes: originalFootnotes, onApply, onCancel }, {
    "@/integrations/supabase/client": { supabase: { functions: { invoke } } }, ...overrides,
  });
  return { ...instance, invoke, onApply, onCancel };
}
const notes = [
  { number: 1, title: "מקור פרטי ראשון", url: "https://example.invalid/one" },
  { number: 2, title: "מקור פרטי שני", sources: [{ title: "כותרת מורכבת", url: "https://example.invalid/two" }] },
];
const result = (reply = "אזכור מעובד תקין") => ({ reply, citation: reply, status: "valid", sourceType: "case_law_database", fromVerifiedStore: false });
function uniform(runCitation = vi.fn(async () => result()), overrides: Record<string, unknown> = {}) {
  const instance = mount(uniformPath, "UniformCitationPanel", { footnotes: notes }, {
    "@/lib/runCitation": { runCitation }, ...overrides,
  });
  return {
    ...instance, runCitation,
    async start() {
      await button(instance.render(), "יצירת הערות שוליים לפי כללי האזכור האחיד")();
      await button(instance.render(), "המשך")();
    },
  };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("citation panel action/payload/output parity", () => {
  it("refills exactly once with the original non-telemetry body and applies the same answer", async () => {
    const p = review();
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 0);
    expect(p.invoke).toHaveBeenCalledTimes(1);
    const [name, options] = p.invoke.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
    expect(name).toBe("citation-refill");
    expect(withoutTelemetry(options.body)).toEqual({ current_citation: originalFootnotes[0].citation, source_type: "case_law_database", missing_fields: [] });
    expect(options.body).not.toHaveProperty("batchId");
    expect(options.body).not.toHaveProperty("requestId");
    const current = cell(card(p.render(), "CitationReviewCard"));
    expect(current).toMatchObject({ citation: "אזכור מעודכן", refilling: false, refillNote: "הושלמו 2 שדות", refillError: undefined });
    await button(p.render(), "עדכן תשובה")();
    expect(p.onApply).toHaveBeenCalledWith(footnoteRerender.rerenderAnswer("תשובה פרטית¹", [{
      originalNumber: 1, citation: "אזכור מעודכן", source_type: "case_law_database", url: originalFootnotes[0].url, source: "local", removed: false,
    }]));
  });

  it("keeps refill failure behavior and invalid ids do no work", async () => {
    const invoke = vi.fn(async () => ({ data: null, error: new Error("existing failure") }));
    const p = review(invoke as never);
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 90);
    expect(invoke).not.toHaveBeenCalled();
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 0);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(cell(card(p.render(), "CitationReviewCard"))).toMatchObject({ citation: originalFootnotes[0].citation, refilling: false, refillError: "שגיאה: existing failure" });
  });

  it("does no work before confirmation and preserves V2 inputs, options and outputs", async () => {
    const p = uniform();
    await button(p.render(), "יצירת הערות שוליים לפי כללי האזכור האחיד")();
    expect(p.runCitation).not.toHaveBeenCalled();
    await button(p.render(), "ביטול")();
    expect(p.runCitation).not.toHaveBeenCalled();
    await p.start();
    expect(p.runCitation).toHaveBeenCalledTimes(2);
    const calls = p.runCitation.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls.map(([opts]) => withoutTelemetry(opts))).toEqual([
      { rawInput: "מקור פרטי ראשון — https://example.invalid/one", overrideType: undefined, projectId: "project-unchanged", useVerifiedStore: true },
      { rawInput: "כותרת מורכבת — https://example.invalid/two", overrideType: undefined, projectId: "project-unchanged", useVerifiedStore: true },
    ]);
    for (const [opts] of calls) expect(opts).not.toHaveProperty("batchId");
    expect(cell(card(p.render(), "FootnoteReviewCard", 0))).toMatchObject({ output: result().reply, status: "valid", approved: false });
    expect(cell(card(p.render(), "FootnoteReviewCard", 1))).toMatchObject({ output: result().reply, status: "valid", approved: false });
  });

  it("regeneration preserves edited input/type and returns the same output", async () => {
    const p = uniform();
    await p.start();
    await call(card(p.render(), "FootnoteReviewCard"), "onInputChange", 1, "קלט ערוך");
    await call(card(p.render(), "FootnoteReviewCard"), "onSourceTypeChange", 1, "book");
    await call(card(p.render(), "FootnoteReviewCard"), "onRegenerate", 1);
    expect(p.runCitation).toHaveBeenCalledTimes(3);
    const opts = (p.runCitation.mock.calls as unknown as Array<[Record<string, unknown>]>)[2][0];
    expect(withoutTelemetry(opts)).toEqual({ rawInput: "קלט ערוך", overrideType: "book", projectId: "project-unchanged", useVerifiedStore: true });
    expect(cell(card(p.render(), "FootnoteReviewCard"))).toMatchObject({ output: result().reply, status: "valid" });
  });

  it("retains automatic retry count and never retries insufficient-credit failures", async () => {
    vi.useFakeTimers();
    const runCitation = vi.fn()
      .mockRejectedValueOnce({ code: "HTTP_503" })
      .mockRejectedValueOnce({ code: "HTTP_503", isInsufficientCredits: true })
      .mockResolvedValueOnce(result());
    const p = uniform(runCitation);
    const start = p.start();
    await vi.runAllTimersAsync();
    await start;
    expect(runCitation).toHaveBeenCalledTimes(3);
    expect(cell(card(p.render(), "FootnoteReviewCard", 0))).toMatchObject({ output: result().reply, status: "valid" });
    expect(cell(card(p.render(), "FootnoteReviewCard", 1))).toMatchObject({ output: null, status: "error", originalCitation: notes[1].title });
  });

  it("retains unverified refill warnings", async () => {
    const p = review(vi.fn(async () => ({ data: { ok: true, updated_citation: "אזכור עם אזהרה", verified: false, warning: "לא אומת" }, error: null })) as never);
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 0);
    expect(cell(card(p.render(), "CitationReviewCard"))).toMatchObject({ citation: "אזכור עם אזהרה", refillError: "⚠ לא אומת", refillNote: undefined, refilling: false });
  });
});

describeAttribution("citation panel metadata attribution", () => {
  it("creates fresh metadata-only refill action/source ids on each intentional retry", async () => {
    const p = review();
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 0);
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 0);
    const calls = p.invoke.mock.calls as unknown as Array<[string, { body: Record<string, unknown> }]>;
    const metadata = calls.map(([, opts]) => wireMetadata(opts.body));
    metadata.forEach((t) => assertMetadata(t, "refill", true));
    expect(metadata[0].telemetryBatchId).not.toBe(metadata[1].telemetryBatchId);
    expect(metadata[0].telemetryRequestId).not.toBe(metadata[1].telemetryRequestId);
    expect(JSON.stringify(metadata)).not.toContain("פרטי");
    expect(JSON.stringify(metadata)).not.toContain("example.invalid");
  });

  it("allocates a fresh refill action after an earlier request failed", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({ data: null, error: new Error("existing failure") })
      .mockResolvedValueOnce({ data: { ok: true, updated_citation: "אזכור אחרי ניסיון חוזר" }, error: null });
    const p = review(invoke);
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 0);
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 0);
    expect(invoke).toHaveBeenCalledTimes(2);
    const first = wireMetadata(invoke.mock.calls[0][1].body);
    const second = wireMetadata(invoke.mock.calls[1][1].body);
    expect(first.telemetryBatchId).not.toBe(second.telemetryBatchId);
    expect(first.telemetryRequestId).not.toBe(second.telemetryRequestId);
    expect(cell(card(p.render(), "CitationReviewCard"))).toMatchObject({ citation: "אזכור אחרי ניסיון חוזר", refillError: undefined });
  });

  it("shares a V2 action id but not source ids; automatic retries retain both ids", async () => {
    vi.useFakeTimers();
    const runCitation = vi.fn().mockRejectedValueOnce({ code: "HTTP_503" }).mockResolvedValue(result());
    const p = uniform(runCitation);
    const start = p.start();
    await vi.runAllTimersAsync();
    await start;
    expect(runCitation).toHaveBeenCalledTimes(3);
    const args = runCitation.mock.calls.map(([opts]) => opts as Record<string, unknown>);
    const attribution = args.map((opts) => opts.telemetry as Record<string, unknown>);
    attribution.forEach((t) => assertMetadata(t, "uniform_citation"));
    expect(new Set(attribution.map((t) => t.telemetryBatchId)).size).toBe(1);
    expect(attribution[0].telemetryRequestId).not.toBe(attribution[1].telemetryRequestId);
    expect(attribution[2]).toBe(attribution[0]);
    expect(args[2].rawInput).toBe(args[0].rawInput);
    expect(JSON.stringify(attribution)).not.toContain("פרטי");
    expect(JSON.stringify(attribution)).not.toContain("example.invalid");
  });

  it("regeneration gets a fresh action and source rather than reusing the previous run", async () => {
    const p = uniform();
    await p.start();
    await call(card(p.render(), "FootnoteReviewCard"), "onRegenerate", 1);
    await call(card(p.render(), "FootnoteReviewCard"), "onRegenerate", 1);
    const args = p.runCitation.mock.calls as unknown as Array<[{ telemetry: Record<string, unknown> }]>;
    const ids = [args[0][0].telemetry, args[2][0].telemetry, args[3][0].telemetry];
    ids.forEach((t) => assertMetadata(t, "uniform_citation"));
    expect(new Set(ids.map((t) => t.telemetryBatchId)).size).toBe(3);
    expect(new Set(ids.map((t) => t.telemetryRequestId)).size).toBe(3);
  });

  it.each(["newTelemetryBatch", "sourceTelemetry", "telemetryBody"])("refill still succeeds if %s throws", async (method) => {
    const p = review(undefined, { "@/lib/costTelemetry": { ...telemetry, [method]: () => { throw new Error("optional metadata failed"); } } });
    await call(card(p.render(), "CitationReviewCard"), "onRefill", 0);
    expect(p.invoke).toHaveBeenCalledTimes(1);
    const [, options] = p.invoke.mock.calls[0] as unknown as [string, { body: Record<string, unknown> }];
    expect(options.body).toEqual({ current_citation: originalFootnotes[0].citation, source_type: "case_law_database", missing_fields: [] });
    expect(cell(card(p.render(), "CitationReviewCard"))).toMatchObject({ citation: "אזכור מעודכן", refilling: false });
  });

  it.each(["newTelemetryBatch", "sourceTelemetry"])("V2 start and regeneration still succeed if %s throws", async (method) => {
    const p = uniform(undefined, { "@/lib/costTelemetry": { ...telemetry, [method]: () => { throw new Error("optional metadata failed"); } } });
    await p.start();
    await call(card(p.render(), "FootnoteReviewCard"), "onRegenerate", 1);
    expect(p.runCitation).toHaveBeenCalledTimes(3);
    const calls = p.runCitation.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls.every(([opts]) => opts.telemetry === undefined)).toBe(true);
    expect(cell(card(p.render(), "FootnoteReviewCard"))).toMatchObject({ output: result().reply, status: "valid" });
  });

  it("keeps both sources running if metadata generation fails part way through the batch", async () => {
    let sources = 0;
    const p = uniform(undefined, { "@/lib/costTelemetry": {
      ...telemetry,
      sourceTelemetry: (batch: Parameters<typeof telemetry.sourceTelemetry>[0]) => {
        if (++sources === 2) throw new Error("optional second source id failed");
        return telemetry.sourceTelemetry(batch);
      },
    } });
    await p.start();
    expect(p.runCitation).toHaveBeenCalledTimes(2);
    const calls = p.runCitation.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(calls.every(([opts]) => opts.telemetry === undefined)).toBe(true);
    for (const index of [0, 1]) expect(cell(card(p.render(), "FootnoteReviewCard", index))).toMatchObject({ output: result().reply, status: "valid" });
  });

  it("does not add provider calls, telemetry event calls, logs or billing ids in the panels", () => {
    for (const path of [refillPath, uniformPath]) {
      const source = readFileSync(resolve(root, path), "utf8");
      expect(source).not.toMatch(/\bconsole\.(?:log|info|warn|error|debug)\s*\(/);
      expect(source).not.toMatch(/cost-telemetry-event|\bbatchId\s*:|\bfetch\s*\(/);
    }
    expect(readFileSync(resolve(root, refillPath), "utf8").match(/\.invoke\(/g)).toHaveLength(1);
    expect(readFileSync(resolve(root, uniformPath), "utf8").match(/\brunCitation\(/g)).toHaveLength(2);
  });
});
