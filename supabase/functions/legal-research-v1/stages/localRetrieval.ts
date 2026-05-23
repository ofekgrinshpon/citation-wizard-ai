// P3.2 — Local DB retrieval. Per-query exact authority + compact text + vector.
// - Exact-authority extraction reads original question + analyzer claims + planner query_he.
// - FTS uses compact_query_he (4–8 core legal terms), not the full normalized model text.
// - Vector recall capped: max 2 per claim (applied in candidatePool too); ordering ensured by score weights.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Candidate, CAPS, Claim, Query, StageRun } from "../lib/types.ts";

type Admin = ReturnType<typeof createClient>;

const EMBED_TIMEOUT_MS = 10_000;
const RPC_TIMEOUT_MS = 20_000;
const EXACT_TIMEOUT_MS = 8_000;

// ─── Compact legal-term query extractor for FTS ─────────────────────────────
// Goal: 4–8 strong terms / short phrases. Strip question words, role-noise.

const COMPACT_STOPWORDS = new Set([
  "האם", "מה", "מהם", "מהי", "מתי", "כיצד", "איך", "למה", "מדוע",
  "של", "על", "את", "אל", "עם", "או", "גם", "כי", "אם", "וגם", "אבל",
  "לפי", "בפני", "בית", "המשפט", "ידי", "פסק", "פסקי", "בעניין",
  "תנאי", "תנאים", "ל", "לכך", "כך", "זה", "זו", "אלו",
]);

// Strong multi-word legal phrases to preserve verbatim if present in source.
const PHRASE_BANK: string[] = [
  "פיצוי מוסכם", "פיצויים מוסכמים", "הפחתת פיצוי מוסכם", "תניית פיצוי מוסכם",
  "סעיף 15 לחוק החוזים", "חוק החוזים תרופות", "תרופות בשל הפרת חוזה",
  "השתק פלוגתא", "מעשה בית דין", "זהות פלוגתא", "הכרעה חיונית", "פסק דין חלוט",
  "השתק עילה", "השתק הגנה", "סופיות הדיון",
  "הבטחה מנהלית", "עילת הסבירות", "ביקורת שיפוטית",
  "סבירות", "מידתיות", "תום לב", "חוסר סמכות", "שיקול דעת",
  "צו מניעה זמני", "סעדים זמניים", "סיכויי תביעה", "מאזן הנוחות",
];

function detectPhrases(corpus: string): string[] {
  const found = new Set<string>();
  for (const p of PHRASE_BANK) {
    if (corpus.includes(p)) found.add(p);
  }
  return [...found];
}

