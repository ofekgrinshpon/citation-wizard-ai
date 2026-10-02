import type { ChatMessage, ChatToolCall } from "../shared/model.ts";

/** Server checkpoint only. The original assistant message holds calls/reasoning. */
export interface PendingToolTurn {
  run_id: string;
  step: number;
  assistant_index: number;
  readable_before: number;
  model_ms: number;
  context_chars: number;
  prompt_tokens: number;
  completion_tokens: number;
  tool_ms: number;
  turn_action: string;
  turn_no_op: boolean;
}

/**
 * Resume only the unanswered suffix of this exact assistant turn. A repeated
 * call ID in an earlier turn is unrelated; duplicate IDs inside this turn or
 * mismatched/out-of-order results are invalid and must never be dispatched.
 */
export function pendingToolCalls(
  messages: ChatMessage[],
  pending: PendingToolTurn,
  runId: string,
  step: number,
): ChatToolCall[] {
  const invalid = () => { throw new Error("invalid_pending_tool_turn"); };
  if (!pending || pending.run_id !== runId || pending.step !== step ||
    !Number.isInteger(pending.assistant_index) || pending.assistant_index < 0) return invalid();
  const assistant = messages[pending.assistant_index];
  if (assistant?.role !== "assistant" || !assistant.tool_calls?.length) return invalid();
  const ids = new Set<string>();
  const calls = assistant.tool_calls.map((c) => {
    if (!c.id || ids.has(c.id) || !c.function?.name || typeof c.function.arguments !== "string") return invalid();
    ids.add(c.id);
    return { id: c.id, name: c.function.name, arguments: c.function.arguments };
  });
  const results = messages.slice(pending.assistant_index + 1);
  if (results.length > calls.length) return invalid();
  for (let i = 0; i < results.length; i++) {
    if (results[i].role !== "tool" || results[i].tool_call_id !== calls[i].id) return invalid();
  }
  return calls.slice(results.length);
}
