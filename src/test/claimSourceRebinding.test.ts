// claim_source_rebinding_v1 — Stage 1 deterministic unit tests.
// Fixtures mirror shapes observed in reports/candidate-funnel/funnel.json.
import { describe, expect, it } from "vitest";
import {
  BINDING_RANK,
  DEFAULT_REF_CAP,
  evaluateBinding,
  meaningfulTerms,
  type RebindBlockInput,
  type RebindSourceInput,
  selectBlockRefs,
} from "../../supabase/functions/legal-research-v1/stages/claimSourceRebinding.ts";

function block(p: Partial<RebindBlockInput> = {}): RebindBlockInput {
  return {
    block_index: 0,
    claim_id: "c1",
    facet_id: null,
    proposition_type: "application",
    claim_category: "doctrinal_synthesis",
    legal_area: "constitutional",
    text: "עילת הסבירות במשפט המינהלי חלה גם על החלטות ממשלה בעלות אופי מדיני",
    ...p,
  };
}
function source(p: Partial<RebindSourceInput> = {}): RebindSourceInput {
  return {
    ref: "s1",
    verified_claim_ids: ["c9"],
    facet_ids: [],
    supported_points: [],
    legal_area: "constitutional",
    verifier_verdict: "direct",
    body_acquired: true,
    ...p,
  };
}

describe("meaningfulTerms", () => {
  it("drops generic legal vocabulary", () => {
    const t = meaningfulTerms("בית המשפט קבע כי החוק והדין קובעים כלל משפטי");
    expect(t.has("משפט")).toBe(false);
    expect(t.has("חוק")).toBe(false);
  });
  it("keeps identifiers and doctrinal terms", () => {
    const t = meaningfulTerms('בבג"ץ 6821/93 נדונה סוגיית הסבירות המינהלית');
    expect(t.has("#6821/93")).toBe(true);
    expect([...t].some((x) => x.includes("סביר"))).toBe(true);
  });
  it("is tolerant to clitic prefixes", () => {
    const a = meaningfulTerms("הסבירות המינהלית");
    const b = meaningfulTerms("סבירות מינהלית");
    expect([...a].some((x) => b.has(x))).toBe(true);
  });
});

describe("evaluateBinding", () => {
  it("binds exactly on claim id match", () => {
    const d = evaluateBinding(block(), source({ verified_claim_ids: ["c1"] }));
    expect(d.binding).toBe("exact");
  });

  it("treats sources with no verifier binding as exact (legacy behaviour)", () => {
    const d = evaluateBinding(block(), source({ verified_claim_ids: [] }));
    expect(d.binding).toBe("exact");
  });

  it("binds via facet parent relation", () => {
    const d = evaluateBinding(
      block({ claim_id: null, facet_id: "c1::f2" }),
      source({ verified_claim_ids: ["c1"] }),
    );
    expect(d.binding).toBe("exact");
  });

  it("binds via source facet whose parent is the block claim", () => {
    const d = evaluateBinding(
      block(),
      source({ verified_claim_ids: ["c7"], facet_ids: ["c1::f1"] }),
    );
    expect(d.binding).toBe("facet");
  });

  it("rescues a divergent claim id via meaningful topical overlap", () => {
    const d = evaluateBinding(block(), source({
      supported_points: [
        "עילת הסבירות חלה על החלטות ממשלה בעלות אופי מדיני מובהק",
      ],
    }));
    expect(d.binding).toBe("topical");
    expect((d.score ?? 0) >= 2).toBe(true);
  });

  it("does not rebind on generic legal words alone", () => {
    const d = evaluateBinding(
      block({ text: "בית המשפט קבע כי החוק חל בעניין זה", legal_area: "constitutional" }),
      source({
        supported_points: ["בית המשפט קבע כי הדין חל במקרה זה"],
        legal_area: "criminal",
      }),
    );
    expect(d.binding).toBe("unbound");
  });

  it("rebinds on a shared docket identifier alone", () => {
    const d = evaluateBinding(
      block({ text: 'ההלכה נקבעה בע"א 6821/93' }),
      source({ supported_points: ['ע"א 6821/93 קבע ביקורת שיפוטית על חקיקה'] }),
    );
    expect(d.binding).toBe("topical");
  });

  it("allows area_direct only for broad doctrinal/background blocks", () => {
    const broad = evaluateBinding(
      block({ proposition_type: "background", claim_category: "contextual_background" }),
      source(),
    );
    expect(broad.binding).toBe("area_direct");
  });

  it("never allows area_direct for a court holding", () => {
    const d = evaluateBinding(
      block({ proposition_type: "black_letter_rule", claim_category: "court_holding" }),
      source(),
    );
    expect(d.binding).toBe("unbound");
  });

  it("never allows area_direct for statutory text or specific application", () => {
    expect(evaluateBinding(
      block({ proposition_type: "black_letter_rule", claim_category: "statutory" }),
      source(),
    ).binding).toBe("unbound");
    expect(evaluateBinding(
      block({ proposition_type: "application", claim_category: "doctrinal_synthesis" }),
      source(),
    ).binding).toBe("unbound");
  });

  it("requires an acquired body for the area fallback", () => {
    const d = evaluateBinding(
      block({ proposition_type: "background", claim_category: "contextual_background" }),
      source({ body_acquired: false }),
    );
    expect(d.binding).toBe("unbound");
  });
});

