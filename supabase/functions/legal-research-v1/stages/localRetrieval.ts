// P3.1 — Local DB retrieval. Per-query exact authority + text + vector.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Candidate, CAPS, Query, StageRun } from "../lib/types.ts";

type Admin = ReturnType<typeof createClient>;

const EMBED_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 20_000;
const EXACT_TIMEOUT_MS = 8_000;

// ─── Query normalization ────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "האם", "מה", "מהם", "מהי", "מתי", "כיצד", "איך", "למה", "מדוע",
  "של", "על", "את", "אל", "עם", "או", "גם", "כי", "אם", "וגם", "אבל",
  "פסק", "דין", "פסקי", "בעניין", "תנאי", "תנאים", "סף", "קביעת",
  "ידי", "לפי", "בפני", "בית", "המשפט",
]);

// We keep "בית המשפט" + "העליון" as multi-token concepts when possible by
// not always stripping them; only de-noised when extra noise is heavy.

function normalizeQueryForFts(q: string): string {
  let s = String(q || "").trim();
  // strip quotes/punctuation that confuses FTS
  s = s.replace(/["׳״''`,.;:?!()[\]{}<>«»—–]/g, " ");
  // collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // dedupe identical tokens (keep first)
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const tok of s.split(" ")) {
    if (!tok) continue;
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    const k = tok.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    tokens.push(tok);
  }
  let out = tokens.join(" ");
  // cap to ~110 chars; prefer cutting on a space
  if (out.length > 110) {
    const cut = out.slice(0, 110);
    const lastSpace = cut.lastIndexOf(" ");
    out = lastSpace > 60 ? cut.slice(0, lastSpace) : cut;
  }
  return out;
}

// ─── Exact authority detection ──────────────────────────────────────────────

interface ExactClue {
  kind: "statute_section" | "statute" | "regulation" | "docket";
  law_name?: string;       // e.g. "חוק החוזים (תרופות בשל הפרת חוזה)"
  section?: string;        // e.g. "15"
  docket?: string;         // e.g. 'ע"א 10208/16'
  search_terms: string[];  // ILIKE-friendly fragments
}

const STATUTE_SECTION_RE = /סעיף\s+([\dא-ת]+(?:[א-ת])?)\s+ל?( חוק[^,?.\n]{2,80})/;
const LAW_BARE_RE = /( חוק[^,?.\n]{2,80}?(?:,\s*תש[\u0590-\u05FF""״'']+[-–]\d{4})?)/;
const DOCKET_RE = /\b(בג"?ץ|בג״ץ|ע"?א|ע״א|רע"?א|רע״א|ע"?פ|ע״פ|דנ"?א|דנ״א|בש"?פ|בש״פ|תפ"?ח|תפ״ח)\s*\d{1,5}\/\d{2,4}\b/;
const REGULATION_RE = /תקנות?\s+[^,?.\n]{2,80}/;

function detectExactClues(q: string): ExactClue[] {
  const clues: ExactClue[] = [];
  const docket = q.match(DOCKET_RE);
  if (docket) {
    clues.push({ kind: "docket", docket: docket[0], search_terms: [docket[0]] });
  }
  const ss = q.match(STATUTE_SECTION_RE);
  if (ss) {
    const law = ss[2].trim();
    clues.push({
      kind: "statute_section",
      law_name: law,
      section: ss[1],
      search_terms: [law, `סעיף ${ss[1]}`],
    });
  } else {
    const bare = q.match(LAW_BARE_RE);
    if (bare) {
      const law = bare[1].trim();
      clues.push({ kind: "statute", law_name: law, search_terms: [law] });
    }
  }
  const reg = q.match(REGULATION_RE);
  if (reg) {
    clues.push({ kind: "regulation", law_name: reg[0], search_terms: [reg[0]] });
  }
  return clues;
}

async function exactAuthorityLookup(
  admin: Admin,
  clues: ExactClue[],
  perQueryLimit: number,
): Promise<{ rows: RpcRow[]; status: "ok" | "empty" | "error"; error?: string }> {
  if (!clues.length) return { rows: [], status: "empty" };
  const collected: RpcRow[] = [];
  try {
    for (const cl of clues) {
      // Pick the most distinctive search term for ILIKE.
      const primary = cl.law_name || cl.docket || cl.search_terms[0];
      if (!primary) continue;
      const pat = `%${primary.replace(/[%_]/g, " ").slice(0, 80)}%`;
      const timer = new Promise<null>((res) => setTimeout(() => res(null), EXACT_TIMEOUT_MS));
      // deno-lint-ignore no-explicit-any
      const q = (admin
        .from("legal_documents")
        .select("id,title,citation,source_type,source_url,metadata")
        .or(`title.ilike.${pat},citation.ilike.${pat}`)
        .limit(perQueryLimit) as any);
      const r = await Promise.race([q, timer]);
      if (!r || r.error || !r.data) continue;
      for (const d of r.data) {
        collected.push({
          document_id: d.id,
          document_title: d.title,
          source_type: d.source_type,
          source_url: d.source_url ?? null,
          chunk_content: null,
          metadata: d.metadata || {},
          similarity: cl.kind === "statute_section" ? 1.0 : 0.9,
        });
      }
    }
  } catch (e) {
    return { rows: collected, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
  return { rows: collected, status: collected.length ? "ok" : "empty" };
}

// ─── RPC helpers ────────────────────────────────────────────────────────────

async function runRpcDiag<T = unknown>(
  promise: PromiseLike<{ data: T | null; error: { message?: string } | null }>,
  ms: number,
): Promise<{ status: "ok" | "empty" | "error" | "timeout"; rows: T extends unknown[] ? T : never[]; error?: string; ms: number }> {
  const t0 = Date.now();
  let timedOut = false;
  const timer = new Promise<null>((res) => setTimeout(() => { timedOut = true; res(null); }, ms));
  try {
    const res = (await Promise.race([promise, timer])) as
      | { data: unknown; error: { message?: string } | null }
      | null;
    const elapsed = Date.now() - t0;
    if (timedOut || !res) return { status: "timeout", rows: [] as never[], ms: elapsed };
    if (res.error) return { status: "error", rows: [] as never[], error: res.error.message || String(res.error), ms: elapsed };
    const rows = (Array.isArray(res.data) ? res.data : []) as never[];
    return { status: rows.length ? "ok" : "empty", rows, ms: elapsed };
  } catch (e) {
    return { status: "error", rows: [] as never[], error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

async function embed(text: string): Promise<{ vec: number[] | null; ms: number; error?: string }> {
  const t0 = Date.now();
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { vec: null, ms: 0, error: "no_api_key" };
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 2000),
        dimensions: 768,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!r.ok) return { vec: null, ms: Date.now() - t0, error: `http_${r.status}` };
    const d = await r.json();
    return { vec: d.data?.[0]?.embedding ?? null, ms: Date.now() - t0 };
  } catch (e) {
    return { vec: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
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
    original_query_he: string;
    normalized_query_he: string;
    exact_clues: ExactClue[];
    exact_hits: number;
    text_hits: number;
    vector_hits: number;
    kept: number;
    ms: number;
    diag: {
      exact_status: "ok" | "empty" | "error";
      exact_error?: string;
      exact_ms: number;
      text_status: "ok" | "empty" | "error" | "timeout";
      text_error?: string;
      text_ms: number;
      vector_status: "ok" | "empty" | "error" | "timeout" | "no_embedding";
      vector_error?: string;
      vector_ms: number;
      embedding_length: number | null;
      embedding_ms: number;
      embedding_error?: string;
      expected_embedding_dim: number;
      top_exact_titles: string[];
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
      const normalized = normalizeQueryForFts(q.query_he);
      const clues = detectExactClues(q.query_he);

      const exactP = exactAuthorityLookup(admin, clues, CAPS.LOCAL_PER_QUERY);
      const embedP = embed(normalized || q.query_he);
      const textP = runRpcDiag<RpcRow[]>(
        // deno-lint-ignore no-explicit-any
        (admin.rpc("search_legal_chunks_text", {
          search_query: normalized || q.query_he,
          match_count: CAPS.LOCAL_PER_QUERY,
        }) as any),
        RPC_TIMEOUT_MS,
      );

      const exactT0 = Date.now();
      const [exactRes, embedRes, textDiag] = await Promise.all([exactP, embedP, textP]);
      const exactMs = Date.now() - exactT0;

      let vectorDiag: {
        status: "ok" | "empty" | "error" | "timeout" | "no_embedding";
        rows: RpcRow[];
        error?: string;
        ms: number;
      };
      if (!embedRes.vec) {
        vectorDiag = { status: "no_embedding", rows: [], ms: 0, error: embedRes.error };
      } else {
        const d = await runRpcDiag<RpcRow[]>(
          // deno-lint-ignore no-explicit-any
          (admin.rpc("match_legal_chunks", {
            query_embedding: JSON.stringify(embedRes.vec),
            match_threshold: 0.5,
            match_count: CAPS.LOCAL_PER_QUERY,
          }) as any),
          RPC_TIMEOUT_MS,
        );
        vectorDiag = d;
      }

      const exactRows = exactRes.rows;
      const textRows = textDiag.rows;
      const vecRows = vectorDiag.rows;

      let kept = 0;
      const seenInQuery = new Set<string>();
      const push = (m: RpcRow, method: "text" | "vector" | "exact_authority", weight: number) => {
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
          retrieval_method: method as any,
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
      for (const r of exactRows) push(r, "exact_authority", 1.2);
      for (const r of textRows) push(r, "text", 0.4);
      for (const r of vecRows) push(r, "vector", 1.0);

      per_query.push({
        claim_id: q.claim_id,
        role: q.role,
        original_query_he: q.query_he,
        normalized_query_he: normalized,
        exact_clues: clues,
        exact_hits: exactRows.length,
        text_hits: textRows.length,
        vector_hits: vecRows.length,
        kept,
        ms: Date.now() - qStart,
        diag: {
          exact_status: exactRes.status,
          exact_error: exactRes.error,
          exact_ms: exactMs,
          text_status: textDiag.status,
          text_error: textDiag.error,
          text_ms: textDiag.ms,
          vector_status: vectorDiag.status,
          vector_error: vectorDiag.error,
          vector_ms: vectorDiag.ms,
          embedding_length: embedRes.vec ? embedRes.vec.length : null,
          embedding_ms: embedRes.ms,
          embedding_error: embedRes.error,
          expected_embedding_dim: 768,
          top_exact_titles: exactRows.slice(0, 5).map((r) => r.document_title),
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
