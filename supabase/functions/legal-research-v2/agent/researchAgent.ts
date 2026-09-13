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
import { rawQueryKey, runRawWebSearch } from "../tools/rawWebSearch.ts";
import { runFetch } from "../tools/fetch.ts";
import { runLookupAuthority } from "../tools/lookupAuthority.ts";
import { seedResultIds } from "../tools/resultIds.ts";
import { registerCandidateProvenance } from "../shared/egressTelemetry.ts";
import {
  AcquisitionLedger,
  type AcquisitionLedgerJson,
  authorityKeyOf,
} from "../tools/acquisitionLedger.ts";
import { AGENT_SYSTEM_PROMPT, buildAgentUserMessage, MEMO_TOOL } from "./prompt.ts";
import { StopPolicy, type StopPolicyJson } from "./stopPolicy.ts";
import { CommitTracker, obligationsSatisfied } from "./commitPolicy.ts";
import {
  buildResearchStateMessage,
  compactAgentMessages,
  dropPriorStateMessages,
} from "./contextWindow.ts";
import { RunTimer } from "../shared/timing.ts";

/**
 * The smallest useful answer to a re-read that would add no new evidence.
 * It never re-sends a body: it points back at the evidence already held.
 */
export function minimalAlreadyReadPayload(
  source_id: string | undefined,
  repeatCount: number,
  store?: EvidenceStore,
): Record<string, unknown> {
  // A repeat adds no new evidence, but the literal text already served for
  // this source is re-attached: it is the only text the agent may quote.
  const quotes = source_id && store
    ? store.servedQuotes(source_id).slice(-2).map((q) => ({ quote_id: q.quote_id, text: q.text }))
    : undefined;
  return {
    already_read: true,
    no_new_evidence: true,
    source_id,
    exact_source_text: quotes?.length ? quotes : undefined,
    instruction: repeatCount >= 3
      ? `הפעולה הזו חוזרת בפעם ה-${repeatCount} ואינה מייצרת ראיה חדשה. עבור לפעולה שונה מהותית (שאילתה אחרת, מסמך אחר, או קטע אחר בתוך ${source_id}) או הגש עכשיו את תזכיר המחקר.`
      : `אין ראיה חדשה: ${source_id} כבר נקרא בריצה זו והתוכן שמור בצד השרת. השתמש במה שכבר יש, או בקש קטע אחר: fetch({source_id:"${source_id}", query:"..."}).`,
  };
}

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
    name: "raw_web_search",
    description:
      "חיפוש אינטרנט רגיל ורחב (תוצאות מדורגות גולמיות, בלי תשובה מנוסחת). השתמש בו כשתוצאות חיפוש גולמיות עשויות לאתר מקורות או מסמכים. domain_filter הוא אופציונלי. תוצאות אינן ראיה ואינן ניתנות לציטוט לפני fetch.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        domain_filter: { type: "array", items: { type: "string" } },
      },
      required: ["query"],
    },
  },
  {
    name: "lookup_authority",
    description:
      "איתור אסמכתה ישראלית מזוהה בשמה. מחזיר מועמדים לא מאומתים, שכל אחד מהם ניתן להבאה ישירה ב-fetch({result_id}) ללא צורך לחזור על מספר ההליך. אין חובה להביא אף מועמד. אם החלטת שאינך זקוק עוד לאסמכתה זו — קרא שוב עם drop:true.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["case", "statute"] },
        docket: { type: "string" },
        title_hint: { type: "string" },
        statute: { type: "string" },
        section: { type: "string" },
        drop: { type: "boolean" },
        drop_reason: { type: "string" },
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
  /** Latency-efficiency counters (legal_research_v2_latency_efficiency_v1). */
  already_read_actions: number;
  noop_already_read_suppressed: number;
  authority_reacquisitions_prevented: number;
  /** Authority-binding safety (v2_acquisition_ledger_verified_authority_binding_v1). */
  authority_bindings_created: number;
  authority_bindings_withheld: number;
  context_compactions: number;
  context_chars_saved: number;
  /** Named-authority acquisition (v2_named_authority_acquisition_v1). */
  lookup_candidates_registered: number;
  acquisition_targets_opened: number;
  identity_autofilled_fetches: number;
  identity_conflicts_rejected: number;
  /** Local corpus body acquisition (v2_local_corpus_body_acquisition_v1). */
  local_corpus_acquisitions: number;
  local_corpus_bindings: number;
  /** Broad web search (v2_raw_web_search_v1). */
  raw_web_search_calls: number;
  raw_web_search_results: number;
  raw_web_search_domains: string[];
  raw_web_search_deduped_queries: number;
  raw_web_results_fetched: number;
  raw_web_identity_rejects: number;
  unsafe_urls_blocked: number;
}

