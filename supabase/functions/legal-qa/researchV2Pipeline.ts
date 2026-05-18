// Research V2 — self-contained Deep pipeline (gated by RESEARCH_V2=true).
//
// question → researchPlan → claimRetrieval → ledger → compact drafter
//          → parseMarkers + buildFootnotes (Card→Claim contract + CitationEngine)
//
// Returns { answer, footnotes, citations, metadata } suitable for buildResponse.
// Designed to be called from index.ts BEFORE the legacy planner cascade. On
// any internal failure returns { fallback: true } so caller can fall through
// to V1 for safety. Does NOT touch credit ledger, qa_logs row, or auth — the
// caller owns those.
//
// Telemetry fields (flat) match the spec in .lovable/plan.md:
//   research_plan, retrieval_v2, retrieval_telemetry, ledger_v2,
//   drafter (prompt_chars, answer_len, footnotes_n, cards_cited, source_ids_used),
//   verification_v2, fallback (when applicable), v2_path: "deep_v2".

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { buildResearchPlan, summarizeResearchPlan, type ResearchPlan } from "./researchPlan.ts";
import { retrieveClaims, summarizeRetrieval, type ClaimCandidatePack, type RetrievalTelemetry } from "./claimRetrieval.ts";
import { verifyAndBuildLedger, summarizeLedger, type Ledger } from "./ledger.ts";
import { callDrafter, type StageRun } from "./aiProvider.ts";
import {
  assignContractIds,
  attachCanonicalCitations,
  buildCitationAssemblyTelemetry,
  parseMarkers,
  buildFootnotes,
  type ContractSourceCard,
} from "./cardClaimContract.ts";

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

async function embedQuery(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000), dimensions: 768 }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

export interface RunResearchV2Args {
  question: string;
  depth: "deep"; // V2 currently wired for Deep only
  adminClient: SupabaseClient;
  drafterTimeoutMs?: number;
  forceDrafterModel?: string | null;
  drafterMaxTokens?: number;
}

export interface RunResearchV2Result {
  ok: boolean;
  fallbackReason?: string;
  answer: string;
  footnotes: Array<{ number: number; citation: string; source_type: string; url?: string }>;
  citations: string[];
  metadata: Record<string, unknown>;
}

interface SourceRecord extends ContractSourceCard {
  documentId: string;
}

function dedupeSources(ledger: Ledger): SourceRecord[] {
  const byDoc = new Map<string, SourceRecord>();
  let nextId = 0;
  for (const entry of ledger.entries) {
    for (const s of entry.sources) {
      const key = s.documentId || `${s.title}|${s.citation}`;
      if (byDoc.has(key)) continue;
      const rec: SourceRecord = {
        id: ++nextId,
        documentId: s.documentId,
        citation: s.citation || s.title,
        source_type: s.sourceType || "unknown",
        url: s.sourceUrl,
        provenance: "local",
        excerpt: (s as { excerpt?: string }).excerpt ?? "",
      };
      byDoc.set(key, rec);
    }
  }
  return [...byDoc.values()];
}

function buildDrafterPrompts(args: {
  question: string;
  plan: ResearchPlan;
  ledger: Ledger;
  cards: SourceRecord[];
}): { systemPrompt: string; userPrompt: string } {
  const { question, plan, ledger, cards } = args;
  const docIdToContract = new Map<string, string>();
  for (const c of cards) docIdToContract.set(c.documentId, c.contractId!);

  const ledgerBlock = ledger.entries.map((e) => {
    const allowedIds = e.sources
      .map((s) => docIdToContract.get(s.documentId))
      .filter((x): x is string => !!x);
    const hedgeLine = e.hedge
      ? `סייגים: דרוש ניסוח מסויג (לדוגמה: "${e.hedgeTemplate ?? "ייתכן"}").`
      : "";
    return `• [${e.claimId}] ${e.claim}\n  מקורות מותרים: ${allowedIds.map((id) => `[cite:${id}]`).join(" ") || "(אין)"}\n  ${hedgeLine}`.trim();
  }).join("\n\n");

  const catalog = cards.map((c) => {
    const cite = c.canonicalCitation || c.citation;
    return `[${c.contractId}] (${c.source_type}) ${cite}`;
  }).join("\n");

  const systemPrompt = `אתה כותב תשובה משפטית קצרה ומדויקת בעברית, על בסיס "פנקס טענות" (ledger) שכבר אומת.

חוקים מחייבים:
1. כתוב תשובה רציפה (לא רשימת תבליטים). 3-6 פסקאות, סך הכל 400-900 מילים.
2. הצג את התזה בפסקה הראשונה.
3. כל טענה מהפנקס נכתבת *לכל היותר פעם אחת* בגוף התשובה. אל תחזור על עצמך.
4. אסור להוסיף טענות חדשות מעבר לפנקס.
5. סמן ציטוטים בסיומת [cite:S#] (או [cite:S1,S2]) — *רק* מזהי מקורות שמופיעים ברשימת "מקורות מותרים" לאותה טענה.
6. אסור להוסיף מספרי הערות שוליים בגוף — הם יותרגמו אוטומטית מ-[cite:S#].
7. טענה המסומנת בסייגים — נסח אותה במפורש כסייג ("ייתכן", "לכאורה", "טרם הוכרע").
8. שאיפת היעד: 5-8 הערות שוליים סך הכל לתשובה.
9. אל תצטט אורגינלים מחוץ לקטלוג. אל תמציא מקורות.

פלט: רק גוף הטקסט עם סימני [cite:S#]. אין כותרת/רשימות/JSON.`;

  const userPrompt = `שאלת המחקר:
${question}

תזה:
${plan.thesis}

פנקס הטענות:
${ledgerBlock}

קטלוג מקורות מותרים:
${catalog}

כתוב את התשובה. זכור: 5-8 הערות שוליים. כל טענה פעם אחת. רק מקורות מהקטלוג.`;

  return { systemPrompt, userPrompt };
}

