// Research V2 — Stage 2: Per-claim retrieval.
//
// Replaces the global source-pack pattern. Each claim is retrieved
// independently using its own search_targets, against the same local
// hybrid (text + vector) store the rest of the pipeline uses. Optional
// Perplexity round is gated by depth and by whether the claim's
// required_evidence includes types we cannot satisfy from the local DB
// alone (academic, committee, news).
//
// This module deliberately does NOT call Perplexity itself — it returns a
// list of suggested external queries that the caller (index.ts) can fan out
// using the existing Perplexity helper. That keeps secret access + rate
// limits centralized.
//
// Gated by env `RESEARCH_V2=true`. Not yet wired in index.ts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import type { V2Claim, V2EvidenceType } from "./researchPlan.ts";

export interface ClaimCandidateSource {
  /** Stable id within the claim's pack, e.g. "C1-S1". */
  id: string;
  /** Underlying chunk/document id from legal_document_chunks/legal_documents. */
  chunkId: string;
  documentId: string;
  title: string;
  citation: string;
  sourceType: string;
  sourceUrl?: string;
  excerpt: string;
  /** 0–1 hybrid score (text rank blended with cosine when both available). */
  score: number;
  /** Where this hit came from. */
  origin: "text" | "vector" | "external_pending";
}

export interface ClaimCandidatePack {
  claimId: string;
  candidates: ClaimCandidateSource[];
  /**
   * Search queries that should be fanned out externally (Perplexity) when
   * the claim's evidence requirements aren't covered locally and depth=deep.
   * Empty when no external round is recommended.
   */
  externalQueries: string[];
}

export interface RetrieveClaimsArgs {
  adminClient: SupabaseClient;
  claims: V2Claim[];
  depth: "fast" | "deep";
  /** Max local hits returned per claim (after merge). */
  perClaimCap?: number;
  /** Optional embedding function for vector search. If absent, text-only. */
  embed?: (text: string) => Promise<number[] | null>;
}

const TYPES_REQUIRING_EXTERNAL: V2EvidenceType[] = ["academic", "committee", "news"];

/**
 * Run per-claim retrieval in parallel. Pure read-only — no writes to DB,
 * no Perplexity calls. Returns one ClaimCandidatePack per claim.
 */
export async function retrieveClaims(args: RetrieveClaimsArgs): Promise<ClaimCandidatePack[]> {
  const { adminClient, claims, depth, embed } = args;
  const perClaimCap = args.perClaimCap ?? (depth === "deep" ? 8 : 6);

  return await Promise.all(
    claims.map((claim) => retrieveForClaim({ claim, adminClient, depth, perClaimCap, embed })),
  );
}

async function retrieveForClaim(args: {
  claim: V2Claim;
  adminClient: SupabaseClient;
  depth: "fast" | "deep";
  perClaimCap: number;
  embed?: (text: string) => Promise<number[] | null>;
}): Promise<ClaimCandidatePack> {
  const { claim, adminClient, depth, perClaimCap, embed } = args;
  const queries = claim.search_targets.length > 0
    ? claim.search_targets
    : [claim.statement];

  // Text round — one RPC per query, capped small.
  const textPromises = queries.slice(0, depth === "deep" ? 4 : 3).map(async (q) => {
    const { data } = await adminClient
      .rpc("search_legal_chunks_text", { search_query: q, match_count: 6 })
      .then((r: { data: unknown }) => r)
      .catch(() => ({ data: null }));
    return Array.isArray(data) ? (data as RawHit[]) : [];
  });

  // Vector round — only when an embed function is available. Cap at 2 queries
  // to bound HNSW contention; per-claim retrieval already fans out across N
  // claims in parallel.
  const vectorPromises: Promise<RawHit[]>[] = embed
    ? queries.slice(0, 2).map(async (q) => {
        try {
          const emb = await embed(q);
          if (!emb) return [];
          const { data } = await adminClient
            .rpc("match_legal_chunks", {
              query_embedding: JSON.stringify(emb),
              match_threshold: 0.55,
              match_count: 6,
            })
            .then((r: { data: unknown }) => r)
            .catch(() => ({ data: null }));
          return Array.isArray(data) ? (data as RawHit[]) : [];
        } catch {
          return [];
        }
      })
    : [];

  const [textResults, vectorResults] = await Promise.all([
    Promise.all(textPromises),
    Promise.all(vectorPromises),
  ]);

  // Merge + dedupe by chunk_id, keep best score per chunk.
  const byChunk = new Map<string, ClaimCandidateSource>();
  let idx = 0;
  const ingest = (hits: RawHit[], origin: "text" | "vector") => {
    for (const h of hits) {
      if (!h?.chunk_id) continue;
      const score = typeof h.similarity === "number" ? Math.max(0, Math.min(1, h.similarity)) : 0.5;
      const prev = byChunk.get(h.chunk_id);
      if (prev && prev.score >= score) continue;
      byChunk.set(h.chunk_id, {
        id: `${claim.id}-S${++idx}`,
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
  textResults.forEach((r) => ingest(r, "text"));
  vectorResults.forEach((r) => ingest(r, "vector"));

  const candidates = [...byChunk.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, perClaimCap);

  // Decide whether external (Perplexity) round is recommended for this claim.
  const externalQueries = shouldFanOutExternal({ claim, candidates, depth })
    ? queries.slice(0, depth === "deep" ? 2 : 1)
    : [];

  return { claimId: claim.id, candidates, externalQueries };
}

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

function shouldFanOutExternal(args: {
  claim: V2Claim;
  candidates: ClaimCandidateSource[];
  depth: "fast" | "deep";
}): boolean {
  const { claim, candidates, depth } = args;
  // Fast never fans out external by default — keeps latency tight.
  if (depth !== "deep") return false;
  // If the claim requires external-only evidence types and local pack is thin,
  // request an external round.
  const wantsExternalType = claim.required_evidence.some((t) =>
    TYPES_REQUIRING_EXTERNAL.includes(t),
  );
  if (wantsExternalType && candidates.length < 3) return true;
  // Or when nothing was found locally at all.
  if (candidates.length === 0) return true;
  return false;
}

/** Telemetry summary for qa_logs.metadata.retrieval_v2. */
export function summarizeRetrieval(packs: ClaimCandidatePack[]) {
  return {
    per_claim: packs.map((p) => ({
      claim_id: p.claimId,
      local_n: p.candidates.length,
      external_n: p.externalQueries.length,
      top_score: p.candidates[0]?.score ?? 0,
    })),
    total_candidates: packs.reduce((n, p) => n + p.candidates.length, 0),
    claims_with_zero: packs.filter((p) => p.candidates.length === 0).length,
  };
}