export function newAgentStats(): AgentContextStats {
  return {
    largest_tool_response_chars: 0,
    evidence_context_chars_last_turn: 0,
    repeated_tool_calls_prevented: 0,
    commit_directives: [],
    already_read_actions: 0,
    noop_already_read_suppressed: 0,
    authority_reacquisitions_prevented: 0,
    authority_bindings_created: 0,
    authority_bindings_withheld: 0,
    context_compactions: 0,
    context_chars_saved: 0,
    lookup_candidates_registered: 0,
    acquisition_targets_opened: 0,
    identity_autofilled_fetches: 0,
    identity_conflicts_rejected: 0,
    local_corpus_acquisitions: 0,
    local_corpus_bindings: 0,
    raw_web_search_calls: 0,
    raw_web_search_results: 0,
    raw_web_search_domains: [],
    raw_web_search_deduped_queries: 0,
    raw_web_results_fetched: 0,
    raw_web_identity_rejects: 0,
    unsafe_urls_blocked: 0,
  };
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
  if (name === "raw_web_search") {
    return rawQueryKey({
      query: String(args.query ?? ""),
      domain_filter: Array.isArray(args.domain_filter) ? args.domain_filter.map((d) => String(d)) : undefined,
    });
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
  /**
   * Presentation-only hook: reports what the agent is doing right now so the
   * UI can show a stage. It never influences the loop.
   */
  onActivity?: (kind: "searching" | "reading") => void;
  /** Timing ledger — measurement only. */
  timer?: RunTimer;
  /** Chunk number, recorded on each turn for latency attribution. */
  chunkIndex?: number;
  /** Liveness ping so a long, healthy run is never mistaken for an abandoned one. */
  heartbeat?: () => Promise<void> | void;
}): Promise<AgentRunResult> {
  const policy = opts.policy ?? new StopPolicy(opts.intake.budgets);
  const discovered = opts.discovered ?? new Map<string, SearchResult>();
  const commit = opts.commit ?? new CommitTracker();
  const ledger = opts.ledger ?? new AcquisitionLedger();
  const trace: AgentTraceEntry[] = opts.trace ?? [];
  const stats: AgentContextStats = { ...newAgentStats(), ...(opts.stats ?? {}) };
  const timer = opts.timer ?? new RunTimer();
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

  let pendingDirective: string | undefined;

  while (!policy.stepExhausted()) {
    if (stepsThisChunk >= chunkCap || Date.now() >= deadlineAt) {
      paused = true;
      break;
    }
    policy.steps += 1;
    stepsThisChunk += 1;

    // ── Context discipline ────────────────────────────────────────────────
    // Stale tool payloads are replaced by their digests and a single rolling
    // research-state message carries what the next decision needs. The full
    // bodies never left the evidence store in the first place.
    const compaction = compactAgentMessages(dropPriorStateMessages(messages));
    if (compaction.compacted) {
      stats.context_compactions += compaction.compacted;
      stats.context_chars_saved += compaction.chars_saved;
    }
    const stateMessage = buildResearchStateMessage({
      intake: opts.intake,
      store: opts.store,
      ledger,
      policy,
      directive: pendingDirective,
    });
    pendingDirective = undefined;
    stats.evidence_context_chars_last_turn = stateMessage.length;
    messages.length = 0;
    messages.push(...compaction.messages, { role: "user", content: stateMessage });

    // Research capacity is reserved: once the research phase closes, the memo
    // tool is the ONLY tool the agent can still call.
    const forceMemo = policy.researchExhausted();
    const contextChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    const modelStarted = Date.now();
    const res = await chat({
      model: opts.model,
      messages,
      tools: forceMemo ? [MEMO_TOOL] : TOOL_SPECS,
      toolChoice: forceMemo ? { name: MEMO_TOOL.name } : "auto",
      usage: opts.usage,
    });
    const modelMs = Date.now() - modelStarted;
    timer.add("agent_model", modelMs);
    await opts.heartbeat?.();
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
      timer.noteTurn({
        turn: policy.steps,
        chunk: opts.chunkIndex ?? 1,
        model_ms: modelMs,
        tool_ms: 0,
        prompt_tokens: res.prompt_tokens,
        completion_tokens: res.completion_tokens,
        cumulative_prompt_tokens: opts.usage.prompt_tokens,
        context_chars: contextChars,
        action: "no_tool_nudge",
        added_evidence: false,
        no_op: true,
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
    let toolMs = 0;
    let turnAction = "";
    let turnNoOp = false;

    for (const call of res.tool_calls) {
      const args = parseJsonLoose<Record<string, unknown>>(call.arguments) ?? {};
      turnAction = turnAction || call.name;
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
          digest: JSON.stringify({ error: blocked }),
        });
        continue;
      }

      const callKey = toolCallKey(call.name, args);
      const repeatWarning = commit.noteToolKey(callKey);
      if (repeatWarning) stats.repeated_tool_calls_prevented += 1;
      const repeatCount = commit.repeatCount(callKey);

      let payload: Record<string, unknown>;
      let summary = "";
      const toolStarted = Date.now();
      if (call.name === "search") {
        opts.onActivity?.("searching");
        policy.note("search", scope ?? "web");
        const out = await runSearch(opts.admin, {
          query: String(args.query ?? ""),
          scope,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        });
        for (const r of out.results) {
          discovered.set(r.result_id, r);
          // Provenance only — the relay gate still decides eligibility.
          registerCandidateProvenance(r.url, scope === "official" ? "search_first" : "retrieved");
        }
        payload = compactSearchOutput(out) as unknown as Record<string, unknown>;
        summary = `scope=${out.scope} results=${out.results.length}${out.error ? ` error=${out.error}` : ""}`;
        timer.add("search", Date.now() - toolStarted);
      } else if (call.name === "raw_web_search") {
        opts.onActivity?.("searching");
        const rawInput = {
          query: String(args.query ?? ""),
          limit: typeof args.limit === "number" ? args.limit : undefined,
          domain_filter: Array.isArray(args.domain_filter)
            ? args.domain_filter.map((d) => String(d))
            : undefined,
        };
        const key = rawQueryKey(rawInput);
        // Per-run dedupe: an identical raw query is answered from the
        // candidates it already produced, and costs no budget.
        const prior = [...discovered.values()].filter((r) => r.query_key === key);
        if (prior.length) {
          stats.raw_web_search_deduped_queries += 1;
          payload = {
            deduped_query: true,
            results: prior.map((r) => ({
              result_id: r.result_id,
              title: r.title.slice(0, 160),
              url: r.url,
              snippet: r.snippet?.slice(0, 220),
              domain: r.domain,
            })),
            instruction:
              "שאילתה זהה כבר בוצעה בריצה זו. אלה אותן תוצאות — בחר מהן מועמד ל-fetch או נסח שאילתה שונה מהותית.",
          };
          summary = `raw_web_search_deduped results=${prior.length}`;
          timer.add("search", Date.now() - toolStarted);
        } else {
          policy.note("raw_web_search");
          const out = await runRawWebSearch(rawInput);
          for (const r of out.results) {
            discovered.set(r.result_id, r);
            registerCandidateProvenance(r.url, "retrieved");
            if (r.domain && !stats.raw_web_search_domains.includes(r.domain)) {
              stats.raw_web_search_domains.push(r.domain);
            }
          }
          stats.raw_web_search_calls += 1;
          stats.raw_web_search_results += out.results.length;
          payload = {
            error: out.error,
            results: out.results.map((r) => ({
              result_id: r.result_id,
              title: r.title.slice(0, 160),
              url: r.url,
              snippet: r.snippet?.slice(0, 220),
              domain: r.domain,
              date: r.published_date,
              possible_docket: r.possible_docket,
            })),
            note:
              "תוצאות חיפוש גולמיות בלבד. אינן ראיה: יש להביא את גוף המסמך ב-fetch לפני כל שימוש.",
          };
          summary = `raw_web results=${out.results.length}${out.error ? ` error=${out.error}` : ""}`;
          timer.add("search", Date.now() - toolStarted);
        }
      } else if (call.name === "lookup_authority") {
        opts.onActivity?.("searching");
        const lookupInput = {
          kind: args.kind === "statute" ? "statute" as const : "case" as const,
          docket: typeof args.docket === "string" ? args.docket : undefined,
          title_hint: typeof args.title_hint === "string" ? args.title_hint : undefined,
          statute: typeof args.statute === "string" ? args.statute : undefined,
          section: typeof args.section === "string" ? args.section : undefined,
        };
        // The agent may explicitly drop a target it no longer wants. Nothing
        // else in the system can force it back onto the target list.
        if (args.drop === true) {
          const key = authorityKeyOf(
            lookupInput.kind === "case"
              ? { docket: lookupInput.docket }
              : { statute: lookupInput.statute, section: lookupInput.section },
          );
          if (key) ledger.abandonTarget(key, String(args.drop_reason ?? "agent_dropped_target"));
          payload = { dropped: key ?? null, note: "היעד הוסר מרשימת יעדי ההשגה." };
          summary = `dropped_target=${key ?? "none"}`;
          timer.add("lookup", Date.now() - toolStarted);
          if (repeatWarning) payload.repetition_warning = repeatWarning;
          trace.push({ step: policy.steps, tool: call.name, input: args, summary });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify(payload),
            digest: JSON.stringify({ tool: call.name, summary }),
          });
          continue;
        }
        policy.note("lookup_authority");
        const out = await runLookupAuthority(opts.admin, lookupInput);
        // Lookup candidates become first-class discovered results: fetchable
        // by result_id, carrying the authority they were found FOR.
        for (const c of out.candidates) {
          if (!c.result_id || (!c.url && !c.local_document_id)) continue;
          discovered.set(c.result_id, {
            result_id: c.result_id,
            title: c.label,
            url: c.url,
            snippet: c.note,
            origin: c.origin,
            possible_docket: c.docket,
            authority_key: c.authority_key,
            expected_identity: c.expected_identity,
            candidate_kind: c.candidate_kind,
            local_document_id: c.local_document_id,
            local_match_basis: c.local_match_basis,
          });
          // Provenance for the relay gate — registration never widens the
          // allowlist and cannot make a guessed URL relay-eligible.
          registerCandidateProvenance(c.url, "retrieved");
          stats.lookup_candidates_registered += 1;
        }
        if (out.authority_key) {
          const before = ledger.target(out.authority_key);
          ledger.openTarget(out.authority_key, {
            label: out.candidates[0]?.label,
            reopen: true,
            candidates: out.candidates
              .filter((c) => c.url || c.local_document_id)
              .map((c) => ({
                result_id: c.result_id,
                url: c.url,
                label: c.label,
                candidate_kind: c.candidate_kind,
              })),
          });
          if (!before) stats.acquisition_targets_opened += 1;
        }
        payload = out as unknown as Record<string, unknown>;
        summary = `candidates=${out.candidates.length} registry=${out.registry_hint ?? "none"} target=${
          out.authority_key ?? "none"
        }`;
        timer.add("lookup", Date.now() - toolStarted);
      } else if (call.name === "fetch") {
        opts.onActivity?.("reading");
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
          { admin: opts.admin },
        );
        timer.add("fetch", Date.now() - toolStarted);
        if (out.acquisition_transport === "local_corpus" && !out.already_read) {
          stats.local_corpus_acquisitions += 1;
          if (out.authority_binding_created) stats.local_corpus_bindings += 1;
        }
        // A cached / targeted read costs no fetch budget.
        if (!out.already_read) policy.note("fetch");
        if (out.already_read) stats.already_read_actions += 1;
        if (out.authority_reuse) stats.authority_reacquisitions_prevented += 1;
        if (out.authority_binding_created) stats.authority_bindings_created += 1;
        if (out.authority_binding_withheld) stats.authority_bindings_withheld += 1;
        if (out.expected_identity_source === "candidate" || out.expected_identity_source === "merged") {
          stats.identity_autofilled_fetches += 1;
        }
        if (out.expected_identity_conflict) stats.identity_conflicts_rejected += 1;
        {
          const cand = typeof args.result_id === "string" ? discovered.get(args.result_id) : undefined;
          if (cand?.origin === "perplexity:raw_web") {
            if (!out.already_read) stats.raw_web_results_fetched += 1;
            if (out.authority_binding_withheld || out.error === "unsafe_url_blocked") {
              stats.raw_web_identity_rejects += 1;
            }
          }
          if (out.error === "unsafe_url_blocked") stats.unsafe_urls_blocked += 1;
        }
        payload = out as unknown as Record<string, unknown>;
        summary = out.already_read
          ? `already_read ${out.source_id}`
          : out.ok
          ? `${out.source_id} chars=${out.text_length} document=${out.is_actual_document}`
          : `failed: ${out.error}`;

        // A repeated already_read action adds nothing: answer with the smallest
        // deterministic response and escalate instead of re-sending evidence.
        if (out.already_read && repeatCount >= 2) {
          stats.noop_already_read_suppressed += 1;
          turnNoOp = true;
          payload = minimalAlreadyReadPayload(out.source_id, repeatCount, opts.store);
          summary = `already_read_noop ${out.source_id} x${repeatCount}`;
        }
      } else {
        payload = { error: `unknown_tool:${call.name}` };
        summary = `unknown_tool:${call.name}`;
      }
      toolMs += Date.now() - toolStarted;

      if (repeatWarning) payload.repetition_warning = repeatWarning;
      trace.push({ step: policy.steps, tool: call.name, input: args, summary });
      const content = JSON.stringify(payload).slice(0, 12_000);
      stats.largest_tool_response_chars = Math.max(stats.largest_tool_response_chars, content.length);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content,
        digest: JSON.stringify({ tool: call.name, summary }).slice(0, 240),
      });
      await opts.heartbeat?.();
    }

    const addedEvidence = opts.store.readable().length > readableBefore;
    timer.noteTurn({
      turn: policy.steps,
      chunk: opts.chunkIndex ?? 1,
      model_ms: modelMs,
      tool_ms: toolMs,
      prompt_tokens: res.prompt_tokens,
      completion_tokens: res.completion_tokens,
      cumulative_prompt_tokens: opts.usage.prompt_tokens,
      context_chars: contextChars,
      action: turnAction || "unknown",
      added_evidence: addedEvidence,
      no_op: turnNoOp || (!addedEvidence && turnAction === "fetch"),
    });

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
    commit.noteRound(addedEvidence);
    const directive = commit.directive({
      readable_count: readable.length,
      obligations_total: opts.intake.docket_obligations.length + opts.intake.statute_obligations.length,
      obligations_satisfied: obligationsSatisfied(opts.intake, readable),
      stale_streak: commit.stale_streak,
      research_steps_left: policy.researchStepsLeft,
      deliverable: opts.intake.deliverable,
      unresolved_targets: ledger.unresolvedTargets().map((t) => ({
        authority_key: t.authority_key,
        untried: t.untried.length,
      })),
    });
    if (directive) {
      stats.commit_directives.push(`step${policy.steps}:${directive.kind}`);
      // Carried into the next turn's single rolling-state message rather than
      // appended as yet another permanent user message.
      pendingDirective = directive.text;
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
  // Fresh isolate after a chunk pause: continue the id sequence instead of
  // restarting it on top of already-issued candidate ids.
  seedResultIds((json.discovered ?? []).map(([id]) => id));
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
