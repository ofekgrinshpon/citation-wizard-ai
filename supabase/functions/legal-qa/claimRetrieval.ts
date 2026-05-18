// Research V2 — Stage 2: Per-claim retrieval (bounded, deduped, cached).
//
// Design notes from probe v1 failure:
//   - Promise.all over 6 claims × 4 queries saturated PostgREST and every
//     RPC tripped the DB statement_timeout. Cancelled queries returned 0
//     hits and the ledger was starved.
//   - Fix: one bounded concurrency limiter for ALL text + vector RPCs in
//     a run, query dedup + cache by normalized key, and at most ONE text
//     query per claim (the most specific search_target) instead of fan-out.
//   - Vector still runs but uses the same limiter and at most one embed
//     call per claim. Per-claim grouping is preserved in the output.
//
// Telemetry: returns RetrievalTelemetry alongside packs so callers can
// log total/executed/cache_hits/timeouts without parsing logs.
//
// Gated by env `RESEARCH_V2=true`. Not yet wired in index.ts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { V2Claim, V2EvidenceType } from "./researchPlan.ts";

export interface ClaimCandidateSource {
  id: string;
  chunkId: string;
  documentId: string;
  title: string;
  citation: string;
  sourceType: string;
  sourceUrl?: string;
  excerpt: string;
  score: number;
  origin: "text" | "vector" | "external_pending";
}

export interface ClaimCandidatePack {
  claimId: string;
  candidates: ClaimCandidateSource[];
  externalQueries: string[];
}

export interface RetrievalTelemetry {
  total_text_queries_planned: number;
  total_text_queries_executed: number;
  total_vector_queries_planned: number;
  total_vector_queries_executed: number;
  max_concurrency: number;
  rpc_timeouts: number;
  rpc_errors: number;
  cache_hits: number;
  candidates_per_claim: Array<{ claim_id: string; n: number; top_score: number }>;
  total_candidates: number;
  duration_ms: number;
}

export interface RetrieveClaimsArgs {
  adminClient: SupabaseClient;
  claims: V2Claim[];
  depth: "fast" | "deep";
  /** Max local hits returned per claim (after merge). */
  perClaimCap?: number;
  /** Optional embedding function for vector search. If absent, text-only. */
  embed?: (text: string) => Promise<number[] | null>;
  /** Hard concurrency cap across ALL RPCs in this run. Default 3. */
  maxConcurrency?: number;
}

export interface RetrieveClaimsResult {
  packs: ClaimCandidatePack[];
  telemetry: RetrievalTelemetry;
}

const TYPES_REQUIRING_EXTERNAL: V2EvidenceType[] = ["academic", "committee", "news"];

interface RawHit {
  chunk_id: string;
  document_id: string;
  chunk_content?: string;
  document_title?: string;
  document_citation?: string;
  source_type?: string;
  source_url?: string;
  similarity?: number;
}

/** Simple FIFO concurrency limiter. */
function makeLimiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    if (active >= max) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job();
  };
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then((v) => { active--; resolve(v); next(); })
          .catch((e) => { active--; reject(e); next(); });
      });
      next();
    });
  };
}

