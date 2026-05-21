// Research Core v1 — runCore orchestrator.
// Planner → Retrieval → Verifier → Ledger → Drafter → Canonical Citations →
// Footnote Builder → CitationQualityPass.
//
// Mirrors V4 runner signature so dispatch in index.ts stays symmetric:
//   { ok, answer, footnotes, citations, metadata, fallbackReason? }
//
// V2/V3/V4 are untouched; this is a parallel pipeline gated by
// RESEARCH_PIPELINE=core + pilot-topic guard in index.ts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type {
  Footnote,
  LedgerSourceId,
  StageRun,
} from "./types.ts";
import { planResearch } from "./planner.ts";
import { retrieveForPlan } from "./retrieval.ts";
import { verify } from "./verifier.ts";
import { buildLedger } from "./ledger.ts";
import { draft } from "./drafter.ts";
import {
  buildCitationsForLedger,
} from "./citations.ts";
import {
  enrichLedgerSource,
  type EnrichmentOutput,
  type EnrichmentPath,
} from "./citationEnrichment.ts";
type EnrichmentDebug = EnrichmentOutput["debug"];
import { runCitationQuality } from "./citation_quality.ts";
import {
  extractDocketFromText,
  extractPartiesFromText,
  extractCaseFieldsFromLedgerSource,
} from "./citationCleanup.ts";
import { lookupPartyNames } from "../../_shared/partyLookup.ts";
import {
  fetchOfficialCasePage,
  newFetcherTelemetry,
  isApprovedUrl,
} from "./officialSourceFetcher.ts";
import type { LedgerSource } from "./types.ts";

export type CoreStageEmitter = (
  name: string,
  status: "running" | "complete",
  detail?: string,
) => void;

export interface RunCoreArgs {
  question: string;
  adminClient: SupabaseClient;
  drafterTimeoutMs?: number;
  forceDrafterModel?: string | null;
  onStage?: CoreStageEmitter;
  signal?: AbortSignal;
}

// Public footnote shape returned to the edge function. Matches V2/V3/V4
// `RunResearchV2Result.footnotes` so `buildResponse(...)` works unchanged.
export interface ApiFootnote {
  number: number;
  citation: string;
  source_type: string;
  url?: string;
}

export interface RunCoreResult {
  ok: boolean;
  fallbackReason?: string;
  answer: string;
  footnotes: ApiFootnote[];
  citations: string[];
  metadata: Record<string, unknown>;
}

function emitSafe(emit: CoreStageEmitter | undefined, name: string, status: "running" | "complete", detail?: string) {
  if (!emit) return;
  try { emit(name, status, detail); } catch (_e) { /* noop */ }
}

function toApiFootnote(fn: Footnote): ApiFootnote {
  return {
    number: fn.number,
    citation: fn.text,
    source_type: fn.source_type,
    ...(fn.url ? { url: fn.url } : {}),
  };
}

async function defaultEmbed(text: string): Promise<number[] | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text, dimensions: 768 }),
    });
    if (!r.ok) { console.error("[core:embed]", r.status, await r.text()); return null; }
    const j = await r.json();
    return j?.data?.[0]?.embedding ?? null;
  } catch (e) {
    console.error("[core:embed] threw", e);
    return null;
  }
}

