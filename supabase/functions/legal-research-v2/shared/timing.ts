/**
 * legal-research-v2 — run timing ledger.
 *
 * Pure measurement. It changes no behaviour: it only makes the difference
 * between *useful research latency* (model thinking, real acquisition) and
 * *orchestration waste* (no-op turns, resume gaps, repeated acquisition)
 * visible in telemetry.
 */

export type TimedPhase =
  | "agent_model"
  | "search"
  | "fetch"
  | "lookup"
  | "verification_model"
  | "temporal_model"
  | "drafting_model"
  | "rendering"
  | "resume_gap";

export interface AgentTurnRecord {
  turn: number;
  chunk: number;
  /** Wall-clock of the model call for this turn. */
  model_ms: number;
  /** Wall-clock of the tool execution triggered by this turn. */
  tool_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cumulative_prompt_tokens: number;
  /** Serialized size of the conversation actually sent to the model. */
  context_chars: number;
  action: string;
  added_evidence: boolean;
  /** True when the action produced nothing the run did not already have. */
  no_op: boolean;
}

export interface RunTimingJson {
  totals_ms: Record<string, number>;
  counts: Record<string, number>;
  turns: AgentTurnRecord[];
}

export class RunTimer {
  private totals: Record<string, number> = {};
  private counts: Record<string, number> = {};
  turns: AgentTurnRecord[] = [];

  add(phase: TimedPhase | string, ms: number): void {
    this.totals[phase] = (this.totals[phase] ?? 0) + Math.max(0, Math.round(ms));
    this.counts[phase] = (this.counts[phase] ?? 0) + 1;
  }

  async time<T>(phase: TimedPhase | string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      this.add(phase, Date.now() - started);
    }
  }

  noteTurn(record: AgentTurnRecord): void {
    this.turns.push(record);
  }

  totalsMs(): Record<string, number> {
    return { ...this.totals };
  }

  toJSON(): RunTimingJson {
    return { totals_ms: { ...this.totals }, counts: { ...this.counts }, turns: this.turns };
  }

  static fromJSON(json: RunTimingJson | null | undefined): RunTimer {
    const t = new RunTimer();
    for (const [k, v] of Object.entries(json?.totals_ms ?? {})) t.totals[k] = v;
    for (const [k, v] of Object.entries(json?.counts ?? {})) t.counts[k] = v;
    t.turns = json?.turns ?? [];
    return t;
  }
}
