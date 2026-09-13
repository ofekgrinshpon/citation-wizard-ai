import { describe, expect, it } from "vitest";

import {
  denseForm,
  matchSpan,
  normalizeForMatch,
} from "../../supabase/functions/legal-research-v2/verification/spanMatch";
import { StopPolicy } from "../../supabase/functions/legal-research-v2/agent/stopPolicy";
import type { ToolBudgets } from "../../supabase/functions/legal-research-v2/types";

const budgets: ToolBudgets = {
  max_agent_steps: 3,
  max_search_calls: 2,
  max_fetch_calls: 1,
  max_lookup_calls: 1,
  max_raw_search_calls: 3,
};

describe("spanMatch — CHECK 3 (verbatim span)", () => {
  const body =
    'בית המשפט קבע כי "הלכת השיתוף חלה גם על נכסים שנרכשו לפני הנישואין", וזאת בכפוף לנסיבות.';

  it("accepts an exact substring", () => {
    const r = matchSpan(body, "הלכת השיתוף חלה גם על נכסים שנרכשו לפני הנישואין");
    expect(r.matched).toBe(true);
    expect(r.status).toBe("exact");
  });

  it("accepts a span differing only in whitespace and quote glyphs", () => {
    const r = matchSpan(body, "הלכת   השיתוף חלה גם על נכסים שנרכשו לפני הנישואין");
    expect(r.matched).toBe(true);
    expect(r.status).toBe("normalized");
  });

  it("tolerates PDF punctuation noise via the dense form", () => {
    const r = matchSpan(body, "הלכת השיתוף, חלה גם על נכסים - שנרכשו לפני הנישואין");
    expect(r.matched).toBe(true);
    expect(r.status).toBe("dense");
  });

  it("rejects a paraphrase that is not present verbatim", () => {
    const r = matchSpan(body, "חזקת השיתוף חלה על כל הנכסים ללא יוצא מן הכלל בכל מקרה");
    expect(r.matched).toBe(false);
    expect(r.status).toBe("not_found");
  });

  it("rejects a span that is too short to be meaningful", () => {
    const r = matchSpan(body, "בית המשפט");
    expect(r.matched).toBe(false);
    expect(r.status).toBe("too_short");
  });

  it("normalizes niqqud and bidi controls out of the comparison", () => {
    expect(normalizeForMatch("שָׁלוֹם\u200f עולם")).toBe("שלום עולם");
    expect(denseForm("א, ב. ג")).toBe("אבג");
  });
});

describe("StopPolicy — hard ceilings", () => {
  it("blocks a tool once its budget is spent and reports exhaustion", () => {
    const p = new StopPolicy(budgets);
    expect(p.checkTool("fetch")).toBeNull();
    p.note("fetch");
    expect(p.checkTool("fetch")).toContain("budget_exhausted:fetch");

    p.note("search", "web");
    expect(p.checkTool("search", "official")).toBeNull();
    p.note("search", "official");
    expect(p.checkTool("search", "official")).toContain("budget_exhausted:search");
    expect(p.search_calls.official).toBe(1);

    expect(p.allExhausted()).toBe(false);
    p.note("lookup_authority");
    expect(p.allExhausted()).toBe(true);
  });

  it("stops the loop at the step ceiling", () => {
    const p = new StopPolicy(budgets);
    p.steps = 3;
    expect(p.stepExhausted()).toBe(true);
  });
});
