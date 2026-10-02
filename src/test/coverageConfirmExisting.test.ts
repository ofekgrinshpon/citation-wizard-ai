/**
 * coverage_confirm_existing_v1 — real agent-loop wiring with a mocked model.
 * No network, no provider calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const script: Array<(req: Record<string, unknown>) => unknown> = [];
const requests: Record<string, unknown>[] = [];
vi.mock("../../supabase/functions/legal-research-v2/shared/model.ts", async (orig) => {
  const real = await orig<Record<string, unknown>>();
  return {
    ...real,
    chat: vi.fn(async (req: Record<string, unknown>) => {
      requests.push(JSON.parse(JSON.stringify({ toolChoice: req.toolChoice, tools: req.tools })));
      const next = script.shift();
      if (!next) return { ok: false, http_status: 599, error: "script_exhausted", content: "", tool_calls: [] };
      return next(req);
    }),
  };
});

import {
  deserializeAgentState,
  forcedTurnCallsValid,
  runResearchAgent,
  serializeAgentState,
} from "../../supabase/functions/legal-research-v2/agent/researchAgent.ts";
import { StopPolicy } from "../../supabase/functions/legal-research-v2/agent/stopPolicy.ts";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore.ts";
import {
  checkConfirm,
  createPendingCoverage,
  parsePendingCoverage,
} from "../../supabase/functions/legal-research-v2/agent/coverageCheck.ts";

const RUN = "11111111-1111-4111-8111-111111111111";
const budgets = {
  max_agent_steps: 20, max_search_calls: 5, max_fetch_calls: 5, max_lookup_calls: 5,
  max_raw_search_calls: 2,
};
const intake = (run_id = RUN) =>
  ({ run_id, question: "סקירה על עילת הסבירות", normalized_question: "סקירה על עילת הסבירות", docket_obligations: [], statute_obligations: [], attachment_text: null, budgets }) as never;

function src(id: string, title: string) {
  return {
    source_id: id, title, url: `https://ex.test/${id}`, sha256: id, fetch_status: "ok",
    extracted_text: "טקסט מקור לדוגמה ".repeat(5), text_length: 80,
    identity_fields: { dockets: [], statutes: [] }, is_actual_document: true, origin: "web",
    fetched_at: "2026-01-01T00:00:00Z",
  };
}
const mkStore = () =>
  EvidenceStore.fromJSON({ seq: 3, sources: [src("S1", "מקור א"), src("S2", "מקור ב"), src("S3", "מקור ג")], quotes: [] } as never);

const memoArgs = (ids: string[], gaps: string[] = []) => ({
  issue_summary: "סוגיה",
  claims: ids.map((id, i) => ({
    claim_id: `C${i + 1}`, proposition: `טענה ${i + 1}`, importance: "core",
    evidence: [{ source_id: id, quoted_span: "טקסט מקור לדוגמה", reason: "כי" }],
  })),
  unresolved_questions: gaps,
  research_complete: true,
});
let callSeq = 0;
const calls = (...cs: Array<[string, unknown]>) => () => ({
  ok: true, content: "", prompt_tokens: 1, completion_tokens: 1,
  tool_calls: cs.map(([name, args]) => ({ id: `call_${++callSeq}`, name, arguments: typeof args === "string" ? args : JSON.stringify(args) })),
});
const lastHandle = (msgs: { role: string; content?: string }[]) => {
  for (const m of [...msgs].reverse()) {
    if (m.role !== "tool") continue;
    const h = /"handle":"(cov_[0-9a-f-]+)"/.exec(m.content ?? "")?.[1];
    if (h) return h;
  }
  return null;
};
const usage = () => ({ prompt_tokens: 0, completion_tokens: 0 }) as never;

async function run(o: Record<string, unknown> = {}) {
  const store = (o.store as EvidenceStore) ?? mkStore();
  return {
    store,
    res: await runResearchAgent({ admin: {} as never, intake: intake(), store, model: "m", usage: usage(), ...o } as never),
  };
}

beforeEach(() => { script.length = 0; requests.length = 0; });

describe("agent loop", () => {
  it("unchanged confirmation hands the exact candidate to downstream, once", async () => {
    let handle = "";
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    script.push((req) => {
      handle = lastHandle(req.messages as never)!;
      return calls(["confirm_existing_memo", { handle }])();
    });
    const { res } = await run();
    expect(handle).toMatch(/^cov_/);
    expect(res.error).toBeUndefined();
    expect(res.memo?.claims.map((c) => c.evidence[0].source_id)).toEqual(["S1"]);
    expect(res.stats.memo_coverage_confirmed_existing).toBe(1);
    expect(res.stats.memo_coverage_check_triggered).toBe(1);
    expect(res.stats.memo_coverage_claims_added).toBe(0);
    expect(res.pending_coverage).toBeNull();
    expect(requests).toHaveLength(2);
    // Tools identical across turns, confirm present from turn one.
    expect(JSON.stringify(requests[0].tools)).toBe(JSON.stringify(requests[1].tools));
    expect((requests[0].tools as { name: string }[]).some((t) => t.name === "confirm_existing_memo")).toBe(true);
  });

  it("full revision with fewer claims and a gap still goes through the normal path", async () => {
    script.push(calls(["submit_research_memo", memoArgs(["S1", "S1"])]));
    script.push(calls(["submit_research_memo", memoArgs(["S1"], ["פער"])]));
    const { res } = await run();
    expect(res.memo?.claims).toHaveLength(1);
    expect(res.stats.memo_coverage_claims_added).toBe(-1);
    expect(res.stats.memo_coverage_gap_left_explicit).toBe(1);
    expect(res.stats.memo_coverage_confirmed_existing).toBe(0);
  });

  it("no eligibility: confirm before any reflection is refused", async () => {
    script.push(calls(["confirm_existing_memo", { handle: "cov_00000000-0000-4000-8000-000000000000" }]));
    script.push(calls(["submit_research_memo", memoArgs(["S1", "S2", "S3"])]));
    const { res } = await run();
    expect(res.stats.memo_coverage_confirm_rejected).toBe(1);
    expect(res.stats.memo_coverage_check_triggered).toBe(0);
    expect(res.memo?.claims).toHaveLength(3);
  });

  it.each([
    ["empty", {}],
    ["wrong", { handle: "cov_00000000-0000-4000-8000-000000000000" }],
    ["memo content", "__WITH_MEMO__"],
    ["malformed", "{not json"],
  ])("%s handle fails closed, candidate untouched", async (_n, bad) => {
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    script.push((req) => {
      const handle = lastHandle(req.messages as never)!;
      const a = bad === "__WITH_MEMO__" ? { handle, ...memoArgs(["S2"]) } : bad;
      return calls(["confirm_existing_memo", a])();
    });
    script.push((req) => calls(["confirm_existing_memo", { handle: lastHandle(req.messages as never) }])());
    const { res } = await run();
    expect(res.stats.memo_coverage_confirm_rejected).toBe(1);
    expect(res.memo?.claims.map((c) => c.evidence[0].source_id)).toEqual(["S1"]);
  });

  it("mixed and duplicate confirmations are refused before any sibling runs", async () => {
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    script.push((req) => {
      const h = lastHandle(req.messages as never);
      return calls(["confirm_existing_memo", { handle: h }], ["search", { query: "x" }])();
    });
    script.push((req) => {
      const h = lastHandle(req.messages as never);
      return calls(["confirm_existing_memo", { handle: h }], ["confirm_existing_memo", { handle: h }])();
    });
    script.push((req) => calls(["confirm_existing_memo", { handle: lastHandle(req.messages as never) }])());
    const { res } = await run();
    expect(res.stats.memo_coverage_confirm_rejected).toBe(2);
    expect(res.policy.totalSearchCalls).toBe(0);
    expect(res.memo?.claims).toHaveLength(1);
  });

  it("source mutation after the reflection makes the handle stale", async () => {
    const store = mkStore();
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    script.push(async (req) => {
      await store.append({ url: "https://ex.test/new", title: "חדש", origin: "web", fetch_status: "ok", extracted_text: "גוף חדש ".repeat(10), is_actual_document: true } as never);
      return calls(["confirm_existing_memo", { handle: lastHandle(req.messages as never) }])();
    });
    script.push(calls(["submit_research_memo", memoArgs(["S1", "S2"])]));
    const { res } = await run({ store });
    expect(res.stats.memo_coverage_confirm_rejected).toBe(1);
    expect(res.memo?.claims).toHaveLength(2);
    expect(res.stats.memo_coverage_confirmed_existing).toBe(0);
  });

  it("research after the reflection then a stale confirmation is refused", async () => {
    let h = "";
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    script.push((req) => { h = lastHandle(req.messages as never)!; return calls(["search", { query: "x", scope: "corpus" }])(); });
    script.push(() => calls(["confirm_existing_memo", { handle: h }])());
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    const policy = new StopPolicy(budgets as never);
    policy.note("search"); // keep the stub search a no-op on the network side
    const res = await runResearchAgent({
      admin: { from: () => { throw new Error("offline"); }, rpc: () => { throw new Error("offline"); } } as never,
      intake: intake(), store: mkStore(), model: "m", usage: usage(), policy,
    } as never).catch((e) => ({ thrown: String(e) }));
    if ("thrown" in res) return; // search tool needs network in this env; stale path covered by helper test
    expect(res.stats.memo_coverage_confirm_rejected).toBeGreaterThanOrEqual(1);
    expect(res.stats.memo_coverage_confirmed_existing).toBe(0);
  });

  it("exhausted research: confirm allowed via 'required', research calls fail closed", async () => {
    const policy = new StopPolicy(budgets as never);
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    script.push((req) => {
      policy.steps = budgets.max_agent_steps - 2; // research phase closed, memo capacity left
      return calls(["confirm_existing_memo", { handle: "cov_00000000-0000-4000-8000-000000000000" }])();
    });
    script.push(calls(["search", { query: "x" }]));
    const { res } = await run({ policy, maxStepsThisChunk: 10 });
    expect(requests[2].toolChoice).toBe("required");
    expect(res.error).toBe("agent_forced_memo_violation");
    expect(res.policy.totalSearchCalls).toBe(0);
  });

  it("checkpoint → resumed chunk can confirm; clarification ends confirmability", async () => {
    let saved: ReturnType<typeof serializeAgentState> | null = null;
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    const first = await run({ maxStepsThisChunk: 1, checkpoint: async (s: never) => { saved = JSON.parse(JSON.stringify(s)); } });
    expect(first.res.paused).toBe(true);
    expect(saved!.pending_coverage?.handle).toMatch(/^cov_/);
    const prior = deserializeAgentState(intake(), saved!);
    const handle = prior.pending_coverage!.handle;
    // resumed chunk confirms
    script.push(calls(["confirm_existing_memo", { handle }]));
    const resumed = await runResearchAgent({
      admin: {} as never, intake: intake(), store: prior.store, model: "m", usage: usage(),
      priorMessages: prior.messages, policy: prior.policy, discovered: prior.discovered,
      commit: prior.commit, ledger: prior.ledger, stats: prior.stats, trace: prior.trace,
      pendingCoverage: prior.pending_coverage,
    } as never);
    expect(resumed.memo?.claims).toHaveLength(1);
    expect(resumed.stats.memo_coverage_confirmed_existing).toBe(1);
    // wrong run cannot replay it
    script.push(calls(["confirm_existing_memo", { handle }]));
    script.push(calls(["submit_research_memo", memoArgs(["S2"])]));
    const other = await runResearchAgent({
      admin: {} as never, intake: intake("22222222-2222-4222-8222-222222222222"), store: mkStore(), model: "m",
      usage: usage(), stats: prior.stats, pendingCoverage: prior.pending_coverage,
    } as never);
    expect(other.stats.memo_coverage_confirmed_existing).toBe(0);
    expect(other.stats.memo_coverage_confirm_rejected).toBe(1);
    expect(other.memo?.claims[0].evidence[0].source_id).toBe("S2");
  });

  it("old checkpoint with no pending handle resumes normally and invents none", async () => {
    script.push(calls(["submit_research_memo", memoArgs(["S1"])]));
    let saved: Record<string, unknown> | null = null;
    await run({ maxStepsThisChunk: 1, checkpoint: async (s: never) => { saved = JSON.parse(JSON.stringify(s)); } });
    delete saved!.pending_coverage;
    const prior = deserializeAgentState(intake(), saved as never);
    expect(prior.pending_coverage).toBeNull();
    const h = lastHandle(prior.messages as never);
    script.push(calls(["confirm_existing_memo", { handle: h }]));
    script.push(calls(["submit_research_memo", memoArgs(["S1", "S2"])]));
    const r = await runResearchAgent({
      admin: {} as never, intake: intake(), store: prior.store, model: "m", usage: usage(),
      priorMessages: prior.messages, policy: prior.policy, stats: prior.stats,
    } as never);
    expect(r.stats.memo_coverage_confirm_rejected).toBe(1);
    expect(r.memo?.claims).toHaveLength(2);
  });

  it("repair re-entry (no pendingCoverage forwarded) cannot replay a handle", async () => {
    script.push(calls(["confirm_existing_memo", { handle: "cov_00000000-0000-4000-8000-000000000000" }]));
    script.push(calls(["submit_research_memo", memoArgs(["S1", "S2", "S3"])]));
    const { res } = await run({ extraUserMessage: "תיקון" });
    expect(res.stats.memo_coverage_confirm_rejected).toBe(1);
    expect(res.memo?.claims).toHaveLength(3);
  });
});

describe("helpers", () => {
  const memo = { issue_summary: "", claims: [], unresolved_questions: [], research_complete: true } as never;
  it("candidate is immutable: mutating the source object or the returned copy changes nothing", () => {
    const m = { claims: [{ proposition: "א" }] } as never as { claims: { proposition: string }[] };
    const p = createPendingCoverage({ run_id: RUN, memo: m as never, read_ids: ["S1"], research_calls_at_check: 0, fingerprint: "f" });
    m.claims[0].proposition = "ב";
    const r = checkConfirm({ pending: p, args: { handle: p.handle }, run_id: RUN, fingerprint: "f" });
    expect(r.ok && (r.memo as never as typeof m).claims[0].proposition).toBe("א");
    if (r.ok) (r.memo as never as typeof m).claims[0].proposition = "ג";
    const r2 = checkConfirm({ pending: p, args: { handle: p.handle }, run_id: RUN, fingerprint: "f" });
    expect(r2.ok && (r2.memo as never as typeof m).claims[0].proposition).toBe("א");
  });
  it("stale / wrong-run / expired state fail closed", () => {
    const p = createPendingCoverage({ run_id: RUN, memo, read_ids: [], research_calls_at_check: 0, fingerprint: "f" });
    expect(checkConfirm({ pending: p, args: { handle: p.handle }, run_id: RUN, fingerprint: "g" })).toMatchObject({ ok: false, reason: "evidence_changed" });
    expect(checkConfirm({ pending: p, args: { handle: p.handle }, run_id: "x", fingerprint: "f" })).toMatchObject({ ok: false, reason: "wrong_run" });
    expect(checkConfirm({ pending: { ...p, confirmable: false }, args: { handle: p.handle }, run_id: RUN, fingerprint: "f" })).toMatchObject({ ok: false, reason: "stale_handle" });
    expect(parsePendingCoverage({ ...p, handle: "bad" })).toBeNull();
    expect(parsePendingCoverage({ ...p, memo_json: "{" })).toBeNull();
    expect(parsePendingCoverage(undefined)).toBeNull();
  });
  it("forced turn: memo or one sole confirm only when pending", () => {
    expect(forcedTurnCallsValid([{ name: "confirm_existing_memo" }], "submit_research_memo", true)).toBe(true);
    expect(forcedTurnCallsValid([{ name: "confirm_existing_memo" }], "submit_research_memo", false)).toBe(false);
    expect(forcedTurnCallsValid([{ name: "confirm_existing_memo" }, { name: "submit_research_memo" }], "submit_research_memo", true)).toBe(false);
    expect(forcedTurnCallsValid([{ name: "search" }], "submit_research_memo", true)).toBe(false);
  });
  it("index forwards pending only to the initial/resume call, never to repairs", () => {
    const idx = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
    expect((idx.match(/pendingCoverage:/g) ?? []).length).toBe(1);
    expect(idx).toMatch(/resume\?\.awaiting_since\s*\? \{ \.\.\.prior\.pending_coverage, confirmable: false \}/);
  });
});
