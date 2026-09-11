// @vitest-environment node
/**
 * v2_named_authority_acquisition_v1
 *
 * Deterministic librarian, autonomous researcher.
 *
 * These tests pin the EXECUTION guarantees only: a named-authority lookup
 * produces durable, fetchable candidates; the identity a candidate was found
 * for survives the hop to fetch and cannot be silently retargeted by the
 * model; targets the agent opened are remembered, deduplicated, resumable and
 * abandonable. Nothing here asserts that any authority must be pursued, how
 * many sources are enough, or in what order research happens — those remain
 * the agent's decisions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  AcquisitionLedger,
  authorityKeyOf,
  normalizeAttemptUrl,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import { runLookupAuthority } from "../../supabase/functions/legal-research-v2/tools/lookupAuthority";
import { resolveExpectedIdentity } from "../../supabase/functions/legal-research-v2/tools/fetch";
import { resetResultIds } from "../../supabase/functions/legal-research-v2/tools/resultIds";
import { staleText } from "../../supabase/functions/legal-research-v2/agent/commitPolicy";

/** Minimal Supabase stub: one local judgment row keyed by case_number. */
function adminStub(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ column: string; value: string }> = [];
  const client = {
    calls,
    from() {
      const q = {
        _col: "",
        _val: "",
        select() {
          return q;
        },
        eq(col: string, val: string) {
          q._col = col;
          q._val = val;
          return q;
        },
        ilike(col: string, val: string) {
          q._col = col;
          q._val = val;
          return q;
        },
        limit() {
          calls.push({ column: q._col, value: q._val });
          const match = rows.filter((r) =>
            q._col === "case_number"
              ? r.case_number === q._val
              : String(r[q._col] ?? "").includes(q._val.replace(/%/g, ""))
          );
          return Promise.resolve({ data: match, error: null });
        },
      };
      return q;
    },
  };
  return client as unknown as Parameters<typeof runLookupAuthority>[0] & { calls: typeof calls };
}

const LOCAL_ROW = {
  id: "doc-local-1",
  title: "פסק דין מקומי",
  source_url: "https://example.gov/judgments/1234-56.docx",
  docx_url: null,
  pdf_url: null,
  source_type: "caselaw",
  case_number: "1234/56",
  citation: 'בג"ץ 1234/56',
};

beforeEach(() => resetResultIds());

describe("A. lookup candidates are durable and fetchable", () => {
  it("gives every usable candidate a result_id and the authority it was found for", async () => {
    const out = await runLookupAuthority(adminStub([LOCAL_ROW]), { kind: "case", docket: "1234/56" });
    expect(out.authority_key).toBe("case:1234/56");
    const usable = out.candidates.filter((c) => c.url);
    expect(usable.length).toBeGreaterThan(0);
    for (const c of usable) {
      expect(c.result_id).toBeTruthy();
      expect(c.authority_key).toBe("case:1234/56");
      expect(c.expected_identity?.docket).toBe("1234/56");
    }
    // ids are unique
    const ids = usable.map((c) => c.result_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("B. document candidates are distinguished from discovery entries", () => {
  it("labels official search pages as discovery_entry and local records as local_document", async () => {
    const out = await runLookupAuthority(adminStub([LOCAL_ROW]), { kind: "case", docket: "1234/56" });
    const local = out.candidates.find((c) => c.origin === "local_corpus");
    expect(local?.candidate_kind).toBe("local_document");
    const searchPages = out.candidates.filter((c) => c.origin === "official_search_entry");
    expect(searchPages.length).toBeGreaterThan(0);
    for (const c of searchPages) expect(c.candidate_kind).toBe("discovery_entry");
  });

  it("prefers the structured docket column over title matching", async () => {
    const admin = adminStub([LOCAL_ROW]);
    await runLookupAuthority(admin, { kind: "case", docket: "1234/56" });
    expect(admin.calls[0].column).toBe("case_number");
  });
});

describe("C. expected identity travels with the candidate", () => {
  it("uses candidate identity when the model restates nothing", () => {
    const r = resolveExpectedIdentity({ expected_identity: { docket: "1234/56" } }, undefined);
    expect(r.source).toBe("candidate");
    expect(authorityKeyOf(r.identity ?? {})).toBe("case:1234/56");
  });

  it("accepts a non-contradictory section from the model", () => {
    const r = resolveExpectedIdentity(
      { expected_identity: { statute: "חוק א" } },
      { statute: "חוק א", section: "12" },
    );
    expect(r.source).toBe("merged");
    expect(r.identity?.section).toBe("12");
    expect(r.conflict).toBeUndefined();
  });
});

describe("D. model metadata cannot silently retarget a known candidate", () => {
  it("keeps the candidate docket and reports the conflict", () => {
    const r = resolveExpectedIdentity(
      { expected_identity: { docket: "1234/56" } },
      { docket: "9999/99" },
    );
    expect(r.identity?.docket).toBe("1234/56");
    expect(r.conflict).toMatch(/model_expected_identity_ignored/);
  });

  it("still allows a free fetch with model-only identity", () => {
    const r = resolveExpectedIdentity(null, { docket: "9999/99" });
    expect(r.source).toBe("model");
    expect(r.identity?.docket).toBe("9999/99");
  });
});

describe("E. targets remember tried paths and never repeat them", () => {
  it("excludes attempted urls from untried candidates", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:1234/56", {
      candidates: [
        { result_id: "r1", url: "https://a.example/doc" },
        { result_id: "r2", url: "https://b.example/doc" },
      ],
    });
    expect(l.untriedCandidates("case:1234/56")).toHaveLength(2);
    l.note("case:1234/56", {
      url: "https://a.example/doc/",
      outcome: "failed",
      reason: "404",
      at: new Date().toISOString(),
    });
    const untried = l.untriedCandidates("case:1234/56");
    expect(untried).toHaveLength(1);
    expect(untried[0].result_id).toBe("r2");
    expect(normalizeAttemptUrl("https://A.example/doc/#x")).toBe("https://a.example/doc");
  });
});

describe("F. acquisition closes only on corroborated bodies", () => {
  it("a corroborated body resolves the target; an uncorroborated one does not", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:1234/56", { candidates: [{ result_id: "r1", url: "https://a.example/doc" }] });
    l.note("case:1234/56", {
      url: "https://a.example/doc",
      outcome: "readable_unconfirmed_identity",
      reason: "docket_absent_from_body",
      at: new Date().toISOString(),
      identity_corroborated: false,
    }, "src-1");
    expect(l.acquired("case:1234/56")).toBe(false);
    expect(l.unresolvedTargets().map((t) => t.authority_key)).toContain("case:1234/56");

    l.note("case:1234/56", {
      url: "https://b.example/doc",
      outcome: "acquired",
      reason: "docket_present_in_body",
      at: new Date().toISOString(),
      identity_corroborated: true,
    }, "src-2");
    expect(l.acquired("case:1234/56")).toBe(true);
    expect(l.unresolvedTargets()).toHaveLength(0);
  });

  it("re-opening a target merges candidates instead of duplicating them", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:1234/56", { candidates: [{ result_id: "r1", url: "https://a.example/doc" }] });
    l.openTarget("case:1234/56", {
      candidates: [
        { result_id: "r1", url: "https://a.example/doc" },
        { url: "https://a.example/doc/" },
        { result_id: "r2", url: "https://c.example/doc" },
      ],
    });
    expect(l.target("case:1234/56")?.candidates).toHaveLength(2);
  });
});