const normalizeQuery = (q: string) =>
  q.normalize("NFKC").replace(/[״"׳']/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

// Hebrew stopwords — short, non-discriminating tokens. Kept local to avoid
// cross-file coupling with queryExpansion.ts.
const HEB_STOPWORDS_LOCAL = new Set([
  "של","על","עם","אם","או","את","זה","זו","הוא","היא","אני","אנו","אתה",
  "מה","מי","איך","למה","כי","גם","רק","כל","כמו","יותר","לא","כן","בין",
  "אבל","אך","יש","אין","לפי","לפני","אחרי","אצל","מן","אל","עד","ה",
]);

function strongTokens(text: string, limit = 3): string[] {
  const toks = (text || "")
    .replace(/["׳״'`.,;:?!()\[\]{}]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !HEB_STOPWORDS_LOCAL.has(t));
  toks.sort((a, b) => b.length - a.length);
  return [...new Set(toks)].slice(0, limit);
}

// Max length for a single text query handed to search_legal_chunks_text.
// Long Hebrew phrases (>~80 chars) consistently trip Postgres statement_timeout
// on full-text search. Above this threshold we degrade to a 3-token query.
const TEXT_QUERY_MAX_CHARS = 80;

/** Pick the single best text query per claim. Prefer a search_target that is
 *  short enough for PG full-text (<= 80 chars). If all targets are long, build
 *  a 3-token query from the strongest tokens across targets + statement. */
function pickTextQuery(claim: V2Claim): string {
  const candidates = (claim.search_targets || []).filter((q) => q && q.trim().length >= 4);
  // Prefer targets that fit under the FT length cap; among those, prefer the longest
  // (more specific). Among long-only candidates, degrade to token query.
  const short = candidates.filter((q) => q.length <= TEXT_QUERY_MAX_CHARS);
  if (short.length > 0) {
    return [...short].sort((a, b) => b.length - a.length)[0];
  }
  const source = [claim.statement, ...candidates].join(" ");
  const toks = strongTokens(source, 3);
  if (toks.length >= 2) return toks.join(" ");
  // Last resort: truncated statement.
  return claim.statement.slice(0, TEXT_QUERY_MAX_CHARS);
}

function pickVectorQuery(claim: V2Claim): string {
  // Use the claim statement directly — denser semantic signal than keyword targets.
  return claim.statement;
}

export async function retrieveClaims(
  args: RetrieveClaimsArgs,
): Promise<RetrieveClaimsResult> {
  const { adminClient, claims, depth, embed } = args;
  const perClaimCap = args.perClaimCap ?? (depth === "deep" ? 8 : 6);
  const maxConcurrency = args.maxConcurrency ?? 3;
  const t0 = Date.now();

  // ── Plan ─────────────────────────────────────────────────────────────
  // One text query per claim, one vector query per claim. Dedup by
  // normalized string so identical search_targets across claims share a
  // single DB call.
  const textPlan: Array<{ claimIds: string[]; query: string; norm: string }> = [];
  const vectorPlan: Array<{ claimIds: string[]; query: string; norm: string }> = [];

  const textByNorm = new Map<string, { claimIds: string[]; query: string; norm: string }>();
  const vecByNorm = new Map<string, { claimIds: string[]; query: string; norm: string }>();

  for (const claim of claims) {
    const tq = pickTextQuery(claim);
    const tn = normalizeQuery(tq);
    const tex = textByNorm.get(tn);
    if (tex) tex.claimIds.push(claim.id);
    else {
      const e = { claimIds: [claim.id], query: tq, norm: tn };
      textByNorm.set(tn, e);
      textPlan.push(e);
    }

    if (embed) {
      const vq = pickVectorQuery(claim);
      const vn = normalizeQuery(vq);
      const vex = vecByNorm.get(vn);
      if (vex) vex.claimIds.push(claim.id);
      else {
        const e = { claimIds: [claim.id], query: vq, norm: vn };
        vecByNorm.set(vn, e);
        vectorPlan.push(e);
      }
    }
  }

  const tele: RetrievalTelemetry = {
    total_text_queries_planned: claims.length, // 1 per claim before dedup
    total_text_queries_executed: 0,
    total_vector_queries_planned: embed ? claims.length : 0,
    total_vector_queries_executed: 0,
    max_concurrency: maxConcurrency,
    rpc_timeouts: 0,
    rpc_errors: 0,
    cache_hits: (claims.length - textPlan.length) + (embed ? claims.length - vectorPlan.length : 0),
    candidates_per_claim: [],
    total_candidates: 0,
    duration_ms: 0,
  };

  const limit = makeLimiter(maxConcurrency);
  const textResults = new Map<string, RawHit[]>(); // norm -> hits
  const vectorResults = new Map<string, RawHit[]>(); // norm -> hits

  // ── Text round ───────────────────────────────────────────────────────
  await Promise.all(textPlan.map((p) => limit(async () => {
    try {
      const { data, error } = await adminClient
        .rpc("search_legal_chunks_text", { search_query: p.query, match_count: 6 });
      tele.total_text_queries_executed++;
      if (error) {
        const msg = String(error.message || "");
        if (/statement timeout/i.test(msg)) tele.rpc_timeouts++;
        else tele.rpc_errors++;
        console.error(`[retrieve_v2 text] "${p.query.slice(0,60)}": ${msg}`);
        textResults.set(p.norm, []);
        return;
      }
      textResults.set(p.norm, Array.isArray(data) ? (data as RawHit[]) : []);
    } catch (e) {
      tele.rpc_errors++;
      console.error(`[retrieve_v2 text throw] "${p.query.slice(0,60)}":`, String((e as any)?.message ?? e));
      textResults.set(p.norm, []);
    }
  })));

  // ── Vector round (bounded by same limiter) ───────────────────────────
  if (embed && vectorPlan.length > 0) {
    await Promise.all(vectorPlan.map((p) => limit(async () => {
      try {
        const emb = await embed(p.query);
        if (!emb) { vectorResults.set(p.norm, []); return; }
        const { data, error } = await adminClient
          .rpc("match_legal_chunks", {
            query_embedding: JSON.stringify(emb),
            match_threshold: 0.55,
            match_count: 6,
          });
        tele.total_vector_queries_executed++;
        if (error) {
          const msg = String(error.message || "");
          if (/statement timeout/i.test(msg)) tele.rpc_timeouts++;
          else tele.rpc_errors++;
          console.error(`[retrieve_v2 vec] "${p.query.slice(0,60)}": ${msg}`);
          vectorResults.set(p.norm, []);
          return;
        }
        vectorResults.set(p.norm, Array.isArray(data) ? (data as RawHit[]) : []);
      } catch (e) {
        tele.rpc_errors++;
        console.error(`[retrieve_v2 vec throw] "${p.query.slice(0,60)}":`, String((e as any)?.message ?? e));
        vectorResults.set(p.norm, []);
      }
    })));
  }

  // ── Assemble per-claim packs (telemetry counters added AFTER fallback) ───
  const packMap = new Map<string, { claim: V2Claim; byChunk: Map<string, ClaimCandidateSource>; idxRef: { i: number } }>();

  const ingestInto = (byChunk: Map<string, ClaimCandidateSource>, claimId: string, idxRef: { i: number }, hits: RawHit[], origin: "text" | "vector") => {
    for (const h of hits) {
      if (!h?.chunk_id) continue;
      const score = typeof h.similarity === "number"
        ? Math.max(0, Math.min(1, h.similarity))
        : 0.5;
      const prev = byChunk.get(h.chunk_id);
      if (prev && prev.score >= score) continue;
      byChunk.set(h.chunk_id, {
        id: `${claimId}-S${++idxRef.i}`,
        chunkId: h.chunk_id,
        documentId: h.document_id,
        title: h.document_title ?? "",
        citation: h.document_citation ?? "",
        sourceType: h.source_type ?? "",
        sourceUrl: h.source_url ?? undefined,
        excerpt: typeof h.chunk_content === "string" ? h.chunk_content.slice(0, 600) : "",
        score,
        origin,
      });
    }
  };

  for (const claim of claims) {
    const tq = pickTextQuery(claim);
    const tn = normalizeQuery(tq);
    const vq = embed ? pickVectorQuery(claim) : null;
    const vn = vq ? normalizeQuery(vq) : null;

    const byChunk = new Map<string, ClaimCandidateSource>();
    const idxRef = { i: 0 };
    ingestInto(byChunk, claim.id, idxRef, textResults.get(tn) ?? [], "text");
    if (vn) ingestInto(byChunk, claim.id, idxRef, vectorResults.get(vn) ?? [], "vector");
    packMap.set(claim.id, { claim, byChunk, idxRef });
  }

  // ── Sequential fallback round for zero-candidate claims ──────────────
  // Runs concurrency=1 to avoid re-saturating the DB queue. Each claim
  // gets ONE text-token retry and ONE relaxed-threshold vector retry.
  const fallbackPerClaim: Array<{ claim_id: string; attempted: boolean; recovered: number; text_status?: string; vec_status?: string; text_query?: string }> = [];
  let fallbackAttempted = 0;
  let fallbackRecovered = 0;

  for (const claim of claims) {
    const entry = packMap.get(claim.id)!;
    if (entry.byChunk.size > 0) continue;

    fallbackAttempted++;
    const before = entry.byChunk.size;
    const toks = strongTokens(`${claim.statement} ${(claim.search_targets || []).join(" ")}`, 3);
    const tokenQuery = toks.join(" ");
    const rec: { claim_id: string; attempted: boolean; recovered: number; text_status?: string; vec_status?: string; text_query?: string } =
      { claim_id: claim.id, attempted: true, recovered: 0, text_query: tokenQuery };

    // Token text retry
    if (toks.length >= 2) {
      try {
        const { data, error } = await adminClient
          .rpc("search_legal_chunks_text", { search_query: tokenQuery, match_count: 6 });
        if (error) {
          const msg = String((error as any).message || "");
          if (/statement timeout/i.test(msg)) { tele.rpc_timeouts++; rec.text_status = "timeout"; }
          else { tele.rpc_errors++; rec.text_status = "error"; }
          console.error(`[retrieve_v2 fallback text] "${tokenQuery}": ${msg}`);
        } else {
          ingestInto(entry.byChunk, claim.id, entry.idxRef, Array.isArray(data) ? (data as RawHit[]) : [], "text");
          rec.text_status = "ok";
        }
      } catch (e) {
        tele.rpc_errors++;
        rec.text_status = "throw";
        console.error(`[retrieve_v2 fallback text throw] "${tokenQuery}":`, String((e as any)?.message ?? e));
      }
    } else {
      rec.text_status = "skipped_no_tokens";
    }

    // Relaxed vector retry (threshold 0.45)
    if (embed) {
      try {
        const emb = await embed(claim.statement);
        if (!emb) {
          rec.vec_status = "no_embed";
        } else {
          const { data, error } = await adminClient
            .rpc("match_legal_chunks", {
              query_embedding: JSON.stringify(emb),
              match_threshold: 0.45,
              match_count: 6,
            });
          if (error) {
            const msg = String((error as any).message || "");
            if (/statement timeout/i.test(msg)) { tele.rpc_timeouts++; rec.vec_status = "timeout"; }
            else { tele.rpc_errors++; rec.vec_status = "error"; }
            console.error(`[retrieve_v2 fallback vec] "${claim.statement.slice(0,60)}": ${msg}`);
          } else {
            ingestInto(entry.byChunk, claim.id, entry.idxRef, Array.isArray(data) ? (data as RawHit[]) : [], "vector");
            rec.vec_status = "ok";
          }
        }
      } catch (e) {
        tele.rpc_errors++;
        rec.vec_status = "throw";
        console.error(`[retrieve_v2 fallback vec throw] "${claim.statement.slice(0,60)}":`, String((e as any)?.message ?? e));
      }
    }

    rec.recovered = entry.byChunk.size - before;
    if (rec.recovered > 0) fallbackRecovered++;
    fallbackPerClaim.push(rec);
    console.log(`[retrieve_v2 fallback] claim=${claim.id} text=${rec.text_status} vec=${rec.vec_status} recovered=${rec.recovered}`);
  }

  (tele as any).fallback = {
    attempted: fallbackAttempted,
    recovered: fallbackRecovered,
    per_claim: fallbackPerClaim,
  };

  // ── Finalize packs + telemetry counters ──────────────────────────────
  const packs: ClaimCandidatePack[] = claims.map((claim) => {
    const entry = packMap.get(claim.id)!;
    const candidates = [...entry.byChunk.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, perClaimCap);

    const externalQueries = shouldFanOutExternal({ claim, candidates, depth })
      ? claim.search_targets.slice(0, depth === "deep" ? 2 : 1)
      : [];

    tele.candidates_per_claim.push({
      claim_id: claim.id,
      n: candidates.length,
      top_score: candidates[0]?.score ?? 0,
    });
    tele.total_candidates += candidates.length;

    return { claimId: claim.id, candidates, externalQueries };
  });

  tele.duration_ms = Date.now() - t0;
  return { packs, telemetry: tele };
}

function shouldFanOutExternal(args: {
  claim: V2Claim;
  candidates: ClaimCandidateSource[];
  depth: "fast" | "deep";
}): boolean {
  const { claim, candidates, depth } = args;
  if (depth !== "deep") return false;
  const wantsExternalType = claim.required_evidence.some((t) =>
    TYPES_REQUIRING_EXTERNAL.includes(t),
  );
  if (wantsExternalType && candidates.length < 3) return true;
  if (candidates.length === 0) return true;
  return false;
}

/** Telemetry summary for qa_logs.metadata.retrieval_v2. */
export function summarizeRetrieval(arg: ClaimCandidatePack[] | RetrieveClaimsResult) {
  // Back-compat: accept the old packs-only signature OR the new {packs,telemetry} shape.
  const packs: ClaimCandidatePack[] = Array.isArray(arg) ? arg : arg.packs;
  const tele = Array.isArray(arg) ? null : arg.telemetry;
  return {
    per_claim: packs.map((p) => ({
      claim_id: p.claimId,
      local_n: p.candidates.length,
      external_n: p.externalQueries.length,
      top_score: p.candidates[0]?.score ?? 0,
    })),
    total_candidates: packs.reduce((n, p) => n + p.candidates.length, 0),
    claims_with_zero: packs.filter((p) => p.candidates.length === 0).length,
    ...(tele ? { telemetry: tele } : {}),
  };
}
