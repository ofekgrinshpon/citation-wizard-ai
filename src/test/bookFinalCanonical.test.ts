import { describe, expect, it } from "vitest";
import { canonicalBookContext, frameBookFinal, readBookFinal } from "../../supabase/functions/_shared/citationPure/bookFinal";
import { rawCitationFingerprint } from "../../supabase/functions/_shared/pastedCitation";
import type { CitationRecoveryInput } from "../../supabase/functions/_shared/citationRecovery";
import { C2_WIRE, c2WirePlan } from "./fixtures/c2WirePayload";

function input(): CitationRecoveryInput {
  return { messages: [{ role: "user", content: C2_WIRE[2].raw }, { role: "user", content: C2_WIRE[2].raw }],
    rawInput: C2_WIRE[2].raw, foreignLookup: c2WirePlan(C2_WIRE[2]).foreignLookup ?? null, batchId: null };
}
describe("exact recursive book context serialization", () => {
  it("orders nested object keys only and preserves JSON primitive semantics", () => {
    expect(canonicalBookContext({ z: [true, false, null, 1901, "  Raw\n^^ ", { b: 2, a: 1 }], a: 0 }))
      .toBe('{"a":0,"z":[true,false,null,1901,"  Raw\\n^^ ",{"a":1,"b":2}]}');
    expect(canonicalBookContext({ a: { b: 2, a: 1 } })).toBe(canonicalBookContext({ a: { a: 1, b: 2 } }));
    expect(canonicalBookContext([1, 2])).not.toBe(canonicalBookContext([2, 1]));
    expect(canonicalBookContext("1")).not.toBe(canonicalBookContext(1));
    expect(canonicalBookContext(" Raw ")).not.toBe(canonicalBookContext("Raw"));
  });
  it.each([undefined, NaN, Infinity, -Infinity, -0, 1n, () => 1, Symbol("x"), new Date(), [undefined], Array(1),
    { a: undefined }, Object.defineProperty({}, "a", { get: () => 1, enumerable: true }),
    Object.defineProperty({}, "a", { value: 1 }), { [Symbol("x")]: 1 }, Object.assign([], { extra: 1 })])
    ("rejects unsupported JSON without coercion: %#", value => {
      expect(() => canonicalBookContext(value)).toThrow("INVALID_BOOK_CONTEXT_JSON");
    });
  it("rejects cycles but permits repeated noncyclic objects", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => canonicalBookContext(cycle)).toThrow("INVALID_BOOK_CONTEXT_JSON");
    const a = { x: 1 }; expect(canonicalBookContext([a, a])).toBe('[{"x":1},{"x":1}]');
  });
  it("keeps exact v1 compatibility, never upgrades a v1 checksum mismatch", () => {
    const original = input();
    const key = rawCitationFingerprint(JSON.stringify(["request-original", original.messages, original.rawInput, original.foreignLookup]));
    const old = "relex:book-final:1\n" + JSON.stringify([key, "old final"]);
    expect(readBookFinal(old, original, "request-original")?.reply).toBe("old final");
    const reordered = { ...original, foreignLookup: Object.fromEntries(Object.entries(original.foreignLookup ?? {}).reverse()) };
    expect(readBookFinal(old, reordered, "request-original")).toBeNull();
    expect(readBookFinal(frameBookFinal(original, "request-original", "new final"), reordered, "request-original")?.reply).toBe("new final");
    expect(readBookFinal(old.replace("book-final:1", "book-final:2"), original, "request-original")).toBeNull();
  });
  it.each(["request", "raw", "manual", "kind", "arrays"])("changed %s context cannot replay", mode => {
    const original = input();
    original.messages[1].content = "distinct earlier context";
    const frame = frameBookFinal(original, "request-original", "final");
    const changed = structuredClone(original);
    if (mode === "raw") changed.rawInput += " ";
    if (mode === "manual") changed.messages[0].content = `[סיווג שיפוט ידני: {"sourceType":"foreign_case_us","jurisdiction":"US"}]\n${C2_WIRE[2].raw}`;
    if (mode === "kind" && changed.foreignLookup) changed.foreignLookup.kind = "book";
    if (mode === "arrays") changed.messages.reverse();
    expect(readBookFinal(frame, changed, mode === "request" ? "request-other" : "request-original")).toBeNull();
  });
});