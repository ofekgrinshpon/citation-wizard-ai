import { describe, expect, it } from "vitest";

import { buildSourcePack } from "../../supabase/functions/legal-research-v2/sources/sourcePack";
import { classifySourceGroup } from "../../supabase/functions/legal-research-v2/sources/grouping";
import { isDelivered, SOURCE_SEARCH_CREDIT_COST } from "../../supabase/functions/legal-research-v2/beta/job";

function src(over: Record<string, unknown> = {}) {
  return {
    source_id: "S1",
    title: "חוק יחסי ממון בין בני זוג, התשל\"ג-1973",
    url: "https://www.nevo.co.il/law_html/law01/001.htm",
    origin: "corpus",
    fetch_status: "ok",
    is_actual_document: true,
    identity_fields: { statutes: ["חוק יחסי ממון בין בני זוג"], sections: ["5"], dockets: [] },
    ...over,
  } as never;
}

describe("source search — deterministic Source Renderer", () => {
  it("admits only read + identity-verified sources the agent relied on", () => {
    const pack = buildSourcePack({
      run_id: "r1",
      question: "איזון משאבים",
      sources: [
        src(),
        src({ source_id: "S2", url: "https://example.com/broken", title: "עמוד לא שמיש", fetch_status: "error", is_actual_document: false }),
        src({ source_id: "S3", url: "https://example.com/unverified", title: "מסמך שנקרא אך לא אומת" }),
      ],
      verification: {
        per_source: { S1: { identity: true }, S3: { identity: false } },
        pack: { claims: [{ sources: [{ source_id: "S1", verified_span: "איזון המשאבים ייעשה" }] }] },
        counters: { identity_verified_pairs: 1, span_verified_pairs: 1 },
      } as never,
      memo: {
        claims: [{ proposition: "כלל האיזון", evidence: [{ source_id: "S1", reason: "מקור ראשוני מרכזי" }] }],
        unresolved_questions: [],
      } as never,
      discovered: [{ title: "מאמר אקדמי", url: "https://example.org/a", origin: "perplexity:academic" }] as never,
    });

    expect(pack.mode).toBe("sources");
    expect(pack.recommended.map((s) => s.source_id)).toEqual(["S1"]);
    expect(pack.recommended[0].span_verified).toBe(true);
    expect(pack.recommended[0].excerpt).toContain("איזון המשאבים");
    // Unread and unusable sources are honest leads, never recommendations.
    expect(pack.leads.some((l) => l.title === "מאמר אקדמי")).toBe(true);
    expect(pack.leads.some((l) => l.title === "עמוד לא שמיש")).toBe(true);
    expect(pack.summary.recommended).toBe(1);
    // Discovered is a de-duplicated count, never discovered + fetched.
    expect(pack.summary.discovered).toBe(4);
  });

  it("returns an empty but valid pack when nothing was verified", () => {
    const pack = buildSourcePack({
      run_id: "r2",
      question: "x",
      sources: [],
      verification: null,
      memo: null,
      discovered: [],
    });
    expect(pack.recommended).toEqual([]);
    expect(pack.groups).toEqual([]);
    expect(pack.summary.discovered).toBe(0);
  });

  it("groups Israeli legislation and case law distinctly", () => {
    expect(classifySourceGroup({ title: "חוק הכשרות המשפטית", url: "https://www.nevo.co.il/law_html/x.htm" }))
      .toBe("legislation");
    expect(classifySourceGroup({ title: "בג\"ץ 1234/20 פלוני נ' שר הפנים", url: "https://supreme.court.gov.il/x" }))
      .toBe("case_law");
  });

  it("counts a source pack as delivered and prices below full research", () => {
    expect(SOURCE_SEARCH_CREDIT_COST).toBeLessThan(5);
    const base = { answer: "", footnotes: [], used_sources: [], pipeline_version: "v2" as const, run_id: "r", debug: {} };
    expect(isDelivered({ ...base, output_mode: "sources", source_pack: { recommended: [{}] } })).toBe(true);
    expect(isDelivered({ ...base, output_mode: "sources", source_pack: { recommended: [] } })).toBe(false);
    // Answer mode semantics are untouched.
    expect(isDelivered({ ...base, answer: "טקסט", footnotes: [{ number: 1, title: "t", sources: [] }] })).toBe(true);
  });
});
