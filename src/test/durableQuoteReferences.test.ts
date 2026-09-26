/**
 * Research → memo → draft handoff track (T1–T12).
 *
 * Covers durable quote references, the quote catalog surviving compaction,
 * the non-binding unused-source note, and the agent-owned drafting brief.
 */
import { describe, expect, it } from "vitest";

import { EvidenceStore } from "../../supabase/functions/legal-research-v2/evidence/evidenceStore.ts";
import { resolveMemoQuoteRefs } from "../../supabase/functions/legal-research-v2/evidence/quoteResolution.ts";
import { buildResearchStateMessage } from "../../supabase/functions/legal-research-v2/agent/contextWindow.ts";
import { AcquisitionLedger } from "../../supabase/functions/legal-research-v2/tools/acquisitionLedger.ts";
import { buildUnusedSourceSummary } from "../../supabase/functions/legal-research-v2/agent/coverageCheck.ts";
import {
  academicGuideRole,
  isAcademicDeliverable,
  normalizeDraftingBrief,
  renderDraftingBrief,
} from "../../supabase/functions/legal-research-v2/drafting/draftingBrief.ts";
import { buildChapterQuestion } from "@/lib/academic/chapterJob";
import type {
  MemoEvidence,
  ResearchMemo,
} from "../../supabase/functions/legal-research-v2/types.ts";

const LONG =
  "בית המשפט קבע כי בעל זכות היוצרים אינו רשאי להגביל העברה חוזרת של עותק שנמכר, וכי כלל מיצוי הזכויות חל גם על עותק שהורד מן הרשת. ";

async function storeWithQuotes() {
  const store = new EvidenceStore();
  const s6 = await store.append({
    url: "https://curia.europa.eu/usedsoft",
    title: "UsedSoft v Oracle",
    origin: "test",
    fetch_status: "ok",
    extracted_text: LONG.repeat(6),
    is_actual_document: true,
  });
  const s7 = await store.append({
    url: "https://curia.europa.eu/tomkabinet",
    title: "Tom Kabinet",
    origin: "test",
    fetch_status: "ok",
    extracted_text: LONG.repeat(6),
    is_actual_document: true,
  });
  const q6 = store.serveQuotes(s6.source_id, [LONG.repeat(2)], "exhaustion");
  const q7 = store.serveQuotes(s7.source_id, [`${LONG.repeat(2)} נוסח שונה.`], "transfer");
  return { store, s6: s6.source_id, s7: s7.source_id, q6: q6[0], q7: q7[0] };
}

function memoWith(evidence: MemoEvidence[]): ResearchMemo {
  return {
    issue_summary: "מיצוי זכויות בעותק דיגיטלי",
    claims: [{
      claim_id: "C1",
      proposition: "כלל המיצוי חל גם על עותק דיגיטלי",
      importance: "core",
      current_state_claim: false,
      evidence,
    }],
    unresolved_questions: [],
    research_complete: true,
  };
}

describe("T1–T5 durable quote references", () => {
  it("T1 resolves a stored quote_id to the exact stored text", async () => {
    const { store, s6, q6 } = await storeWithQuotes();
    const out = resolveMemoQuoteRefs(
      memoWith([{ source_id: s6, quote_id: q6.quote_id, reason: "מיצוי" }]),
      store,
    );
    expect(out.memo!.claims[0].evidence[0].quoted_span).toBe(q6.text);
    expect(out.stats.memo_evidence_resolved_from_quote_id).toBe(1);
  });

  it("T2 refuses a quote_id belonging to another source", async () => {
    const { store, s6, q7 } = await storeWithQuotes();
    const out = resolveMemoQuoteRefs(
      memoWith([{ source_id: s6, quote_id: q7.quote_id, reason: "מיצוי" }]),
      store,
    );
    expect(out.memo!.claims[0].evidence).toHaveLength(0);
    expect(out.stats.quote_source_mismatch).toBe(1);
    expect(out.stats.memo_evidence_dropped_unresolvable).toBe(1);
  });

  it("T3 never invents text for an unknown quote_id", async () => {
    const { store, s6 } = await storeWithQuotes();
    const out = resolveMemoQuoteRefs(
      memoWith([{ source_id: s6, quote_id: "S6-q999", reason: "מיצוי" }]),
      store,
    );
    expect(out.memo!.claims[0].evidence).toHaveLength(0);
    expect(out.stats.invalid_quote_id).toBe(1);
  });

  it("T4 keeps legacy quoted_span-only evidence byte-identical", async () => {
    const { store, s6 } = await storeWithQuotes();
    const span = LONG.trim();
    const out = resolveMemoQuoteRefs(
      memoWith([{ source_id: s6, quoted_span: span, reason: "מיצוי" }]),
      store,
    );
    const ev = out.memo!.claims[0].evidence[0];
    expect(ev.quoted_span).toBe(span);
    expect(ev.quote_id).toBeUndefined();
    expect(out.stats.quote_ids_referenced_in_memo).toBe(0);
  });

  it("T5 resolution only produces an ordinary span — no verification bypass", async () => {
    const { store, s6, q6 } = await storeWithQuotes();
    const out = resolveMemoQuoteRefs(
      memoWith([{ source_id: s6, quote_id: q6.quote_id, reason: "מיצוי" }]),
      store,
    );
    const ev = out.memo!.claims[0].evidence[0];
    // The verifier receives exactly what it would have received from a literal
    // span: same source_id, real body text, no verified/trusted flag added.
    expect(ev.source_id).toBe(s6);
    expect(store.get(s6)!.extracted_text).toContain(ev.quoted_span!.slice(0, 60));
    expect(Object.keys(ev).sort()).toEqual(["quote_id", "quoted_span", "reason", "source_id"]);
  });
});

