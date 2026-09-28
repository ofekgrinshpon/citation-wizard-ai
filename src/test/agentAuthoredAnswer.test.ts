/**
 * agent_authored_answer experiment — safety / trust tests T1–T11.
 */
import { describe, expect, it } from "vitest";

import {
  buildAgentAnswerRepairMessage,
  gateAnswerBlocks,
  normalizeAnswerBlocks,
} from "../../supabase/functions/legal-research-v2/drafting/draft";
import { renderAnswer } from "../../supabase/functions/legal-research-v2/drafting/render";
import { normalizeMemo } from "../../supabase/functions/legal-research-v2/agent/researchAgent";
import {
  AGENT_ANSWER_MEMO_TOOL,
  MEMO_TOOL,
} from "../../supabase/functions/legal-research-v2/agent/prompt";
import { readFileSync } from "node:fs";
import { resolveMemoQuoteRefs } from "../../supabase/functions/legal-research-v2/evidence/quoteResolution";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import { applyTemporalGate } from "../../supabase/functions/legal-research-v2/verification/temporalValidity";
import type {
  AgentAnswerBlock,
  VerifiedEvidencePack,
} from "../../supabase/functions/legal-research-v2/types";


const pack: VerifiedEvidencePack = {
  claims: [
    {
      claim_id: "C1",
      proposition: "כלל המיצוי חל על עותק פיזי שנמכר כדין.",
      importance: "core",
      support_status: "supported",
      sources: [{ source_id: "S1", display_title: "חוק זכות יוצרים", verified_span: "ציטוט מאומת", support: "supports" }],
    },
    {
      claim_id: "C2",
      proposition: "ReDigi: העברה דיגיטלית יוצרת העתק חדש.",
      importance: "core",
      support_status: "supported",
      sources: [{ source_id: "S4", display_title: "Capitol Records v. ReDigi", verified_span: "a new copy", support: "supports" }],
    },
  ],
  unsupported_claims: [{ claim_id: "C3", proposition: "UsedSoft חל בישראל.", importance: "core", reasons: ["span_not_found"] }],
};
const memoIds = ["C1", "C2", "C3"];
const para = (text: string, claim_ids: string[], source_ids?: string[]): AgentAnswerBlock => ({
  type: "paragraph",
  text,
  claim_ids,
  ...(source_ids ? { source_ids } : {}),
});

