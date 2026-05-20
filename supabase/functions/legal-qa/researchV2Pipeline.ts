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
import { retrieveClaims, summarizeRetrieval, type ClaimCandidatePack, type ClaimCandidateSource, type RetrievalTelemetry } from "./claimRetrieval.ts";
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
  enforceAnchorFirst,
  sortAllowedIdsByTier,
  type AllowedSourceInfo,
} from "./anchorFirstPass.ts";
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

/**
 * SSE stage emitter signature — matches the `emitStage` helper inside
 * `index.ts`. Threaded into the V2/V3 pipeline so the live progress UI
 * (`StageProgressList`) shows real steps instead of staying stuck on the
 * "מתחיל…" placeholder.
 */
export type ResearchStageEmitter = (
  name: string,
  status: "running" | "complete",
  detail?: string,
) => void;

export interface RunResearchV2Args {
  question: string;
  depth: "deep"; // V2 currently wired for Deep only
  adminClient: SupabaseClient;
  drafterTimeoutMs?: number;
  forceDrafterModel?: string | null;
  drafterMaxTokens?: number;
  /** Optional SSE stage emitter (no-op if omitted). */
  onStage?: ResearchStageEmitter;
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
  /**
   * V3 Step 2.2 — pre-validated source candidates from per-anchor Perplexity
   * fallback. Keyed by anchor dedup key (type|name(lower)|docket|section).
   * Injected into the matching claim pack BEFORE verification so the existing
   * ledger/drafter/citation-engine path stays unchanged.
   */
  externalAnchorCandidatesPromise?: Promise<Map<string, ClaimCandidateSource[]>>;
  externalAnchorCandidatesTimeoutMs?: number;
  /**
   * V4 simplification: disable the internal AnswerMap stage even when the
   * `RESEARCH_V2_ANSWER_MAP` env flag is on. V4 supplies anchors solely via
   * `externalAnchorsPromise` (the V3 LegalResearchPlan), so the parallel
   * AnswerMap planner is redundant — running it just adds latency, cost, and
   * an extra anchor-merge layer V4 is explicitly trying to remove.
   */
  disableAnswerMap?: boolean;
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

// ── External anchor merge ──────────────────────────────────────────
// Dedupe key matches answerMap.sanitizeAnchorList: type|name(lower)|docket|section.
function anchorDedupKey(a: { type: string; name: string; docket?: string; section?: string }): string {
  return `${a.type}|${(a.name || "").trim().toLowerCase()}|${a.docket ?? ""}|${a.section ?? ""}`;
}

function mergeExternalAnchors(
  base: AnswerMap | null,
  external: DoctrinalAnchor[],
): { answerMap: AnswerMap | null; added: number; deduped: number; addedIds: string[]; idMap: Record<string, string> } {
  // idMap: external (V3) input anchor id → final id in merged AnswerMap.
  // Telemetry bridge so V3 pipeline can resolve verifier/ledger counters
  // keyed by the merged ids back to its original A1/A2/... ids.
  const idMap: Record<string, string> = {};
  if (!external || external.length === 0) {
    return { answerMap: base, added: 0, deduped: 0, addedIds: [], idMap };
  }
  const existing = base?.doctrinal_anchors ?? [];
  const byKey = new Map(existing.map((a) => [anchorDedupKey(a), a.id] as const));
  const usedIds = new Set(existing.map((a) => a.id));
  let nextIdx = existing.length;
  const added: DoctrinalAnchor[] = [];
  let deduped = 0;
  for (const a of external) {
    const key = anchorDedupKey(a);
    const dupOf = byKey.get(key);
    if (dupOf) {
      // Bridge V3 id → existing AnswerMap id (the one reconciliation/lifecycle use).
      if (a.id) idMap[a.id] = dupOf;
      deduped++;
      continue;
    }
    // Allocate a fresh A-id that doesn't collide with existing AnswerMap ids.
    let id = a.id;
    while (!id || usedIds.has(id)) {
      nextIdx++;
      id = `A${nextIdx}`;
    }
    usedIds.add(id);
    byKey.set(key, id);
    if (a.id) idMap[a.id] = id;
    added.push({ ...a, id });
  }
  if (added.length === 0) {
    return { answerMap: base, added: 0, deduped, addedIds: [], idMap };
  }
  const merged: AnswerMap = {
    ...(base ?? { doctrinal_anchors: [], counter_anchors: [] }),
    doctrinal_anchors: [...existing, ...added],
    counter_anchors: base?.counter_anchors ?? [],
  };
  return { answerMap: merged, added: added.length, deduped, addedIds: added.map((a) => a.id), idMap };
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

  // Build per-card lookup so we can tier-sort each claim's allowed sources.
  const cardById = new Map<string, ContractSourceCard>();
  for (const c of cards) if (c.contractId) cardById.set(c.contractId, c);

  const ledgerBlock = ledger.entries.map((e) => {
    const infos: AllowedSourceInfo[] = [];
    for (const s of e.sources) {
      const cid = docIdToContract.get(s.documentId);
      if (!cid) continue;
      const card = cardById.get(cid);
      infos.push({
        contractId: cid,
        sourceType: (s.sourceType || card?.source_type || "").toLowerCase(),
        hasAnchorId: !!s.anchorId,
      });
    }
    const allowedIds = sortAllowedIdsByTier(infos);
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
10. **כלל סדר ציטוט (anchor-first)**: רשימת "מקורות מותרים" של כל טענה ממוינת לפי עדיפות — סטטוט/תקנה/חוק־יסוד או פסיקה מנחה מאומתת מופיעים ראשונים. כאשר ברשימה קיים מקור מעוגן ומאומת כזה, חובה להציבו ראשון ב-[cite:S#] של אותה טענה. מותר להוסיף אחריו מקור משני אחד (אקדמיה/דו"ח/פסיקה תומכת) אם הוא מוסיף הסבר, ביקורת או הקשר. עיקרון: anchor-first, **not** anchor-only.

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
  // Safe stage emitter — never throws into the pipeline.
  const emit: ResearchStageEmitter = (name, status, detail) => {
    try { args.onStage?.(name, status, detail); } catch (_e) { /* noop */ }
  };
  const metadata: Record<string, unknown> = {
    v2_path: "deep_v2",
    depth,
  };

  // ── Stage 1: ResearchPlan ──────────────────────────────────────────
  emit("decompose", "running");
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
    emit("decompose", "complete", "שגיאה");
    metadata.fallback = { reason: "research_plan_failed", stage: "research_plan_v2", detail: fallback_reason ?? null };
    return emptyFallback("research_plan_failed", metadata);
  }
  emit("decompose", "complete", `${plan.claims.length} טענות`);

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
  if (args.disableAnswerMap) {
    metadata.answer_map = { status: "skipped_v4_disabled" };
  } else if (answerMapEnabled()) {
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
      id_map: merged.idMap,
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
  emit("retrieve", "running");
  const { packs, telemetry } = await retrieveClaims({
    adminClient, claims: plan.claims, depth, embed: embedQuery, maxConcurrency: 3,
    anchorQueriesByClaim,
    anchorIdsByClaim,
    anchorQueryOwnersByClaim,
  });
  metadata.retrieval_v2 = summarizeRetrieval({ packs, telemetry });
  metadata.retrieval_telemetry = telemetry;
  {
    const totalCands = packs.reduce((n, p) => n + p.candidates.length, 0);
    emit("retrieve", "complete", `${totalCands} מועמדים`);
    // V2 doesn't have a discrete rerank step — surface source_pack as the
    // logical equivalent ("pool assembled") so the bar keeps progressing.
    emit("source_pack", "running");
    emit("source_pack", "complete", `${packs.length} פנקסי טענות`);
  }

  // ── Stage 2.5: External anchor candidate injection (V3 Step 2.2) ────
  // Take Perplexity-found, Tier-A-validated candidates from V3 and push
  // them into the matching claim pack BEFORE verification. Each candidate
  // already carries origin="anchor" and an anchorId so the existing
  // anchor lifecycle telemetry picks it up automatically.
  if (args.externalAnchorCandidatesPromise && answerMapForRecon) {
    const extT0 = Date.now();
    const timeoutMs = args.externalAnchorCandidatesTimeoutMs ?? 30000;
    let byKey: Map<string, ClaimCandidateSource[]> = new Map();
    let extStatus: "ok" | "timeout" | "error" | "empty" = "empty";
    let extError: string | undefined;
    try {
      byKey = await Promise.race([
        args.externalAnchorCandidatesPromise,
        new Promise<Map<string, ClaimCandidateSource[]>>((_, rej) =>
          setTimeout(() => rej(new Error("external_candidates_timeout")), timeoutMs),
        ),
      ]);
      extStatus = byKey.size > 0 ? "ok" : "empty";
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      extStatus = /timeout/i.test(msg) ? "timeout" : "error";
      extError = msg;
    }

    // Reverse: anchorId → claimId (from anchorIdsByClaim built earlier).
    const claimByAnchorId = new Map<string, string>();
    if (anchorIdsByClaim) {
      for (const [claimId, ids] of anchorIdsByClaim) {
        for (const id of ids) claimByAnchorId.set(id, claimId);
      }
    }

    let totalInjected = 0;
    const injectedPerAnchor: Array<{ anchor_id: string; claim_id: string | null; n: number }> = [];
    if (byKey.size > 0) {
      // Walk merged anchors → look up candidates by key → push into pack.
      for (const a of answerMapForRecon.doctrinal_anchors) {
        const key = `${a.type}|${(a.name || "").trim().toLowerCase()}|${a.docket ?? ""}|${a.section ?? ""}`;
        const cands = byKey.get(key);
        if (!cands || cands.length === 0) continue;
        const claimId = claimByAnchorId.get(a.id) ?? packs[0]?.claimId ?? null;
        if (!claimId) continue;
        const pack = packs.find((p) => p.claimId === claimId);
        if (!pack) continue;
        for (const c of cands) {
          // Reassign anchorId in case merge re-IDed the anchor.
          pack.candidates.push({ ...c, anchorId: a.id });
          totalInjected++;
        }
        injectedPerAnchor.push({ anchor_id: a.id, claim_id: claimId, n: cands.length });
      }
    }

    metadata.external_anchor_candidates = {
      status: extStatus,
      duration_ms: Date.now() - extT0,
      keys_supplied: byKey.size,
      injected: totalInjected,
      per_anchor: injectedPerAnchor,
      ...(extError ? { error: extError } : {}),
    };
  }


  // ── Stage 3: Verification + ledger ─────────────────────────────────
  emit("claim_map", "running");
  const { ledger, runs: verifyRuns } = await verifyAndBuildLedger({
    claims: plan.claims, packs, depth, thesis: plan.thesis,
  });
  metadata.verification_v2 = { runs: verifyRuns.map(r => ({
    stage: r.stage, status: r.status, model: r.model, duration_ms: r.duration_ms,
  })) };
  emit("claim_map", "complete", `${ledger.entries.length}/${plan.claims.length} טענות`);
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
  emit("drafter", "running");
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
    emit("drafter", "complete", "ריק");
    metadata.fallback = { reason: "drafter_empty", stage: "drafter_v2" };
    return emptyFallback("drafter_empty", metadata);
  }
  emit("drafter", "complete", `${drafterRes.text.length} תווים`);

  // ── Stage 6: Card→Claim contract → anchor-first enforcement → footnotes ──
  emit("anchor_pass", "running");
  const parsedFirst = parseMarkers(drafterRes.text, cards);


  // Step 3 — anchor-first reorder INSIDE existing [cite:...] groups only.
  // Pure TS, no LLM. Never inserts cites into unrelated sentences and never
  // cites a source that is not in the claim's verified allowed set.
  const docIdToContractPost = new Map<string, string>();
  for (const c of cards) if (c.contractId) docIdToContractPost.set(c.documentId, c.contractId);
  const anchorFirst = enforceAnchorFirst({
    body: drafterRes.text,
    parse: parsedFirst,
    ledger,
    cards,
    docIdToContract: docIdToContractPost,
  });
  metadata.v3_anchor_first_enforcement = {
    totals: anchorFirst.totals,
    per_claim: anchorFirst.per_claim,
  };
  emit("anchor_pass", "complete", `${(anchorFirst.totals?.promoted ?? 0) + (anchorFirst.totals?.added ?? 0)} עיגונים`);

  // Re-parse the rewritten body so buildFootnotes sees the new cite order.
  emit("footnote_validate", "running");
  const parsed = parseMarkers(anchorFirst.body, cards);
  const built = buildFootnotes(anchorFirst.body, parsed, cards);
  emit("footnote_validate", "complete", `${built.footnotes.length} הערות`);

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
