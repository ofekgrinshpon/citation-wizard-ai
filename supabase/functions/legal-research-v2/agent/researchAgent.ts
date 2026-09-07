/**
 * legal-research-v2 — the single research agent.
 *
 * A plain tool-calling loop: the model decides what to research, calls
 * search / lookup_authority / fetch, reads real bodies, and finishes with a
 * structured research memo. The loop itself contains no legal logic.
 */

import type {
  Intake,
  MemoClaim,
  ResearchMemo,
  SearchResult,
  SearchScope,
} from "../types.ts";
import type { EvidenceStore } from "../evidence/evidenceStore.ts";
import type { SupabaseClient } from "../shared/primitives.ts";
import { chat, type ChatMessage, parseJsonLoose, type ToolSpec, type UsageLedger } from "../shared/model.ts";
import { runSearch } from "../tools/search.ts";
import { runFetch } from "../tools/fetch.ts";
import { runLookupAuthority } from "../tools/lookupAuthority.ts";
import { AGENT_SYSTEM_PROMPT, buildAgentUserMessage, MEMO_TOOL } from "./prompt.ts";
import { StopPolicy } from "./stopPolicy.ts";

const TOOL_SPECS: ToolSpec[] = [
  {
    name: "search",
    description:
      "גילוי מקורות אפשריים. תוצאות אינן ראיה ואינן ניתנות לציטוט לפני fetch.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        scope: { type: "string", enum: ["web", "corpus", "official", "academic"] },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_authority",
    description: "איתור אסמכתה ישראלית מזוהה בשמה. מחזיר מועמדים לא מאומתים.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["case", "statute"] },
        docket: { type: "string" },
        title_hint: { type: "string" },
        statute: { type: "string" },
        section: { type: "string" },
      },
      required: ["kind"],
    },
  },
  {
    name: "fetch",
    description:
      "הבאת גוף מסמך אמיתי וקריאתו. רק כאן נוצרת ראיה. אפשר להעביר find לקבלת חלונות טקסט מדויקים.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        result_id: { type: "string" },
        url: { type: "string" },
        expected_identity: {
          type: "object",
          additionalProperties: false,
          properties: {
            docket: { type: "string" },
            statute: { type: "string" },
            section: { type: "string" },
          },
        },
        find: { type: "array", items: { type: "string" } },
      },
    },
  },
  MEMO_TOOL,
];

export interface AgentTraceEntry {
  step: number;
  tool: string;
  input: Record<string, unknown>;
  summary: string;
}

export interface AgentRunResult {
  memo: ResearchMemo | null;
  error?: string;
  trace: AgentTraceEntry[];
  policy: StopPolicy;
  discovered: Map<string, SearchResult>;
  messages: ChatMessage[];
}

function normalizeMemo(raw: unknown): ResearchMemo | null {
  const r = raw as Partial<ResearchMemo> | null;
  if (!r || typeof r !== "object") return null;
  const claims: MemoClaim[] = Array.isArray(r.claims)
    ? r.claims
      .filter((c) => c && typeof c.proposition === "string" && c.proposition.trim())
      .map((c, i) => ({
        claim_id: String(c.claim_id ?? `C${i + 1}`),
        proposition: String(c.proposition).trim(),
        importance: c.importance === "supporting" ? "supporting" : "core",
        evidence: Array.isArray(c.evidence)
          ? c.evidence
            .filter((e) => e && typeof e.source_id === "string")
            .map((e) => ({
              source_id: String(e.source_id),
              quoted_span: String(e.quoted_span ?? ""),
              locator: typeof e.locator === "string" ? e.locator : undefined,
              reason: String(e.reason ?? ""),
            }))
          : [],
      }))
    : [];
  return {
    issue_summary: String(r.issue_summary ?? "").trim(),
    claims,
    unresolved_questions: Array.isArray(r.unresolved_questions)
      ? r.unresolved_questions.map((q) => String(q)).filter(Boolean)
      : [],
    research_complete: r.research_complete === true,
  };
}

