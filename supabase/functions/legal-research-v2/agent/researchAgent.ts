/**
 * legal-research-v2 — the single research agent.
 *
 * A plain tool-calling loop: the model decides what to research, calls
 * search / lookup_authority / fetch, reads real bodies, and finishes with a
 * structured research memo. The loop itself contains no legal logic.
 *
 * Three disciplines wrap the loop (and only these):
 *   • commit policy   — reserved memo capacity + deterministic commit signals
 *   • repetition      — repeating a call is cheap, useless and discouraged
 *   • context budget  — bodies live in the evidence store, not in the messages
 *
 * The loop is chunkable: it can stop after a bounded number of steps or at a
 * wall-clock deadline, serialize its state and resume in a later invocation.
 */

import type {
  Intake,
  MemoClaim,
  ResearchMemo,
  SearchResult,
  SearchScope,
} from "../types.ts";
import { EvidenceStore, type EvidenceStoreJson } from "../evidence/evidenceStore.ts";
import type { SupabaseClient } from "../shared/primitives.ts";
import { chat, type ChatMessage, parseJsonLoose, type ToolSpec, type UsageLedger } from "../shared/model.ts";
import { runSearch } from "../tools/search.ts";
import { runFetch } from "../tools/fetch.ts";
import { runLookupAuthority } from "../tools/lookupAuthority.ts";
import { AcquisitionLedger, type AcquisitionLedgerJson } from "../tools/acquisitionLedger.ts";
import { AGENT_SYSTEM_PROMPT, buildAgentUserMessage, MEMO_TOOL } from "./prompt.ts";
import { StopPolicy, type StopPolicyJson } from "./stopPolicy.ts";
import { CommitTracker, obligationsSatisfied } from "./commitPolicy.ts";

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
      "הבאת גוף מסמך אמיתי וקריאתו — כאן בלבד נוצרת ראיה. הגוף המלא נשמר בצד השרת ואינו מוחזר לשיחה: מוחזרים תקציר וחלונות טקסט. לקריאה ממוקדת בתוך מסמך שכבר נקרא העבר source_id יחד עם query.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        result_id: { type: "string" },
        url: { type: "string" },
        source_id: { type: "string" },
        query: { type: "string" },
        locator: { type: "string" },
        want: { type: "string", enum: ["relevant_section"] },
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
        refetch_reason: { type: "string" },
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

export interface AgentContextStats {
  largest_tool_response_chars: number;
  evidence_context_chars_last_turn: number;
  repeated_tool_calls_prevented: number;
  commit_directives: string[];
}

export interface AgentStateJson {
  messages: ChatMessage[];
  policy: StopPolicyJson;
  discovered: Array<[string, SearchResult]>;
  store: EvidenceStoreJson;
  commit: ReturnType<CommitTracker["toJSON"]>;
  ledger: AcquisitionLedgerJson;
  trace: AgentTraceEntry[];
  stats: AgentContextStats;
  memo: ResearchMemo | null;
}

