/**
 * legal-research-v2 — agent-authored answer (EVALUATION ONLY).
 *
 * Experiment flag `agent_authored_answer`: the SAME Research Agent that did the
 * research writes the final answer inside its memo submission. Nothing here is
 * evidence and nothing here verifies anything — verification stays the single
 * source of truth. This module only:
 *
 *   • normalizes the agent's answer blocks;
 *   • gates each block against the claims that SURVIVED verification;
 *   • derives each block's citations from verified claims only (model-supplied
 *     source_ids are never trusted);
 *   • builds the one bounded repair message for the same agent.
 *
 * A block that references a failed or unknown claim never reaches the renderer
 * unchanged: it is either repaired by the agent (and re-verified) or dropped.
 */

import type {
  AgentAnswerBlock,
  DraftBlock,
  RejectedPair,
  VerifiedEvidencePack,
} from "../types.ts";

export const AGENT_ANSWER_LIMITS = {
  MAX_BLOCKS: 80,
  MAX_BLOCK_CHARS: 6000,
  MAX_CLAIM_REFS: 16,
};

export function normalizeAnswerBlocks(raw: unknown): AgentAnswerBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AgentAnswerBlock[] = [];
  for (const b of raw.slice(0, AGENT_ANSWER_LIMITS.MAX_BLOCKS)) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    const type = r.type === "heading" || r.type === "list_item" ? r.type : "paragraph";
    const text = typeof r.text === "string"
      ? r.text.replace(/\[\^?\d+\]/g, "").trim().slice(0, AGENT_ANSWER_LIMITS.MAX_BLOCK_CHARS)
      : "";
    if (!text) continue;
    const ids = (v: unknown) =>
      Array.isArray(v)
        ? [...new Set(v.filter((x) => typeof x === "string" && x.trim()).map((x) => String(x).trim()))]
          .slice(0, AGENT_ANSWER_LIMITS.MAX_CLAIM_REFS)
        : [];
    out.push({
      type,
      text,
      claim_ids: ids(r.claim_ids),
      ...(Array.isArray(r.source_ids) ? { source_ids: ids(r.source_ids) } : {}),
    });
  }
  return out;
}

export type BlockStatus = "accepted" | "framing" | "requires_repair";

export interface GatedBlock {
  index: number;
  block: AgentAnswerBlock;
  status: BlockStatus;
  verified_claim_ids: string[];
  failed_claim_ids: string[];
  unknown_claim_ids: string[];
  /** Model-supplied source ids that do not match any verified claim of the block. */
  untrusted_source_ids: string[];
  /** Derived from verified claims only — the only citations ever rendered. */
  derived_source_ids: string[];
}

export interface GateResult {
  blocks: GatedBlock[];
  accepted: DraftBlock[];
  requires_repair: GatedBlock[];
  claims_referenced_but_unverified: string[];
}

/**
 * `memoClaimIds` = every claim the agent submitted; `pack` = what survived
 * verification + temporal gate. A claim id outside the memo is "unknown".
 */
export function gateAnswerBlocks(
  blocks: AgentAnswerBlock[],
  pack: VerifiedEvidencePack,
  memoClaimIds: Iterable<string>,
): GateResult {
  const memoIds = new Set(memoClaimIds);
  const verified = new Map(pack.claims.map((c) => [c.claim_id, c]));
  const gated: GatedBlock[] = blocks.map((block, index) => {
    const verified_claim_ids: string[] = [];
    const failed_claim_ids: string[] = [];
    const unknown_claim_ids: string[] = [];
    for (const id of block.claim_ids) {
      if (verified.has(id)) verified_claim_ids.push(id);
      else if (memoIds.has(id)) failed_claim_ids.push(id);
      else unknown_claim_ids.push(id);
    }
    const derived = new Set<string>();
    for (const id of verified_claim_ids) {
      for (const s of verified.get(id)!.sources) derived.add(s.source_id);
    }
    const untrusted_source_ids = (block.source_ids ?? []).filter((s) => !derived.has(s));
    const status: BlockStatus = failed_claim_ids.length || unknown_claim_ids.length
      ? "requires_repair"
      : verified_claim_ids.length
      ? "accepted"
      : "framing";
    return {
      index,
      block,
      status,
      verified_claim_ids,
      failed_claim_ids,
      unknown_claim_ids,
      untrusted_source_ids,
      derived_source_ids: [...derived],
    };
  });
  const unverified = new Set<string>();
  for (const g of gated) for (const id of [...g.failed_claim_ids, ...g.unknown_claim_ids]) unverified.add(id);
  return {
    blocks: gated,
    // Headings never carry citations; framing blocks carry none either.
    accepted: gated
      .filter((g) => g.status !== "requires_repair")
      .map((g) => ({
        type: g.block.type,
        text: g.block.text,
        source_ids: g.block.type === "heading" ? [] : g.derived_source_ids,
      })),
    requires_repair: gated.filter((g) => g.status === "requires_repair"),
    claims_referenced_but_unverified: [...unverified],
  };
}