export async function runCore(args: RunCoreArgs): Promise<RunCoreResult> {
  const tStart = Date.now();
  const { question, adminClient, onStage, signal } = args;
  const stageRuns: StageRun[] = [];

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY") ?? "";
  if (!LOVABLE_API_KEY) {
    return {
      ok: false, fallbackReason: "missing_lovable_api_key",
      answer: "", footnotes: [], citations: [],
      metadata: { core: { error: "missing_lovable_api_key" } },
    };
  }

  const recordStage = (s: StageRun) => stageRuns.push(s);

  // ─── 1. Planner ────────────────────────────────────────────────────────
  emitSafe(onStage, "plan", "running");
  const tPlan = Date.now();
  const planRes = await planResearch({ question, lovableApiKey: LOVABLE_API_KEY, signal });
  recordStage({
    stage: "plan",
    duration_ms: Date.now() - tPlan,
    status: planRes.ok ? "ok" : "error",
    model: planRes.model,
    ...(planRes.error ? { error: planRes.error } : {}),
  });
  if (!planRes.ok || !planRes.plan) {
    emitSafe(onStage, "plan", "complete", "planner_failed");
    return {
      ok: false, fallbackReason: `planner_failed:${planRes.error ?? "unknown"}`,
      answer: "", footnotes: [], citations: [],
      metadata: { core: { stage_runs: stageRuns, error: planRes.error } },
    };
  }
  const plan = planRes.plan;
  emitSafe(onStage, "plan", "complete", `claims=${plan.claims.length} auth=${plan.expected_authorities.length}`);

  // ─── 2. Retrieval ──────────────────────────────────────────────────────
  emitSafe(onStage, "retrieval", "running");
  const tRet = Date.now();
  let retrieval;
  try {
    retrieval = await retrieveForPlan({
      adminClient, plan,
      embed: defaultEmbed,
      perplexityKey: PERPLEXITY_API_KEY || undefined,
      signal,
    });
  } catch (e) {
    recordStage({ stage: "retrieval", duration_ms: Date.now() - tRet, status: "error", error: (e as Error).message });
    emitSafe(onStage, "retrieval", "complete", "error");
    return {
      ok: false, fallbackReason: `retrieval_threw:${(e as Error).message}`,
      answer: "", footnotes: [], citations: [],
      metadata: { core: { stage_runs: stageRuns } },
    };
  }
  recordStage({
    stage: "retrieval",
    duration_ms: Date.now() - tRet,
    status: retrieval.total_candidates > 0 ? "ok" : "empty",
  });
  emitSafe(onStage, "retrieval", "complete", `candidates=${retrieval.total_candidates}`);

  // ─── 3. Verifier ───────────────────────────────────────────────────────
  emitSafe(onStage, "verify", "running");
  const tVer = Date.now();
  let verification;
  try {
    verification = await verify({
      plan, packs: retrieval.packs, lovableApiKey: LOVABLE_API_KEY, signal,
    });
  } catch (e) {
    recordStage({ stage: "verify", duration_ms: Date.now() - tVer, status: "error", error: (e as Error).message });
    emitSafe(onStage, "verify", "complete", "error");
    return {
      ok: false, fallbackReason: `verify_threw:${(e as Error).message}`,
      answer: "", footnotes: [], citations: [],
      metadata: { core: { stage_runs: stageRuns } },
    };
  }
  recordStage({
    stage: "verify",
    duration_ms: Date.now() - tVer,
    status: verification.totals.direct + verification.totals.partial > 0 ? "ok" : "empty",
  });
  emitSafe(onStage, "verify", "complete",
    `direct=${verification.totals.direct} partial=${verification.totals.partial}`);

  // ─── 4. Ledger ─────────────────────────────────────────────────────────
  emitSafe(onStage, "ledger", "running");
  const tLed = Date.now();
  const candidateMeta = new Map<string, { source_type?: string; document_id?: string }>();
  // Richer per-candidate metadata kept locally for enrichment ONLY — does not
  // flow into Planner/Retrieval/Verifier/Ledger. Keyed by candidate_id.
  const candidateRichMeta = new Map<string, {
    case_number?: string;
    parties?: { party1?: string; party2?: string } | string;
    decision_date?: string;
    court?: string;
    year?: string;
    judges?: string;
  }>();
  for (const pack of retrieval.packs) {
    for (const c of pack.candidates) {
      candidateMeta.set(c.candidate_id, { source_type: c.source_type, document_id: c.document_id });
      const m = (c.metadata || {}) as Record<string, unknown>;
      const pickStr = (k: string): string | undefined => {
        const v = m[k];
        return typeof v === "string" && v.trim() ? v.trim() : undefined;
      };
      let parties: { party1?: string; party2?: string } | string | undefined;
      const rawParties = m.parties;
      if (rawParties && typeof rawParties === "object") {
        const rp = rawParties as Record<string, unknown>;
        const p1 = typeof rp.party1 === "string" ? rp.party1.trim() : undefined;
        const p2 = typeof rp.party2 === "string" ? rp.party2.trim() : undefined;
        if (p1 && p2) parties = { party1: p1, party2: p2 };
      } else if (typeof rawParties === "string" && rawParties.trim()) {
        parties = rawParties.trim();
      }
      candidateRichMeta.set(c.candidate_id, {
        case_number: pickStr("case_number"),
        parties,
        decision_date: pickStr("decision_date"),
        court: pickStr("court"),
        year: pickStr("year"),
        judges: pickStr("judges"),
      });
    }
  }
  const ledger = buildLedger({
    plan, verification,
    authorityResolutions: retrieval.authority_resolutions,
    candidateMeta,
  });
  recordStage({
    stage: "ledger",
    duration_ms: Date.now() - tLed,
    status: ledger.entries.length > 0 ? "ok" : "empty",
  });
  emitSafe(onStage, "ledger", "complete",
    `supported=${ledger.totals.supported} hedged=${ledger.totals.hedged} sources=${ledger.totals.sources}`);

  if (ledger.entries.length === 0 || ledger.totals.sources === 0) {
    return {
      ok: false, fallbackReason: "ledger_insufficient",
      answer: "", footnotes: [], citations: [],
      metadata: {
        core: {
          stage_runs: stageRuns,
          plan,
          ledger: {
            supported: ledger.entries.filter(e => e.status === "supported").map(e => e.claim_id),
            hedged: ledger.entries.filter(e => e.status === "hedged").map(e => e.claim_id),
            unsupported: ledger.unsupported_claim_ids,
          },
        },
      },
    };
  }

  // ─── 5. Drafter ────────────────────────────────────────────────────────
  emitSafe(onStage, "draft", "running");
  const tDr = Date.now();
  let draftRes;
  try {
    draftRes = await draft({ plan, ledger, lovableApiKey: LOVABLE_API_KEY, signal });
  } catch (e) {
    recordStage({ stage: "draft", duration_ms: Date.now() - tDr, status: "error", error: (e as Error).message });
    emitSafe(onStage, "draft", "complete", "error");
    return {
      ok: false, fallbackReason: `draft_threw:${(e as Error).message}`,
      answer: "", footnotes: [], citations: [],
      metadata: { core: { stage_runs: stageRuns, plan } },
    };
  }
  recordStage({
    stage: "draft",
    duration_ms: Date.now() - tDr,
    status: draftRes.answer ? "ok" : "empty",
    model: draftRes.model,
  });
  emitSafe(onStage, "draft", "complete",
    `paragraphs=${draftRes.paragraph_count} markers=${draftRes.citations_used.length}`);

  if (!draftRes.answer?.trim()) {
    return {
      ok: false, fallbackReason: "drafter_empty",
      answer: "", footnotes: [], citations: [],
      metadata: { core: { stage_runs: stageRuns, plan, draft_warnings: draftRes.warnings } },
    };
  }

  // ─── 6.1 Canonical Citations ───────────────────────────────────────────
  const tCit = Date.now();
  const citations = buildCitationsForLedger(ledger.entries) as Map<LedgerSourceId, ReturnType<typeof buildCitationsForLedger> extends Map<string, infer V> ? V : never>;
  recordStage({ stage: "citations", duration_ms: Date.now() - tCit, status: "ok" });



  // ─── 6.1.5 Enrich bare-reporter caselaw citations ──────────────────────
  // Two-stage recovery:
  //   (a) Metadata short-circuit — if candidateRichMeta has parties already,
  //       rebuild the citation directly with no external call.
  //   (b) partyLookup batch — for the remainder, prefer metadata.case_number
  //       over regex extraction, and pass the full LedgerSource context
  //       (title/snippet/url/source_type/reporter citation) to Perplexity so
  //       it can disambiguate the docket. Trusted-domain, capped, batched.
  // No LLM inference of parties from training memory anywhere.
  emitSafe(onStage, "enrich_citations", "running");
  const tEnr = Date.now();
  type EnrichAttempt = {
    ls_id: LedgerSourceId;
    docket: string;
    docket_source: "metadata" | "extracted" | "official_page" | "none";
    prefix?: string;
    used_metadata_parties: boolean;
    pass?: "metadata" | "text_regex" | "official_fetch" | "party_lookup";
    title_excerpt?: string;
    snippet_excerpt?: string;
    url?: string;
    source_type?: string;
    reporter_citation?: string;
    status:
      | "metadata_hit"
      | "text_regex_hit"
      | "official_fetch_hit"
      | "hit"
      | "no_match"
      | "timeout"
      | "parse_failed"
      | "request_failed"
      | "skipped_no_docket"
      | "domain_filtered";
    rejection_reason?: string;
    enrichment_input_fields?: string[];
    resolver_input_after_enrichment?: Record<string, string | undefined>;
    resolver_output?: EnrichmentDebug["resolver_output"];
    missing_fields_after_enrichment?: string[];
    safety_net_used?: boolean;
    enrichment_path?: EnrichmentPath;
    partial_enriched?: boolean;
  };
  const enrichment = {
    bare_reporter_attempted: 0,
    bare_reporter_recovered: 0,
    bare_reporter_dropped: 0,
    partial_enriched: 0,
    metadata_short_circuits: 0,
    text_regex_attempted: 0,
    text_regex_recovered: 0,
    official_fetch_attempted: 0,
    official_fetch_recovered: 0,
    official_fetch_timeouts: 0,
    party_lookup_attempted: 0,
    party_lookup_hits: 0,
    party_lookup_timeouts: 0,
    party_lookup_status: "skipped" as string,
    attempts: [] as EnrichAttempt[],
  };
  const lsById = new Map<LedgerSourceId, LedgerSource>();
  for (const e of ledger.entries) for (const s of e.sources) lsById.set(s.ls_id, s);

  const bareIds: LedgerSourceId[] = [];
  for (const [id, cit] of citations) {
    if (cit.citation_errors.includes("failed_bare_reporter")) bareIds.push(id);
  }
  enrichment.bare_reporter_attempted = bareIds.length;

  const truncate = (s: string | undefined, n: number): string | undefined =>
    !s ? undefined : (s.length > n ? s.slice(0, n) + "…" : s);

  /**
   * Tag an EnrichAttempt with the debug envelope from
   * `enrichBareReporterCitationWithDebug`. Mutates `attempt` in place.
   * Also returns derived booleans for the caller's counter logic.
   */
  const annotateAttempt = (
    attempt: EnrichAttempt,
    citation: { citation_errors: string[] },
    debug: EnrichmentDebug,
  ): { recovered: boolean; partial: boolean } => {
    attempt.enrichment_input_fields = debug.enrichment_input_fields;
    attempt.resolver_input_after_enrichment = debug.resolver_input_after_enrichment;
    attempt.resolver_output = debug.resolver_output;
    attempt.missing_fields_after_enrichment = debug.missing_fields_after_enrichment;
    attempt.safety_net_used = debug.safety_net_used;
    attempt.enrichment_path = debug.enrichment_path;
    const recovered = !citation.citation_errors.includes("failed_bare_reporter");
    const partial = citation.citation_errors.includes("partial_enriched");
    attempt.partial_enriched = partial;
    attempt.rejection_reason = recovered
      ? (partial ? "partial_enriched" : undefined)
      : "rebuild_still_bare";
    return { recovered, partial };
  };


  // Pass A — metadata short-circuit: rebuild any bare-reporter citation whose
  // candidate metadata already contains structured parties. No external call.
  const stillBareAfterA: LedgerSourceId[] = [];
  for (const id of bareIds) {
    const ls = lsById.get(id);
    if (!ls) { stillBareAfterA.push(id); continue; }
    const rich = candidateRichMeta.get(ls.candidate_id);
    let p1: string | undefined;
    let p2: string | undefined;
    if (rich?.parties && typeof rich.parties === "object") {
      p1 = rich.parties.party1;
      p2 = rich.parties.party2;
    }
    const metaCase = rich?.case_number;
    if (p1 && p2) {
      const { citation: fresh, debug } = enrichLedgerSource({
        ls,
        passLabel: "metadata",
        recovered: {
          caseNumber: metaCase,
          party1: p1,
          party2: p2,
          year: rich?.year,
          fullDate: rich?.decision_date,
        },
      });
      citations.set(id, fresh);
      const attempt: EnrichAttempt = {
        ls_id: id,
        docket: metaCase || "(from metadata.parties)",
        docket_source: metaCase ? "metadata" : "none",
        used_metadata_parties: true,
        pass: "metadata",
        title_excerpt: truncate(ls.title, 120),
        url: ls.url,
        source_type: ls.source_type,
        reporter_citation: truncate(ls.citation, 120),
        status: "metadata_hit",
      };
      const { recovered, partial } = annotateAttempt(attempt, fresh, debug);
      if (recovered) enrichment.bare_reporter_recovered++;
      if (partial) enrichment.partial_enriched++;
      enrichment.metadata_short_circuits++;
      enrichment.attempts.push(attempt);
      if (!recovered) stillBareAfterA.push(id);
    } else {
      stillBareAfterA.push(id);
    }
  }

  // Pass B — text-regex extraction from title + citation + snippet + url.
  // No external call. Recovers any case whose LedgerSource fields already
  // expose `<P1> נ׳ <P2>` (most common path — official Israeli court titles
  // are structured exactly this way).
  const stillBareAfterB: LedgerSourceId[] = [];
  for (const id of stillBareAfterA) {
    const ls = lsById.get(id);
    if (!ls) { stillBareAfterB.push(id); continue; }
    enrichment.text_regex_attempted++;
    const fields = extractCaseFieldsFromLedgerSource({
      title: ls.title,
      citation: ls.citation,
      snippet: ls.snippet,
      url: ls.url,
    });
    if (fields.docket && fields.party1 && fields.party2) {
      const { citation: fresh, debug } = enrichLedgerSource({
        ls,
        passLabel: "text_regex",
        recovered: {
          caseNumber: fields.docket,
          party1: fields.party1,
          party2: fields.party2,
          year: fields.year,
          fullDate: fields.fullDate,
        },
      });
      citations.set(id, fresh);
      const attempt: EnrichAttempt = {
        ls_id: id,
        docket: fields.docket,
        docket_source: "extracted",
        prefix: fields.prefix,
        used_metadata_parties: false,
        pass: "text_regex",
        title_excerpt: truncate(ls.title, 120),
        snippet_excerpt: truncate(ls.snippet, 200),
        url: ls.url,
        source_type: ls.source_type,
        reporter_citation: truncate(ls.citation, 120),
        status: "text_regex_hit",
      };
      const { recovered, partial } = annotateAttempt(attempt, fresh, debug);
      if (recovered) {
        enrichment.bare_reporter_recovered++;
        enrichment.text_regex_recovered++;
      }
      if (partial) enrichment.partial_enriched++;
      enrichment.attempts.push(attempt);
      if (!recovered) stillBareAfterB.push(id);
    } else {
      stillBareAfterB.push(id);
    }
  }

  // Pass C — official-URL fetch + parse. Only for LedgerSources with an
  // approved official permalink. Parallel cap 5, 20s overall budget.
  const stillBareAfterC: LedgerSourceId[] = [];
  const fetcherTel = newFetcherTelemetry();
  const cFetchable: LedgerSourceId[] = stillBareAfterB.filter((id) => {
    const ls = lsById.get(id);
    return !!(ls && ls.url && isApprovedUrl(ls.url));
  });
  const cSkipped: LedgerSourceId[] = stillBareAfterB.filter((id) => !cFetchable.includes(id));
  // Cap to 5 concurrent fetches, 20s overall budget.
  const C_CAP = 5;
  const C_BUDGET_MS = 20_000;
  const cTargets = cFetchable.slice(0, C_CAP);
  const cExcess = cFetchable.slice(C_CAP);
  if (cTargets.length > 0) {
    const overallCtrl = new AbortController();
    const overallTimer = setTimeout(() => overallCtrl.abort(), C_BUDGET_MS);
    try {
      const results = await Promise.allSettled(
        cTargets.map((id) => {
          const ls = lsById.get(id)!;
          return fetchOfficialCasePage(ls.url!, fetcherTel, 12_000).then((r) => ({ id, ls, fields: r }));
        }),
      );
      clearTimeout(overallTimer);
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { id, ls, fields } = r.value;
        if (fields && fields.docket && fields.party1 && fields.party2) {
          const { citation: fresh, debug } = enrichLedgerSource({
            ls,
            passLabel: "official_fetch",
            recovered: {
              caseNumber: fields.docket,
              party1: fields.party1,
              party2: fields.party2,
              year: fields.year,
              fullDate: fields.fullDate,
            },
          });
          citations.set(id, fresh);
          const attempt: EnrichAttempt = {
            ls_id: id,
            docket: fields.docket,
            docket_source: "official_page",
            prefix: fields.prefix,
            used_metadata_parties: false,
            pass: "official_fetch",
            title_excerpt: truncate(ls.title, 120),
            url: ls.url,
            source_type: ls.source_type,
            reporter_citation: truncate(ls.citation, 120),
            status: "official_fetch_hit",
          };
          const { recovered, partial } = annotateAttempt(attempt, fresh, debug);
          if (recovered) {
            enrichment.bare_reporter_recovered++;
            enrichment.official_fetch_recovered++;
          }
          if (partial) enrichment.partial_enriched++;
          enrichment.attempts.push(attempt);
          if (!recovered) stillBareAfterC.push(id);
        } else {
          stillBareAfterC.push(id);
          enrichment.attempts.push({
            ls_id: id,
            docket: "(none)",
            docket_source: "none",
            used_metadata_parties: false,
            pass: "official_fetch",
            title_excerpt: truncate(ls.title, 120),
            url: ls.url,
            source_type: ls.source_type,
            reporter_citation: truncate(ls.citation, 120),
            status: "no_match",
            rejection_reason: "fetch_or_parse_returned_nothing",
          });
        }
      }
    } catch (e) {
      console.warn("[core:enrich_citations] official_fetch threw", e);
    }
  }
  // Sources we never even tried in Pass C (no approved URL, or overflow):
  for (const id of [...cSkipped, ...cExcess]) stillBareAfterC.push(id);
  enrichment.official_fetch_attempted = fetcherTel.attempted;
  enrichment.official_fetch_timeouts = fetcherTel.timeouts;
  // Persist per-url fetcher telemetry for forensics.
  (enrichment as Record<string, unknown>).official_fetch_telemetry = fetcherTel;

  // Pass D — partyLookup batch for whatever is still bare after A+B+C.
  if (stillBareAfterC.length > 0 && PERPLEXITY_API_KEY) {
    const reqMap = new Map<string, {
      ls_id: LedgerSourceId; prefix: string; docket: string; docket_source: "metadata" | "extracted";
    }>();
    const skippedNoDocket: LedgerSourceId[] = [];
    for (const id of stillBareAfterC) {
      const ls = lsById.get(id);
      if (!ls) continue;
      const rich = candidateRichMeta.get(ls.candidate_id);
      let docket: string | undefined = rich?.case_number;
      let prefix = ""; // metadata case_number rarely carries a prefix
      let docket_source: "metadata" | "extracted" = "metadata";
      if (!docket) {
        const text = `${ls.title || ""}\n${ls.citation || ""}\n${ls.snippet || ""}`;
        const dk = extractDocketFromText(text);
        if (dk) { docket = dk.docket; prefix = dk.prefix; docket_source = "extracted"; }
      }
      if (!docket) { skippedNoDocket.push(id); continue; }
      if (reqMap.has(docket)) continue;
      reqMap.set(docket, { ls_id: id, prefix, docket, docket_source });
      if (reqMap.size >= 5) break;
    }
    for (const id of skippedNoDocket) {
      const ls = lsById.get(id);
      enrichment.attempts.push({
        ls_id: id,
        docket: "(none)",
        docket_source: "none",
        used_metadata_parties: false,
        pass: "party_lookup",
        title_excerpt: truncate(ls?.title, 120),
        snippet_excerpt: truncate(ls?.snippet, 200),
        url: ls?.url,
        source_type: ls?.source_type,
        reporter_citation: truncate(ls?.citation, 120),
        status: "skipped_no_docket",
        rejection_reason: "no_docket_in_metadata_or_text",
      });
    }
    if (reqMap.size > 0) {
      enrichment.party_lookup_attempted = reqMap.size;
      try {
        const lookup = await lookupPartyNames(
          [...reqMap.values()].map((v) => {
            const ls = lsById.get(v.ls_id);
            const rich = ls ? candidateRichMeta.get(ls.candidate_id) : undefined;
            return {
              caseNumber: v.docket,
              caseTypeHint: v.prefix,
              courtHint: rich?.court,
              contextHints: ls ? {
                title: ls.title,
                snippet: ls.snippet,
                url: ls.url,
                sourceType: ls.source_type,
                reporterCitation: ls.citation,
              } : undefined,
            };
          }),
        );
        enrichment.party_lookup_status = lookup.status;
        enrichment.party_lookup_hits = lookup.hits.size;
        if (lookup.status === "timeout") enrichment.party_lookup_timeouts++;
        for (const [docket, meta] of reqMap) {
          const hit = lookup.hits.get(docket);
          const ls = lsById.get(meta.ls_id);
          const baseAttempt: EnrichAttempt = {
            ls_id: meta.ls_id,
            docket,
            docket_source: meta.docket_source,
            prefix: meta.prefix || undefined,
            used_metadata_parties: false,
            pass: "party_lookup",
            title_excerpt: truncate(ls?.title, 120),
            snippet_excerpt: truncate(ls?.snippet, 200),
            url: ls?.url,
            source_type: ls?.source_type,
            reporter_citation: truncate(ls?.citation, 120),
            status: "no_match",
          };
          if (!hit) {
            const failureReason = lookup.failures.get(docket);
            baseAttempt.status = (failureReason ?? "no_match") as EnrichAttempt["status"];
            baseAttempt.rejection_reason = failureReason
              ? `perplexity:${failureReason}`
              : `perplexity_status:${lookup.status}`;
            enrichment.attempts.push(baseAttempt);
            continue;
          }
          if (!ls) {
            baseAttempt.status = "no_match";
            baseAttempt.rejection_reason = "ledger_source_missing";
            enrichment.attempts.push(baseAttempt);
            continue;
          }
          const { citation: fresh, debug } = enrichLedgerSource({
            ls,
            passLabel: "party_lookup",
            recovered: {
              caseNumber: docket,
              party1: hit.party1,
              party2: hit.party2,
              fullDate: hit.fullDate,
              year: hit.year,
            },
          });
          citations.set(meta.ls_id, fresh);
          baseAttempt.status = "hit";
          const { recovered, partial } = annotateAttempt(baseAttempt, fresh, debug);
          if (recovered) enrichment.bare_reporter_recovered++;
          if (partial) enrichment.partial_enriched++;
          enrichment.attempts.push(baseAttempt);
        }
      } catch (e) {
        enrichment.party_lookup_status = `error:${(e as Error).message}`;
        console.warn("[core:enrich_citations] partyLookup failed", e);
        for (const [docket, meta] of reqMap) {
          const ls = lsById.get(meta.ls_id);
          enrichment.attempts.push({
            ls_id: meta.ls_id,
            docket,
            docket_source: meta.docket_source,
            prefix: meta.prefix || undefined,
            used_metadata_parties: false,
            pass: "party_lookup",
            title_excerpt: truncate(ls?.title, 120),
            snippet_excerpt: truncate(ls?.snippet, 200),
            url: ls?.url,
            source_type: ls?.source_type,
            reporter_citation: truncate(ls?.citation, 120),
            status: "request_failed",
            rejection_reason: `exception:${(e as Error).message}`,
          });
        }
      }
    }
  }

  // Final count of still-bare citations (will be dropped by quality pass).
  for (const id of bareIds) {
    const cit = citations.get(id);
    if (cit && cit.citation_errors.includes("failed_bare_reporter")) {
      enrichment.bare_reporter_dropped++;
    }
  }
  recordStage({
    stage: "enrich_citations",
    duration_ms: Date.now() - tEnr,
    status: "ok",
  });
  emitSafe(onStage, "enrich_citations", "complete",
    `bare=${enrichment.bare_reporter_attempted} ` +
    `meta=${enrichment.metadata_short_circuits} ` +
    `regex=${enrichment.text_regex_recovered}/${enrichment.text_regex_attempted} ` +
    `official=${enrichment.official_fetch_recovered}/${enrichment.official_fetch_attempted} ` +
    `party=${enrichment.party_lookup_hits}/${enrichment.party_lookup_attempted} ` +
    `recovered=${enrichment.bare_reporter_recovered} ` +
    `partial_enriched=${enrichment.partial_enriched} ` +
    `dropped=${enrichment.bare_reporter_dropped}`);

  // ─── 6.2 + 6.3 Footnote builder + CitationQualityPass ──────────────────
  emitSafe(onStage, "post_processing", "running", "citation_quality");
  const tQual = Date.now();
  const qual = runCitationQuality({
    answer: draftRes.answer,
    ledger,
    citations,
  });
  recordStage({
    stage: "citation_quality",
    duration_ms: Date.now() - tQual,
    status: qual.status === "ok" ? "ok" : (qual.status === "needs_review" ? "ok" : "empty"),
  });
  emitSafe(onStage, "post_processing", "complete",
    `status=${qual.status} fn=${qual.footnotes.length} removed=${qual.removed_citations.length}`);

  // Acceptance asserts ----------------------------------------------------
  const acceptanceErrors: string[] = [];
  if (/\[cite:LS\d+\]/.test(qual.rendered_answer)) acceptanceErrors.push("marker_leftover_in_answer");
  // Every superscript in rendered text resolves to a footnote number.
  // (rendered_answer carries superscripts produced by buildFootnotes; we
  // check that every number referenced has a matching footnote entry.)
  // Every superscript glyph in rendered text must resolve to a footnote
  // number. Adjacent markers (e.g. [cite:LS4][cite:LS5]) produce two
  // consecutive single-digit superscripts that must be validated
  // INDIVIDUALLY — never parsed as one multi-digit number ("45").
  const SUP_MAP: Record<string, number> = {
    "⁰":0,"¹":1,"²":2,"³":3,"⁴":4,"⁵":5,"⁶":6,"⁷":7,"⁸":8,"⁹":9,
  };
  const fnNumbers = new Set(qual.footnotes.map(f => f.number));
  outer: for (const ch of qual.rendered_answer) {
    const n = SUP_MAP[ch];
    if (n === undefined) continue;
    if (!fnNumbers.has(n)) {
      acceptanceErrors.push(`sup_no_footnote:${n}`);
      console.error("[core:acceptance] sup_no_footnote — should be unreachable after pre-strip", {
        missing_n: n,
        fn_numbers: [...fnNumbers],
        marker_to_footnote: qual.marker_to_footnote,
      });
      break outer;
    }
  }

  // Placeholder footnotes are forbidden unless source explicitly partial.
  for (const fn of qual.footnotes) {
    if (/\(ציטוט חסר\)/.test(fn.text)) {
      const cit = citations.get(fn.ls_id);
      if (!cit || cit.citation_quality !== "partial") {
        acceptanceErrors.push(`placeholder_unmarked:${fn.ls_id}`);
        break;
      }
    }
  }

  const coreMetadata = {
    version: "core_v1",
    plan,
    retrieval: {
      per_claim: retrieval.packs.map((p) => ({
        claim_id: p.claim_id,
        local_text_count: p.local_text_count,
        local_vector_count: p.local_vector_count,
        exact_authority_count: p.exact_authority_count,
        approved_web_count: p.approved_web_count,
        approved_web_domains: p.approved_web_domains,
        candidate_ids: p.candidates.map((c) => c.candidate_id),
      })),
      total_candidates: retrieval.total_candidates,
      total_web_candidates: retrieval.total_web_candidates,
      web_global_cap_hit: retrieval.web_global_cap_hit,
    },
    verification: verification.per_claim.map((cv) => ({
      claim_id: cv.claim_id,
      verdict_counts: cv.aggregates.counts_by_support,
    })),
    ledger: {
      supported: ledger.entries.filter((e) => e.status === "supported").map((e) => e.claim_id),
      hedged: ledger.entries.filter((e) => e.status === "hedged").map((e) => e.claim_id),
      unsupported: ledger.unsupported_claim_ids,
      totals: ledger.totals,
      invariants: ledger.invariants,
    },
    drafter: {
      model: draftRes.model,
      paragraph_count: draftRes.paragraph_count,
      citations_used: draftRes.citations_used,
      unknown_markers: draftRes.unknown_markers,
      unsupported_claim_leaks: draftRes.unsupported_claim_leaks,
      insufficient_sentence_required: draftRes.insufficient_sources_sentence_required,
      insufficient_sentence_present: draftRes.insufficient_sources_sentence_present,
      warnings: draftRes.warnings,
    },
    citation_quality: {
      status: qual.status,
      summary: qual.citation_summary,
      removed_citations: qual.removed_citations,
      flagged_footnotes: qual.flagged_footnotes,
      claims_lost_all_support: qual.claims_lost_all_support,
      marker_to_footnote: qual.marker_to_footnote,
    },
    enrichment,
    acceptance_errors: acceptanceErrors,
    stage_runs: stageRuns,
    total_duration_ms: Date.now() - tStart,
  };

  if (qual.status === "insufficient_verified_sources") {
    return {
      ok: false, fallbackReason: `quality_${qual.status}`,
      answer: "", footnotes: [], citations: [],
      metadata: { core: coreMetadata },
    };
  }
  if (acceptanceErrors.length > 0) {
    return {
      ok: false, fallbackReason: `acceptance:${acceptanceErrors[0]}`,
      answer: "", footnotes: [], citations: [],
      metadata: { core: coreMetadata },
    };
  }

  // qual.status === "ok" || "needs_review" → ship the answer.
  const apiFootnotes = qual.footnotes.map(toApiFootnote);
  return {
    ok: true,
    answer: qual.rendered_answer,
    footnotes: apiFootnotes,
    citations: apiFootnotes.map((f) => f.citation),
    metadata: { core: coreMetadata },
  };
}
