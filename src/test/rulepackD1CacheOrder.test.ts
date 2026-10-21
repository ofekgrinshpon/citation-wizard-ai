/**
 * D1 correction — the disabled-capability decision precedes the verified-store
 * cache in the actual runner. Controlled capability-policy test (entries are
 * toggled and restored), not an attacker-mutation claim. Offline only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ invoke: vi.fn(), retry: vi.fn(), classifier: vi.fn(), cache: vi.fn() }));
vi.mock("@/lib/functionError", () => ({ invokeFunction: m.invoke, retryCitationFunction: m.retry }));
vi.mock("@/lib/verifiedSources", () => ({ findVerifiedSourceMatch: m.cache, classifyVerifiedSource: vi.fn(() => "x"), getVerifiedCategoryLabel: vi.fn(() => "x") }));
vi.mock("@/lib/sourceTypeClassifier", () => ({ resolveSourceType: m.classifier }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { runCitation } from "@/lib/runCitation";
import { runCitation as legacyRunCitation } from "./fixtures/legacyRunCitation.baseline";
import type { SourceType } from "@/data/abbreviations";
import { DISABLED_RULEPACK_WARNING, RULEPACK_MANIFEST } from "../../supabase/functions/_shared/citationPure/rulepack";

const BOOK = "Author: Jane Doe; Book: Synthetic Collection; Edition: 2nd";
const CASES: { name: string; raw: string; type: SourceType; entry: string }[] = [
  { name: "Brown unanchored case", raw: "Brown v. Board of Education", type: "foreign_case_other", entry: "unanchored.case" },
  { name: "book without year", raw: BOOK, type: "foreign_book", entry: "general.book" },
  { name: "book with year", raw: `${BOOK}; Year: 2020`, type: "foreign_book", entry: "general.book" },
];
const hit = (raw: string) => ({ source_name: raw, full_citation: "Cached result", source_type: "", verification_status: "verified" });

let restore: (() => void) | null = null;
function disable(id: string) {
  const e = RULEPACK_MANIFEST.find(x => x.id === id) as { status: string } | undefined;
  expect(e).toBeTruthy();
  const prior = e!.status;
  e!.status = "planned_disabled";
  restore = () => { e!.status = prior; };
}
beforeEach(() => { vi.clearAllMocks(); m.invoke.mockResolvedValue({ data: { content: "UNSAFE" }, errorInfo: null }); });
afterEach(() => { restore?.(); restore = null; });

describe("disabled capability precedes verified-store cache", () => {
  for (const c of CASES) {
    for (const cacheHit of [true, false]) {
      it(`${c.name} — ${cacheHit ? "cache hit" : "cache miss"}: preserved, zero cache/provider`, async () => {
        m.cache.mockResolvedValue(cacheHit ? hit(c.raw) : null);
        disable(c.entry);
        const r = await runCitation({ rawInput: c.raw, overrideType: c.type });
        expect(r.fromVerifiedStore).toBe(false);
        expect(r.status).toBe("warning");
        expect(r.warningMsg).toBe(DISABLED_RULEPACK_WARNING);
        expect(r.citation).not.toBe("Cached result");
        expect(r.reply).toContain(DISABLED_RULEPACK_WARNING);
        expect(m.cache).toHaveBeenCalledTimes(0);
        expect(m.classifier).toHaveBeenCalledTimes(0);
        expect(m.invoke).toHaveBeenCalledTimes(0);
        expect(m.retry).toHaveBeenCalledTimes(0);
      });
    }
  }
});

describe("enabled cache semantics unchanged", () => {
  for (const c of CASES) {
    it(`${c.name} — enabled cache hit matches frozen baseline exactly`, async () => {
      m.cache.mockResolvedValue(hit(c.raw));
      const expected = await legacyRunCitation({ rawInput: c.raw, overrideType: c.type });
      vi.clearAllMocks();
      m.cache.mockResolvedValue(hit(c.raw));
      const r = await runCitation({ rawInput: c.raw, overrideType: c.type });
      expect(r.fromVerifiedStore).toBe(true);
      for (const k of ["citation", "reply", "status", "warningMsg", "sourceType", "sourceLabel"] as const) expect(r[k]).toEqual(expected[k]);
      expect(m.cache).toHaveBeenCalledTimes(1);
      expect(m.invoke).toHaveBeenCalledTimes(0);
      expect(m.retry).toHaveBeenCalledTimes(0);
    });
  }
});