export function wordCount(blocks: Array<{ text: string }>): number {
  return blocks.map((b) => b.text).join(" ").split(/\s+/).filter(Boolean).length;
}

export function buildAgentAnswerRepairMessage(input: {
  blocks: AgentAnswerBlock[];
  gate: GateResult;
  pack: VerifiedEvidencePack;
  rejected: RejectedPair[];
  unsupported: Array<{ claim_id: string; proposition: string }>;
}): string {
  const answer = input.blocks
    .map((b, i) => `[${i + 1}] (${b.type}; claims: ${b.claim_ids.join(", ") || "—"}) ${b.text}`)
    .join("\n");
  const verified = input.pack.claims
    .map((c) => `- ${c.claim_id}: ${c.proposition} (מקורות: ${c.sources.map((s) => s.source_id).join(", ")})`)
    .join("\n");
  const failedIds = new Set(input.gate.claims_referenced_but_unverified);
  const reasons: string[] = [];
  for (const id of failedIds) {
    const u = input.unsupported.find((c) => c.claim_id === id);
    const rej = input.rejected.filter((r) => r.claim_id === id);
    if (!u && !rej.length) {
      reasons.push(`- ${id}: אינו קיים בתזכיר שהגשת (claim_id לא מוכר)`);
      continue;
    }
    const why = rej.length
      ? rej.map((r) => `${r.source_id}: ${r.reason}${r.detail ? ` (${r.detail})` : ""}`).join("; ")
      : "נפלה באימות (ללא ראיה מאומתת או בשל בדיקת תוקף עדכני)";
    reasons.push(`- ${id}${u ? ` — ${u.proposition}` : ""}: ${why}`);
  }
  const affected = input.gate.requires_repair.map((g) => g.index + 1).join(", ");
  return `האימות הסתיים. חלק מהטענות שעליהן נשענת התשובה שכתבת לא עברו אימות. סבב תיקון אחד בלבד.

התשובה שכתבת (בלוקים ממוספרים):
${answer}

בלוקים הדורשים תיקון: ${affected || "(אין)"}

טענות שנכשלו והסיבה המדויקת:
${reasons.join("\n") || "(אין)"}

טענות מאומתות שנותרו (מותר להסתמך עליהן):
${verified || "(אין)"}

הנחיה:
- תקן את התשובה כך שכל טענה מהותית תישען רק על claims מאומתים.
- שמור ככל האפשר על איכות, מבנה ורצף התשובה המקורית. אל תכתוב מחדש בלוקים שאינם דורשים שינוי.
- אם ניתן לבסס טענה באמצעות חומר שכבר נקרא (quote_id שמור או ציטוט מילולי) — הוסף claim מתאים עם ראיה, והוא יעבור אימות מלא לפני פרסום.
- מחקר נוסף מותר רק אם הוא באמת נחוץ ונותר תקציב.
- אם לא ניתן לבסס — הסר, סייג או נסח מחדש. אל תמציא authority או תוכן שאינו בראיות.
- הגש שוב submit_research_memo מלא: claims (כולל המאומתים שבהם אתה ממשיך להשתמש) ו-answer_blocks המתוקנים.`;
}
