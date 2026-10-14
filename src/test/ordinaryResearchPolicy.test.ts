import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { ORDINARY_RESEARCH_MODEL, ORDINARY_RESEARCH_SETTINGS } from "../../supabase/functions/legal-research-v2/shared/ordinaryResearchPolicy";
import { routeModel, ROUTER_SYSTEM } from "../../supabase/functions/legal-research-v2/beta/modelRouter";
import { chat, modelConfig, newUsageLedger } from "../../supabase/functions/legal-research-v2/shared/model";
import { parseEvaluationReasoningEffort } from "../../supabase/functions/legal-research-v2/shared/evaluationReasoning";
import { parseDirectProvider, directProviderConfigError, directPilotRunError, isDirectPilotState, directPilotPauseId } from "../../supabase/functions/legal-research-v2/shared/directProviderPolicy";
import { SOURCE_SEARCH_BUDGETS } from "../../supabase/functions/legal-research-v2/sources/contract";
import { DEFAULT_BUDGETS, type Intake } from "../../supabase/functions/legal-research-v2/types";

const source = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
const tree = ts.createSourceFile("index.ts", source, ts.ScriptTarget.Latest, true);
function loadFunction<T>(name: string, deps: Record<string, unknown>): T {
  const fn = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn) throw new Error(`Missing actual function ${name}`);
  const js = ts.transpileModule(fn.getText(tree).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(deps), `${js}; return ${name};`)(...Object.values(deps)) as T;
}
const buildIntake = loadFunction<(input: Record<string, unknown>) => Intake>("buildIntake", {
  detectDockets: () => [], detectStatuteSections: () => [], DEFAULT_BUDGETS, SOURCE_SEARCH_BUDGETS,
  SOURCE_SCOUTING_CONTRACT: "existing source contract", separateDrafterEnabled: () => false,
});
const env: Record<string, string> = {
  SUPABASE_URL: "https://offline.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  SUPABASE_ANON_KEY: "fixture-anon", V2_SMOKE_TOKEN: "fixture-smoke", V2_AGENT_MODEL: "openai/gpt-6-astra",
};
const baseDeps = {
  Deno: { env: { get: (key: string) => env[key] } },
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  parseDirectProvider, directProviderConfigError, directPilotRunError, isDirectPilotState, directPilotPauseId,
  parseEvaluationReasoningEffort, modelConfig: () => ({ agent: env.V2_AGENT_MODEL }),
  ORDINARY_RESEARCH_SETTINGS, buildIntake,
};
const classifierResult = { ok: true, http_status: 200, terminal: false, content: '{"action":"research","model":"astra"}', tool_calls: [], finish_reason: "stop", prompt_tokens: 2, completion_tokens: 1 };
function fixture(options: { conversation?: boolean; academicEnabled?: boolean; saved?: { intake: Intake; resume: unknown }; classifierFailure?: boolean } = {}) {
  const runs: Array<{ intake: Intake; resume: unknown }> = [];
  const charges: unknown[] = [];
  const classifier = vi.fn(async () => { if (options.classifierFailure) throw new Error("classifier unavailable"); return classifierResult; });
  const admin = { from(table: string) {
    let inserted = false;
    const result = () => ({ data: table === "legal_research_jobs" && inserted ? { id: "job" } : table === "v2_eval_runs" && options.saved ? { id: "row", status: "paused", agent_state: options.saved } : null, error: null });
    const q = { select: () => q, eq: () => q, update: () => q, insert: () => { inserted = true; return q; }, maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return q;
  } };
  const userClient = { auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, rpc: async (name: string, args: unknown) => { charges.push({ name, args }); return { data: { ok: true }, error: null }; } };
  const handler = loadFunction<(req: Request) => Promise<Response>>("handleRequest", {
    ...baseDeps, createClient: (_url: string, key: string) => key === env.SUPABASE_SERVICE_ROLE_KEY ? admin : userClient,
    parseProjectContext: () => ({ chapter: { index: 1, title: "fixture", role: "body" } }),
    academicWritingEnabled: () => options.academicEnabled ?? true,
    RESEARCH_CREDIT_COST: 10, SOURCE_SEARCH_CREDIT_COST: 3, ACADEMIC_CHAPTER_CREDIT_COST: 20,
    resolveOwnedProjectId: async () => null, setCostCorrelation: () => {},
    loadOwnedConversationContext: async () => ({ conversationId: options.conversation === false ? null : "conversation", context: "context" }),
    routeModel: (input: Parameters<typeof routeModel>[0]) => routeModel(input, { chat: classifier as never }),
    acquireOperationLock: async () => ({ ok: true, bypass: true }),
    driveRun: async (_admin: unknown, intake: Intake, resume: unknown) => { runs.push({ intake, resume }); },
    EdgeRuntime: { waitUntil: () => {} },
  });
  const invoke = (body: Record<string, unknown>, internal = false) => handler(new Request("https://offline.invalid", {
    method: "POST", headers: internal ? { "x-smoke-mode": "1", "x-smoke-token": "fixture-smoke" } : { Authorization: "Bearer fixture-owner" },
    body: JSON.stringify({ question: "synthetic research question", ...body }),
  }));
  return { runs, charges, classifier, invoke };
}
afterEach(() => vi.unstubAllGlobals());

describe("new ordinary research policy through the actual request handler", () => {
  it.each([
    ["new chat", {}, {}, 1, DEFAULT_BUDGETS],
    ["source search", { mode: "source_search" }, {}, 0, SOURCE_SEARCH_BUDGETS],
    ["academic context", { mode: "academic_chapter", project_context: {} }, {}, 0, DEFAULT_BUDGETS],
    ["standalone research", {}, { conversation: false }, 0, DEFAULT_BUDGETS],
    ["attached evidence", { attachments: [{ storage_path: "owner/file", file_name: "file.pdf", mime_type: "application/pdf" }] }, {}, 0, DEFAULT_BUDGETS],
    ["classifier failure", {}, { classifierFailure: true }, 1, DEFAULT_BUDGETS],
  ])("%s pins exact SOL 6.1 medium without new classifier calls or quota changes", async (_name, body, options, count, budgets) => {
    const f = fixture(options);
    const response = await f.invoke({ ...body, agent_model: "openai/gpt-6-astra", agent_reasoning_effort: "high", agent_provider: "openai" });
    expect(response.status).toBe(202);
    expect(f.runs).toHaveLength(1);
    expect(f.runs[0].intake).toMatchObject({ ...ORDINARY_RESEARCH_SETTINGS, budgets });
    expect(f.runs[0].intake.agent_direct_provider).toBeUndefined();
    expect(f.classifier).toHaveBeenCalledTimes(count);
    expect(f.charges).toHaveLength(1);
  });

  it("preserves the academic feature freeze before any charge/classifier/research", async () => {
    const f = fixture({ academicEnabled: false });
    expect((await f.invoke({ mode: "academic_chapter", project_context: {} })).status).toBe(503);
    expect(f.runs).toHaveLength(0); expect(f.charges).toHaveLength(0); expect(f.classifier).not.toHaveBeenCalled();
  });

  it.each(["openai/gpt-6-astra", "openai/gpt-6-sol", null])("does not rewrite the saved legacy model %s on resume", async model => {
    const intake = buildIntake({ run_id: "saved", question: "q", agent_model: model, agent_reasoning_effort: "high" });
    const saved = { intake, resume: { agent_state: { messages: [] }, chunk_index: 2 } };
    const f = fixture({ saved });
    expect((await f.invoke({ resume_run_id: "saved", agent_model: ORDINARY_RESEARCH_MODEL }, true)).status).toBe(202);
    expect(f.runs[0].intake).toBe(intake); expect(f.runs[0].intake.agent_model).toBe(model);
    expect(f.runs[0].intake.agent_reasoning_effort).toBe("high"); expect(f.runs[0].resume).toBe(saved.resume);
    expect(f.classifier).not.toHaveBeenCalled();
  });

  it("new ordinary checkpoint retains its pin through resume despite the Astra env", async () => {
    const intake = buildIntake({ run_id: "saved", question: "q", ...ORDINARY_RESEARCH_SETTINGS });
    const f = fixture({ saved: { intake, resume: { chunk_index: 1 } } });
    expect((await f.invoke({ resume_run_id: "saved" }, true)).status).toBe(202);
    expect(f.runs[0].intake).toMatchObject(ORDINARY_RESEARCH_SETTINGS);
  });

  it.each(["openai/gpt-6-astra", "openai/gpt-6-sol"])("preserves authenticated internal override %s/high", async model => {
    const f = fixture();
    const response = await f.invoke({ agent_model: model, agent_reasoning_effort: "high", background: true }, true);
    expect(response.status).toBe(202); expect(f.runs[0].intake.agent_model).toBe(model);
    expect(f.runs[0].intake.agent_reasoning_effort).toBe("high"); expect(f.classifier).not.toHaveBeenCalled();
  });

  it("classifier prompt no longer makes model-tier decisions", () => {
    expect(ROUTER_SYSTEM).not.toMatch(/astra|"model"/i);
    expect(ROUTER_SYSTEM).toContain('"action"');
  });
});

describe("actual research pipeline model selection and checkpoint stability", () => {
  it.each([
    ["new ordinary", ORDINARY_RESEARCH_SETTINGS, ORDINARY_RESEARCH_MODEL],
    ["existing explicit", { agent_model: "openai/gpt-6-astra", agent_reasoning_effort: "high" }, "openai/gpt-6-astra"],
    ["existing unpinned", { agent_model: null }, "openai/gpt-6-astra"],
  ])("%s uses the intended persisted or legacy model before the first provider call", async (_name, settings, model) => {
    const intake = buildIntake({ run_id: "run", question: "q", ...settings });
    const runPipeline = loadFunction<(admin: unknown, intake: Intake, opts: unknown) => Promise<unknown>>("runPipeline", {
      ...baseDeps,
      deserializeAgentState: () => ({ store: { all: () => [] }, messages: [], stats: {} }),
      RunTimer: { fromJSON: () => ({ add: () => {} }) }, EMPTY_ATTACHMENT_TELEMETRY: {},
      isValidMemoReady: () => false, CHUNK: { MAX_STEPS: 8, MAX_MS: 90000 },
      runResearchAgent: async (opts: { model: string; intake: Intake }) => {
        expect(opts.model).toBe(model); expect(opts.intake).toBe(intake);
        throw new Error("offline selection observed");
      },
    });
    await expect(runPipeline({}, intake, { resume: { usage: newUsageLedger(), agent_state: {}, started_at: 1 }, chunked: true })).rejects.toThrow("offline selection observed");
  });
});

describe("SOL 6.1 medium existing gateway transport (mocked only)", () => {
  it("uses Responses with exact model, medium, tools and replay, without native credentials", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal("Deno", { env: { get: (key: string) => key === "LOVABLE_API_KEY" ? "synthetic-only" : undefined } });
    vi.stubGlobal("fetch", async (url: string, opts: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(opts.body)) });
      return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { model: "gpt-6.1-sol", reasoning: { effort: "medium" }, usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`, { status: 200 });
    });
    const result = await chat({ model: ORDINARY_RESEARCH_MODEL, reasoningEffort: "medium", messages: [{ role: "user", content: "fixture" }], tools: [{ name: "fixture", description: "fixture", parameters: {} }], toolChoice: "required", replayReasoning: true });
    expect(result.ok).toBe(true); expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://ai.gateway.lovable.dev/v1/responses");
    expect(requests[0].body).toMatchObject({ model: ORDINARY_RESEARCH_MODEL, reasoning: { effort: "medium" }, store: false, stream: true, tool_choice: "required", tools: [{ type: "function", name: "fixture", strict: false }], include: ["reasoning.encrypted_content"] });
  });

  it("gateway rejection makes no fallback-model or native-provider request", async () => {
    const requests: string[] = [];
    vi.stubGlobal("Deno", { env: { get: () => "fixture-only" } });
    vi.stubGlobal("fetch", async (_url: string, opts: RequestInit) => { requests.push(JSON.parse(String(opts.body)).model); return new Response("model unavailable", { status: 400 }); });
    const result = await chat({ model: ORDINARY_RESEARCH_MODEL, reasoningEffort: "medium", messages: [] });
    expect(result.ok).toBe(false); expect(result.terminal).toBe(true); expect(requests).toEqual([ORDINARY_RESEARCH_MODEL]);
  });

  it("legacy/evaluation env config remains available without controlling the new public pin", () => {
    vi.stubGlobal("Deno", { env: { get: (key: string) => ({ V2_AGENT_MODEL: "openai/gpt-6-astra", V2_VERIFIER_MODEL: "existing-verifier", V2_DRAFTER_MODEL: "existing-drafter" })[key] } });
    expect(modelConfig()).toEqual({ agent: "openai/gpt-6-astra", verifier: "existing-verifier", drafter: "existing-drafter" });
    expect(ORDINARY_RESEARCH_SETTINGS).toEqual({ agent_model: "openai/gpt-6.1-sol", agent_reasoning_effort: "medium" });
  });
});
