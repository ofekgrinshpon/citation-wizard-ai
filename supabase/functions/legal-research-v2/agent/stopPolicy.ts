/**
 * legal-research-v2 — hard ceilings for the research agent.
 *
 * These are ceilings, not targets. The agent normally stops well below them
 * by calling `submit_research_memo`. Nothing here plans, routes or ranks.
 */

import type { SearchScope, ToolBudgets } from "../types.ts";

export class StopPolicy {
  steps = 0;
  search_calls: Record<SearchScope, number> = { web: 0, corpus: 0, official: 0, academic: 0 };
  fetch_calls = 0;
  lookup_calls = 0;

  constructor(private readonly budgets: ToolBudgets) {}

  get totalSearchCalls(): number {
    return Object.values(this.search_calls).reduce((a, b) => a + b, 0);
  }

  stepExhausted(): boolean {
    return this.steps >= this.budgets.max_agent_steps;
  }

  /** Returns null when allowed, otherwise the reason string handed to the agent. */
  checkTool(name: string, scope?: SearchScope): string | null {
    if (name === "search" && this.totalSearchCalls >= this.budgets.max_search_calls) {
      return `budget_exhausted:search (${this.budgets.max_search_calls})`;
    }
    if (name === "fetch" && this.fetch_calls >= this.budgets.max_fetch_calls) {
      return `budget_exhausted:fetch (${this.budgets.max_fetch_calls})`;
    }
    if (name === "lookup_authority" && this.lookup_calls >= this.budgets.max_lookup_calls) {
      return `budget_exhausted:lookup_authority (${this.budgets.max_lookup_calls})`;
    }
    if (name === "search" && scope) void scope;
    return null;
  }

  note(name: string, scope?: SearchScope): void {
    if (name === "search") this.search_calls[scope ?? "web"] += 1;
    else if (name === "fetch") this.fetch_calls += 1;
    else if (name === "lookup_authority") this.lookup_calls += 1;
  }

  /** True when every tool budget is spent: the agent must finalize now. */
  allExhausted(): boolean {
    return this.totalSearchCalls >= this.budgets.max_search_calls &&
      this.fetch_calls >= this.budgets.max_fetch_calls &&
      this.lookup_calls >= this.budgets.max_lookup_calls;
  }
}
