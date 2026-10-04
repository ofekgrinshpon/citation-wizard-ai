import { afterEach, beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { runtimeCheckpoint, runtimeDiagnostic, runtimeDiagnosticsActive, setRuntimeDiagnosticStep, withRuntimeDiagnostics } from "../../supabase/functions/legal-research-v2/shared/runtimeDiagnostics.ts";
const originalInfo = console.info;
let logs: Array<Record<string, unknown>>;
beforeEach(() => { logs = []; console.info = value => logs.push(JSON.parse(value)); });
afterEach(() => { console.info = originalInfo; });
describe("bounded native pilot runtime phase observations", () => {
  it("stays silent without an enabled context", async () => {
    runtimeDiagnostic("sse_begin");
    await withRuntimeDiagnostics(false, 1, async () => runtimeDiagnostic("sse_begin"));
    assert.equal(logs.length, 0);
  });
  it("allows only fixed phases and finite nonnegative numeric fields", async () => {
    await withRuntimeDiagnostics(true, 2, async () => {
      runtimeDiagnostic("untrusted" as Parameters<typeof runtimeDiagnostic>[0]);
      runtimeDiagnostic("sse_progress", { response_bytes: 42, chunks: Infinity, events: -1,
        request_bytes: NaN, output_chars: "private" } as unknown as Parameters<typeof runtimeDiagnostic>[1]);
    });
    assert.deepEqual(logs[1], { event: "v2_runtime_phase", phase: "sse_progress", seq: 2, chunk: 2, step: 0, response_bytes: 42 });
    assert.equal(logs.length, 3);
  });
  it("caps new diagnostic records at 256 with an explicit final marker", async () => {
    await withRuntimeDiagnostics(true, 1, async () => {
      for (let i = 0; i < 1000; i++) runtimeDiagnostic("sse_progress", { chunks: i });
      assert.equal(runtimeDiagnosticsActive(), false);
    });
    assert.equal(logs.length, 256); assert.equal(logs.at(-1)?.phase, "diagnostics_capped");
  });
  it("isolates concurrent runs and nested disabled contexts", async () => {
    await Promise.all([1, 2].map(chunk => withRuntimeDiagnostics(true, chunk, async () => {
      setRuntimeDiagnosticStep(chunk + 10); await Promise.resolve();
      await withRuntimeDiagnostics(false, 9, async () => runtimeDiagnostic("sse_begin"));
      runtimeDiagnostic("request_begin");
    })));
    for (const chunk of [1, 2]) assert.deepEqual(logs.filter(l => l.chunk === chunk).map(l => [l.phase, l.seq, l.step]),
      [["run_begin", 1, 0], ["request_begin", 2, chunk + 10], ["run_end", 3, chunk + 10]]);
  });
  it("does not let a logging failure change the operation result or thrown error", async () => {
    console.info = () => { throw Error("log sink"); };
    assert.equal(await withRuntimeDiagnostics(true, 1, async () => 7), 7);
    const original = Error("original");
    await assert.rejects(() => withRuntimeDiagnostics(true, 1, async () => { throw original; }), e => e === original);
  });
  it("counts checkpoint scalars without serializing payloads", async () => {
    await withRuntimeDiagnostics(true, 1, async () => runtimeCheckpoint({
      messages: [{ toJSON() { throw Error("must not serialize"); } }],
      store: { sources: [{ extracted_text: "private" }], quotes: [{}] },
    }));
    assert.equal(logs[1].source_body_chars, 7); assert.equal(logs[1].quote_count, 1);
    assert(!JSON.stringify(logs).includes("private"));
  });
  it("fails open on malformed checkpoint and throwing metric getter", async () => {
    await withRuntimeDiagnostics(true, 1, async () => {
      runtimeCheckpoint(null as unknown as Parameters<typeof runtimeCheckpoint>[0]);
      runtimeDiagnostic("sse_progress", { get response_bytes() { throw Error("private"); } });
    });
    assert.equal(logs.length, 2);
  });
});
