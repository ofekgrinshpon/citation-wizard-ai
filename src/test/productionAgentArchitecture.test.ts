/**
 * Production architecture: Astra research agent writes the answer, ask_user
 * pause/resume on the same run, answer-block coverage safeguard, and
 * claim-specific statute locators.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_AGENT_MODEL,
  separateDrafterEnabled,
} from "../../supabase/functions/legal-research-v2/shared/model";
import {
  applyBlockCoverage,
  gateAnswerBlocks,
} from "../../supabase/functions/legal-research-v2/drafting/draft";
import { renderAnswer } from "../../supabase/functions/legal-research-v2/drafting/render";
import {
  applyUserReply,
  AWAITING_USER_STATUS,
  parseAskUserArgs,
} from "../../supabase/functions/legal-research-v2/beta/clarification";
import { decideAutoResume } from "../../supabase/functions/legal-research-v2/beta/resumePolicy";
import type { VerifiedEvidencePack } from "../../supabase/functions/legal-research-v2/types";

const indexSrc = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
const agentSrc = readFileSync("supabase/functions/legal-research-v2/agent/researchAgent.ts", "utf8");
const promptSrc = readFileSync("supabase/functions/legal-research-v2/agent/prompt.ts", "utf8");

const pack: VerifiedEvidencePack = {
  claims: [
    {
      claim_id: "C1",
      proposition: "סעיף 12 לחוק זכות יוצרים מגדיר מיצוי",
      importance: "core",
      support_status: "supported",
      sources: [{ source_id: "S1", display_title: "חוק זכות יוצרים, התשס\"ח-2007", verified_span: "x", locator: "ס' 12", support: "supports" }],
    },
    {
      claim_id: "C2",
      proposition: "סעיף 37 עוסק בשימוש מותר",
      importance: "core",
      support_status: "supported",
      sources: [{ source_id: "S1", display_title: "חוק זכות יוצרים, התשס\"ח-2007", verified_span: "y", locator: "ס' 37", support: "supports" }],
    },
  ],
  unsupported_claims: [],
};

const savedRow = (status: string) => ({
  status,
  agent_state: {
    resume: {
      agent_state: {
        messages: [{ role: "system", content: "sys" }, { role: "user", content: "q" }],
        policy: { steps: 7, search_calls: 3, fetch_calls: 4 },
        store: { sources: [{ source_id: "S1" }], quotes: [{ quote_id: "S1-q1" }] },
        ledger: { targets: ["case:1"] },
        discovered: [["R1", {}]],
        trace: [{ step: 1 }],
        stats: { ask_user_calls: 1 },
      },
      chunk_index: 2,
      usage: { model_calls: 9 },
      started_at: 1000,
      timing: { phases: {} },
      awaiting_since: 5000,
    },
    intake: { run_id: "r1", question: "q", agent_model: null },
    job: { id: "j1", user_id: "u1", credit_request_id: "c1" },
    stage: "reading",
    awaiting_user: { question: "?" },
  },
});

describe("architecture defaults", () => {
  it("T1 production default Research Agent is Astra", () => {
    expect(DEFAULT_AGENT_MODEL).toBe("openai/gpt-6-astra");
  });

  it("T2 answer path is agent-authored; the drafter is only reached in the rollback branch", () => {
    expect(separateDrafterEnabled(() => undefined)).toBe(false);
    expect(indexSrc).toMatch(/output_mode !== "sources" && !separateDrafterEnabled\(\)/);
    const agentBranch = indexSrc.indexOf("if (intake.agent_authored_answer) {");
    const drafterCall = indexSrc.indexOf("runDrafter({");
    const elseBranch = indexSrc.indexOf("} else {", agentBranch);
    expect(agentBranch).toBeGreaterThan(0);
    expect(drafterCall).toBeGreaterThan(elseBranch);
    expect(indexSrc).not.toMatch(/agent_authored_answer: body\.agent_authored_answer/);
  });

  it("T3 emergency flag restores the separate drafter", () => {
    expect(separateDrafterEnabled((k) => (k === "V2_USE_SEPARATE_DRAFTER" ? "true" : undefined))).toBe(true);
    expect(separateDrafterEnabled((k) => (k === "V2_USE_SEPARATE_DRAFTER" ? "false" : undefined))).toBe(false);
  });
});

describe("answer blocks", () => {
  it("T4 a verified block renders with its footnote", () => {
    const gate = gateAnswerBlocks([{ type: "paragraph", text: "מיצוי.", claim_ids: ["C1"] }], pack, ["C1", "C2"]);
    const out = renderAnswer(gate.accepted, pack);
    expect(out.footnotes).toHaveLength(1);
    expect(out.answer_markdown).toContain("¹");
  });

  it("T5 a block saying more than its claims goes to repair", () => {
    const gate = gateAnswerBlocks([{ type: "paragraph", text: "מיצוי, וגם הלכה נוספת.", claim_ids: ["C1"] }], pack, ["C1"]);
    const after = applyBlockCoverage(gate, [{ block_index: 0, coverage: "overclaims", reason: "הלכה נוספת" }]);
    expect(after.requires_repair).toHaveLength(1);
    expect(after.accepted).toHaveLength(0);
    expect(after.requires_repair[0].coverage_issue).toMatch(/^overclaims/);
  });

  it("T6 heading and pure framing blocks may exist without claim_ids", () => {
    const gate = gateAnswerBlocks([
      { type: "heading", text: "מבוא", claim_ids: [] },
      { type: "paragraph", text: "פרק זה בוחן את השאלה.", claim_ids: [] },
    ], pack, []);
    const after = applyBlockCoverage(gate, [{ block_index: 1, coverage: "framing" }]);
    expect(after.accepted).toHaveLength(2);
    expect(after.requires_repair).toHaveLength(0);
  });

  it("T7 a substantive claimless block cannot publish", () => {
    const gate = gateAnswerBlocks([{ type: "paragraph", text: "בית המשפט קבע כי...", claim_ids: [] }], pack, []);
    const after = applyBlockCoverage(gate, [{ block_index: 0, coverage: "substantive" }]);
    expect(after.accepted).toHaveLength(0);
    expect(after.requires_repair).toHaveLength(1);
  });
});

describe("ask_user pause / resume", () => {
  it("T8 ask_user parks the run in awaiting_user (never done)", () => {
    expect(parseAskUserArgs({ question: "עובד–מעסיק או מסחרי?", options: ["א", "ב", "א"] }))
      .toEqual({ question: "עובד–מעסיק או מסחרי?", options: ["א", "ב"] });
    expect(parseAskUserArgs({ question: "" })).toBeNull();
    expect(indexSrc).toMatch(/out\.paused && out\.awaiting_user/);
    expect(indexSrc).toMatch(/status: AWAITING_USER_STATUS/);
    expect(agentSrc).toMatch(/if \(awaitingUser\) break;/);
  });

  it("T9 the full research state survives the pause", () => {
    const d = applyUserReply({ row: savedRow(AWAITING_USER_STATUS), reply: "מסחרי", userId: "u1", now: 9000 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const r = d.agent_state.resume;
    expect(r.agent_state.store).toEqual(savedRow("x").agent_state.resume.agent_state.store);
    expect(r.agent_state.ledger).toEqual({ targets: ["case:1"] });
    expect(r.agent_state.trace).toEqual([{ step: 1 }]);
    expect(r.usage).toEqual({ model_calls: 9 });
    expect(r.started_at).toBe(1000);
    expect(d.agent_state.intake.run_id).toBe("r1");
    expect(d.agent_state.job.id).toBe("j1");
  });

  it("T10 the reply resumes the same run and EvidenceStore", () => {
    const d = applyUserReply({ row: savedRow(AWAITING_USER_STATUS), reply: "מסחרי", userId: "u1", now: 9000 });
    if (!d.ok) throw new Error("expected ok");
    const msgs = d.agent_state.resume.agent_state.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[2].role).toBe("user");
    expect(msgs[2].content).toContain("מסחרי");
    expect(applyUserReply({ row: savedRow("done"), reply: "x", userId: "u1", now: 1 }).ok).toBe(false);
    expect(applyUserReply({ row: savedRow(AWAITING_USER_STATUS), reply: "x", userId: "other", now: 1 }).ok).toBe(false);
  });

  it("T11 budgets do not reset after the reply", () => {
    const d = applyUserReply({ row: savedRow(AWAITING_USER_STATUS), reply: "x", userId: "u1", now: 1 });
    if (!d.ok) throw new Error("expected ok");
    expect(d.agent_state.resume.agent_state.policy).toEqual({ steps: 7, search_calls: 3, fetch_calls: 4 });
    expect(d.agent_state.resume.chunk_index).toBe(2);
  });

  it("T12 resuming after a reply never consumes credits", () => {
    const start = indexSrc.indexOf("if (clarificationReply) {");
    const end = indexSrc.indexOf("// ══ Beta production entry", start);
    const handler = indexSrc.slice(start, end);
    expect(handler.length).toBeGreaterThan(100);
    expect(handler).not.toMatch(/consume_credits/);
    expect(handler).toMatch(/\.eq\("status", AWAITING_USER_STATUS\)/);
  });

  it("T13 the watchdog and the stale-job reaper ignore awaiting_user", () => {
    const d = decideAutoResume({
      run_id: "r1",
      status: AWAITING_USER_STATUS,
      agent_state: { resume: {} },
      last_beat_at: new Date(0).toISOString(),
      created_at: new Date().toISOString(),
      auto_resume_count: 0,
      watchdog_claimed_at: null,
    } as never, Date.now());
    expect(d.automatic_resume_triggered).toBe(false);
    expect(indexSrc).toMatch(/\.in\("status", \["running", "paused"\]\)/);
  });

  it("T14 two clarification turns stay bounded and keep state", () => {
    const first = applyUserReply({ row: savedRow(AWAITING_USER_STATUS), reply: "א", userId: "u1", now: 1 });
    if (!first.ok) throw new Error("expected ok");
    const second = applyUserReply({
      row: { status: AWAITING_USER_STATUS, agent_state: first.agent_state },
      reply: "ב",
      userId: "u1",
      now: 2,
    });
    if (!second.ok) throw new Error("expected ok");
    const msgs = second.agent_state.resume.agent_state.messages;
    expect(msgs.map((m) => m.role)).toEqual(["system", "user", "user", "user"]);
    expect(second.agent_state.resume.agent_state.store).toEqual(first.agent_state.resume.agent_state.store);
    // No hard one-question cap, but repairs never ask and the prompt discourages it.
    expect(indexSrc.match(/allowAskUser: false/g)?.length).toBeGreaterThanOrEqual(3);
    expect(promptSrc).toMatch(/אם ניתן לקבל החלטה סבירה ולהמשיך — המשך בלי לשאול/);
  });

  it("T16 a normal question can finish without ask_user (never forced)", () => {
    expect(agentSrc).toMatch(/toolChoice: forceMemo \? \{ name: memoTool\.name \} : "auto"/);
    expect(agentSrc).not.toMatch(/name: "ask_user" \}/);
  });

  it("T17 academic-style requests use the same path without academic_context", () => {
    // Agent-authored answer is decided only by output_mode + rollback flag.
    const block = indexSrc.slice(indexSrc.indexOf("Production answer path: the agent writes"), indexSrc.indexOf("academic_context: input.academic_context"));
    expect(block).not.toMatch(/academic/);
  });
});

describe("statute locator", () => {
  it("T15 locator is claim-specific for two sections of the same statute", () => {
    const gate = gateAnswerBlocks([
      { type: "paragraph", text: "על מיצוי.", claim_ids: ["C1"] },
      { type: "paragraph", text: "על שימוש מותר.", claim_ids: ["C2"] },
    ], pack, ["C1", "C2"]);
    const out = renderAnswer(gate.accepted, pack);
    expect(out.footnotes[0].citation).toContain("ס' 12");
    expect(out.footnotes[1].citation).toContain("37");
    expect(out.footnotes[1].citation).not.toContain("12");
  });
});