function tokenize(s: string): string[] {
  return String(s || "")
    .replace(/["׳״''`,.;:?!()[\]{}<>«»—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t && t.length >= 2 && !COMPACT_STOPWORDS.has(t));
}

// Build compact FTS query from planner-query plus optional original-question/claim context.
function buildCompactQuery(plannerQuery: string, ctxCorpus: string): string {
  // 1. preserved phrases first (highest priority)
  const phrases = detectPhrases(plannerQuery + " " + ctxCorpus);
  // 2. residual single tokens from planner query
  const corpus = (plannerQuery + " " + ctxCorpus).slice(0, 600);
  const phraseTokens = new Set<string>(
    phrases.flatMap((p) => p.split(" ").filter((t) => t.length >= 2)),
  );
  const residual: string[] = [];
  const seen = new Set<string>();
  for (const tok of tokenize(plannerQuery)) {
    if (phraseTokens.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    residual.push(tok);
  }
  // Always include statute-section signal if present
  const ss = corpus.match(/סעיף\s+[\dא-ת]+/);
  if (ss && !residual.includes(ss[0]) && !phrases.some((p) => p.includes(ss[0]))) {
    residual.unshift(ss[0]);
  }
  const parts: string[] = [...phrases, ...residual];
  // Cap to ~8 terms / ~80 chars
  const out: string[] = [];
  let len = 0;
  for (const p of parts) {
    if (out.length >= 8) break;
    if (len + p.length + 1 > 80) break;
    out.push(p);
    len += p.length + 1;
  }
  return out.join(" ");
}

// ─── Exact authority detection ──────────────────────────────────────────────

interface ExactClue {
  kind: "statute_section" | "statute" | "regulation" | "docket";
  source: "question" | "claim" | "planner_query";
  law_name?: string;
  section?: string;
  docket?: string;
  search_terms: string[];
}

const STATUTE_SECTION_RE = /סעיף\s+([\dא-ת]+(?:[א-ת])?)\s+ל?(\s*חוק[^,?.\n]{2,80})/g;
const LAW_BARE_RE = /(חוק\s+[^,?.\n]{2,80}?(?:,\s*תש[\u0590-\u05FF""״'']+[-–]\d{4})?)/g;
const DOCKET_RE = /\b(בג"?ץ|בג״ץ|ע"?א|ע״א|רע"?א|רע״א|ע"?פ|ע״פ|דנ"?א|דנ״א|בש"?פ|בש״פ|תפ"?ח|תפ״ח)\s*\d{1,5}\/\d{2,4}\b/g;
const REGULATION_RE = /תקנות\s+[^,?.\n]{2,80}/g;

function detectExactClues(
  text: string,
  source: ExactClue["source"],
): ExactClue[] {
  const clues: ExactClue[] = [];
  for (const m of text.matchAll(DOCKET_RE)) {
    clues.push({ kind: "docket", source, docket: m[0], search_terms: [m[0]] });
  }
  for (const m of text.matchAll(STATUTE_SECTION_RE)) {
    const law = m[2].trim();
    clues.push({
      kind: "statute_section", source,
      law_name: law, section: m[1],
      search_terms: [law, `סעיף ${m[1]}`],
    });
  }
  // Bare law mentions only if no statute_section already covers it
  const seenLaws = new Set(clues.filter((c) => c.law_name).map((c) => c.law_name));
  for (const m of text.matchAll(LAW_BARE_RE)) {
    const law = m[1].trim();
    if (seenLaws.has(law)) continue;
    clues.push({ kind: "statute", source, law_name: law, search_terms: [law] });
    seenLaws.add(law);
  }
  for (const m of text.matchAll(REGULATION_RE)) {
    clues.push({ kind: "regulation", source, law_name: m[0], search_terms: [m[0]] });
  }
  return clues;
}

function dedupeClues(clues: ExactClue[]): ExactClue[] {
  const seen = new Map<string, ExactClue>();
  for (const c of clues) {
    const k = `${c.kind}|${(c.law_name || c.docket || "").toLowerCase()}|${c.section || ""}`;
    if (!seen.has(k)) seen.set(k, c);
  }
  return [...seen.values()];
}

async function exactAuthorityLookup(
  admin: Admin,
  clues: ExactClue[],
  role: string,
  perQueryLimit: number,
): Promise<{ rows: RpcRow[]; status: "ok" | "empty" | "error"; error?: string }> {
  if (!clues.length) return { rows: [], status: "empty" };
  const allowedTypes: string[] | null = (() => {
    if (role === "primary_statute" || role === "regulation") {
      return ["legislation_primary", "legislation_secondary"];
    }
    if (role === "binding_case_law" || role === "persuasive_case_law") {
      return ["caselaw"];
    }
    return null;
  })();
  const collected: RpcRow[] = [];
  try {
    for (const cl of clues) {
      const primary = cl.law_name || cl.docket || cl.search_terms[0];
      if (!primary || primary.length < 6) continue;
      const pat = `%${primary.replace(/[%_]/g, " ").slice(0, 80)}%`;
      const timer = new Promise<null>((res) => setTimeout(() => res(null), EXACT_TIMEOUT_MS));
      // deno-lint-ignore no-explicit-any
      let q: any = admin
        .from("legal_documents")
        .select("id,title,citation,source_type,source_url,metadata")
        .or(`title.ilike.${pat},citation.ilike.${pat}`)
        .limit(perQueryLimit);
      if (allowedTypes) q = q.in("source_type", allowedTypes);
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
  // Dedup by document_id
  const seen = new Set<string>();
  const unique = collected.filter((r) => {
    if (seen.has(r.document_id)) return false;
    seen.add(r.document_id);
    return true;
  });
  return { rows: unique, status: unique.length ? "ok" : "empty" };
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
    compact_query_he: string;
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
      top_exact_titles: string[];
      top_text_titles: string[];
      top_vector_titles: string[];
    };
  }>;
  stage_runs: StageRun[];
  ms: number;
  global_exact: {
    clues_from_question: ExactClue[];
    clues_from_claims: ExactClue[];
  };
}

export async function runLocalRetrieval(
  admin: Admin,
  queries: Query[],
  ctx: { question: string; claims: Claim[] },
): Promise<LocalRetrievalResult> {
  const t0 = Date.now();
  const targets = queries.filter((q) => q.targets.includes("local_db"));
  const candidates: Candidate[] = [];
  const per_query: LocalRetrievalResult["per_query"] = [];

  // Global exact clues from original question + analyzer claims (P3.2 #1)
  const questionClues = dedupeClues(detectExactClues(ctx.question || "", "question"));
  const claimClues = dedupeClues(
    (ctx.claims || []).flatMap((c) => detectExactClues(c.text_he || "", "claim")),
  );
  const ctxCorpus = [ctx.question, ...(ctx.claims || []).map((c) => c.text_he)].join(" ");

  await Promise.all(
    targets.map(async (q) => {
      const qStart = Date.now();
      const compact = buildCompactQuery(q.query_he, ctxCorpus);
      const plannerClues = detectExactClues(q.query_he, "planner_query");
      // Merge global + planner clues — but only inject question/claim clues
      // when the role is statute/regulation/case (otherwise they're noise).
      const roleAcceptsExact =
        q.role === "primary_statute" || q.role === "regulation" ||
        q.role === "binding_case_law" || q.role === "persuasive_case_law";
      const clues = dedupeClues([
        ...plannerClues,
        ...(roleAcceptsExact ? [...questionClues, ...claimClues] : []),
      ]);

      const exactP = exactAuthorityLookup(admin, clues, q.role, CAPS.LOCAL_PER_QUERY);
      const embedP = embed(compact || q.query_he);
      const textP = runRpcDiag<RpcRow[]>(
        // deno-lint-ignore no-explicit-any
        (admin.rpc("search_legal_chunks_text", {
          search_query: compact || q.query_he,
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
        // P3.2 #3: if we already have strong text hits, shrink vector quota.
        const vectorBudget = textDiag.rows.length >= 3 ? 2 : CAPS.LOCAL_PER_QUERY;
        const d = await runRpcDiag<RpcRow[]>(
          // deno-lint-ignore no-explicit-any
          (admin.rpc("match_legal_chunks", {
            query_embedding: JSON.stringify(embedRes.vec),
            match_threshold: 0.5,
            match_count: vectorBudget,
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
      // P3.2 #3: weights enforce exact > text > vector ordering inside the pool.
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
      for (const r of exactRows) push(r, "exact_authority", 1.5);
      for (const r of textRows) push(r, "text", 1.0);
      for (const r of vecRows) push(r, "vector", 0.6);

      per_query.push({
        claim_id: q.claim_id,
        role: q.role,
        original_query_he: q.query_he,
        compact_query_he: compact,
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
    global_exact: {
      clues_from_question: questionClues,
      clues_from_claims: claimClues,
    },
  };
}
