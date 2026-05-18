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
import { callDrafter } from "./aiProvider.ts";
import {
  assignContractIds,
  attachCanonicalCitations,
  buildCitationAssemblyTelemetry,
  parseMarkers,
  buildFootnotes,
  type ContractSourceCard,
} from "./cardClaimContract.ts";
import {
  answerMapEnabled,
  buildAnswerMap,
  summarizeAnswerMap,
  type AnswerMap,
  type DoctrinalAnchor,
} from "./answerMap.ts";
import { reconcileAnchors } from "./anchorReconciliation.ts";

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
  /**
   * Optional promise resolving to externally-discovered doctrinal anchors
   * (e.g. from V3 LegalResearchPlan). When provided, V2 awaits it after its
   * own AnswerMap stage (bounded by `externalAnchorsTimeoutMs`) and merges
   * non-duplicate anchors into the doctrinal pool BEFORE reconciliation.
   * External anchors get fresh A-ids and behave identically to AnswerMap
   * anchors from that point on (reconciliation → retrieval → lifecycle).
   */
  externalAnchorsPromise?: Promise<DoctrinalAnchor[]>;
  externalAnchorsTimeoutMs?: number;
  /** Source label for telemetry (`metadata.external_anchors.source`). */
  externalAnchorsSource?: string;
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

const BROKEN_TITLE_CORE_RE =
  /^\s*["״"׳']?\s*(?:פרטי\s+מסמך|ללא\s+כותרת|untitled|no\s+title|home|download|פסק[־\s]+דין|החלטה|תוצאות\s+חיפוש|search\s+results|מסמך)\s*["״"׳']?\s*$/i;
const BROKEN_TITLE_KNESSET_RE =
  /פרטי\s+מסמך\s*\([^)]*מרכז\s+המחקר\s+והמידע\s+של\s+הכנסת[^)]*\)/i;
function isBrokenSource(title: string, citation: string): boolean {
  const t = (title || "").trim();
  const c = (citation || "").trim();
  if (!t && !c) return true;
  if (BROKEN_TITLE_CORE_RE.test(t) || BROKEN_TITLE_CORE_RE.test(c)) return true;
  if (BROKEN_TITLE_KNESSET_RE.test(t) || BROKEN_TITLE_KNESSET_RE.test(c)) return true;
  const cStrip = c.replace(/\[חסר:[^\]]+\]/g, "").trim();
  const tStrip = t.replace(/\[חסר:[^\]]+\]/g, "").trim();
  if (!cStrip && !tStrip) return true;
  return false;
}

