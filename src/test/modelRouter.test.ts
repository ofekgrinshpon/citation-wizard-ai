import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseRouterOutput,
  routeModel,
  ROUTE_MODELS,
  buildRouterUserMessage,
  answerDirectChat,
  OUT_OF_SCOPE_REPLY_HE,
} from "../../supabase/functions/legal-research-v2/beta/modelRouter.ts";

const ok = (content: string) => async () => ({
  ok: true, http_status: 200, terminal: false, content, tool_calls: [], finish_reason: "stop",
  prompt_tokens: 50, completion_tokens: 10,
}) as never;

describe("Sol/Astra router", () => {
  it("R1 parses sol/astra only", () => {
    expect(parseRouterOutput('{"model":"sol","reason":"x"}')?.model).toBe("sol");
    expect(parseRouterOutput('```json\n{"model":"ASTRA","reason":"y"}\n```')?.model).toBe("astra");
    expect(parseRouterOutput('{"model":"luna"}')).toBeNull();
    expect(parseRouterOutput("garbage")).toBeNull();
  });

  it("R2 maps choice to model id with telemetry", async () => {
    const r = await routeModel({ question: "תציע לי שאלת מחקר", has_attachments: false }, { chat: ok('{"model":"sol","reason":"רעיונות"}') });
    expect(r.model_id).toBe(ROUTE_MODELS.sol);
    expect(r.source).toBe("router");
    expect(r.reason).toBe("רעיונות");
    expect(r.router_prompt_tokens).toBe(50);
  });

  it("R3 any failure falls back to Astra and never throws", async () => {
    const bad = await routeModel({ question: "q", has_attachments: false }, { chat: ok("no json") });
    expect(bad.model).toBe("astra");
    expect(bad.source).toBe("fallback");
    const thrown = await routeModel({ question: "q", has_attachments: false }, { chat: (async () => { throw new Error("x"); }) as never });
    expect(thrown.model).toBe("astra");
    const http = await routeModel({ question: "q", has_attachments: false }, {
      chat: (async () => ({ ok: false, http_status: 503, terminal: false, error: "down", content: "", tool_calls: [], finish_reason: null, prompt_tokens: 0, completion_tokens: 0 })) as never,
    });
    expect(http.model).toBe("astra");
    expect(http.router_error).toMatch(/503/);
  });

  it("R4 academic chapters go to Astra without a router call", async () => {
    let called = false;
    const r = await routeModel({ question: "q", has_attachments: false, academic: true }, { chat: (async () => { called = true; }) as never });
    expect(called).toBe(false);
    expect(r.model).toBe("astra");
  });

  it("R5 router input = last message + recent context + attachments flag, no deliverable classes", () => {
    const m = buildRouterUserMessage({ question: "שאלה", conversation_context: "הקשר", has_attachments: true });
    expect(m).toContain("שאלה");
    expect(m).toContain("הקשר");
    expect(m).toContain("כן");
  });

  it("R6 routed model feeds intake.agent_model; verifier/budgets untouched", () => {
    const idx = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
    expect(idx).toMatch(/input\.model_route\?\.model_id/);
    expect(idx).toMatch(/model_selected: intake\.model_route/);
    const router = readFileSync("supabase/functions/legal-research-v2/beta/modelRouter.ts", "utf8");
    expect(router).not.toMatch(/budgets|max_agent_steps|verifyClaim/);
  });

  const route = (json: string, extra: Record<string, unknown> = {}) =>
    routeModel({ question: "q", has_attachments: false, allow_direct: true, ...extra } as never, { chat: ok(json) });

  it("A1 recipe → out_of_scope, Sol, no research", async () => {
    const r = await route('{"action":"out_of_scope","model":"astra","reason":"לא משפטי"}', { question: "כתוב לי מתכון לעוגה" });
    expect(r.action).toBe("out_of_scope");
    expect(r.model).toBe("sol");
    expect(OUT_OF_SCOPE_REPLY_HE).toMatch(/עוזר משפטי/);
  });

  it("A2 follow-up clarification → chat on Sol", async () => {
    const r = await route('{"action":"chat","model":"sol","reason":"הבהרה"}', { question: "מה התכוונת במה שאמרת קודם?" });
    expect(r.action).toBe("chat");
    expect(r.model_id).toBe(ROUTE_MODELS.sol);
  });

  it("A3 case-law search / original research question → research", async () => {
    expect((await route('{"action":"research","model":"sol","reason":"איתור"}')).action).toBe("research");
    const q = await route('{"action":"research","model":"astra","reason":"מקוריות"}');
    expect(q.action).toBe("research");
    expect(q.model).toBe("astra");
  });

  it("A4 general topics may be chat; old {model} output still means research", async () => {
    expect((await route('{"action":"chat","model":"sol","reason":"x"}')).action).toBe("chat");
    expect(parseRouterOutput('{"model":"sol"}')?.action).toBe("research");
    expect(parseRouterOutput('{"action":"banana","model":"sol"}')).toBeNull();
  });

  it("A5 direct turns are impossible with attachments or outside the chat", async () => {
    expect((await route('{"action":"chat","model":"sol"}', { has_attachments: true })).action).toBe("research");
    expect((await route('{"action":"out_of_scope","model":"sol"}', { allow_direct: false })).action).toBe("research");
  });

  it("A6 direct chat answer is a single Sol call; direct path skips search/verifier/footnotes/charge", async () => {
    let model = "";
    const r = await answerDirectChat({ question: "q" }, { chat: (async (a: { model: string }) => { model = a.model; return { ok: true, content: "תשובה", prompt_tokens: 1, completion_tokens: 1 }; }) as never });
    expect(r.ok).toBe(true);
    expect(model).toBe(ROUTE_MODELS.sol);
    const idx = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
    const direct = idx.slice(idx.indexOf("Direct turns (out_of_scope / chat)"), idx.indexOf("Account-level concurrency protection"));
    expect(direct).not.toMatch(/consume_credits|driveRun|verif|footnotes:/);
    expect(direct).toMatch(/research_started: false/);
    expect(idx.indexOf("Direct turns")).toBeLessThan(idx.indexOf('"consume_credits"'));
  });
});