export interface AgentRunResult {
  memo: ResearchMemo | null;
  error?: string;
  /** True when the chunk ended on its step/time budget, not on a decision. */
  paused: boolean;
  trace: AgentTraceEntry[];
  policy: StopPolicy;
  discovered: Map<string, SearchResult>;
  messages: ChatMessage[];
  commit: CommitTracker;
  ledger: AcquisitionLedger;
  stats: AgentContextStats;
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
        current_state_claim: c.current_state_claim === true,
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

/** Deterministic key used for repeated-call detection. */
export function toolCallKey(name: string, args: Record<string, unknown>): string {
  if (name === "search") {
    const q = String(args.query ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return `search:${args.scope ?? "web"}:${q}`;
  }
  if (name === "fetch") {
    const u = String(args.url ?? args.result_id ?? args.source_id ?? "").trim().toLowerCase();
    return `fetch:${u}:${String(args.query ?? "")}`;
  }
  if (name === "lookup_authority") {
    return `lookup:${JSON.stringify(args)}`.toLowerCase();
  }
  return `${name}:${JSON.stringify(args)}`.slice(0, 300);
}

/** Compact discovery output: snippets are hints, never evidence. */
function compactSearchOutput(out: { results: SearchResult[]; scope: SearchScope; error?: string }) {
  return {
    scope: out.scope,
    error: out.error,
    results: out.results.map((r) => ({
      result_id: r.result_id,
      title: r.title.slice(0, 160),
      url: r.url,
      snippet: r.snippet?.slice(0, 220),
      possible_docket: r.possible_docket,
    })),
  };
}

/** One line per source already read — the agent's persistent memory of evidence. */
export function evidenceLedgerMessage(store: EvidenceStore): string {
  const rows = store.all().map((s) =>
    `${s.source_id} | ${s.fetch_status === "ok" && s.is_actual_document ? "נקרא" : `לא שמיש (${s.not_document_reason ?? s.fetch_error ?? "?"})`} | ${
      s.title.slice(0, 90)
    } | ${s.text_length} תווים | ${s.url ?? ""}`
  );
  return `מצב הראיות בריצה זו (הגוף המלא שמור בצד השרת; לקריאה ממוקדת: fetch({source_id, query})):\n${
    rows.join("\n") || "(טרם נקראו מסמכים)"
  }`;
}

export async function runResearchAgent(opts: {
  admin: SupabaseClient;
  intake: Intake;
  store: EvidenceStore;
  model: string;
  usage: UsageLedger;
  /** Continue an existing conversation (targeted repair turn / resumed chunk). */
  priorMessages?: ChatMessage[];
  extraUserMessage?: string;
  policy?: StopPolicy;
  discovered?: Map<string, SearchResult>;
  commit?: CommitTracker;
  ledger?: AcquisitionLedger;
  stats?: AgentContextStats;
  trace?: AgentTraceEntry[];
  /** Chunked execution: stop after this many steps in the current invocation. */
  maxStepsThisChunk?: number;
  /** Chunked execution: stop when this wall-clock timestamp is reached. */
  deadlineAt?: number;
  /**
   * Called after every completed step in chunked mode. Persisting each step
   * is what makes a run survive an abrupt worker death (CPU-time kill),
   * which no chunk boundary can anticipate.
   */
  checkpoint?: (state: AgentStateJson) => Promise<void>;
}): Promise<AgentRunResult> {
  const policy = opts.policy ?? new StopPolicy(opts.intake.budgets);
  const discovered = opts.discovered ?? new Map<string, SearchResult>();
  const commit = opts.commit ?? new CommitTracker();
  const ledger = opts.ledger ?? new AcquisitionLedger();
  const trace: AgentTraceEntry[] = opts.trace ?? [];
  const stats: AgentContextStats = opts.stats ?? {
    largest_tool_response_chars: 0,
    evidence_context_chars_last_turn: 0,
    repeated_tool_calls_prevented: 0,
    commit_directives: [],
  };
  const chunkCap = opts.maxStepsThisChunk ?? Number.POSITIVE_INFINITY;
  const deadlineAt = opts.deadlineAt ?? Number.POSITIVE_INFINITY;

  const messages: ChatMessage[] = opts.priorMessages
    ? [...opts.priorMessages]
    : [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      { role: "user", content: buildAgentUserMessage(opts.intake) },
    ];
  if (opts.extraUserMessage) messages.push({ role: "user", content: opts.extraUserMessage });

  let memo: ResearchMemo | null = null;
  let error: string | undefined;
  let paused = false;
  let stepsThisChunk = 0;

  while (!policy.stepExhausted()) {
    if (stepsThisChunk >= chunkCap || Date.now() >= deadlineAt) {
      paused = true;
      break;
    }
    policy.steps += 1;
    stepsThisChunk += 1;

    // Research capacity is reserved: once the research phase closes, the memo
    // tool is the ONLY tool the agent can still call.
    const forceMemo = policy.researchExhausted();
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

    const readableBefore = opts.store.readable().length;

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

      const repeatWarning = commit.noteToolKey(toolCallKey(call.name, args));
      if (repeatWarning) stats.repeated_tool_calls_prevented += 1;

      let payload: Record<string, unknown>;
      let summary = "";
      if (call.name === "search") {
        policy.note("search", scope ?? "web");
        const out = await runSearch(opts.admin, {
          query: String(args.query ?? ""),
          scope,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        for (const r of out.results) discovered.set(r.result_id, r);
        payload = compactSearchOutput(out) as unknown as Record<string, unknown>;
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
        payload = out as unknown as Record<string, unknown>;
        summary = `candidates=${out.candidates.length} registry=${out.registry_hint ?? "none"}`;
      } else if (call.name === "fetch") {
        const out = await runFetch(
          opts.store,
          discovered,
          {
            result_id: typeof args.result_id === "string" ? args.result_id : undefined,
            url: typeof args.url === "string" ? args.url : undefined,
            source_id: typeof args.source_id === "string" ? args.source_id : undefined,
            query: typeof args.query === "string" ? args.query : undefined,
            locator: typeof args.locator === "string" ? args.locator : undefined,
            want: typeof args.want === "string" ? args.want : undefined,
            expected_identity: (args.expected_identity ?? undefined) as
              | { docket?: string; statute?: string; section?: string }
              | undefined,
            find: Array.isArray(args.find) ? args.find.map((f) => String(f)) : undefined,
            refetch_reason: typeof args.refetch_reason === "string" ? args.refetch_reason : undefined,
          },
          ledger,
        );
        // A cached / targeted read costs no fetch budget.
        if (!out.already_read) policy.note("fetch");
        payload = out as unknown as Record<string, unknown>;
        summary = out.already_read
          ? `already_read ${out.source_id}`
          : out.ok
          ? `${out.source_id} chars=${out.text_length} document=${out.is_actual_document}`
          : `failed: ${out.error}`;
      } else {
        payload = { error: `unknown_tool:${call.name}` };
        summary = `unknown_tool:${call.name}`;
      }

      if (repeatWarning) payload.repetition_warning = repeatWarning;
      trace.push({ step: policy.steps, tool: call.name, input: args, summary });
      const content = JSON.stringify(payload).slice(0, 12_000);
      stats.largest_tool_response_chars = Math.max(stats.largest_tool_response_chars, content.length);
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }

    if (memo) break;

    if (opts.checkpoint) {
      const snapshot: AgentRunResult = {
        memo: null,
        paused: true,
        trace,
        policy,
        discovered,
        messages,
        commit,
        ledger,
        stats,
      };
      await opts.checkpoint(serializeAgentState({ result: snapshot, store: opts.store }));
    }

    // ── Deterministic commit discipline ──────────────────────────────────
    const readable = opts.store.readable();
    commit.noteRound(readable.length > readableBefore);
    const directive = commit.directive({
      readable_count: readable.length,
      obligations_total: opts.intake.docket_obligations.length + opts.intake.statute_obligations.length,
      obligations_satisfied: obligationsSatisfied(opts.intake, readable),
      stale_streak: commit.stale_streak,
      research_steps_left: policy.researchStepsLeft,
    });
    if (directive) {
      stats.commit_directives.push(`step${policy.steps}:${directive.kind}`);
      const ledgerMsg = evidenceLedgerMessage(opts.store);
      stats.evidence_context_chars_last_turn = ledgerMsg.length;
      messages.push({ role: "user", content: `${ledgerMsg}\n\n${directive.text}` });
    }
  }

  if (!memo && !error && !paused) error = "agent_step_budget_exhausted_without_memo";
  return { memo, error, paused, trace, policy, discovered, messages, commit, ledger, stats };
}

/** Serialize everything a later invocation needs to resume this run. */
export function serializeAgentState(input: {
  result: AgentRunResult;
  store: EvidenceStore;
}): AgentStateJson {
  return {
    messages: input.result.messages,
    policy: input.result.policy.toJSON(),
    discovered: [...input.result.discovered.entries()],
    store: input.store.toJSON(),
    commit: input.result.commit.toJSON(),
    ledger: input.result.ledger.toJSON(),
    trace: input.result.trace,
    stats: input.result.stats,
    memo: input.result.memo,
  };
}

export function deserializeAgentState(intake: Intake, json: AgentStateJson) {
  return {
    messages: json.messages,
    policy: StopPolicy.fromJSON(intake.budgets, json.policy),
    discovered: new Map(json.discovered),
    store: EvidenceStore.fromJSON(json.store),
    commit: CommitTracker.fromJSON(json.commit),
    ledger: AcquisitionLedger.fromJSON(json.ledger),
    trace: json.trace ?? [],
    stats: json.stats,
    memo: json.memo,
  };
}