describe("selectBlockRefs", () => {
  const profiles = new Map<string, any>([
    ["s1", { ref: "s1", judgment_authority: true, statutory_authority: false, doctrinal_authority: false, background_only: false, eligibility_reason: "" }],
    ["s2", { ref: "s2", judgment_authority: false, statutory_authority: false, doctrinal_authority: true, background_only: false, eligibility_reason: "" }],
    ["s3", { ref: "s3", judgment_authority: false, statutory_authority: false, doctrinal_authority: false, background_only: true, eligibility_reason: "" }],
    ["s4", { ref: "s4", judgment_authority: false, statutory_authority: false, doctrinal_authority: false, background_only: true, eligibility_reason: "" }],
  ]);
  const sources = new Map<string, any>([
    ["s1", { ref: "s1", verifier_verdict: "partial" }],
    ["s2", { ref: "s2", verifier_verdict: "direct" }],
    ["s3", { ref: "s3", verifier_verdict: "direct" }],
    ["s4", { ref: "s4", verifier_verdict: "partial" }],
  ]);

  it("prefers stronger binding, then higher authority", () => {
    const { refs } = selectBlockRefs(["s3", "s2", "s1"], {
      bindings: new Map([["s1", "exact"], ["s2", "topical"], ["s3", "exact"]]) as any,
      profiles,
      sources,
      claim_category: "doctrinal_synthesis",
    });
    expect(refs[0]).toBe("s1");
    expect(refs[1]).toBe("s3");
  });

  it("caps refs per block to avoid footnote inflation", () => {
    const { refs, dropped } = selectBlockRefs(["s1", "s2", "s3", "s4"], {
      bindings: new Map([["s1", "exact"], ["s2", "topical"], ["s3", "topical"], ["s4", "area_direct"]]) as any,
      profiles,
      sources,
      claim_category: "contextual_background",
    });
    expect(refs.length).toBe(DEFAULT_REF_CAP);
    expect(dropped).toEqual(["s4"]);
  });

  it("allows a wider cap for genuine multi-source synthesis", () => {
    const { refs } = selectBlockRefs(["s1", "s2", "s3", "s4"], {
      bindings: new Map([["s1", "exact"], ["s2", "exact"], ["s3", "facet"], ["s4", "exact"]]) as any,
      profiles,
      sources,
      claim_category: "doctrinal_synthesis",
    });
    expect(refs.length).toBe(4);
  });

  it("keeps a single ref untouched", () => {
    const { refs } = selectBlockRefs(["s1"], {
      bindings: new Map([["s1", "area_direct"]]) as any,
      profiles,
      sources,
      claim_category: "court_holding",
    });
    expect(refs).toEqual(["s1"]);
  });

  it("ranks bindings in the required hierarchy", () => {
    expect(BINDING_RANK.exact).toBeGreaterThan(BINDING_RANK.facet);
    expect(BINDING_RANK.facet).toBeGreaterThan(BINDING_RANK.topical);
    expect(BINDING_RANK.topical).toBeGreaterThan(BINDING_RANK.area_direct);
  });
});
