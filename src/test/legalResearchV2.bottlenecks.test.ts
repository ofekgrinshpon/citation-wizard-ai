import { describe, expect, it } from "vitest";

import {
  CommitTracker,
  obligationsSatisfied,
} from "../../supabase/functions/legal-research-v2/agent/commitPolicy";
import {
  reservedMemoSteps,
  StopPolicy,
} from "../../supabase/functions/legal-research-v2/agent/stopPolicy";
import { toolCallKey } from "../../supabase/functions/legal-research-v2/agent/researchAgent";
import {
  AcquisitionLedger,
  authorityKeyOf,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import {
  cleanDisplayTitle,
  stripInternalIds,
} from "../../supabase/functions/legal-research-v2/shared/titleHygiene";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import { clampFetchOutput, FETCH_LIMITS } from "../../supabase/functions/legal-research-v2/tools/fetch";
import type {
  EvidenceSource,
  Intake,
  ToolBudgets,
} from "../../supabase/functions/legal-research-v2/types";

const BUDGETS: ToolBudgets = {
  max_agent_steps: 30,
  max_search_calls: 8,
  max_fetch_calls: 12,
  max_lookup_calls: 6,
};

describe("stop policy — reserved memo capacity", () => {
  it("always reserves between 2 and 6 steps for the memo", () => {
    expect(reservedMemoSteps(30)).toBe(6);
    expect(reservedMemoSteps(10)).toBe(2);
    expect(reservedMemoSteps(4)).toBe(2);
  });

  it("closes research tools before the overall step budget runs out", () => {
    const p = new StopPolicy(BUDGETS);
    p.steps = p.researchStepLimit;
    expect(p.researchExhausted()).toBe(true);
    expect(p.stepExhausted()).toBe(false);
    expect(p.checkTool("search", "web")).toMatch(/research_phase_closed/);
  });

  it("round-trips through JSON so a chunked run resumes with the same counters", () => {
    const p = new StopPolicy(BUDGETS);
    p.steps = 7;
    p.note("search", "corpus");
    p.note("fetch");
    const back = StopPolicy.fromJSON(BUDGETS, JSON.parse(JSON.stringify(p.toJSON())));
    expect(back.steps).toBe(7);
    expect(back.search_calls.corpus).toBe(1);
    expect(back.fetch_calls).toBe(1);
  });
});

describe("commit policy", () => {
  const base = {
    readable_count: 0,
    obligations_total: 0,
    obligations_satisfied: 0,
    stale_streak: 0,
    research_steps_left: 20,
  };

  it("issues a mandatory commit once research capacity is spent", () => {
    const t = new CommitTracker();
    expect(t.directive({ ...base, research_steps_left: 0 })?.kind).toBe("mandatory_commit");
  });

  it("issues the named-authority directive when every obligation has a body", () => {
    const t = new CommitTracker();
    const d = t.directive({ ...base, obligations_total: 1, obligations_satisfied: 1 });
    expect(d?.kind).toBe("named_authority_ready");
    // never repeated
    expect(t.directive({ ...base, obligations_total: 1, obligations_satisfied: 1 })).not.toBe(d);
  });

  it("issues early commit once several documents were read, and only once", () => {
    const t = new CommitTracker();
    expect(t.directive({ ...base, readable_count: 3 })?.kind).toBe("early_commit");
    expect(t.directive({ ...base, readable_count: 4 })).toBeNull();
  });

  it("flags stale research after repeated rounds without new evidence", () => {
    const t = new CommitTracker();
    t.noteRound(false);
    t.noteRound(false);
    expect(t.stale_streak).toBe(2);
    expect(t.directive({ ...base, stale_streak: t.stale_streak })?.kind).toBe("stale_research");
  });

  it("warns when the same tool call is repeated", () => {
    const t = new CommitTracker();
    expect(t.noteToolKey("search:web:x")).toBeNull();
    expect(t.noteToolKey("search:web:x")).toMatch(/כבר בוצעה/);
    expect(t.noteToolKey("search:web:x")).toMatch(/חוזרת/);
  });

  it("counts satisfied docket obligations from read bodies", () => {
    const intake = {
      docket_obligations: [{ docket_id: "d", display: 'בג"ץ 1000/92', variants: [] }],
      statute_obligations: [],
    } as unknown as Intake;
    const readable = [
      {
        identity_fields: { dockets: ["1000/92"], statutes: [], sections: [] },
        extracted_text: "",
      } as unknown as EvidenceSource,
    ];
    expect(obligationsSatisfied(intake, readable)).toBe(1);
  });
});

describe("repeated call keys", () => {
  it("treats the same search as the same key regardless of punctuation", () => {
    expect(toolCallKey("search", { query: "חלוקת רכוש, בני זוג", scope: "web" }))
      .toBe(toolCallKey("search", { query: "חלוקת רכוש בני זוג", scope: "web" }));
  });
  it("distinguishes different fetch targets", () => {
    expect(toolCallKey("fetch", { url: "https://a/x" }))
      .not.toBe(toolCallKey("fetch", { url: "https://a/y" }));
  });
});

describe("acquisition ledger", () => {
  it("keys named authorities and advises after repeated failures", () => {
    const key = authorityKeyOf({ docket: 'בג"ץ 1000/92' })!;
    expect(key).toBe("case:1000/92");
    const l = new AcquisitionLedger();
    l.note(key, { url: "https://a", outcome: "failed", reason: "http_404", at: "t" });
    expect(l.advice(key)).toBeUndefined();
    l.note(key, { url: "https://b", outcome: "failed", reason: "http_500", at: "t" });
    expect(l.advice(key)).toMatch(/mirror|עותק מראה/);
    expect(l.failedUrls(key)).toEqual(["https://a", "https://b"]);
    l.note(key, { url: "https://c", outcome: "acquired", reason: "ok", at: "t" }, "S3");
    expect(l.acquired(key)).toBe(true);
    const back = AcquisitionLedger.fromJSON(JSON.parse(JSON.stringify(l.toJSON())));
    expect(back.acquired(key)).toBe(true);
  });
});

describe("title hygiene", () => {
  it("strips Knesset internal numbers in both text directions", () => {
    expect(stripInternalIds("מספר פנימי: 2233595 הצעת חוק העונשין")).toBe("הצעת חוק העונשין");
    expect(stripInternalIds("2232480 : פנימי מספר")).toBe("");
  });
  it("prefers a real body title over a filename", () => {
    const t = cleanDisplayTitle({
      raw_title: "https://fs.knesset.gov.il/25/law/25_lst_123.pdf",
      body_text: "מספר פנימי: 2233595\nחוק העונשין (תיקון מס' 145), התשפ\"ד-2024",
      url: "https://fs.knesset.gov.il/25/law/25_lst_123.pdf",
    });
    expect(t).toContain("חוק העונשין");
    expect(t).not.toMatch(/2233595/);
  });
});

describe("evidence store — context discipline", () => {
  it("keeps the body server-side and returns bounded excerpts", async () => {
    const store = new EvidenceStore();
    const body = `${"רקע ".repeat(500)}\nהלכת בבלי קובעת כי הדין האזרחי חל.\n${"סיפא ".repeat(500)}`;
    const src = await store.append({
      url: "https://example.org/doc",
      title: "פסק דין",
      origin: "web",
      fetch_status: "ok",
      extracted_text: body,
      is_actual_document: true,
    });
    const ex = store.excerpt(src.source_id, { query: "הלכת בבלי" })!;
    expect(ex.from).toBe("query");
    expect(ex.windows[0]).toContain("הלכת בבלי");
    expect(ex.windows[0].length).toBeLessThanOrEqual(1_300);
    expect(store.get(src.source_id)!.text_length).toBe(body.length);
  });

  it("serializes and restores, keeping URL dedupe alive", async () => {
    const store = new EvidenceStore();
    await store.append({
      url: "https://example.org/a?id=7",
      title: "מסמך",
      origin: "web",
      fetch_status: "ok",
      extracted_text: "טקסט ארוך מספיק כדי להיחשב מסמך.".repeat(30),
      is_actual_document: true,
    });
    const back = EvidenceStore.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    expect(back.findByUrl("https://example.org/a?id=7&utm_source=x")?.source_id).toBe("S1");
    expect(back.all()).toHaveLength(1);
  });
});

describe("fetch output clamping", () => {
  it("never returns a payload beyond the context ceiling", () => {
    const out = clampFetchOutput({
      ok: true,
      source_id: "S1",
      text_head: "א".repeat(50_000),
      summary: "ב".repeat(5_000),
      windows: ["ג".repeat(20_000), "ד".repeat(20_000), "ה".repeat(20_000)],
    });
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(FETCH_LIMITS.MAX_RESPONSE_CHARS + 200);
    expect(out.text_head!.length).toBeLessThanOrEqual(FETCH_LIMITS.HEAD_CHARS);
  });
});

describe("citation hygiene", () => {
  it("never leaks an internal evidence id into a footnote", async () => {
    const { formatCitation } = await import(
      "../../supabase/functions/legal-research-v2/drafting/render"
    );
    expect(formatCitation({ display_title: "בג\"ץ דפי זהב", locator: "S1" }))
      .not.toMatch(/S1/);
    expect(formatCitation({ display_title: "פסק דין", locator: "פסקה 11, S3" }))
      .toBe("פסק דין, פסקה 11");
  });
});
