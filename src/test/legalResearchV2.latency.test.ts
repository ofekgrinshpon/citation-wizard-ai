import { describe, expect, it } from "vitest";

import { RunTimer } from "../../supabase/functions/legal-research-v2/shared/timing";
import { decideResearchRepair } from "../../supabase/functions/legal-research-v2/verification/repairPolicy";
import { AcquisitionLedger } from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import {
  CONTEXT,
  compactAgentMessages,
  dropPriorStateMessages,
} from "../../supabase/functions/legal-research-v2/agent/contextWindow";
import type { VerificationOutcome } from "../../supabase/functions/legal-research-v2/types";

function outcome(input: {
  claims?: number;
  unsupportedCore?: boolean;
  reason?: string;
}): VerificationOutcome {
  return {
    pack: {
      claims: Array.from({ length: input.claims ?? 0 }, (_v, i) => ({
        claim_id: `C${i}`,
        proposition: "p",
        importance: "core" as const,
        support_status: "supported" as const,
        sources: [],
      })),
      unsupported_claims: input.unsupportedCore
        ? [{ claim_id: "CX", proposition: "p", importance: "core" as const, reasons: [] }]
        : [],
    },
    rejected: input.unsupportedCore
      ? [{
        claim_id: "CX",
        source_id: "S1",
        // deno-lint-ignore no-explicit-any
        reason: (input.reason ?? "span_not_found") as any,
        detail: "",
      }]
      : [],
    counters: {
      total_evidence_pairs: 0,
      identity_verified_pairs: 0,
      span_verified_pairs: 0,
      support_verdicts: { supports: 0, supports_partially: 0, does_not_support: 0 },
    },
  };
}

describe("RunTimer", () => {
  it("accumulates phase totals and survives serialization", async () => {
    const t = new RunTimer();
    t.add("agent_model", 120);
    await t.time("fetch", async () => "x");
    t.noteTurn({
      turn: 1,
      chunk: 1,
      model_ms: 120,
      tool_ms: 5,
      prompt_tokens: 10,
      completion_tokens: 2,
      cumulative_prompt_tokens: 10,
      context_chars: 500,
      action: "search",
      added_evidence: true,
      no_op: false,
    });
    const round = RunTimer.fromJSON(t.toJSON());
    expect(round.totalsMs().agent_model).toBe(120);
    expect(round.toJSON().counts.fetch).toBe(1);
    expect(round.turns).toHaveLength(1);
  });
});

describe("selective repair policy", () => {
  it("does not reopen research when nothing core is unsupported", () => {
    expect(decideResearchRepair(outcome({ claims: 2 })).repair).toBe(false);
  });

  it("reopens research when a body was missing or unreadable", () => {
    const d = decideResearchRepair(outcome({ claims: 2, unsupportedCore: true, reason: "fetch_failed" }));
    expect(d).toEqual({ repair: true, reason: "unreadable_or_missing_body" });
  });

  it("narrows instead of reopening when the span failed on a body that was read", () => {
    const d = decideResearchRepair(outcome({ claims: 2, unsupportedCore: true, reason: "span_not_found" }));
    expect(d).toEqual({ repair: false, reason: "narrowable_to_verified_propositions" });
  });

  it("always reopens when nothing at all verified", () => {
    const d = decideResearchRepair(outcome({ claims: 0, unsupportedCore: true, reason: "span_not_found" }));
    expect(d).toEqual({ repair: true, reason: "no_verified_claims" });
  });
});

describe("acquisition ledger authority state", () => {
  it("recognises an already attempted URL and reports usable bodies", () => {
    const l = new AcquisitionLedger();
    l.note("case:1000/92", {
      url: "https://a.example/doc?id=1",
      outcome: "failed",
      reason: "fetch_error",
      at: new Date().toISOString(),
    });
    expect(l.attemptOn("case:1000/92", "https://a.example/doc?id=1/")?.outcome).toBe("failed");
    expect(l.attemptOn("case:1000/92", "https://b.example/x")).toBeNull();
    expect(l.state("case:1000/92")?.unresolved).toBe(true);

    l.note("case:1000/92", {
      url: "https://b.example/x",
      outcome: "acquired",
      reason: "ok",
      at: new Date().toISOString(),
    }, "S4");
    expect(l.state("case:1000/92")?.usable_body_source_id).toBe("S4");
    expect(l.state("case:1000/92")?.unresolved).toBe(false);
  });
});

describe("context window compaction", () => {
  it("keeps recent tool payloads verbatim and digests stale ones", () => {
    const big = "x".repeat(5_000);
    const messages = Array.from({ length: 8 }, (_v, i) => ({
      role: "tool" as const,
      tool_call_id: `t${i}`,
      content: big,
      digest: `digest-${i}`,
    }));
    const out = compactAgentMessages(messages);
    expect(out.compacted).toBe(8 - CONTEXT.KEEP_RECENT_TOOL_MESSAGES);
    expect(out.chars_saved).toBeGreaterThan(0);
    expect(out.messages[0].content).toBe("digest-0");
    expect(out.messages[7].content).toBe(big);
  });

  it("keeps only one rolling state message", () => {
    const messages = [
      { role: "system" as const, content: "sys" },
      { role: "user" as const, content: "the question" },
      { role: "user" as const, content: `${CONTEXT.STATE_MARKER}\nold state` },
    ];
    const out = dropPriorStateMessages(messages);
    expect(out).toHaveLength(2);
    expect(out[1].content).toBe("the question");
  });
});
