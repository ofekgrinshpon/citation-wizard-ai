import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  freezeForCheckpoint, isValidMemoReady, MEMO_READY_VERSION, restoreMemoReadyResult,
} from "../../supabase/functions/legal-research-v2/beta/memoCheckpoint.ts";
import { forcedMemoCallsValid } from "../../supabase/functions/legal-research-v2/agent/researchAgent.ts";

const idx = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
const agentSrc = readFileSync("supabase/functions/legal-research-v2/agent/researchAgent.ts", "utf8");

const state = {
  messages: [{ role: "assistant", content: "x", reasoning_items: [{ type: "reasoning", encrypted_content: "E" }], replay_seq: ["r"] }],
  policy: { steps: 3 }, discovered: [], store: { sources: [] }, commit: {}, ledger: {}, trace: [],
  stats: { awaiting_user_duration_ms: 5 }, memo: { claims: [] },
};
const marker = (o: Record<string, unknown> = {}) => ({
  agent_state: state, chunk_index: 1, usage: { prompt_tokens: 10 }, started_at: 1,
  timing: { phases: {} }, pipeline_phase: "memo_ready", pipeline_phase_version: MEMO_READY_VERSION, ...o,
});

describe("memo_ready marker", () => {
  it("accepts only exact versioned marker with memo", () => {
    expect(isValidMemoReady(marker())).toBe(true);
    expect(isValidMemoReady(marker({ pipeline_phase_version: 2 }))).toBe(false);
    expect(isValidMemoReady(marker({ pipeline_phase: undefined }))).toBe(false); // legacy
    expect(isValidMemoReady(marker({ agent_state: { ...state, memo: null } }))).toBe(false);
    expect(isValidMemoReady(null)).toBe(false);
  });
  it("JSON round-trip keeps state/evidence/replay/budgets/timing and is immutable", () => {
    const m = marker();
    const frozen = freezeForCheckpoint(m);
    (m.agent_state.messages as unknown[]).push({ role: "user", content: "repair" });
    expect(frozen.agent_state.messages).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(frozen))).toEqual(frozen);
    expect(isValidMemoReady(frozen)).toBe(true);
  });
  it("restored result is a completed, non-paused, non-awaiting result", () => {
    const r = restoreMemoReadyResult({ ...state, discovered: new Map() } as never);
    expect(r.paused).toBe(false);
    expect(r.awaiting_user).toBeUndefined();
    expect(r.memo).toEqual({ claims: [] });
  });
  it("pipeline: bypasses only initial research; saves after pause branches, before verification", () => {
    expect(idx).toMatch(/memoReady \? restoreMemoReadyResult\(prior!\) : await runResearchAgent/);
    const save = idx.indexOf("await saveMemoReadyCheckpoint(admin");
    expect(save).toBeGreaterThan(idx.indexOf('pause_kind: "handoff",\n      },\n    };'));
    expect(save).toBeLessThan(idx.indexOf('await opts.progress?.advance("verifying")'));
    expect(idx.slice(save - 80, save)).toContain("!memoReady && agent.memo");
    // repairs still call the agent; no global memo short-circuit in the agent
    expect((idx.match(/await runResearchAgent\(/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(agentSrc).not.toMatch(/if \(prior\.memo\) return/);
  });
  it("save failure: logged, no handoff/retry, returns false", () => {
    const fn = idx.slice(idx.indexOf("export async function saveMemoReadyCheckpoint"), idx.indexOf("async function runPipeline("));
    expect(fn).toContain("return false");
    expect(fn).not.toMatch(/selfInvokeResume|invokeResumeHandoff|awaiting_since/);
  });
});

describe("forced memo tool prefix", () => {
  it("same tools array always; forcing via named toolChoice", () => {
    expect(agentSrc).toContain("tools: toolSpecs,");
    expect(agentSrc).not.toContain("forceMemo ? [memoTool] : toolSpecs");
    expect(agentSrc).toContain('toolChoice: forceMemo ? { name: memoTool.name } : "auto"');
  });
  it("rejects non-memo, mixed and ask_user calls before dispatch", () => {
    expect(forcedMemoCallsValid([{ name: "submit_research_memo" }], "submit_research_memo")).toBe(true);
    expect(forcedMemoCallsValid([{ name: "search" }], "submit_research_memo")).toBe(false);
    expect(forcedMemoCallsValid([{ name: "submit_research_memo" }, { name: "read" }], "submit_research_memo")).toBe(false);
    expect(forcedMemoCallsValid([{ name: "ask_user" }], "submit_research_memo")).toBe(false);
    const check = agentSrc.indexOf("forcedMemoCallsValid(res.tool_calls");
    expect(check).toBeLessThan(agentSrc.indexOf("tool_calls: res.tool_calls.map", check));
    expect(agentSrc.slice(check, check + 160)).toContain("break;");
  });
});