export async function runResearchV2(args: RunResearchV2Args): Promise<RunResearchV2Result> {
  const t0 = Date.now();
  const { question, depth, adminClient } = args;
  const drafterMaxTokens = args.drafterMaxTokens ?? 4000;
  const drafterTimeoutMs = args.drafterTimeoutMs ?? 180000;
  const metadata: Record<string, unknown> = {
    v2_path: "deep_v2",
    depth,
  };

  // ── Stage 1: ResearchPlan ──────────────────────────────────────────
  const planT0 = Date.now();
  const { plan, run: planRun } = await buildResearchPlan({ question, depth });
  metadata.research_plan = {
    ...summarizeResearchPlan(plan, planRun),
    duration_ms: Date.now() - planT0,
  };
  if (!plan) {
    metadata.fallback = { reason: "research_plan_failed", stage: "research_plan_v2" };
    return emptyFallback("research_plan_failed", metadata);
  }

  // ── Stage 2: Per-claim retrieval ───────────────────────────────────
  const { packs, telemetry } = await retrieveClaims({
    adminClient, claims: plan.claims, depth, embed: embedQuery, maxConcurrency: 3,
  });
  metadata.retrieval_v2 = summarizeRetrieval({ packs, telemetry });
  metadata.retrieval_telemetry = telemetry;

  // ── Stage 3: Verification + ledger ─────────────────────────────────
  const { ledger, runs: verifyRuns } = await verifyAndBuildLedger({
    claims: plan.claims, packs, depth, thesis: plan.thesis,
  });
  metadata.verification_v2 = { runs: verifyRuns.map(r => ({
    stage: r.stage, status: r.status, model: r.model, duration_ms: r.duration_ms,
  })) };
  metadata.ledger_v2 = {
    ...summarizeLedger(ledger),
    kept: ledger.entries.length,
    dropped: ledger.dropped.length,
    supported: ledger.entries.filter(e => e.verdict === "supported").length,
    partially_supported: ledger.entries.filter(e => e.verdict === "partially_supported").length,
    claim_ids_kept: ledger.entries.map(e => e.claimId),
    claim_ids_dropped: ledger.dropped.map(e => e.claimId),
  };

  if (ledger.entries.length === 0) {
    metadata.fallback = { reason: "empty_ledger", stage: "ledger_v2" };
    return emptyFallback("empty_ledger", metadata);
  }

  // ── Stage 4: Build cards + compact drafter prompt ─────────────────
  const cards = dedupeSources(ledger);
  assignContractIds(cards);
  attachCanonicalCitations(cards);
  metadata.citation_assembly = buildCitationAssemblyTelemetry(cards);

  const { systemPrompt, userPrompt } = buildDrafterPrompts({
    question, plan, ledger, cards,
  });
  const promptChars = systemPrompt.length + userPrompt.length;

  // ── Stage 5: Drafter ───────────────────────────────────────────────
  const drafterT0 = Date.now();
  const drafterRes = await callDrafter(
    systemPrompt, userPrompt, drafterMaxTokens, drafterTimeoutMs,
    "structured", args.forceDrafterModel ?? undefined,
  );
  const drafterMs = Date.now() - drafterT0;
  if (!drafterRes?.text) {
    metadata.drafter = {
      prompt_chars: promptChars, answer_len: 0, footnotes_n: 0,
      cards_cited: 0, source_ids_used: [], duration_ms: drafterMs,
      model: drafterRes?.modelUsed ?? null, status: "empty",
    };
    metadata.fallback = { reason: "drafter_empty", stage: "drafter_v2" };
    return emptyFallback("drafter_empty", metadata);
  }

  // ── Stage 6: Card→Claim contract → footnotes ──────────────────────
  const parsed = parseMarkers(drafterRes.text, cards);
  const built = buildFootnotes(drafterRes.text, parsed, cards);

  const sourceIdsUsed = Object.keys(built.sourceIdUsage);
  metadata.drafter = {
    prompt_chars: promptChars,
    answer_len: built.body.length,
    footnotes_n: built.footnotes.length,
    cards_cited: sourceIdsUsed.length,
    source_ids_used: sourceIdsUsed,
    duration_ms: drafterMs,
    model: drafterRes.modelUsed,
    status: "ok",
    invalid_markers: parsed.invalidSourceIds,
  };

  metadata.total_duration_ms = Date.now() - t0;

  const citations = cards
    .filter((c) => sourceIdsUsed.includes(c.contractId!))
    .map((c) => c.url ?? "")
    .filter((u) => !!u);

  return {
    ok: true,
    answer: built.body,
    footnotes: built.footnotes.map((f) => ({
      number: f.number, citation: f.citation, source_type: f.source_type,
      ...(f.url ? { url: f.url } : {}),
    })),
    citations,
    metadata,
  };
}

function emptyFallback(reason: string, metadata: Record<string, unknown>): RunResearchV2Result {
  return {
    ok: false,
    fallbackReason: reason,
    answer: "",
    footnotes: [],
    citations: [],
    metadata,
  };
}

export function researchV2Enabled(): boolean {
  return (Deno.env.get("RESEARCH_V2") ?? "false").toLowerCase() === "true";
}
