import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  attestUsageFailure,
  hasAmbiguousFailure,
  isDefinitiveInsertFailure,
} from "../../supabase/functions/_shared/legacyUsageRefund";
import {
  finishJobError,
  definitiveGatewayFailure,
  finishJobSuccess,
  isTerminal,
  refundJob,
  type BetaJob,
  type BetaResultShape,
} from "../../supabase/functions/legal-research-v2/beta/job";

const job: BetaJob = { id: "job-1", user_id: "user-1", credit_request_id: "charge-1" };
const result = (delivered = true): BetaResultShape => ({
  answer: delivered ? "A cited answer" : "",
  footnotes: delivered ? [{ number: 1, title: "Source", sources: [{ title: "Source" }] }] : [],
  used_sources: [], pipeline_version: "v2", run_id: "run-1", debug: {},
});

/** An offline stateful query mock: conditional writes choose one terminal winner. */
function database(initialStatus = "running", options: { writeError?: boolean; rpcResult?: unknown } = {}) {
  const row: Record<string, unknown> = { id: job.id, user_id: job.user_id, status: initialStatus };
  const calls: string[] = [];
  const rpc = vi.fn(async (name: string) => {
    calls.push(name);
    return { data: options.rpcResult ?? { ok: true, refunded: true }, error: null };
  });
  const from = vi.fn(() => {
    let patch: Record<string, unknown> | null = null;
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    const execute = () => {
      if (options.writeError) return { data: null, error: { message: "unknown DB outcome" } };
      if (!filters.every((test) => test(row))) return { data: null, error: null };
      if (patch) { Object.assign(row, patch); calls.push(`persist:${row.status}`); }
      return { data: { ...row }, error: null };
    };
    const builder = {
      update(value: Record<string, unknown>) { patch = value; return builder; },
      select() { return builder; },
      eq(key: string, value: unknown) { filters.push((r) => r[key] === value); return builder; },
      in(key: string, values: unknown[]) { filters.push((r) => values.includes(r[key])); return builder; },
      maybeSingle: async () => execute(),
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };
    return builder;
  });
  return { admin: { from, rpc } as never, row, rpc, calls };
}

