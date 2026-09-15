/**
 * v2_span_hunting_efficiency_v1 — repeated targeted re-reads of an already
 * acquired body stop once they no longer produce NEW quotable text.
 *
 * Nothing here touches acquisition, identity, verification or budgets: the
 * only subject is quote novelty on a source already in the evidence store.
 */
import { describe, expect, it } from "vitest";
import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore";
import {
  AcquisitionLedger,
  NO_NEW_QUOTE_THRESHOLD,
} from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger";
import { runFetch } from "../../supabase/functions/legal-research-v2/tools/fetch";
import type { SearchResult } from "../../supabase/functions/legal-research-v2/types";

const FILLER = "הדיון המשפטי נמשך בהרחבה רבה בפסקה זו ובפסקאות שאחריה. ";

/** A long body with three well-separated, distinct quotable regions. */
function body(): string {
  return [
    "בית המשפט העליון\nרע\"א 1239/19 פלוני נ' אלמוני\nפסק דין\n",
    FILLER.repeat(30),
    "שיתוף פרסום בפייסבוק מהווה פרסום לעניין חוק איסור לשון הרע. ",
    FILLER.repeat(30),
    "לחיצת לייק אינה מהווה פרסום לעניין החוק. ",
    FILLER.repeat(30),
    "\n12. סעיף זה עוסק בהגנת תום הלב במשא ומתן.\n",
    FILLER.repeat(20),
    "\n25. חוזה יפורש לפי אומד דעתם של הצדדים.\n",
    FILLER.repeat(20),
  ].join("");
}

async function storeWithSource() {
  const store = new EvidenceStore();
  await store.append({
    url: "https://example.org/judgment",
    title: "רע\"א 1239/19",
    origin: "web",
    fetch_status: "ok",
    extracted_text: body(),
    is_actual_document: true,
  });
  return store;
}

const discovered = new Map<string, SearchResult>();

function read(store: EvidenceStore, ledger: AcquisitionLedger, query: string, extra = {}) {
  return runFetch(store, discovered, { source_id: "S1", query, ...extra }, ledger);
}

/**
 * A paraphrased read that lands on the SAME passage the run already holds —
 * exactly the span-hunting pattern this fix targets.
 */
function paraphrase(store: EvidenceStore, ledger: AcquisitionLedger, query: string) {
  return runFetch(
    store,
    discovered,
    { source_id: "S1", query, find: ["שיתוף פרסום בפייסבוק"] },
    ledger,
  );
}

describe("quote novelty", () => {
  it("reports how many served quotes are new", async () => {
    const store = await storeWithSource();
    const first = store.serveQuotesWithNovelty("S1", [body().slice(0, 500)], "a");
    expect(first.new_count).toBe(1);
    const again = store.serveQuotesWithNovelty("S1", [body().slice(0, 500)], "b");
    expect(again.new_count).toBe(0);
    // Quote ids and dedupe semantics are unchanged.
    expect(again.quotes[0].quote_id).toBe(first.quotes[0].quote_id);
    expect(again.quotes[0].text).toBe(first.quotes[0].text);
    expect(store.servedQuotes("S1")).toHaveLength(1);
  });

  it("serveQuotes still returns the quote array unchanged", async () => {
    const store = await storeWithSource();
    const quotes = store.serveQuotes("S1", [body().slice(0, 400)]);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].quote_id).toBe("S1-q1");
  });
});

