import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { pendingToolCalls, type PendingToolTurn } from "../../supabase/functions/legal-research-v2/agent/pendingToolTurn.ts";
import type { ChatMessage } from "../../supabase/functions/legal-research-v2/shared/model.ts";

const call = (id: string) => ({ id, type: "function" as const, function: { name: "fetch", arguments: JSON.stringify({ url: `https://example.test/${id}` }) } });
const state = (assistant_index = 0): PendingToolTurn => ({
  run_id: "run", step: 4, assistant_index, readable_before: 0,
  model_ms: 90_001, context_chars: 50, prompt_tokens: 20, completion_tokens: 10,
  tool_ms: 0, turn_action: "", turn_no_op: false,
});
const result = (id: string): ChatMessage => ({ role: "tool", tool_call_id: id, content: "{}" });

describe("pending tool turn journal", () => {
  it("retains original IDs, names, and arguments", () => {
    const c = call("original");
    assert.deepEqual(pendingToolCalls([{ role: "assistant", content: "", tool_calls: [c] }], state(), "run", 4), [{ id: c.id, ...c.function }]);
  });
  it("resumes only the unanswered suffix", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "", tool_calls: [call("a"), call("b")] }, result("a")];
    assert.deepEqual(pendingToolCalls(messages, state(), "run", 4).map(c => c.id), ["b"]);
  });
  it("a fully completed saved turn performs no calls on replay", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "", tool_calls: [call("a")] }, result("a")];
    assert.deepEqual(pendingToolCalls(messages, state(), "run", 4), []);
  });
  it("same ID in an earlier turn does not mark current call complete", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "", tool_calls: [call("a")] }, result("a"), { role: "assistant", content: "", tool_calls: [call("a")] }];
    assert.equal(pendingToolCalls(messages, state(2), "run", 4).length, 1);
  });
  it("rejects duplicate IDs in one turn", () => {
    assert.throws(() => pendingToolCalls([{ role: "assistant", content: "", tool_calls: [call("a"), call("a")] }], state(), "run", 4), /invalid_pending/);
  });
  for (const [name, suffix] of [
    ["wrong result ID", [result("other")]],
    ["duplicate result", [result("a"), result("a")]],
    ["intervening message", [{ role: "user", content: "Changed request" } as ChatMessage]],
  ] as const) it(`rejects ${name}`, () => {
    assert.throws(() => pendingToolCalls([{ role: "assistant", content: "", tool_calls: [call("a")] }, ...suffix], state(), "run", 4), /invalid_pending/);
  });
  it("rejects foreign run, wrong step, and invalid assistant index", () => {
    const messages: ChatMessage[] = [{ role: "assistant", content: "", tool_calls: [call("a")] }];
    for (const bad of [{ ...state(), run_id: "other" }, { ...state(), step: 5 }, state(-1), state(0.5), state(5)]) {
      assert.throws(() => pendingToolCalls(messages, bad, "run", 4), /invalid_pending/);
    }
  });
  it("JSON round-trip preserves the journal and pending suffix", () => {
    const snapshot = JSON.parse(JSON.stringify({ messages: [{ role: "assistant", content: "", tool_calls: [call("a"), call("b")] }, result("a")], pending: state() }));
    assert.equal(pendingToolCalls(snapshot.messages, snapshot.pending, "run", 4)[0].id, "b");
  });
});
