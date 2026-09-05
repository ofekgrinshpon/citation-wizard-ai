// canonical_registry_discovery_and_representative_source_use_v1 — unit tests.
import { describe, expect, it } from "vitest";
import {
  buildAuthorityQueryVariants,
  screenCanonicalCandidate,
} from "../../supabase/functions/legal-research-v1/stages/canonicalRegistryDiscovery.ts";
import { collectDiscoveryUrlsFor } from "../../supabase/functions/legal-research-v1/lib/canonicalDiscoveryUrls.ts";
import { detectDockets } from "../../supabase/functions/legal-research-v1/stages/docketDetection.ts";
import {
  buildRepresentativeSourceSelection,
  representativeRoleOf,
  assessDrafterRepresentativeCompliance,
  renderRepresentativeSourceBlock,
} from "../../supabase/functions/legal-research-v1/stages/representativeSourceSelection.ts";
import { buildClaimSourcePlan } from "../../supabase/functions/legal-research-v1/stages/claimSourcePlanning.ts";
import { enforceStatuteDominanceOnDraft } from "../../supabase/functions/legal-research-v1/stages/statuteDominance.ts";
import { buildSourceLastMileFunnel } from "../../supabase/functions/legal-research-v1/stages/sourceLastMileFunnel.ts";

// deno-lint-ignore-file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function src(over: Record<string, unknown> = {}): any {
  return {
    ref: "S1",
    candidate_id: "c1",
    title: "מאמר על עקרון המידתיות",
    raw_title: "מאמר על עקרון המידתיות",
    title_status: "ok",
    title_hygiene_reasons: [],
    url: "https://law.tau.ac.il/x.pdf",
    source_type: "academic",
    role: "doctrinal_source",
    origin: "perplexity",
    best_support: "direct",
    supported_points: [],
    claim_ids: ["C1"],
    snippet: "עקרון המידתיות וביקורת חוקתית",
    body_acquired: true,
    text_usability: "full_text",
    citable_as: "scholarship",
    ...over,
  };
}

const DOCKET = detectDockets('ע"א 6821/93 בנק המזרחי')[0];

describe("canonical registry discovery", () => {
  it("generates bounded targeted query variants for a canonical authority", () => {
    const v = buildAuthorityQueryVariants({
      label: 'ע"א 6821/93 בנק המזרחי נ\' מגדל כפר שיתופי',
      docket: "6821/93",
    });
    expect(v.length).toBeGreaterThanOrEqual(4);
    expect(v.some((q) => q.includes("6821/93"))).toBe(true);
    expect(v.some((q) => q.includes("בנק המזרחי"))).toBe(true);
    expect(v.some((q) => q.includes("court.gov.il"))).toBe(true);
  });

  it("selects an exact-docket discovered URL for fetch", () => {
    const sel = screenCanonicalCandidate(
      "https://supremedecisions.court.gov.il/Home/Download?path=x.pdf",
      'ע"א 6821/93 בנק המזרחי',
      DOCKET,
      "מזרחי",
      0,
    );
    expect(sel.selected_for_fetch).toBe(true);
    expect(sel.docket_evidence).toBe("title");
  });

  it("rejects listing pages and off-host adjacent results before fetch", () => {
    const listing = screenCanonicalCandidate(
      "https://www.court.gov.il/search?q=מזרחי",
      "רשימת פסקי דין",
      DOCKET,
      "מזרחי",
      0,
    );
    expect(listing.selected_for_fetch).toBe(false);
    expect(listing.rejection_reason).toBe("listing_page");

    const adjacent = screenCanonicalCandidate(
      "https://www.example-blog.co.il/post/1234",
      'ע"א 1234/95 עניין אחר',
      DOCKET,
      "מזרחי",
      0,
    );
    expect(adjacent.selected_for_fetch).toBe(false);
    expect(adjacent.rejection_reason).toBe("no_exact_docket_evidence");
  });

  it("discovered URLs without exact docket evidence are never collected", () => {
    const urls = collectDiscoveryUrlsFor(
      [{
        url: "https://supremedecisions.court.gov.il/Home/Download?path=a.pdf",
        title: "",
        discovery_source: "canonical_registry_discovery",
      }],
      [],
      DOCKET,
    );
    expect(urls).toHaveLength(0);
  });


  it("untargeted discovery URLs without docket evidence stay excluded", () => {
    const urls = collectDiscoveryUrlsFor(
      [{ url: "https://x.court.gov.il/a", title: "", discovery_source: "official_discovery" }],
      [],
      DOCKET,
    );
    expect(urls).toHaveLength(0);
  });
});