describe("consecutive no-new-quote tracking", () => {
  it("a productive read leaves the counter at zero", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    const out = await read(store, ledger, "שיתוף פרסום בפייסבוק");
    expect(out.new_quote_count).toBeGreaterThan(0);
    expect(ledger.readState("S1")?.consecutive_no_new_quotes).toBe(0);
  });

  it("a second, different productive read keeps the counter at zero", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    await read(store, ledger, "שיתוף פרסום בפייסבוק");
    const out = await read(store, ledger, "לחיצת לייק אינה מהווה פרסום");
    expect(out.new_quote_count).toBeGreaterThan(0);
    expect(ledger.readState("S1")?.consecutive_no_new_quotes).toBe(0);
  });

  it("a paraphrase returning already-served text increments the counter", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    await paraphrase(store, ledger, "שיתוף פרסום בפייסבוק");
    const out = await paraphrase(store, ledger, "האם שיתוף מהווה פרסום");
    expect(out.new_quote_count).toBe(0);
    expect(ledger.readState("S1")?.consecutive_no_new_quotes).toBe(1);
    expect(ledger.spanHuntingExhausted("S1")).toBe(false);
  });

  it("marks the source span-hunting exhausted after three zero-novelty reads", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    await paraphrase(store, ledger, "שיתוף פרסום בפייסבוק");
    for (const q of ["האם שיתוף הוא פרסום", "שיתוף כפרסום בחוק", "מעמד השיתוף"]) {
      await paraphrase(store, ledger, q);
    }
    expect(ledger.readState("S1")?.consecutive_no_new_quotes).toBe(NO_NEW_QUOTE_THRESHOLD);
    expect(ledger.spanHuntingExhausted("S1")).toBe(true);
  });

  it("a new quote resets the counter and clears exhaustion", async () => {
    const ledger = new AcquisitionLedger();
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    expect(ledger.spanHuntingExhausted("S1")).toBe(true);
    ledger.noteQuoteYield("S1", 1);
    expect(ledger.readState("S1")?.consecutive_no_new_quotes).toBe(0);
    expect(ledger.spanHuntingExhausted("S1")).toBe(false);
  });

  it("keeps an independent counter per source", () => {
    const ledger = new AcquisitionLedger();
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    ledger.noteQuoteYield("S2", 0);
    expect(ledger.spanHuntingExhausted("S1")).toBe(true);
    expect(ledger.spanHuntingExhausted("S2")).toBe(false);
  });

  it("survives serialize / resume", () => {
    const ledger = new AcquisitionLedger();
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    ledger.noteLocatorAttempt("S1", "25");
    const resumed = AcquisitionLedger.fromJSON(JSON.parse(JSON.stringify(ledger.toJSON())));
    expect(resumed.spanHuntingExhausted("S1")).toBe(true);
    expect(resumed.readState("S1")?.consecutive_no_new_quotes).toBe(3);
    expect(resumed.isNewLocator("S1", "25")).toBe(false);
  });

  it("reports the exhaustion transition exactly once", () => {
    const ledger = new AcquisitionLedger();
    ledger.noteQuoteYield("S1", 0);
    ledger.noteQuoteYield("S1", 0);
    expect(ledger.noteQuoteYield("S1", 0).newly_exhausted).toBe(true);
    expect(ledger.noteQuoteYield("S1", 0).newly_exhausted).toBe(false);
  });
});

describe("suppression after exhaustion", () => {
  async function exhausted() {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    await paraphrase(store, ledger, "שיתוף פרסום בפייסבוק");
    for (const q of ["האם שיתוף הוא פרסום", "שיתוף כפרסום בחוק", "מעמד השיתוף"]) {
      await paraphrase(store, ledger, q);
    }
    return { store, ledger };
  }

  it("suppresses a further paraphrase without running an in-document search", async () => {
    const { store, ledger } = await exhausted();
    const before = store.servedQuotes("S1").length;
    const out = await read(store, ledger, "האם שיתוף נחשב פרסום");
    expect(out.span_hunting_suppressed).toBe(true);
    expect(out.span_hunting_exhausted).toBe(true);
    expect(out.already_read).toBe(true);
    expect(out.no_new_evidence).toBe(true);
    expect(out.windows).toBeUndefined();
    // No new excerpt work was done at all.
    expect(store.servedQuotes("S1")).toHaveLength(before);
  });

  it("still re-surfaces the exact text already served", async () => {
    const { store, ledger } = await exhausted();
    const out = await read(store, ledger, "האם שיתוף נחשב פרסום");
    expect(out.exact_source_text?.length).toBeGreaterThan(0);
    const known = store.servedQuotes("S1").map((q) => q.text);
    for (const q of out.exact_source_text ?? []) expect(known).toContain(q.text);
  });

  it("tells the agent to use existing quotes, pivot, or submit", async () => {
    const { store, ledger } = await exhausted();
    const out = await read(store, ledger, "ניסוח אחר לגמרי");
    expect(out.instruction).toContain("S1");
    expect(out.instruction).toContain("תזכיר");
  });
});

