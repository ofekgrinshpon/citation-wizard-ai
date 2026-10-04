/** Bounded, content-free phase observations for already-authorized native pilots.
 * No persistence/provider calls; elapsed values are NOT hosted CPU measurements.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export const RUNTIME_DIAGNOSTIC_LIMIT = 256;
const PHASES = [
  "run_begin", "run_end", "request_begin", "request_prepared", "input_count_begin", "input_count_end",
  "dispatch_begin", "response_headers", "sse_begin", "sse_progress", "sse_end", "response_validate_begin", "response_validate_end", "attempt_end",
  "checkpoint_begin", "checkpoint_end", "source_extract_begin", "source_extract_end",
  "text_process_begin", "text_process_end", "source_read_begin", "source_read_end", "coverage_reflection",
  "diagnostics_capped",
] as const;
type Phase = typeof PHASES[number];
const FIELDS = [
  "elapsed_ms", "sync_elapsed_ms", "request_bytes", "response_bytes", "chunks", "events",
  "max_buffer_chars", "max_line_chars", "pending_line_chars", "message_count", "source_count",
  "source_body_chars", "quote_count", "input_bytes", "output_chars", "term_count", "http_status",
  "input_tokens", "attempt", "ok", "terminal", "format_kind", "readable_count", "unused_count",
] as const;
type Fields = Partial<Record<typeof FIELDS[number], number>>;
interface Scope { chunk: number; step: number; seq: number }
const scopes = new AsyncLocalStorage<Scope | undefined>();
const number = (n: number): number => Math.round(Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, n)) * 1000) / 1000;

export function runtimeDiagnosticsActive(): boolean {
  const scope = scopes.getStore();
  return !!scope && scope.seq < RUNTIME_DIAGNOSTIC_LIMIT;
}

export function setRuntimeDiagnosticStep(step: number): void {
  const scope = scopes.getStore();
  if (scope && Number.isFinite(step)) scope.step = number(step);
}

/** Runtime allowlist also rejects unknown keys/strings supplied through untyped callers. */
export function runtimeDiagnostic(phase: Phase, fields: Fields = {}): void {
  try {
    const scope = scopes.getStore();
    if (!scope || scope.seq >= RUNTIME_DIAGNOSTIC_LIMIT || !PHASES.includes(phase)) return;
    const capped = scope.seq === RUNTIME_DIAGNOSTIC_LIMIT - 1;
    const record: Record<string, string | number> = {
      event: "v2_runtime_phase", phase: capped ? "diagnostics_capped" : phase,
      seq: ++scope.seq, chunk: scope.chunk, step: scope.step,
    };
    if (!capped) for (const key of FIELDS) {
      const value = fields[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) record[key] = number(value);
    }
    console.info(JSON.stringify(record));
  } catch { /* Observation failures must never affect research or settlement. */ }
}

export function withRuntimeDiagnostics<T>(enabled: boolean, chunk: number, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return scopes.run(undefined, fn);
  return scopes.run({ chunk: Number.isFinite(chunk) ? number(chunk) : 0, step: 0, seq: 0 }, async () => {
    runtimeDiagnostic("run_begin");
    try { return await fn(); } finally { runtimeDiagnostic("run_end"); }
  });
}

/** Shallow length reads only; malformed diagnostic inputs never block an existing save path. */
export function runtimeCheckpoint(state: {
  messages: unknown[];
  store: { sources: Array<{ extracted_text: string }>; quotes?: unknown[] };
}): void {
  try {
    if (!runtimeDiagnosticsActive()) return;
    runtimeDiagnostic("checkpoint_begin", {
      message_count: state.messages.length, source_count: state.store.sources.length,
      source_body_chars: state.store.sources.reduce((n, source) => n + source.extracted_text.length, 0),
      quote_count: state.store.quotes?.length ?? 0,
    });
  } catch { /* Diagnostic observation only. */ }
}
