/** Synthetic-only regressions: no network, database, or provider calls. */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  checkConfirm, coverageFingerprint, createPendingCoverage, parsePendingCoverage,
} from "../../supabase/functions/legal-research-v2/agent/coverageCheck.ts";

const memo = {
  issue_summary: "Synthetic", unresolved_questions: [],
  claims: [{ claim_id: "C1", proposition: "Synthetic claim", evidence: [{ source_id: "S1", quoted_span: "Synthetic body" }] }],
} as never;
const fixture = () => ({
  readable: [{ source_id: "S1", title: "Synthetic", extracted_text: "Synthetic body", url: "https://example.test/1",
    identity_fields: { dockets: ["A", "B"], sections: ["1", "2"] },
    bibliographic: { title: "Synthetic", year: 2026 }, fetch_error: undefined }],
  quotes: [{ quote_id: "S1-q1", source_id: "S1", text: "Synthetic body", issue: undefined },
    { quote_id: "S1-q2", source_id: "S1", text: "Second quote", issue: undefined }],
  researchCalls: 7,
});
const reordered = (x: unknown): unknown => Array.isArray(x) ? x.map(reordered)
  : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).reverse().map(k => [k, reordered((x as Record<string, unknown>)[k])])) : x;
const pending = (fingerprint: string) => createPendingCoverage({ run_id: "synthetic", memo, read_ids: ["S1"], research_calls_at_check: 7, fingerprint });
const confirm = (p: ReturnType<typeof pending>, fingerprint: string) => checkConfirm({ pending: p, args: { handle: p.handle }, run_id: "synthetic", fingerprint });

