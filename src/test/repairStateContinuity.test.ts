/**
 * v2_repair_state_continuity_v1
 *
 * Repair re-entry (verification repair / temporal repair / derivative fallback)
 * must continue the SAME research run: the acquisition ledger, the commit
 * tracker and the cumulative agent stats are forwarded, not recreated.
 *
 * These tests exercise (a) the forwarding contract at the three index.ts call
 * sites and (b) the state semantics the forwarded objects must keep.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AcquisitionLedger } from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger.ts";
import { CommitTracker } from "../../supabase/functions/legal-research-v2/agent/commitPolicy.ts";
import { StopPolicy } from "../../supabase/functions/legal-research-v2/agent/stopPolicy.ts";

/** Mirrors runResearchAgent's option defaulting for the state objects. */
function reenter(opts: {
  ledger?: AcquisitionLedger;
  commit?: CommitTracker;
  stats?: Record<string, number>;
}) {
  return {
    ledger: opts.ledger ?? new AcquisitionLedger(),
    commit: opts.commit ?? new CommitTracker(),
    stats: { already_read_actions: 0, authority_bindings_created: 0, ...(opts.stats ?? {}) },
  };
}

const attempt = (url: string, outcome: "acquired" | "failed", reason: string) => ({
  url,
  outcome,
  reason,
  at: new Date().toISOString(),
  identity_corroborated: outcome === "acquired",
});

describe("repair re-entry forwards run state (index.ts call sites)", () => {
  const src = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
  const calls = src.split("runResearchAgent({").slice(1);

  it("has exactly four research entries: initial + three bounded repairs", () => {
    expect(calls).toHaveLength(4);
  });

  it("every call site forwards ledger, commit and stats", () => {
    for (const c of calls) {
      const body = c.slice(0, c.indexOf("\n    });") + 1 || 4000);
      expect(body).toMatch(/ledger:/);
      expect(body).toMatch(/commit:/);
      expect(body).toMatch(/stats:/);
    }
  });

  it("repair call sites do not pass trace (index.ts concatenates traces itself)", () => {
    for (const c of calls.slice(1)) {
      const body = c.slice(0, 900);
      expect(body).not.toMatch(/\btrace:/);
    }
    expect(src).toMatch(/trace: \[\.\.\.agent\.trace, \.\.\./);
  });
});

describe("A — acquired authority survives repair", () => {
  it("keeps the binding and does not re-acquire", () => {
    const l = new AcquisitionLedger();
    l.note("case:4602/13", attempt("https://x/a.pdf", "acquired", "docket_present_in_body"), "S1");
    const r = reenter({ ledger: l });
    expect(r.ledger.acquired("case:4602/13")).toBe(true);
    expect(r.ledger.get("case:4602/13")?.acquired_source_id).toBe("S1");
    expect(r.ledger.unresolvedTargets().map((t) => t.authority_key)).not.toContain("case:4602/13");
  });
});

describe("B — failed acquisition path survives repair", () => {
  it("remembers the dead URL and keeps the untried candidate", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:9780/17", {
      candidates: [{ url: "https://x/a" }, { url: "https://x/b" }],
    });
    l.note("case:9780/17", attempt("https://x/a", "failed", "http_403"));
    const r = reenter({ ledger: l });
    expect(r.ledger.failedUrls("case:9780/17")).toContain("https://x/a");
    expect(r.ledger.attemptOn("case:9780/17", "https://x/a/")).not.toBeNull();
    expect(r.ledger.untriedCandidates("case:9780/17").map((c) => c.url)).toEqual(["https://x/b"]);
  });
});

describe("C — unresolved target survives repair", () => {
  it("still surfaces the open target with its untried candidates", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:9780/17", { candidates: [{ url: "https://x/b" }] });
    const r = reenter({ ledger: l });
    const open = r.ledger.unresolvedTargets();
    expect(open.map((t) => t.authority_key)).toContain("case:9780/17");
    expect(open[0].untried).toHaveLength(1);
  });
});

describe("D — abandoned target survives repair", () => {
  it("does not reappear as unresolved after re-entry", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:1234/20");
    l.abandonTarget("case:1234/20", "no longer needed");
    const r = reenter({ ledger: l });
    expect(r.ledger.target("case:1234/20")?.abandoned).toBe(true);
    expect(r.ledger.unresolvedTargets().map((t) => t.authority_key)).not.toContain("case:1234/20");
  });
});