describe("escape hatch", () => {
  it("allows a statute section never requested on this source", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    const out = await runFetch(store, discovered, {
      source_id: "S1",
      query: "סעיף 25",
      want: "relevant_section",
    }, ledger);
    expect(out.span_hunting_suppressed).toBeUndefined();
    expect(out.section_requested).toBe("25");
    expect(out.section_found).toBe(true);
  });

  it("does not let an already-known missing section bypass exhaustion", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    ledger.noteRead("S1", { yielded: false, locator: "999" });
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    const out = await runFetch(store, discovered, {
      source_id: "S1",
      locator: "999",
    }, ledger);
    expect(out.span_hunting_suppressed).toBe(true);
  });

  it("allows a materially new locator only once", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    const first = await runFetch(store, discovered, { source_id: "S1", locator: "12" }, ledger);
    expect(first.span_hunting_suppressed).toBeUndefined();
    // It produced new text, so the counter reset — that is the productive case.
    expect(ledger.spanHuntingExhausted("S1")).toBe(false);
    // Once the source is exhausted again, the SAME locator no longer bypasses:
    // it is no longer a locator that was never attempted here.
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    const second = await runFetch(store, discovered, { source_id: "S1", locator: "12" }, ledger);
    expect(second.span_hunting_suppressed).toBe(true);
  });

  it("does not let an ordinary paraphrase bypass exhaustion", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    const out = await read(store, ledger, "ניסוח חדש ושונה לחלוטין של אותה שאלה");
    expect(out.span_hunting_suppressed).toBe(true);
  });

  it("allows an explicit refetch_reason to revisit the source", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    const out = await read(store, ledger, "לחיצת לייק אינה מהווה פרסום", {
      refetch_reason: "repair: missing quoted span for the like holding",
    });
    expect(out.span_hunting_suppressed).toBeUndefined();
    expect(out.new_quote_count).toBeGreaterThan(0);
  });
});

describe("invariants preserved", () => {
  it("neither productive nor suppressed re-reads are network fetches", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    const productive = await read(store, ledger, "שיתוף פרסום בפייסבוק");
    expect(productive.already_read).toBe(true);
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    const suppressed = await read(store, ledger, "עוד ניסוח");
    // `already_read` is what the agent loop keys on to skip the fetch budget.
    expect(suppressed.already_read).toBe(true);
  });

  it("serves identical exact quote text to what verification expects", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    const out = await read(store, ledger, "לחיצת לייק אינה מהווה פרסום");
    const quote = out.exact_source_text?.[0];
    expect(quote).toBeTruthy();
    expect(store.get("S1")!.extracted_text).toContain("לחיצת לייק אינה מהווה פרסום");
    expect(quote!.text).toContain("לחיצת לייק אינה מהווה פרסום");
    expect(quote!.quote_id).toMatch(/^S1-q\d+$/);
  });

  it("leaves no_yield / missing-locator behaviour intact", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    const out = await runFetch(store, discovered, { source_id: "S1", locator: "999" }, ledger);
    expect(out.section_found).toBe(false);
    expect(ledger.knownMissingLocator("S1", "999")).toBe(true);
  });

  it("does not touch a first read of an unseen source", async () => {
    const store = await storeWithSource();
    const ledger = new AcquisitionLedger();
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    await store.append({
      url: "https://example.org/other",
      title: "מקור אחר",
      origin: "web",
      fetch_status: "ok",
      extracted_text: body(),
      is_actual_document: true,
    });
    const out = await runFetch(store, discovered, {
      source_id: "S2",
      query: "שיתוף פרסום בפייסבוק",
    }, ledger);
    expect(out.span_hunting_suppressed).toBeUndefined();
    expect(out.new_quote_count).toBeGreaterThan(0);
  });

  it("does not change acquisition-target behaviour", () => {
    const ledger = new AcquisitionLedger();
    ledger.openTarget("case:1239/19", { label: "רע\"א 1239/19" }, []);
    for (let i = 0; i < 3; i += 1) ledger.noteQuoteYield("S1", 0);
    expect(ledger.unresolvedTargets().map((t) => t.authority_key)).toContain("case:1239/19");
  });
});