describe("representative source selection", () => {
  const claims = [{ claim_id: "C1", text_he: "רקע תיאורטי על עקרון המידתיות בביקורת חוקתית" }];
  const question = "כתוב רקע תיאורטי על עקרון המידתיות בביקורת חוקתית";

  it("maps sources to representative roles", () => {
    expect(representativeRoleOf(src({ citable_as: "statute", source_type: "israeli_law" })))
      .toBe("primary_statute_or_text");
    expect(representativeRoleOf(src({ citable_as: "judgment", source_type: "caselaw" })))
      .toBe("canonical_case_law");
    expect(representativeRoleOf(src())).toBe("direct_doctrinal_scholarship");
    expect(
      representativeRoleOf(src({ title: "ביקורת על מבחן המידתיות", best_support: "partial" })),
    ).toBe("critique_or_counterposition");
  });

  it("selects one strongest representative per role", () => {
    const sources = [
      src({ ref: "S1" }),
      src({
        ref: "S2",
        title: 'בג"ץ מידתיות ביקורת חוקתית',
        citable_as: "judgment",
        source_type: "caselaw",
        authority_tier: "official_primary",
      }),
      src({ ref: "S3", title: "חוק-יסוד: כבוד האדם וחירותו — מידתיות", citable_as: "statute", source_type: "israeli_law" }),
    ];
    const plan = buildClaimSourcePlan(question, claims, sources, { academicMode: true });
    const rep = buildRepresentativeSourceSelection(question, claims, sources, plan);
    const picked = rep.by_claim["C1"] ?? [];
    expect(picked.length).toBeGreaterThanOrEqual(2);
    expect(new Set(picked).size).toBe(picked.length);
    expect(renderRepresentativeSourceBlock(rep, plan)).toContain("עוגן מועדף");
  });

  it("selects no representative when only weak/generic sources exist", () => {
    const weak = [
      src({
        ref: "S9",
        title: "מבוא כללי לפילוסופיה",
        snippet: "טקסט כללי",
        best_support: "partial",
        body_acquired: false,
        text_usability: "metadata_only",
      }),
    ];
    const plan = buildClaimSourcePlan(question, claims, weak, { academicMode: true });
    const rep = buildRepresentativeSourceSelection(question, claims, weak, plan);
    expect(rep.selected_count).toBe(0);
  });

  it("reports drafter compliance with representative sources", () => {
    const sources = [src({ ref: "S1" })];
    const plan = buildClaimSourcePlan(question, claims, sources, { academicMode: true });
    const rep = buildRepresentativeSourceSelection(question, claims, sources, plan);
    const draft = {
      blocks: [{ kind: "paragraph", text: "טקסט", source_refs: [], claim_id: "C1" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const c = assessDrafterRepresentativeCompliance(draft, rep);
    if (rep.selected_count > 0) {
      expect(c.rows[0].compliant).toBe(false);
      expect(c.rows[0].missed_expected_sources.length).toBeGreaterThan(0);
    }
  });
});

describe("statute dominance fallback", () => {
  const question = "מה אומר חוק-יסוד: כבוד האדם וחירותו לגבי פגיעה בזכויות?";
  const statute = src({
    ref: "S1",
    title: "חוק-יסוד: כבוד האדם וחירותו",
    citable_as: "statute",
    source_type: "israeli_law",
  });
  const judgment = src({
    ref: "S2",
    title: 'בג"ץ פגיעה בזכויות',
    citable_as: "judgment",
    source_type: "caselaw",
  });

  it("promotes the statute when claim markers are missing", () => {
    const draft = {
      blocks: [{ kind: "paragraph", text: "פסקה", source_refs: ["S2"], claim_id: "C1" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = enforceStatuteDominanceOnDraft(draft, {
      question,
      sources: [statute, judgment],
      statutoryClaimIds: [],
    });
    expect(out.check.correction_applied).toBe(true);
    expect(draft.blocks[0].source_refs[0]).toBe("S1");
    expect(draft.blocks[0].source_refs).toContain("S2");
  });

  it("a statutory question cannot finalize with only a judgment citation", () => {
    const draft = {
      blocks: [{ kind: "paragraph", text: "פסקה", source_refs: ["S2"], claim_id: "C1" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = enforceStatuteDominanceOnDraft(draft, { question, sources: [statute, judgment] });
    expect(out.check.statute_cited).toBe(true);
    expect(out.check.statute_first_or_primary).toBe(true);
  });

  it("declares the gap when no statute source is available", () => {
    const draft = {
      blocks: [{ kind: "paragraph", text: "פסקה", source_refs: ["S2"], claim_id: "C1" }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const out = enforceStatuteDominanceOnDraft(draft, { question, sources: [judgment] });
    expect(out.check.correction_applied).toBe(false);
    expect(out.check.blocked_reason).toBe("no_verified_statute_source_available");
  });
});

describe("source last-mile funnel", () => {
  it("attributes each loss to a stage", () => {
    const s1 = src({ ref: "S1" });
    const s2 = src({ ref: "S2" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mk = (refs: string[]): any => ({
      blocks: [{ kind: "paragraph", text: "t", source_refs: refs, claim_id: "C1" }],
    });
    const funnel = buildSourceLastMileFunnel({
      sources: [s1, s2],
      representative: { version: "v", run_id: null, rows: [], by_claim: { C1: ["S1"] }, selected_count: 1, claims_with_representative: 1 },
      rawDraft: mk(["S1", "S2"]),
      postCsmDraft: mk(["S1"]),
      postAlignmentDraft: mk(["S1"]),
      citedRefs: ["S1"],
    });
    expect(funnel.counts.final_cited).toBe(1);
    const lost = funnel.rows.find((r) => r.source_id === "S2")!;
    expect(lost.loss_stage).toBe("dropped_by_claim_source_match");
  });
});
