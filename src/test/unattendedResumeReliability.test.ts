/**
 * automatic_resume_v1 — unattended checkpoint recovery.
 *
 * The recovery decision is pure and bounded; these tests pin every branch of
 * it, plus the invariants the executing code must preserve (atomic claim,
 * checkpoint replay, no research/verification/drafting change).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  classifyStall,
  decideAutoResume,
  RESUME_WATCHDOG,
  type WatchdogRow,
} from "../../supabase/functions/legal-research-v2/beta/resumePolicy";

const NOW = Date.parse("2026-09-10T12:00:00Z");
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

const row = (over: Partial<WatchdogRow> = {}): WatchdogRow => ({
  run_id: "r1",
  status: "paused",
  agent_state: { resume: { agent_state: {}, chunk_index: 2 }, stage: "reading" },
  last_beat_at: agoMs(10 * 60_000),
  created_at: agoMs(20 * 60_000),
  auto_resume_count: 0,
  watchdog_claimed_at: null,
  ...over,
});

const indexSrc = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");

describe("R1 — an abandoned checkpoint is recovered without a human", () => {
  it("triggers on a paused run whose worker stopped beating", () => {
    const d = decideAutoResume(row(), NOW);
    expect(d.automatic_resume_triggered).toBe(true);
    expect(d.automatic_resume_reason).toBe("recoverable_no_executor");
    expect(d.automatic_resume_checkpoint).toBe("reading");
    expect(d.manual_resume_required).toBe(false);
  });

  it("also recovers a run killed mid-chunk that still reads 'running'", () => {
    expect(classifyStall(row({ status: "running" }), NOW)).toBe("recoverable_no_executor");
  });
});

describe("R2 — a live worker is never resumed underneath itself", () => {
  it("leaves a recently beating run alone", () => {
    const d = decideAutoResume(row({ last_beat_at: agoMs(20_000) }), NOW);
    expect(d.automatic_resume_triggered).toBe(false);
    expect(d.automatic_resume_reason).toBe("still_alive");
  });

  it("uses created_at when a run has never beaten yet", () => {
    expect(classifyStall(row({ last_beat_at: null, created_at: agoMs(5_000) }), NOW))
      .toBe("still_alive");
  });

  it("beats while it works and stamps the checkpoint write", () => {
    expect(indexSrc).toContain("createRunBeat");
    expect(indexSrc).toMatch(/checkpoint[\s\S]{0,600}last_beat_at/);
  });
});

describe("R3 — recovery replays the stored checkpoint, it does not restart", () => {
  it("resumes through the same path a manual resume uses", () => {
    expect(indexSrc).toContain('JSON.stringify({ resume_run_id: row.run_id })');
    // The stored envelope carries the job and stage so a mid-chunk recovery can
    // still finalize the user-facing job row.
    expect(indexSrc).toMatch(/intake,\s*\n\s*\/\/ Without these a mid-chunk recovery/);
    expect(indexSrc).toContain("job: opts.job ?? null");
  });

  it("never re-charges: no credit call exists in the sweep", () => {
    const sweep = indexSrc.slice(
      indexSrc.indexOf("async function sweepStalledRuns"),
      indexSrc.indexOf("serve(async (req)"),
    );
    expect(sweep).not.toMatch(/consume_credits|refund|RESEARCH_CREDIT_COST/);
  });
});

describe("R4 — two sweepers can never both own one run", () => {
  it("refuses a run already claimed inside the claim TTL", () => {
    const d = decideAutoResume(row({ watchdog_claimed_at: agoMs(30_000) }), NOW);
    expect(d.automatic_resume_triggered).toBe(false);
    expect(d.duplicate_resume_prevented).toBe(true);
  });

  it("allows a claim to expire so a dead sweeper cannot block recovery", () => {
    expect(classifyStall(
      row({ watchdog_claimed_at: agoMs(RESUME_WATCHDOG.CLAIM_TTL_MS + 1_000) }),
      NOW,
    )).toBe("recoverable_no_executor");
  });

  it("claims with an optimistic compare-and-set on the resume counter", () => {
    expect(indexSrc).toMatch(/auto_resume_count: prior \+ 1[\s\S]{0,400}\.eq\("auto_resume_count", prior\)/);
  });
});

describe("R5 — recovery is bounded and fails over to a human", () => {
  it("stops after the maximum number of automatic resumes", () => {
    const d = decideAutoResume(
      row({ auto_resume_count: RESUME_WATCHDOG.MAX_AUTO_RESUMES }),
      NOW,
    );
    expect(d.automatic_resume_triggered).toBe(false);
    expect(d.automatic_resume_terminal_failure).toBe(true);
    expect(d.manual_resume_required).toBe(true);
  });

  it("never revives a long-abandoned run", () => {
    const d = decideAutoResume(
      row({
        created_at: agoMs(RESUME_WATCHDOG.MAX_RUN_AGE_MS + 60_000),
        last_beat_at: agoMs(RESUME_WATCHDOG.MAX_RUN_AGE_MS + 30_000),
      }),
      NOW,
    );
    expect(d.automatic_resume_triggered).toBe(false);
    expect(d.automatic_resume_reason).toBe("abandoned_too_old");
    expect(d.automatic_resume_terminal_failure).toBe(true);
  });

  it("keeps a small, explicit bound", () => {
    expect(RESUME_WATCHDOG.MAX_AUTO_RESUMES).toBeLessThanOrEqual(6);
    expect(RESUME_WATCHDOG.BATCH).toBeLessThanOrEqual(10);
  });
});

describe("R6 — terminal and unrecoverable states are left alone", () => {
  it.each(["done", "error", "failed", "refused"])("never touches a %s run", (status) => {
    const d = decideAutoResume(row({ status }), NOW);
    expect(d.automatic_resume_triggered).toBe(false);
    expect(d.automatic_resume_reason).toBe("terminal_status");
    expect(d.automatic_resume_terminal_failure).toBe(false);
  });

  it("asks for a human when there is no checkpoint to replay", () => {
    const d = decideAutoResume(row({ agent_state: null }), NOW);
    expect(d.automatic_resume_triggered).toBe(false);
    expect(d.automatic_resume_reason).toBe("no_checkpoint");
    expect(d.manual_resume_required).toBe(true);
  });
});

describe("R7 — the research behaviour itself is untouched", () => {
  it("the recovery policy module contains no research logic", () => {
    const code = readFileSync(
      "supabase/functions/legal-research-v2/beta/resumePolicy.ts",
      "utf8",
    )
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toMatch(/drafter|verif|synthes|coverage|same.?work|quota|memo/i);
  });
});

describe("R8 — the sweep endpoint is not publicly callable", () => {
  it("requires a single-use scheduler nonce or service-role smoke auth", () => {
    expect(indexSrc).toContain("v2_watchdog_ticks");
    expect(indexSrc).toMatch(/schedulerOk[\s\S]{0,200}isSmoke\) return json\(\{ error: "unauthorized" \}, 401\)/);
    expect(indexSrc).toMatch(/\.is\("used_at", null\)/);
  });
});
