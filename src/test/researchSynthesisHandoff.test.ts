import { describe, expect, it } from "vitest";

import {
  normalizeResearchSynthesis,
  projectVerifiedSynthesis,
  renderSynthesisForDrafter,
} from "../../supabase/functions/legal-research-v2/drafting/synthesis";
import { buildDrafterInput } from "../../supabase/functions/legal-research-v2/drafting/draft";
import type {
  ResearchSynthesis,
  VerifiedEvidencePack,
} from "../../supabase/functions/legal-research-v2/types";

function packOf(claimIds: string[], sourceIds: string[][] = []): VerifiedEvidencePack {
  return {
    claims: claimIds.map((id, i) => ({
      claim_id: id,
      proposition: `טענה ${id}`,
      importance: "core" as const,
      support_status: "supported" as const,
      sources: (sourceIds[i] ?? ["S1"]).map((sid) => ({
        source_id: sid,
        display_title: `מקור ${sid}`,
        verified_span: "ציטוט מאומת",
        support: "supports" as const,
      })),
    })),
    unsupported_claims: [],
  };
}

const synthesis: ResearchSynthesis = {
  sections: [{ heading: "עמדות בספרות", purpose: "מיפוי", claim_ids: ["C1", "C2"] }],
  source_roles: [
    { source_id: "S1", role: "scholarship_position", claim_ids: ["C1"] },
    { source_id: "S99", role: "critique", claim_ids: ["C2"] },
  ],
  relationships: [
    { kind: "disagreement", relationship_claim_id: "C7", related_claim_ids: ["C1", "C2"] },
  ],
};

describe("synthesis normalization", () => {
  it("is optional and never crashes on malformed input", () => {
    expect(normalizeResearchSynthesis(undefined)).toBeUndefined();
    expect(normalizeResearchSynthesis("junk")).toBeUndefined();
    expect(normalizeResearchSynthesis({ sections: 5, relationships: null })).toBeUndefined();
  });

  it("trims, dedupes, bounds and drops unknown enum values", () => {
    const out = normalizeResearchSynthesis({
      sections: [
        { heading: "  נושא  ", purpose: "x".repeat(400), claim_ids: ["C1", "C1", " C2 "] },
        { heading: "ריק", claim_ids: [] },
      ],
      source_roles: [
        { source_id: "S1", role: "not_a_role", claim_ids: ["C1"] },
        { source_id: "S1", role: "not_a_role", claim_ids: ["C1"] },
      ],
      relationships: [
        { kind: "nonsense", relationship_claim_id: "C3", related_claim_ids: ["C1"] },
        { kind: "contrast", relationship_claim_id: "C3", related_claim_ids: ["C1"] },
        { kind: "contrast", relationship_claim_id: "C3", related_claim_ids: ["C1"] },
      ],
    })!;
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].heading).toBe("נושא");
    expect(out.sections[0].purpose!.length).toBe(240);
    expect(out.sections[0].claim_ids).toEqual(["C1", "C2"]);
    expect(out.source_roles).toEqual([
      { source_id: "S1", role: "other", claim_ids: ["C1"] },
    ]);
    expect(out.relationships).toHaveLength(1);
    expect(out.relationships[0].kind).toBe("contrast");
  });
});

describe("verified synthesis projection", () => {
  it("A — a rejected claim disappears from its section", () => {
    const out = projectVerifiedSynthesis(synthesis, packOf(["C1", "C7"]));
    expect(out.synthesis!.sections[0].claim_ids).toEqual(["C1"]);
    expect(out.claim_refs_dropped).toBeGreaterThan(0);
  });

  it("A2 — a section whose claims all failed is dropped", () => {
    const out = projectVerifiedSynthesis(synthesis, packOf(["C7"]));
    expect(out.synthesis?.sections ?? []).toHaveLength(0);
  });

  it("B — a relationship whose carrying claim fails verification disappears", () => {
    const out = projectVerifiedSynthesis(synthesis, packOf(["C1", "C2"]));
    expect(out.synthesis!.relationships).toHaveLength(0);
  });

  it("B2 — the relationship survives when its carrying claim survives", () => {
    const out = projectVerifiedSynthesis(synthesis, packOf(["C1", "C2", "C7"]));
    expect(out.synthesis!.relationships[0].relationship_claim_id).toBe("C7");
    expect(out.synthesis!.relationships[0].related_claim_ids).toEqual(["C1", "C2"]);
  });

  it("C — a source role for a source absent from the final pack is dropped", () => {
    const out = projectVerifiedSynthesis(synthesis, packOf(["C1", "C2", "C7"]));
    expect(out.synthesis!.source_roles.map((r) => r.source_id)).toEqual(["S1"]);
    expect(out.source_refs_dropped).toBe(1);
  });

  it("D — a claim removed by a later gate (temporal) cannot survive in synthesis", () => {
    const afterTemporalGate = packOf(["C2", "C7"]);
    const out = projectVerifiedSynthesis(synthesis, afterTemporalGate);
    expect(JSON.stringify(out.synthesis)).not.toContain("C1");
  });

  it("G — a legacy memo without synthesis projects to null", () => {
    const out = projectVerifiedSynthesis(undefined, packOf(["C1"]));
    expect(out.synthesis).toBeNull();
    expect(renderSynthesisForDrafter(null)).toBe("");
  });
});

describe("drafter input isolation", () => {
  const pack = packOf(["C1", "C7"], [["S1"], ["S2"]]);
  const projected = projectVerifiedSynthesis(synthesis, pack).synthesis;

  it("carries verified claims, source metadata and the verified synthesis", () => {
    const input = buildDrafterInput("שאלה", pack, [], [], projected);
    expect(input).toContain("טענה C1");
    expect(input).toContain("S1");
    expect(input).toContain("ציטוט מאומת");
    expect(input).toContain("עמדות בספרות");
    expect(input).toContain("אינו ראיה");
  });

  it("never carries agent trace, searches, tool messages or unverified refs", () => {
    const input = buildDrafterInput("שאלה", pack, [], [], projected);
    for (const forbidden of ["S99", "tool_call", "raw_web_search", "result_id", "http"]) {
      expect(input).not.toContain(forbidden);
    }
  });

  it("legacy call sites without synthesis are unchanged", () => {
    expect(buildDrafterInput("שאלה", pack, [], [])).toBe(
      buildDrafterInput("שאלה", pack, [], [], null),
    );
  });
});