describe("T6–T7 quote availability after compaction", () => {
  it("T6 lists stored quote ids in the rolling research state", async () => {
    const { store, s6, s7, q6, q7 } = await storeWithQuotes();
    const msg = buildResearchStateMessage({
      store,
      stepsLeft: 5,
      researchStepsLeft: 3,
      obligations: [],
      ledger: new AcquisitionLedger(),
    } as never);
    expect(msg).toContain(q6.quote_id);
    expect(msg).toContain(q7.quote_id);
    expect(msg).toContain(s6);
  });

  it("T7 shows an unused read source and its stored quotes, without demanding use", async () => {
    const { s7 } = await storeWithQuotes();
    const note = buildUnusedSourceSummary([
      { source_id: s7, title: "Tom Kabinet", quote_count: 2 },
    ]);
    expect(note).toContain(s7);
    expect(note).toContain("quote_id");
    expect(note).toMatch(/אין חובה להשתמש/);
  });
});

describe("T8–T10 agent-owned drafting brief", () => {
  it("T8 accepts an academic introduction brief with no academic context", () => {
    const brief = normalizeDraftingBrief({
      deliverable: "academic_introduction",
      depth: "deep",
      audience: "academic",
      target_words: { min: 800, max: 1200 },
      goals: ["להציג את הרקע והבעיה המשפטית"],
      style: "פרוזה אקדמית משפטית רציפה",
    });
    expect(brief?.deliverable).toBe("academic_introduction");
    expect(brief?.target_words).toEqual({ min: 800, max: 1200 });
    expect(isAcademicDeliverable(brief)).toBe(true);
    expect(academicGuideRole(brief)).toBe("introduction");
  });

  it("T9 the brief is writing guidance only and cannot create evidence", () => {
    const text = renderDraftingBrief(normalizeDraftingBrief({
      deliverable: "academic_introduction",
      depth: "deep",
      goals: ["לדון ב-UsedSoft"],
    }));
    expect(text).toMatch(/אינו ראיה|אינה ראיה/);
    expect(text).toMatch(/מאומת/);
  });

  it("T10 the length target is soft and bounded", () => {
    const brief = normalizeDraftingBrief({
      deliverable: "legal_analysis",
      depth: "standard",
      target_words: { min: 4000, max: 100 },
    });
    // min/max are repaired rather than rejected, and the rendered instruction
    // explicitly allows a shorter answer when the evidence is thin.
    expect(brief!.target_words!.min!).toBeLessThanOrEqual(brief!.target_words!.max!);
    expect(renderDraftingBrief(brief)).toMatch(/קצר/);
    expect(normalizeDraftingBrief({ deliverable: "legal_analysis", depth: "x" })?.depth).toBe("standard");
  });
});

describe("T11–T12 chapter role and normal answers", () => {
  it("T11 keeps an introduction chapter an introduction", () => {
    const q = buildChapterQuestion({
      chapterTitle: "מבוא",
      chapterRole: "introduction",
      researchQuestion: "מהם גבולות שליטתו של בעל זכות יוצרים?",
    } as never);
    expect(q).toContain("פרק מבוא");
    expect(q).not.toContain("פרק גוף");
  });

  it("T12 a plain legal request without a brief changes nothing", () => {
    expect(normalizeDraftingBrief(undefined)).toBeNull();
    expect(normalizeDraftingBrief(null)).toBeNull();
    expect(renderDraftingBrief(null)).toBe("");
    expect(isAcademicDeliverable(null)).toBe(false);
  });
});