describe("G. agent autonomy is preserved", () => {
  it("a target can be abandoned by the agent and stops being surfaced", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:1234/56", { candidates: [{ result_id: "r1", url: "https://a.example/doc" }] });
    l.abandonTarget("case:1234/56", "no longer relevant");
    expect(l.unresolvedTargets()).toHaveLength(0);
    expect(l.target("case:1234/56")?.abandon_reason).toBe("no longer relevant");
  });

  it("the stale signal offers options and never commands an acquisition", () => {
    const text = staleText([{ authority_key: "case:1234/56", untried: 2 }]);
    expect(text).toContain("case:1234/56");
    expect(text).toContain("ההחלטה שלך");
    expect(text).toContain("להגיש את התזכיר");
  });

  it("mentioned-but-unpursued authorities create no target at all", () => {
    const l = new AcquisitionLedger();
    expect(l.unresolvedTargets()).toHaveLength(0);
    expect(l.target("case:1/11")).toBeNull();
  });
});

describe("H. target state survives chunking and compaction", () => {
  it("round-trips through JSON with attempts and abandonment intact", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:1234/56", {
      label: "פסק דין",
      candidates: [{ result_id: "r1", url: "https://a.example/doc" }, { result_id: "r2", url: "https://b.example/doc" }],
    });
    l.note("case:1234/56", {
      url: "https://a.example/doc",
      outcome: "failed",
      reason: "404",
      at: new Date().toISOString(),
    });
    l.openTarget("statute:חוק א", { candidates: [{ result_id: "r3", url: "https://d.example/law" }] });
    l.abandonTarget("statute:חוק א", "dropped");

    const revived = AcquisitionLedger.fromJSON(JSON.parse(JSON.stringify(l.toJSON())));
    expect(revived.target("case:1234/56")?.label).toBe("פסק דין");
    expect(revived.untriedCandidates("case:1234/56").map((c) => c.result_id)).toEqual(["r2"]);
    expect(revived.target("statute:חוק א")?.abandoned).toBe(true);
    expect(revived.unresolvedTargets().map((t) => t.authority_key)).toEqual(["case:1234/56"]);
  });
});

describe("I. exhaustion is bounded and visible", () => {
  it("a target with every candidate tried stops offering untried paths", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:1234/56", {
      candidates: [{ result_id: "r1", url: "https://a.example/doc" }, { result_id: "r2", url: "https://b.example/doc" }],
    });
    for (const url of ["https://a.example/doc", "https://b.example/doc"]) {
      l.note("case:1234/56", { url, outcome: "failed", reason: "404", at: new Date().toISOString() });
    }
    expect(l.untriedCandidates("case:1234/56")).toHaveLength(0);
    // Still unresolved (honest state) but no path is proposed any more.
    expect(l.unresolvedTargets()[0].untried).toHaveLength(0);
    expect(staleText([{ authority_key: "case:1234/56", untried: 0 }])).not.toContain("case:1234/56");
  });
});