function dedupeSources(ledger: Ledger): SourceRecord[] {
  const byDoc = new Map<string, SourceRecord>();
  let nextId = 0;
  for (const entry of ledger.entries) {
    for (const s of entry.sources) {
      if (isBrokenSource(s.title || "", s.citation || "")) continue;
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
  const planResult = await buildResearchPlan({ question, depth });
  const { plan, run: planRun, fallback_model_used, fallback_reason, primary_run } = planResult;
  const planMs = Date.now() - planT0;

  // V2 planner telemetry (persisted by index.ts even when V2 falls back to V1).
  const plannerStatus: "success" | "fallback_success" | "timeout" | "failed" = plan
    ? (fallback_model_used ? "fallback_success" : "success")
    : (planRun.status === "timeout" ? "timeout" : "failed");
  metadata.research_plan_v2_attempted = true;
  metadata.research_plan_v2_status = plannerStatus;
  metadata.planner_model = planRun.model;
  metadata.planner_ms = planMs;
  if (fallback_model_used) metadata.research_plan_fallback_model_used = true;
  if (fallback_reason) metadata.fallback_reason = fallback_reason;
  if (primary_run) metadata.research_plan_primary_run = primary_run;

  metadata.research_plan = {
    ...summarizeResearchPlan(plan, planRun),
    duration_ms: planMs,
    fallback_model_used: fallback_model_used === true,
  };
  if (!plan) {
    metadata.fallback = { reason: "research_plan_failed", stage: "research_plan_v2", detail: fallback_reason ?? null };
    return emptyFallback("research_plan_failed", metadata);
  }

  // ── Stage 1.5: AnswerMap / Authority Discovery (gated) ────────────
  let anchorQueriesByClaim: Map<string, string[]> | undefined;
  let anchorIdsByClaim: Map<string, string[]> | undefined;
  let anchorQueryOwnersByClaim:
    | Map<string, Array<{ query: string; anchorId: string }>>
    | undefined;
  // anchors_by_id[anchorId] = { type, name, centrality, claim_id } for missing_expected
  const anchorsById = new Map<
    string,
    { type: string; name: string; centrality: string; claim_id: string }
  >();
  let answerMapForRecon: AnswerMap | null = null;
  if (answerMapEnabled()) {
    try {
      const amT0 = Date.now();
      const amRes = await buildAnswerMap({ question, plan, depth: "deep" });
      metadata.answer_map = {
        ...amRes.telemetry,
        total_duration_ms: Date.now() - amT0,
        ...summarizeAnswerMap(amRes.answerMap),
      };
      answerMapForRecon = amRes.answerMap;
    } catch (e) {
      metadata.answer_map_error = (e as Error).message ?? String(e);
    }
  } else {
    metadata.answer_map = { status: "skipped_disabled" };
  }

  // ── Stage 1.6: External anchor merge (e.g. V3 LegalResearchPlan) ──
  // Awaits an externally-supplied DoctrinalAnchor[] (V3 expected_anchors,
  // converted to V2 shape upstream) and merges non-duplicates into the
  // doctrinal pool BEFORE reconciliation. This routes V3 anchors through
  // the existing retrieval / lifecycle / missing_expected machinery
  // without a parallel retrieval track.
  if (args.externalAnchorsPromise) {
    const extT0 = Date.now();
    const extTimeoutMs = args.externalAnchorsTimeoutMs ?? 5000;
    let externalAnchors: DoctrinalAnchor[] = [];
    let extStatus: "ok" | "timeout" | "error" | "empty" = "empty";
    let extError: string | undefined;
    try {
      externalAnchors = await Promise.race([
        args.externalAnchorsPromise,
        new Promise<DoctrinalAnchor[]>((_, rej) =>
          setTimeout(() => rej(new Error("external_anchors_timeout")), extTimeoutMs)
        ),
      ]);
      extStatus = externalAnchors.length > 0 ? "ok" : "empty";
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      extStatus = /timeout/i.test(msg) ? "timeout" : "error";
      extError = msg;
    }
    const merged = mergeExternalAnchors(answerMapForRecon, externalAnchors);
    answerMapForRecon = merged.answerMap;
    metadata.external_anchors = {
      source: args.externalAnchorsSource ?? "external",
      status: extStatus,
      duration_ms: Date.now() - extT0,
      supplied: externalAnchors.length,
      added: merged.added,
      deduped: merged.deduped,
      added_ids: merged.addedIds,
      ...(extError ? { error: extError } : {}),
    };
  }

  if (answerMapForRecon) {
    const recon = reconcileAnchors({ plan, answerMap: answerMapForRecon, depth: "deep" });
    metadata.anchor_reconciliation = recon.telemetry;
    if (recon.byClaim.size > 0) {
      anchorQueriesByClaim = recon.byClaim;
      anchorIdsByClaim = recon.anchorsByClaim;
      anchorQueryOwnersByClaim = recon.queryOwnersByClaim;
    }
    // Index anchors → claim attachment for missing_expected_anchors.
    for (const att of recon.telemetry.attachments) {
      const a = answerMapForRecon.doctrinal_anchors.find((x) => x.id === att.anchor_id);
      if (a) {
        anchorsById.set(a.id, {
          type: a.type, name: a.name, centrality: a.centrality, claim_id: att.claim_id,
        });
      }
    }
  }

  // ── Stage 2: Per-claim retrieval ───────────────────────────────────
  const { packs, telemetry } = await retrieveClaims({
    adminClient, claims: plan.claims, depth, embed: embedQuery, maxConcurrency: 3,
    anchorQueriesByClaim,
    anchorIdsByClaim,
    anchorQueryOwnersByClaim,
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

  // ── Anchor lifecycle + missing_expected_anchors ─────────────────────
  // Anchor lifecycle = per-claim journey of anchor-origin candidates from
  // retrieval pool → top-5 → verifier verdict → final ledger sources.
  // missing_expected_anchors = canonical-authority anchors (statute /
  // regulation / basic_law_section) that were discovered by AnswerMap but
  // produced ZERO anchor-origin candidates in retrieval — i.e. no local
  // DB row matched the authority. Recorded for corpus-ingestion triage,
  // NOT used to force citations.
  if (anchorsById.size > 0) {
    const lifecycle = ledger.anchorLifecycle ?? [];
    const lifecycleByClaim = new Map(lifecycle.map((l) => [l.claim_id, l] as const));
    const anchorRet = telemetry.anchor_retrieval;
    const anchorCandsByClaim = new Map<string, number>();
    if (anchorRet) {
      for (const pc of anchorRet.per_claim) anchorCandsByClaim.set(pc.claim_id, pc.anchor_candidates);
    }
    const CANONICAL_TYPES = new Set(["statute_section", "regulation", "basic_law_section"]);
    const missing: Array<{
      anchor_id: string; name: string; type: string; centrality: string; claim_id: string;
      reason: "no_local_db_match";
    }> = [];
    for (const [aid, a] of anchorsById) {
      if (!CANONICAL_TYPES.has(a.type)) continue;
      const cands = anchorCandsByClaim.get(a.claim_id) ?? 0;
      const lc = lifecycleByClaim.get(a.claim_id);
      const hasThisAnchor = !!lc?.candidates.some((c) => c.anchor_id === aid);
      if (cands === 0 || !hasThisAnchor) {
        missing.push({
          anchor_id: aid, name: a.name, type: a.type, centrality: a.centrality,
          claim_id: a.claim_id, reason: "no_local_db_match",
        });
      }
    }

    const totals = lifecycle.reduce(
      (acc, l) => {
        acc.in_pool += l.in_pool;
        acc.in_top5 += l.in_top5;
        acc.verified_direct += l.verified_direct;
        acc.verified_partial += l.verified_partial;
        acc.verified_tangential += l.verified_tangential;
        acc.verified_unrelated += l.verified_unrelated;
        acc.cited += l.cited;
        return acc;
      },
      { in_pool: 0, in_top5: 0, verified_direct: 0, verified_partial: 0, verified_tangential: 0, verified_unrelated: 0, cited: 0 },
    );

    metadata.anchor_lifecycle = {
      discovered: anchorsById.size,
      reconciled: [...anchorsById.values()].length,
      queries_executed: anchorRet?.queries_executed ?? 0,
      queries_timed_out: anchorRet?.queries_timed_out ?? 0,
      candidates_in_pool: totals.in_pool,
      candidates_in_top5: totals.in_top5,
      verified_direct: totals.verified_direct,
      verified_partial: totals.verified_partial,
      verified_tangential: totals.verified_tangential,
      verified_unrelated: totals.verified_unrelated,
      cited: totals.cited,
      per_claim: lifecycle,
    };
    metadata.missing_expected_anchors = missing;
  }


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