describe("trusted legacy refund RPC", () => {
  it.each([
    [null, null, false],
    [{ ok: true }, null, false],
    [{ ok: true, noop: true, refunded: false }, null, false],
    [{ ok: false, refunded: true }, null, false],
    [{ ok: true, refunded: true }, { message: "RPC error" }, false],
    [{ ok: true, refunded: true }, null, true],
    [{ ok: true, refunded: true, replayed: true }, null, true],
  ])("reports only confirmed positive refunds (%j)", async (data, error, expected) => {
    const rpc = vi.fn(async () => ({ data, error }));
    expect(await attestUsageFailure({ rpc }, "u", "r", "known-failure")).toBe(expected);
    expect(rpc).toHaveBeenCalledWith("attest_usage_failure", {
      _user_id: "u", _request_id: "r", _reason: "known-failure",
    });
  });

  it("does not claim a refund on a lost RPC response", async () => {
    expect(await attestUsageFailure({ rpc: async () => { throw new TypeError("fetch failed"); } }, "u", "r", "known")).toBe(false);
  });

  it("skips admin/zero-charge jobs with no credit request", async () => {
    const db = database();
    expect(await refundJob(db.admin, { ...job, credit_request_id: null }, "known")).toBe(false);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each(["23505", "23503", "22P02"])("recognizes atomic SQL rejection %s", (code) => {
    expect(isDefinitiveInsertFailure({ code })).toBe(true);
  });
  it.each([null, {}, { code: "PGRST000" }, { code: "08006" }, { message: "fetch failed" }])("does not infer rejected insertion from %j", (error) => {
    expect(isDefinitiveInsertFailure(error)).toBe(false);
  });
});

describe("legacy research terminal/refund ordering", () => {
  it("keeps a delivered cited answer charged", async () => {
    const db = database();
    expect(await finishJobSuccess(db.admin, job, result())).toEqual({ refunded: false });
    expect(db.row.status).toBe("done");
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.row.result).toMatchObject({ delivery_failed: false, credits_refunded: false });
  });

  it("persists a no-answer terminal winner before attestation", async () => {
    const db = database();
    expect(await finishJobSuccess(db.admin, job, result(false))).toEqual({ refunded: true });
    expect(db.calls).toEqual(["persist:done", "attest_usage_failure", "persist:done"]);
    expect(db.row.result).toMatchObject({ delivery_failed: true, execution_outcome_unknown: false, credits_refunded: true });
  });

  it("persists a definitive gateway failure before attestation", async () => {
    const db = database();
    expect(await finishJobError(db.admin, job, "model_error_503", true)).toEqual({ refunded: true });
    expect(db.calls[0]).toBe("persist:error");
    expect(db.calls[1]).toBe("attest_usage_failure");
  });

  it("records thrown/transport failures without automatic refund", async () => {
    const db = database();
    expect(await finishJobError(db.admin, job, "fetch failed")).toEqual({ refunded: false });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.row.result).toMatchObject({ execution_outcome_unknown: true, credits_refunded: false });
  });

  it("does not convert a timed-out no-answer result into a known failure", async () => {
    const db = database();
    expect(await finishJobSuccess(db.admin, job, { ...result(false), debug: { agent_error: "request timeout" } })).toEqual({ refunded: false });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(db.row.result).toMatchObject({ execution_outcome_unknown: true, delivery_failed: false });
  });

  it.each(["done", "error", "timed_out", "awaiting_user"])("does not refund or rewrite terminal/parked %s", async (status) => {
    const db = database(status);
    expect(await finishJobError(db.admin, job, "model_error_503", true)).toEqual({ refunded: false, skipped: true });
    expect(await finishJobSuccess(db.admin, job, result(false))).toEqual({ refunded: false, skipped: true });
    expect(db.row.status).toBe(status);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("does not refund if terminal persistence is unknown", async () => {
    const db = database("running", { writeError: true });
    expect(await finishJobSuccess(db.admin, job, result(false))).toEqual({ refunded: false, skipped: true });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(await isTerminal(db.admin, job.id)).toBe(true);
  });

  it("does not advertise a refund when service eligibility is denied", async () => {
    const db = database("running", { rpcResult: { ok: false, error: "REFUND_NOT_ELIGIBLE" } });
    expect(await finishJobSuccess(db.admin, job, result(false))).toEqual({ refunded: false });
    expect(db.row.result).toMatchObject({ credits_refunded: false });
  });

  it("a concurrent failure loses to a persisted successful answer", async () => {
    const db = database();
    const [success, failure] = await Promise.all([
      finishJobSuccess(db.admin, job, result()),
      finishJobError(db.admin, job, "model_error_503", true),
    ]);
    expect(success).toEqual({ refunded: false });
    expect(failure).toEqual({ refunded: false, skipped: true });
    expect(db.row.status).toBe("done");
    expect(db.row.result).toMatchObject({ answer: "A cited answer", credits_refunded: false });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("a concurrent success cannot overwrite a confirmed failed winner", async () => {
    const db = database();
    const [failure, success] = await Promise.all([
      finishJobError(db.admin, job, "model_error_503", true),
      finishJobSuccess(db.admin, job, result()),
    ]);
    expect(failure).toEqual({ refunded: true });
    expect(success).toEqual({ refunded: false, skipped: true });
    expect(db.row.status).toBe("error");
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("legacy caller integration guards", () => {
  const read = (path: string) => readFileSync(`supabase/functions/${path}`, "utf8");
  it.each(["legal-qa/index.ts", "bibliography-lookup/index.ts", "legal-research-v2/index.ts", "legal-research-v2/beta/job.ts"])("%s no longer uses owner/unattested refund RPCs", (path) => {
    const source = read(path);
    expect(source).not.toMatch(/rpc\(\s*"refund_credits(?:_for_user)?"/);
    expect(source).toContain("attestUsageFailure");
  });
  it.each(["legal-qa/index.ts", "bibliography-lookup/index.ts", "legal-research-v2/index.ts"])("%s refuses a replayed consume as fresh execution", (path) => {
    const source = read(path);
    expect(source).toContain(".replayed === true");
    expect(source).toContain('error: "REQUEST_ALREADY_CONSUMED"');
  });
  it("retired V1 has no consumption, watchdog, or refund execution path", () => {
    const source = read("legal-research-v1/index.ts");
    expect(source).toContain('code: "RESEARCH_VERSION_RETIRED"');
    expect(source).toContain("status: 410");
    expect(source).toContain("execution_started: false");
    expect(source).toContain("units_consumed: 0");
    expect(source).not.toMatch(/attestUsageFailure|consume_credits|refund_credits|refundCredits|credits_refunded/);
    expect(source).not.toMatch(/createClient|makeAdminClient|legal_research_jobs|setTimeout|waitUntil/);
    expect(source).not.toMatch(/acquireOperationLock|heartbeatOperationLock|releaseOperationLock/);
  });
  it("bibliography only tracks a debit after successful non-replayed consume", () => {
    const source = read("bibliography-lookup/index.ts");
    expect(source.indexOf("creditRequestId = consumeData.admin")).toBeGreaterThan(source.indexOf("consumeData.replayed === true"));
    expect(source).toContain("e instanceof DefinitiveUsageFailure");
  });
  it("detects nested ambiguous diagnostics without treating normal answer prose as authority", () => {
    expect(hasAmbiguousFailure({ debug: { stage: { error: "connection reset" } } })).toBe(true);
    expect(hasAmbiguousFailure({ timed_out: true })).toBe(true);
    expect(hasAmbiguousFailure({ answer: "A legal claim involving a timeout" })).toBe(false);
    expect(hasAmbiguousFailure({ debug: { refusal: "No suitable sources" } })).toBe(false);
  });
});


describe("synthetic model error outcomes", () => {
  it.each(["agent_model_error_502: responses_stream_incomplete", "drafter_error_502", "drafter_error_0", "drafter_no_blocks", "agent_model_error_504: timeout"])("never attests ambiguous %s", (error) => {
    expect(definitiveGatewayFailure({ agent_error: error })).toBe(false);
    expect(hasAmbiguousFailure({ drafter_error: error })).toBe(true);
  });
  it("recognizes explicit gateway rejection", () => {
    expect(definitiveGatewayFailure({ agent_error: "agent_model_error_429: rejected" })).toBe(true);
  });
  it("keeps stage failure transport detail uncertain", () => {
    expect(hasAmbiguousFailure({ error: "stage_failed", detail: "network_error: lost response" })).toBe(true);
    expect(hasAmbiguousFailure({ debug: { planning: { transport_failed: true } } })).toBe(true);
  });
});