describe("E — per-source read state survives repair", () => {
  it("keeps exhaustion and known-missing locators", () => {
    const l = new AcquisitionLedger();
    for (let i = 0; i < 3; i++) l.noteRead("S1", { yielded: false, locator: "סעיף 8" });
    const r = reenter({ ledger: l });
    expect(r.ledger.readState("S1")?.exhausted).toBe(true);
    expect(r.ledger.knownMissingLocator("S1", "סעיף 8")).toBe(true);
  });
});

describe("F — commit state survives repair", () => {
  it("continues stale streak, issued directives and repeat counts", () => {
    const c = new CommitTracker();
    c.noteToolKey("search:foo");
    c.noteToolKey("search:foo");
    c.noteRound(false);
    c.noteRound(false);
    const signals = {
      readable_count: 1,
      obligations_total: 0,
      obligations_satisfied: 0,
      stale_streak: c.stale_streak,
      research_steps_left: 8,
    };
    expect(c.directive(signals)?.kind).toBe("stale_research");

    const r = reenter({ commit: c });
    expect(r.commit.stale_streak).toBe(2);
    expect(r.commit.repeatCount("search:foo")).toBe(2);
    // Already-issued one-shot directive is not re-issued from zero after repair.
    expect(r.commit.directive({ ...signals, stale_streak: 2 })).toBeNull();
    // A fresh tracker would have re-issued it — proving continuity matters.
    expect(new CommitTracker().directive({ ...signals, stale_streak: 2 })?.kind).toBe("stale_research");
  });
});

describe("G — stats remain cumulative", () => {
  it("carries counters into the repair run", () => {
    const r = reenter({ stats: { already_read_actions: 44, authority_bindings_created: 2 } });
    expect(r.stats.already_read_actions).toBe(44);
    expect(r.stats.authority_bindings_created).toBe(2);
  });
});

describe("H — autonomy preserved", () => {
  it("an open target never gates completion", () => {
    const l = new AcquisitionLedger();
    l.openTarget("case:1234/20", { candidates: [{ url: "https://x/c" }] });
    const r = reenter({ ledger: l });
    expect(r.ledger.unresolvedTargets()).toHaveLength(1);
    // Commit policy never consults targets as a completion condition.
    const d = r.commit.directive({
      readable_count: 3,
      obligations_total: 0,
      obligations_satisfied: 0,
      stale_streak: 0,
      research_steps_left: 0,
      unresolved_targets: [{ authority_key: "case:1234/20", untried: 1 }],
    });
    expect(d?.kind).toBe("mandatory_commit");
    // The agent may also drop it outright.
    r.ledger.abandonTarget("case:1234/20", "not needed");
    expect(r.ledger.unresolvedTargets()).toHaveLength(0);
  });

  it("allExhausted does not depend on acquisition state", () => {
    const p = new StopPolicy({
      max_agent_steps: 10,
      max_search_calls: 1,
      max_fetch_calls: 1,
      max_lookup_calls: 1,
    } as never);
    expect(p.allExhausted()).toBe(false);
    p.note("search");
    p.note("fetch");
    p.note("lookup_authority");
    expect(p.allExhausted()).toBe(true);
  });
});

describe("I — boundedness preserved", () => {
  it("a shared StopPolicy is not reset by repair re-entry", () => {
    const p = new StopPolicy({
      max_agent_steps: 10,
      max_search_calls: 5,
      max_fetch_calls: 5,
      max_lookup_calls: 5,
    } as never);
    p.steps = 8; // research limit is 10 - reserved(2) = 8
    expect(p.researchExhausted()).toBe(true);
    expect(p.checkTool("search")).toMatch(/research_phase_closed/);
    // Forwarding preserved state cannot revive research capacity.
    expect(p.researchStepsLeft).toBe(0);
  });

  it("no repair path re-enters research more than once", () => {
    const src = readFileSync("supabase/functions/legal-research-v2/index.ts", "utf8");
    expect(src.split("runResearchAgent({")).toHaveLength(5); // 4 calls
    expect(/while\s*\(.*repair/i.test(src)).toBe(false);
    expect(/for\s*\(.*repair/i.test(src)).toBe(false);
  });
});
