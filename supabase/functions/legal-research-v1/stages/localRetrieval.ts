// P3 — Local DB retrieval. Per-query text + vector search.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Candidate, CAPS, Query, StageRun } from "../lib/types.ts";

type Admin = ReturnType<typeof createClient>;

const EMBED_TIMEOUT_MS = 8000;
const RPC_TIMEOUT_MS = 8000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return await Promise.race([
    p,
    new Promise<T | null>((res) => setTimeout(() => res(null), ms)),
  ]).catch(() => null);
}

// Diagnostic variant: distinguishes ok/empty/error/timeout and captures error msg.
async function runRpcDiag<T = unknown>(
  promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  ms: number,
): Promise<{ status: "ok" | "empty" | "error" | "timeout"; rows: T extends unknown[] ? T : never[]; error?: string }> {
  let timedOut = false;
  const timer = new Promise<null>((res) => setTimeout(() => { timedOut = true; res(null); }, ms));
  try {
    const res = (await Promise.race([promise, timer])) as
      | { data: unknown; error: { message?: string } | null }
      | null;
    if (timedOut || !res) return { status: "timeout", rows: [] as never[] };
    if (res.error) return { status: "error", rows: [] as never[], error: res.error.message || String(res.error) };
    const rows = (Array.isArray(res.data) ? res.data : []) as never[];
    return { status: rows.length ? "ok" : "empty", rows };
  } catch (e) {
    return { status: "error", rows: [] as never[], error: e instanceof Error ? e.message : String(e) };
  }
}

async function embed(text: string): Promise<number[] | null> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const r = await withTimeout(
      fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: text.slice(0, 2000),
          dimensions: 768,
        }),
      }),
      EMBED_TIMEOUT_MS,
    );
    if (!r || !r.ok) return null;
    const d = await r.json();
    return d.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

interface RpcRow {
  document_id: string;
  document_title: string;
  source_type: string;
  source_url?: string | null;
  chunk_content?: string | null;
  metadata?: Record<string, unknown>;
  similarity?: number;
}

function isPlaceholderTitle(t: string | null | undefined): boolean {
  const s = (t || "").trim();
  if (!s) return true;
  return /^(פרטי\s+מסמך|ללא\s+כותרת)/i.test(s);
}

export interface LocalRetrievalResult {
  candidates: Candidate[];
  per_query: Array<{
    claim_id: string;
    role: string;
    query_he: string;
    text_hits: number;
    vector_hits: number;
    kept: number;
    ms: number;
    diag: {
      text_status: "ok" | "empty" | "error" | "timeout";
      text_error?: string;
      vector_status: "ok" | "empty" | "error" | "timeout" | "no_embedding";
      vector_error?: string;
      embedding_length: number | null;
      expected_embedding_dim: number;
      top_text_titles: string[];
      top_vector_titles: string[];
    };
  }>;
  stage_runs: StageRun[];
  ms: number;
}

export async function runLocalRetrieval(
  admin: Admin,
  queries: Query[],
): Promise<LocalRetrievalResult> {
  const t0 = Date.now();
  const targets = queries.filter((q) => q.targets.includes("local_db"));
  const candidates: Candidate[] = [];
  const per_query: LocalRetrievalResult["per_query"] = [];

  await Promise.all(
    targets.map(async (q) => {
      const qStart = Date.now();
      const [textDiag, vec] = await Promise.all([
        runRpcDiag<RpcRow[]>(
          // deno-lint-ignore no-explicit-any
          (admin.rpc("search_legal_chunks_text", {
            search_query: q.query_he,
            match_count: CAPS.LOCAL_PER_QUERY,
          }) as any),
          RPC_TIMEOUT_MS,
        ),
        embed(q.query_he),
      ]);

      let vectorDiag: { status: "ok" | "empty" | "error" | "timeout" | "no_embedding"; rows: RpcRow[]; error?: string };
      if (!vec) {
        vectorDiag = { status: "no_embedding", rows: [] };
      } else {
        const d = await runRpcDiag<RpcRow[]>(
          // deno-lint-ignore no-explicit-any
          (admin.rpc("match_legal_chunks", {
            query_embedding: JSON.stringify(vec),
            match_threshold: 0.5,
            match_count: CAPS.LOCAL_PER_QUERY,
          }) as any),
          RPC_TIMEOUT_MS,
        );
        vectorDiag = d;
      }

      const textRows = textDiag.rows;
      const vecRows = vectorDiag.rows;

      let kept = 0;
      const seenInQuery = new Set<string>();
      const push = (m: RpcRow, method: "text" | "vector", weight: number) => {
        if (!m?.document_id || isPlaceholderTitle(m.document_title)) return;
        const meta = (m.metadata || {}) as Record<string, unknown>;
        if (meta.broken_title === true) return;
        const key = `${method}:${m.document_id}`;
        if (seenInQuery.has(key)) return;
        seenInQuery.add(key);
        candidates.push({
          candidate_id: crypto.randomUUID(),
          claim_id: q.claim_id,
          role: q.role,
          origin: "local_db",
          retrieval_method: method,
          title: m.document_title,
          source_type: m.source_type,
          document_id: m.document_id,
          source_url: m.source_url ?? null,
          snippet: (m.chunk_content || "").slice(0, 400),
          query_he: q.query_he,
          score: ((m.similarity ?? 0) as number) * weight,
          expected_source_type: q.expected_source_type,
          metadata: meta,
        });
        kept++;
      };
      for (const r of textRows) push(r, "text", 0.4);
      for (const r of vecRows) push(r, "vector", 1.0);

      per_query.push({
        claim_id: q.claim_id,
        role: q.role,
        query_he: q.query_he,
        text_hits: textRows.length,
        vector_hits: vecRows.length,
        kept,
        ms: Date.now() - qStart,
        diag: {
          text_status: textDiag.status,
          text_error: textDiag.error,
          vector_status: vectorDiag.status,
          vector_error: vectorDiag.error,
          embedding_length: vec ? vec.length : null,
          expected_embedding_dim: 768,
          top_text_titles: textRows.slice(0, 5).map((r) => r.document_title),
          top_vector_titles: vecRows.slice(0, 5).map((r) => r.document_title),
        },
      });
    }),
  );

  return {
    candidates,
    per_query,
    stage_runs: [{ stage: "local_retrieval", ms: Date.now() - t0, ok: true }],
    ms: Date.now() - t0,
  };
}