// Exported only from the test file so the offline runner exercises the same tests.
describe("canonical coverage fingerprint", () => {
  it("is invariant to recursive JSONB-style key reordering and omitted optional values", () => {
    const a = fixture();
    const b = reordered(JSON.parse(JSON.stringify(a))) as typeof a;
    assert.deepEqual(b, JSON.parse(JSON.stringify(a)));
    assert.equal(coverageFingerprint(a), coverageFingerprint(b));
    assert.match(coverageFingerprint(a), /^[a-f0-9]{64}$/);
    const p = pending(coverageFingerprint(a));
    const restored = parsePendingCoverage(reordered(JSON.parse(JSON.stringify(p))));
    assert.ok(restored);
    assert.equal(confirm(restored, coverageFingerprint(b)).ok, true);
  });
  it("retains the existing source-id order normalization without mutating inputs", () => {
    const a = fixture();
    a.readable.push({ ...a.readable[0], source_id: "S2", extracted_text: "Other body" });
    const b = structuredClone(a); b.readable.reverse();
    const before = structuredClone(b);
    assert.equal(coverageFingerprint(a), coverageFingerprint(b));
    assert.deepEqual(b, before);
  });
  const mutations: Array<[string, (x: ReturnType<typeof fixture>) => void]> = [
    ["body", x => { x.readable[0].extracted_text += " changed"; }],
    ["title", x => { x.readable[0].title += " changed"; }],
    ["URL", x => { x.readable[0].url += "/changed"; }],
    ["identity", x => { x.readable[0].identity_fields.dockets.push("C"); }],
    ["bibliographic metadata", x => { x.readable[0].bibliographic.year++; }],
    ["quote text", x => { x.quotes[0].text += " changed"; }],
    ["quote id", x => { x.quotes[0].quote_id += "changed"; }],
    ["quote source", x => { x.quotes[0].source_id = "S2"; }],
    ["nested array order", x => { x.readable[0].identity_fields.dockets.reverse(); }],
    ["quote array order", x => { x.quotes.reverse(); }],
    ["research count", x => { x.researchCalls++; }],
    ["record removal", x => { x.readable.pop(); }],
    ["quote removal", x => { x.quotes.pop(); }],
  ];
  for (const [name, mutate] of mutations) it(`rejects genuine ${name} changes`, () => {
    const a = fixture(); const p = pending(coverageFingerprint(a));
    mutate(a);
    assert.deepEqual(confirm(p, coverageFingerprint(a)), { ok: false, reason: "evidence_changed", invalidate: true });
  });
  it("distinguishes null, missing, types, empty arrays, and string whitespace", () => {
    const values = [undefined, null, "", " ", false, 0, "0", [], {}, [null]];
    const fingerprints = values.map(extra => coverageFingerprint({ ...fixture(), readable: [{ ...fixture().readable[0], extra }] }));
    assert.equal(new Set(fingerprints).size, values.length);
  });
  it("supports shared non-cyclic references and own special keys without prototype pollution", () => {
    const shared = { b: 2, a: 1 };
    const special = JSON.parse('{"__proto__":{"polluted":true},"constructor":"data","2":"two","10":"ten"}');
    const input = { ...fixture(), readable: [{ ...fixture().readable[0], left: shared, right: shared, special }] };
    assert.equal(coverageFingerprint(input), coverageFingerprint(reordered(JSON.parse(JSON.stringify(input))) as typeof input));
    assert.equal(({} as { polluted?: boolean }).polluted, undefined);
    assert.notEqual(coverageFingerprint(input), "");
  });
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  const sparse = new Array(2); sparse[1] = "x";
  const accessor = Object.defineProperty({}, "x", { enumerable: true, get: () => "x" });
  const extraArray = Object.assign([1], { extra: true });
  const invalids: Array<[string, unknown]> = [
    ["NaN", NaN], ["Infinity", Infinity], ["negative Infinity", -Infinity], ["bigint", 1n],
    ["function", () => 1], ["symbol", Symbol("x")], ["cycle", cycle],
    ["Date", new Date(0)], ["Map", new Map()], ["Set", new Set()],
    ["undefined array slot", [undefined]], ["sparse array", sparse], ["accessor", accessor],
    ["array extra property", extraArray], ["symbol-keyed object", { [Symbol("x")]: 1 }],
  ];
  for (const [name, extra] of invalids) it(`fails closed for ${name}`, () => {
    const fp = coverageFingerprint({ ...fixture(), readable: [{ ...fixture().readable[0], extra }] });
    assert.equal(fp, "");
    const p = pending(fp);
    assert.equal(p.confirmable, false);
    assert.equal(confirm(p, fp).ok, false);
    assert.equal(confirm({ ...p, confirmable: true }, fp).ok, false);
    assert.equal(confirm(pending(coverageFingerprint(fixture())), fp).ok, false);
  });
  for (const researchCalls of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) it(`rejects invalid research count ${researchCalls}`, () => {
    assert.equal(coverageFingerprint({ ...fixture(), researchCalls }), "");
  });
  it("fails closed for malformed outer collections", () => {
    for (const value of [null, undefined, {}, "[]", new Set()]) {
      assert.equal(coverageFingerprint({ ...fixture(), readable: value } as never), "");
      assert.equal(coverageFingerprint({ ...fixture(), quotes: value } as never), "");
    }
  });
  it("preserves run, handle, candidate integrity, and stale-state checks", () => {
    const fp = coverageFingerprint(fixture()); const p = pending(fp);
    assert.equal(checkConfirm({ pending: p, args: { handle: "wrong" }, run_id: "synthetic", fingerprint: fp }).ok, false);
    assert.equal(checkConfirm({ pending: p, args: { handle: p.handle }, run_id: "other", fingerprint: fp }).ok, false);
    assert.equal(checkConfirm({ pending: p, args: { handle: p.handle, memo }, run_id: "synthetic", fingerprint: fp }).ok, false);
    assert.equal(confirm({ ...p, memo_json: JSON.stringify({ ...memo as object, issue_summary: "changed" }) }, fp).ok, false);
    assert.equal(confirm({ ...p, confirmable: false }, fp).ok, false);
    assert.equal(parsePendingCoverage({ ...p, memo_json: "{" }), null);
    assert.equal(confirm(p, fp).ok, true);
  });
});
