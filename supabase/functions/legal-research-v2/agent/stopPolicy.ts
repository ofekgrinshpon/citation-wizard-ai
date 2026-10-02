/**
 * legal-research-v2 — hard ceilings for the research agent.
 *
 * These are ceilings, not targets. The agent normally stops well below them
 * by calling `submit_research_memo`. Nothing here plans, routes or ranks.
 *
 * Invariant (agent commit policy): tool exploration can never consume the
 * capacity reserved for submitting the memo. `researchStepLimit` is always
 * strictly smaller than `max_agent_steps`.
 */

import type { SearchScope, ToolBudgets } from "../types.ts";

/** Extra 504 attempts per run, separate from the base acquisition ceiling. */
export const MAX_FETCH_RETRY_CALLS = 2;

/** Steps held back from the research phase for synthesis / memo submission. */
export function reservedMemoSteps(maxAgentSteps: number): number {
  return Math.min(6, Math.max(2, Math.ceil(maxAgentSteps * 0.2)));
}

export interface StopPolicyJson {
  steps: number;
  search_calls: Record<SearchScope, number>;
  fetch_calls: number;
  /** Optional only to restore checkpoints created before separate retry accounting. */
  fetch_retry_calls?: number;
  lookup_calls: number;
  raw_search_calls?: number;
}

export class StopPolicy {
  steps = 0;
  search_calls: Record<SearchScope, number> = { web: 0, corpus: 0, official: 0, academic: 0 };
  fetch_calls = 0;
  fetch_retry_calls = 0;
  lookup_calls = 0;
  raw_search_calls = 0;

  constructor(private readonly budgets: ToolBudgets) {}

  get totalSearchCalls(): number {
    return Object.values(this.search_calls).reduce((a, b) => a + b, 0);
  }

  /** Last step on which research tools may still be used. */
  get researchStepLimit(): number {
    const max = this.budgets.max_agent_steps;
    return Math.max(1, max - reservedMemoSteps(max));
  }

  /** Steps of research capacity still available. */
  get researchStepsLeft(): number {
    return Math.max(0, this.researchStepLimit - this.steps);
  }

  /** True once the research phase is over: only memo submission remains. */
  researchExhausted(): boolean {
    return this.steps >= this.researchStepLimit;
  }

  stepExhausted(): boolean {
    return this.steps >= this.budgets.max_agent_steps;
  }

  /** Returns null when allowed, otherwise the reason string handed to the agent. */
  checkTool(name: string, scope?: SearchScope): string | null {
    if (this.researchExhausted()) return "research_phase_closed: הגש את התזכיר עכשיו";
    if (name === "search" && this.totalSearchCalls >= this.budgets.max_search_calls) {
      return `budget_exhausted:search (${this.budgets.max_search_calls})`;
    }
    if (name === "fetch" && this.fetch_calls >= this.budgets.max_fetch_calls) {
      return `budget_exhausted:fetch (${this.budgets.max_fetch_calls})`;
    }
    if (name === "lookup_authority" && this.lookup_calls >= this.budgets.max_lookup_calls) {
      return `budget_exhausted:lookup_authority (${this.budgets.max_lookup_calls})`;
    }
    if (name === "raw_web_search" && this.raw_search_calls >= this.rawSearchBudget) {
      return `budget_exhausted:raw_web_search (${this.rawSearchBudget})`;
    }
    if (name === "search" && scope) void scope;
    return null;
  }

  /** Conservative default when an older serialized budget lacks the field. */
  get rawSearchBudget(): number {
    const v = this.budgets.max_raw_search_calls;
    return typeof v === "number" && v >= 0 ? v : 3;
  }

  note(name: string, scope?: SearchScope): void {
    if (name === "search") this.search_calls[scope ?? "web"] += 1;
    else if (name === "fetch") this.fetch_calls += 1;
    else if (name === "lookup_authority") this.lookup_calls += 1;
    else if (name === "raw_web_search") this.raw_search_calls += 1;
  }

  /** Synchronous check + debit so concurrent fetches share one bounded allowance. */
  reserveFetchRetry(): boolean {
    if (this.fetch_retry_calls >= MAX_FETCH_RETRY_CALLS) return false;
    this.fetch_retry_calls += 1;
    return true;
  }

  /** True when every tool budget is spent: the agent must finalize now. */
  allExhausted(): boolean {
    return this.researchExhausted() ||
      (this.totalSearchCalls >= this.budgets.max_search_calls &&
        this.fetch_calls >= this.budgets.max_fetch_calls &&
        this.lookup_calls >= this.budgets.max_lookup_calls);
  }

  toJSON(): StopPolicyJson {
    return {
      steps: this.steps,
      search_calls: { ...this.search_calls },
      fetch_calls: this.fetch_calls,
      fetch_retry_calls: this.fetch_retry_calls,
      lookup_calls: this.lookup_calls,
      raw_search_calls: this.raw_search_calls,
    };
  }

  static fromJSON(budgets: ToolBudgets, json: StopPolicyJson | null | undefined): StopPolicy {
    const p = new StopPolicy(budgets);
    if (json) {
      p.steps = json.steps ?? 0;
      p.search_calls = {
        web: json.search_calls?.web ?? 0,
        corpus: json.search_calls?.corpus ?? 0,
        official: json.search_calls?.official ?? 0,
        academic: json.search_calls?.academic ?? 0,
      };
      p.fetch_calls = json.fetch_calls ?? 0;
      // A legacy checkpoint may already have spent retries inside fetch_calls.
      // Never renew that unknown allowance on resume; a pristine run is safe.
      const retries = json.fetch_retry_calls;
      p.fetch_retry_calls = retries === undefined
        ? (p.fetch_calls > 0 ? MAX_FETCH_RETRY_CALLS : 0)
        : (Number.isSafeInteger(retries) && retries >= 0 ? retries : MAX_FETCH_RETRY_CALLS);
      p.lookup_calls = json.lookup_calls ?? 0;
      p.raw_search_calls = json.raw_search_calls ?? 0;
    }
    return p;
  }
}