describe("agent-authored answer gate", () => {
  it("T1 block whose claim survives verification is rendered with a footnote", () => {
    const g = gateAnswerBlocks([para("המיצוי חל על עותק פיזי", ["C1"])], pack, memoIds);
    expect(g.requires_repair).toHaveLength(0);
    const out = renderAnswer(g.accepted, pack);
    expect(out.footnotes).toHaveLength(1);
    expect(out.cited_source_ids).toEqual(["S1"]);
  });

  it("T2 block referencing a failed claim cannot reach output unchanged", () => {
    const g = gateAnswerBlocks([para("UsedSoft חל בישראל", ["C3"])], pack, memoIds);
    expect(g.requires_repair).toHaveLength(1);
    expect(g.accepted).toHaveLength(0);
    expect(g.claims_referenced_but_unverified).toEqual(["C3"]);
  });

  it("T3 model-declared source ids never become citations", () => {
    const g = gateAnswerBlocks([para("טקסט", ["C1"], ["S1", "S9"]), para("מסגור", [], ["S4"])], pack, memoIds);
    expect(g.accepted[0].source_ids).toEqual(["S1"]);
    expect(g.accepted[1].source_ids).toEqual([]);
    expect(g.blocks[0].untrusted_source_ids).toEqual(["S9"]);
    expect(renderAnswer(g.accepted, pack).cited_source_ids).toEqual(["S1"]);
  });

  it("T4 unknown claim_id is rejected for final rendering", () => {
    const g = gateAnswerBlocks([para("טענה", ["C99"])], pack, memoIds);
    expect(g.requires_repair[0].unknown_claim_ids).toEqual(["C99"]);
    expect(g.accepted).toHaveLength(0);
  });

  it("T5 multi-claim block survives only when every claim is verified", () => {
    const ok = gateAnswerBlocks([para("x", ["C1", "C2"])], pack, memoIds);
    expect(ok.accepted[0].source_ids.sort()).toEqual(["S1", "S4"]);
    const bad = gateAnswerBlocks([para("x", ["C1", "C3"])], pack, memoIds);
    expect(bad.accepted).toHaveLength(0);
    expect(bad.requires_repair[0].verified_claim_ids).toEqual(["C1"]);
  });

  it("T6 quote-id evidence is resolved to stored text before verification (same path)", async () => {
    const store = new EvidenceStore();
    const src = await store.append({
      url: "https://e.x/d",
      title: "doc",
      origin: "test",
      fetch_status: "ok",
      extracted_text: "the downloaded copy must be made unusable at the time of resale ".repeat(4),
      is_actual_document: true,
    });
    const qid = store.serveQuotes(src.source_id, ["the downloaded copy must be made unusable at the time of resale ".repeat(2)], "resale")[0].quote_id;
    const memo = normalizeMemo({
      issue_summary: "i",
      claims: [{ claim_id: "C1", proposition: "p", evidence: [{ source_id: src.source_id, quote_id: qid, reason: "r" }] }],
      unresolved_questions: [],
      research_complete: true,
      answer_blocks: [{ type: "paragraph", text: "t", claim_ids: ["C1"] }],
    })!;
    const resolved = resolveMemoQuoteRefs(memo, store).memo;
    expect(resolved.claims[0].evidence[0].quoted_span).toContain("unusable");
    expect(resolved.answer_blocks).toHaveLength(1);
  });

  it("T7 a current-law claim removed by the temporal gate makes its block require repair", () => {
    const gated = applyTemporalGate(
      { ...pack, claims: pack.claims.map((c) => (c.claim_id === "C1" ? { ...c, current_state_claim: true } : c)) },
      [{ claim_id: "C1", temporal_status: "unverifiable", detail: "no current source" } as never],
    ).pack;
    expect(gated.claims.some((c) => c.claim_id === "C1")).toBe(false);
    const g = gateAnswerBlocks([para("הדין כיום", ["C1"])], gated, memoIds);
    expect(g.requires_repair).toHaveLength(1);
    expect(g.requires_repair[0].failed_claim_ids).toEqual(["C1"]);
  });

  it("T8 repair message carries exact failure reasons and allows removal", () => {
    const blocks = [para("UsedSoft חל בישראל", ["C3"]), para("ok", ["C1"])];
    const gate = gateAnswerBlocks(blocks, pack, memoIds);
    const msg = buildAgentAnswerRepairMessage({
      blocks,
      gate,
      pack,
      rejected: [{ claim_id: "C3", source_id: "S6", reason: "span_not_found", detail: "no match", stage: "span" } as never],
      unsupported: pack.unsupported_claims,
    });
    expect(msg).toContain("C3");
    expect(msg).toContain("span_not_found");
    expect(msg).toContain("הסר, סייג או נסח מחדש");
    expect(msg).toContain("בלוקים הדורשים תיקון: 1");
  });

  it("T9 a new claim added in repair is unpublishable until it is in the verified pack", () => {
    // Repaired answer references new claim C4 — the repaired pack (post
    // verification) does not contain it, so the block cannot render.
    const g = gateAnswerBlocks([para("טענה חדשה", ["C4"])], pack, [...memoIds, "C4"]);
    expect(g.accepted).toHaveLength(0);
    expect(g.requires_repair[0].failed_claim_ids).toEqual(["C4"]);
  });

  it("T10 all blocks clean → no repair needed", () => {
    const g = gateAnswerBlocks(
      [{ type: "heading", text: "מבוא", claim_ids: [] }, para("a", ["C1"]), para("b", ["C2"])],
      pack,
      memoIds,
    );
    expect(g.requires_repair).toHaveLength(0);
    expect(g.accepted).toHaveLength(3);
    expect(g.accepted[0].source_ids).toEqual([]);
  });

  it("T11 flag off: production intake, tool and memo unchanged", () => {
    const src = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
    // Flag is strictly opt-in and absent from the intake unless exactly true.
    expect(src).toContain("...(input.agent_authored_answer === true ? { agent_authored_answer: true } : {})");
    expect(src).toContain("agent_authored_answer: body.agent_authored_answer === true");
    // Drafter runs on the non-experiment branch.
    expect(src).toMatch(/\} else \{\s*draft = await timer\.time\("drafting_model", \(\) =>\s*runDrafter\(/);
    const agentSrc = readFileSync("supabase/functions/legal-research-v2/agent/researchAgent.ts", "utf8");
    expect(agentSrc).toContain("opts.intake.agent_authored_answer ? AGENT_ANSWER_MEMO_TOOL : MEMO_TOOL");
    expect((MEMO_TOOL.parameters.properties as Record<string, unknown>).answer_blocks).toBeUndefined();
    expect(MEMO_TOOL.parameters.required).not.toContain("answer_blocks");
    expect(AGENT_ANSWER_MEMO_TOOL.parameters.required).toContain("answer_blocks");
    const memo = normalizeMemo({ issue_summary: "i", claims: [], unresolved_questions: [], research_complete: true });
    expect(memo && "answer_blocks" in memo).toBe(false);
  });

  it("normalizes blocks: strips footnote markup, drops empty text", () => {
    const b = normalizeAnswerBlocks([{ type: "x", text: "טקסט[^2]", claim_ids: ["C1", "C1"] }, { text: " " }])!;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ type: "paragraph", text: "טקסט", claim_ids: ["C1"] });
  });
});
