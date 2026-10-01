import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { invokeResumeHandoff } from "../../supabase/functions/legal-research-v2/beta/resumeHandoff";
import { resumeGapPhase } from "../../supabase/functions/legal-research-v2/shared/timing";

const RUN = "00000000-0000-4000-8000-000000000001";

describe("resume hand-off acknowledgment", () => {
  for (const status of [200, 202, 500, 503]) {
    it(`status ${status}: one request, logs only on failure, no state access`, async () => {
      const fetchImpl = vi.fn(async () => new Response("x", { status }));
      const log = vi.fn();
      const ack = await invokeResumeHandoff(RUN, "https://h", "k", { fetchImpl: fetchImpl as never, log });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(ack.ok).toBe(status < 300);
      expect(ack.status).toBe(status);
      expect(log).toHaveBeenCalledTimes(status < 300 ? 0 : 1);
      if (status >= 300) {
        const line = JSON.parse(log.mock.calls[0][0]);
        expect(Object.keys(line).sort()).toEqual(["event", "run_id", "status"]);
      }
    });
  }

  it("network error: logged once, rethrown, not retried", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("net"); });
    const log = vi.fn();
    await expect(invokeResumeHandoff(RUN, "https://h", "k", { fetchImpl: fetchImpl as never, log })).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("orchestrator never rewrites agent_state after the hand-off", () => {
    const src = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
    const i = src.indexOf("const ack = await selfInvokeResume(");
    expect(i).toBeGreaterThan(0);
    const tail = src.slice(i, src.indexOf("return;", i));
    expect(tail).not.toMatch(/\.update\(|agent_state/);
  });
});

describe("resume gap phase selection", () => {
  it("separates voluntary hand-off, mid-call recovery and legacy rows", () => {
    expect(resumeGapPhase("handoff")).toBe("resume_gap");
    expect(resumeGapPhase("checkpoint")).toBe("recovered_mid_call_elapsed");
    expect(resumeGapPhase(undefined)).toBe("resume_gap_unclassified");
  });
});