export async function runResearchAgent(opts: {
  admin: SupabaseClient;
  intake: Intake;
  store: EvidenceStore;
  model: string;
  usage: UsageLedger;
  /** Continue an existing conversation (targeted repair turn). */
  priorMessages?: ChatMessage[];
  extraUserMessage?: string;
  policy?: StopPolicy;
  discovered?: Map<string, SearchResult>;
}): Promise<AgentRunResult> {
  const policy = opts.policy ?? new StopPolicy(opts.intake.budgets);
  const discovered = opts.discovered ?? new Map<string, SearchResult>();
  const trace: AgentTraceEntry[] = [];

  const messages: ChatMessage[] = opts.priorMessages
    ? [...opts.priorMessages]
    : [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      { role: "user", content: buildAgentUserMessage(opts.intake) },
    ];
  if (opts.extraUserMessage) messages.push({ role: "user", content: opts.extraUserMessage });

  let memo: ResearchMemo | null = null;
  let error: string | undefined;

  while (!policy.stepExhausted()) {
    policy.steps += 1;
    const forceMemo = policy.allExhausted();
    const res = await chat({
      model: opts.model,
      messages,
      tools: forceMemo ? [MEMO_TOOL] : TOOL_SPECS,
      toolChoice: forceMemo ? { name: MEMO_TOOL.name } : "auto",
      usage: opts.usage,
    });
    if (!res.ok) {
      error = `agent_model_error_${res.http_status}: ${res.error ?? ""}`.slice(0, 300);
      break;
    }
    if (!res.tool_calls.length) {
      // No tool call: nudge once towards the memo, then stop.
      messages.push({ role: "assistant", content: res.content });
      messages.push({
        role: "user",
        content: "סיים כעת: קרא ל-submit_research_memo עם התזכיר המובנה.",
      });
      if (trace.some((t) => t.tool === "no_tool_nudge")) {
        error = "agent_did_not_submit_memo";
        break;
      }
      trace.push({ step: policy.steps, tool: "no_tool_nudge", input: {}, summary: "no tool call" });
      continue;
    }

    messages.push({
      role: "assistant",
      content: res.content ?? "",
      tool_calls: res.tool_calls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments },
      })),
    });

    for (const call of res.tool_calls) {
      const args = parseJsonLoose<Record<string, unknown>>(call.arguments) ?? {};
      if (call.name === MEMO_TOOL.name) {
        memo = normalizeMemo(args);
        trace.push({
          step: policy.steps,
          tool: "submit_research_memo",
          input: {},
          summary: `claims=${memo?.claims.length ?? 0}`,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ received: true }) });
        break;
      }

      const scope = typeof args.scope === "string" ? args.scope as SearchScope : undefined;
      const blocked = policy.checkTool(call.name, scope);
      if (blocked) {
        trace.push({ step: policy.steps, tool: call.name, input: args, summary: blocked });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: blocked, advice: "סיים והגש תזכיר עם מה שכבר אומת." }),
        });
        continue;
      }

      let payload: unknown;
      let summary = "";
      if (call.name === "search") {
        policy.note("search", scope ?? "web");
        const out = await runSearch(opts.admin, {
          query: String(args.query ?? ""),
          scope,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        for (const r of out.results) discovered.set(r.result_id, r);
        payload = out;
        summary = `scope=${out.scope} results=${out.results.length}${out.error ? ` error=${out.error}` : ""}`;
      } else if (call.name === "lookup_authority") {
        policy.note("lookup_authority");
        const out = await runLookupAuthority(opts.admin, {
          kind: args.kind === "statute" ? "statute" : "case",
          docket: typeof args.docket === "string" ? args.docket : undefined,
          title_hint: typeof args.title_hint === "string" ? args.title_hint : undefined,
          statute: typeof args.statute === "string" ? args.statute : undefined,
          section: typeof args.section === "string" ? args.section : undefined,
        });
        payload = out;
        summary = `candidates=${out.candidates.length} registry=${out.registry_hint ?? "none"}`;
      } else if (call.name === "fetch") {
        policy.note("fetch");
        const out = await runFetch(opts.store, discovered, {
          result_id: typeof args.result_id === "string" ? args.result_id : undefined,
          url: typeof args.url === "string" ? args.url : undefined,
          expected_identity: (args.expected_identity ?? undefined) as
            | { docket?: string; statute?: string; section?: string }
            | undefined,
          find: Array.isArray(args.find) ? args.find.map((f) => String(f)) : undefined,
        });
        payload = out;
        summary = out.ok
          ? `${out.source_id} chars=${out.text_length} document=${out.is_actual_document}`
          : `failed: ${out.error}`;
      } else {
        payload = { error: `unknown_tool:${call.name}` };
        summary = `unknown_tool:${call.name}`;
      }

      trace.push({ step: policy.steps, tool: call.name, input: args, summary });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(payload).slice(0, 60_000),
      });
    }

    if (memo) break;
  }

  if (!memo && !error) error = "agent_step_budget_exhausted_without_memo";
  return { memo, error, trace, policy, discovered, messages };
}
