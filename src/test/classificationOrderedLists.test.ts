import { describe, expect, it } from "vitest";
import {
  applyOverride, computeEffective, createRecord, effectiveKey, isOutputStale, markGenerated,
  type ClassificationOverrides, type ClassificationRecord,
} from "@/lib/foreignClassification";

const INPUT = "Some Author, A Book Title (2001)";
const fresh = (patch: ClassificationOverrides): ClassificationRecord => {
  const r = applyOverride(createRecord("k1", INPUT), patch);
  const key = effectiveKey(computeEffective(r.detected, r.overrides));
  return markGenerated(r, { effectiveKey: key, inputFingerprint: r.detected.inputFingerprint });
};
const keyOf = (r: ClassificationRecord) => effectiveKey(computeEffective(r.detected, r.overrides));

describe("effectiveKey preserves ordered structured lists", () => {
  const cases: Array<[string, (l: string[]) => ClassificationOverrides]> = [
    ["authorship.author_list", (l) => ({ structured: { authorship: { author_list: l } } })],
    ["authorship.editor_list", (l) => ({ structured: { authorship: { editor_list: l } } })],
    ["authorship.translator_list", (l) => ({ structured: { authorship: { translator_list: l } } })],
    ["treaty_parties.party_list", (l) => ({ structured: { treaty_parties: { party_list: l } } })],
  ];
  for (const [name, mk] of cases) {
    it(`${name} permutation changes key and marks output stale`, () => {
      const r = fresh(mk(["A", "B"]));
      expect(isOutputStale(r)).toBe(false);
      const swapped = applyOverride(r, mk(["B", "A"]));
      expect(keyOf(swapped)).not.toBe(keyOf(r));
      expect(isOutputStale(swapped)).toBe(true);
      // stored value order unchanged
      const [axis, field] = name.split(".");
      expect((swapped.overrides.structured as Record<string, Record<string, unknown>>)[axis][field]).toEqual(["B", "A"]);
    });
  }
});

describe("effectiveKey canonicalizes set-valued axes", () => {
  it("access_medium permutation yields same key and stays fresh", () => {
    const r = fresh({ multi: { access_medium: ["web", "print"] } });
    const swapped = applyOverride(r, { multi: { access_medium: ["print", "web"] } });
    expect(swapped.overrides.multi?.access_medium).toEqual(["print", "web"]);
    {
      expect(keyOf(swapped)).toBe(keyOf(r));
      expect(isOutputStale(swapped)).toBe(false);
    }
  });
  it("set-valued multi arrays sort; object key order deterministic", () => {
    const base = computeEffective(createRecord("k", INPUT).detected, {});
    const a = { ...base, multi: { citation_scheme: ["x", "y"], container: ["c", "d"] } };
    const b = { ...base, multi: { container: ["d", "c"], citation_scheme: ["y", "x"] } };
    expect(effectiveKey(a)).toBe(effectiveKey(b));
  });
});
